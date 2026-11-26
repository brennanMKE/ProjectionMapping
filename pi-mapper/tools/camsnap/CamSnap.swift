// CamSnap: background agent that serves webcam JPEGs on 127.0.0.1.
//
//   GET /snap.jpg?camera=<name substring>&w=<width>   fresh JPEG
//   GET /cameras                                      camera names, one per line
//   GET /status                                       JSON: permission + active camera
//   GET /quit                                         exit the agent
//
// Environment: CAMSNAP_PORT (default 8999), CAMSNAP_IDLE_SECONDS (default 600;
// the capture session stops after this long without a request, 0 = never).

import AppKit
import AVFoundation
import CoreImage
import Foundation
import Network

let port = UInt16(ProcessInfo.processInfo.environment["CAMSNAP_PORT"] ?? "") ?? 8999
let idleSeconds = Double(ProcessInfo.processInfo.environment["CAMSNAP_IDLE_SECONDS"] ?? "") ?? 600
let requestTimeout: TimeInterval = 5.0
/// Frames captured within this long of (re)starting a camera are skipped so
/// auto exposure and white balance can settle.
let warmup: TimeInterval = 0.8

func log(_ message: String) {
    NSLog("CamSnap: %@", message)
}

func authString(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
}

enum SnapError: Error {
    case permission(String)
    case noCamera(String)
    case configure(String)
    case timeout
    case encode

    var http: (Int, String) {
        switch self {
        case .permission(let s): return (403, "camera permission \(s)")
        case .noCamera(let s): return (404, "no camera matching '\(s)'")
        case .configure(let s): return (500, "could not open camera: \(s)")
        case .timeout: return (504, "timed out waiting for a frame")
        case .encode: return (500, "JPEG encoding failed")
        }
    }
}

final class Camera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let queue = DispatchQueue(label: "camsnap.capture")
    private let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let ciContext = CIContext()

    // All state below is touched only on `queue`.
    private var input: AVCaptureDeviceInput?
    private var startedAt = Date.distantPast
    private var waiters: [(id: UUID, notBefore: Date, width: Int, done: (Result<Data, SnapError>) -> Void)] = []
    private var lastRequest = Date()

    override init() {
        super.init()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }
        if idleSeconds > 0 {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 30, repeating: 30)
            timer.setEventHandler { [weak self] in self?.checkIdle() }
            timer.resume()
            idleTimer = timer
        }
    }
    private var idleTimer: DispatchSourceTimer?

    static func devices() -> [AVCaptureDevice] {
        var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .external]
        if #available(macOS 14.0, *) { types.append(.continuityCamera) }
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }

    /// Requested substring first; otherwise Logitech, then the first external
    /// (non-Continuity) camera, then any external, then built-in.
    static func pick(_ query: String?) -> AVCaptureDevice? {
        let all = devices()
        if let q = query, !q.isEmpty {
            return all.first { $0.localizedName.localizedCaseInsensitiveContains(q) }
        }
        if let d = all.first(where: { $0.localizedName.localizedCaseInsensitiveContains("Logitech") }) { return d }
        let external = all.filter { $0.deviceType == .external }
        if let d = external.first { return d }
        if let d = all.first(where: { $0.deviceType != .builtInWideAngleCamera }) { return d }
        return all.first
    }

    var activeName: String? {
        queue.sync { input?.device.localizedName }
    }

    func snap(camera query: String?, width: Int, done: @escaping (Result<Data, SnapError>) -> Void) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status == .authorized else {
            return done(.failure(.permission(authString(status))))
        }
        queue.async {
            self.lastRequest = Date()
            // Keep the current camera when no camera was named and one is open.
            let device: AVCaptureDevice?
            if (query ?? "").isEmpty, let current = self.input?.device, current.isConnected {
                device = current
            } else {
                device = Camera.pick(query)
            }
            guard let device else { return done(.failure(.noCamera(query ?? "(default)"))) }
            do {
                try self.ensureRunning(device)
            } catch let e as SnapError {
                return done(.failure(e))
            } catch {
                return done(.failure(.configure("\(error)")))
            }
            let id = UUID()
            let notBefore = max(Date(), self.startedAt.addingTimeInterval(warmup))
            self.waiters.append((id, notBefore, width, done))
            self.queue.asyncAfter(deadline: .now() + requestTimeout) {
                if let i = self.waiters.firstIndex(where: { $0.id == id }) {
                    let w = self.waiters.remove(at: i)
                    w.done(.failure(.timeout))
                }
            }
        }
    }

    // queue only
    private func ensureRunning(_ device: AVCaptureDevice) throws {
        if input?.device.uniqueID != device.uniqueID {
            log("switching to \(device.localizedName)")
            session.beginConfiguration()
            if let old = input { session.removeInput(old) }
            input = nil
            let newInput = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(newInput) else {
                session.commitConfiguration()
                throw SnapError.configure("session refused input")
            }
            session.addInput(newInput)
            input = newInput
            chooseFormat(device)
            session.commitConfiguration()
            startedAt = Date()
        }
        if !session.isRunning {
            session.startRunning()
            startedAt = Date()
            log("session started (\(device.localizedName))")
        }
    }

    /// Largest format up to 1920 wide that does at least 15 fps.
    private func chooseFormat(_ device: AVCaptureDevice) {
        let candidates = device.formats.filter { f in
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return d.width <= 1920 && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 15 }
        }
        guard let best = candidates.max(by: {
            let a = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            let b = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
            return Int(a.width) * Int(a.height) < Int(b.width) * Int(b.height)
        }) else { return }
        do {
            try device.lockForConfiguration()
            device.activeFormat = best
            device.unlockForConfiguration()
        } catch {
            log("could not set format: \(error)")
        }
    }

    // queue only
    private func checkIdle() {
        guard session.isRunning, waiters.isEmpty,
              Date().timeIntervalSince(lastRequest) > idleSeconds else { return }
        log("idle, stopping session")
        session.stopRunning()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !waiters.isEmpty, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let now = Date()
        let ready = waiters.filter { $0.notBefore <= now }
        guard !ready.isEmpty else { return }
        waiters.removeAll { $0.notBefore <= now }
        let image = CIImage(cvPixelBuffer: pixels)
        for w in ready {
            if let jpeg = encode(image, width: w.width) {
                w.done(.success(jpeg))
            } else {
                w.done(.failure(.encode))
            }
        }
    }

    private func encode(_ image: CIImage, width: Int) -> Data? {
        var img = image
        let srcWidth = image.extent.width
        if width > 0, CGFloat(width) < srcWidth {
            let s = CGFloat(width) / srcWidth
            img = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
        }
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!
        let opts = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.85]
        return ciContext.jpegRepresentation(of: img, colorSpace: cs, options: opts)
    }
}

