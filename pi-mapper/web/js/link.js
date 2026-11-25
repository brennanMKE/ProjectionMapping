// WebSocket link to mapd with auto-reconnect and clock-offset estimation.
//
// offset = server clock - local clock (ms). Cue times from the server are in
// server time; toLocal() converts them. On the Pi itself the projector page
// shares the server's clock, so the offset is ~0, but the same code lets a
// laptop or phone browser follow cues too.

export class Link {
  constructor({ role, name = '', onMessage, onState }) {
    this.role = role;
    this.name = name;
    this.onMessage = onMessage;
    this.onState = onState || (() => {});
    this.offset = 0;
    this.bestRtt = Infinity;
    this.samples = [];
    this.ws = null;
    this.open = false;
    this.backoff = 500;
    this.connect();
    setInterval(() => this.ping(), 10000);
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.backoff = 500;
      this.onState(true);
      this.send({ type: 'hello', role: this.role, name: this.name });
      // a quick burst of pings to settle the clock offset
      for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 150);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'pong') return this.onPong(m);
      if (m.type === 'welcome') this.offset = m.serverTime - Date.now();
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.open = false;
      this.onState(false);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  ping() { this.send({ type: 'ping', t0: Date.now() }); }

  onPong(m) {
    const now = Date.now();
    const rtt = now - m.t0;
    const off = m.ts - (m.t0 + now) / 2;
    // keep the sample with the lowest round trip from the last few
    this.samples.push({ rtt, off });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off;
    this.bestRtt = best.rtt;
  }

  serverNow() { return Date.now() + this.offset; }
  toLocal(serverMs) { return serverMs - this.offset; }
}

// Run fn at a server timestamp: setTimeout gets close, a short spin does the rest.
export function runAt(link, serverMs, fn) {
  const target = link.toLocal(serverMs);
  const wait = target - Date.now();
  const fire = () => {
    while (Date.now() < target) { /* spin, at most a few ms */ }
    fn();
  };
  if (wait > 8) setTimeout(fire, wait - 6);
  else fire();
}