// MARK: - HTTP

final class Server {
    let camera: Camera
    let listener: NWListener
    private let queue = DispatchQueue(label: "camsnap.http", attributes: .concurrent)

    init(camera: Camera) throws {
        self.camera = camera
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        listener = try NWListener(using: params)
    }

    func start() {
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: log("listening on 127.0.0.1:\(port)")
            case .failed(let e):
                log("listener failed: \(e)")
                exit(1)
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        listener.start(queue: queue)
    }

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }
            if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buf[..<end.lowerBound], as: UTF8.self)
                self.handle(head, conn)
            } else if error != nil || isComplete || buf.count > 65536 {
                conn.cancel()
            } else {
                self.receive(conn, buffer: buf)
            }
        }
    }

    private func handle(_ head: String, _ conn: NWConnection) {
        let parts = head.split(separator: "\r\n", maxSplits: 1).first?.split(separator: " ") ?? []
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            return respond(conn, 405, "text/plain", Data("method not allowed\n".utf8))
        }
        let comps = URLComponents(string: String(parts[1]))
        let path = comps?.path ?? "/"
        let query = Dictionary((comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })

        switch path {
        case "/snap.jpg", "/snap":
            let width = Int(query["w"] ?? "") ?? 1280
            camera.snap(camera: query["camera"], width: width) { result in
                switch result {
                case .success(let jpeg): self.respond(conn, 200, "image/jpeg", jpeg)
                case .failure(let e):
                    let (code, msg) = e.http
                    self.respond(conn, code, "text/plain", Data((msg + "\n").utf8))
                }
            }
        case "/cameras":
            let names = Camera.devices().map { $0.localizedName }.joined(separator: "\n")
            respond(conn, 200, "text/plain", Data((names + "\n").utf8))
        case "/status", "/":
            let auth = authString(AVCaptureDevice.authorizationStatus(for: .video))
            let active = camera.activeName.map { "\"\(jsonEscape($0))\"" } ?? "null"
            let body = "{\"auth\":\"\(auth)\",\"camera\":\(active),\"pid\":\(getpid())}\n"
            respond(conn, 200, "application/json", Data(body.utf8))
        case "/quit":
            respond(conn, 200, "text/plain", Data("bye\n".utf8)) { exit(0) }
        default:
            respond(conn, 404, "text/plain", Data("not found\n".utf8))
        }
    }

    private func respond(_ conn: NWConnection, _ code: Int, _ type: String, _ body: Data, then: (() -> Void)? = nil) {
        let reason = HTTPURLResponse.localizedString(forStatusCode: code).capitalized
        var head = "HTTP/1.1 \(code) \(reason)\r\n"
        head += "Content-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in
            conn.cancel()
            then?()
        })
    }
}

func jsonEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
}

// MARK: - main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let camera = Camera()
let server: Server
do {
    server = try Server(camera: camera)
} catch {
    log("cannot create listener: \(error)")
    exit(1)
}
server.start()

switch AVCaptureDevice.authorizationStatus(for: .video) {
case .notDetermined:
    log("requesting camera access")
    AVCaptureDevice.requestAccess(for: .video) { granted in
        log("camera access \(granted ? "granted" : "denied")")
    }
case let s:
    log("camera access: \(authString(s))")
}

app.run()
