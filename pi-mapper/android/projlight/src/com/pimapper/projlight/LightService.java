package com.pimapper.projlight;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Foreground service with a minimal HTTP server on port 8765.
 *
 *   GET  /status            {"light":"on|off|unknown","powerOnMode":"..."}
 *   POST /light/off         vendor setBacklightEnable(false)
 *   POST /light/on          vendor setBacklightEnable(true)
 *   POST /hdmi              open the HDMI input
 *   POST /poweron/<mode>    DIRECT | MEMORY | STANDBY
 *
 * Every request needs header "X-Token: <token>". Set the token once with:
 *   adb shell am start-foreground-service -n com.pimapper.projlight/.LightService --es token <token>
 *
 * The vendor classes (com.softwinner.tv) are reached by reflection, so the
 * app builds against the plain Android SDK.
 */
public class LightService extends Service {
    static final String TAG = "projlight";
    static final int PORT = 8765;
    private volatile ServerSocket server;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(1, notification());
        if (intent != null && intent.hasExtra("token")) {
            prefs().edit().putString("token", intent.getStringExtra("token")).apply();
        }
        if (server == null) {
            new Thread(this::serve, "projlight-http").start();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private SharedPreferences prefs() { return getSharedPreferences("projlight", MODE_PRIVATE); }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("projlight", "projlight", NotificationManager.IMPORTANCE_LOW));
        return new Notification.Builder(this, "projlight")
                .setContentTitle("projlight")
                .setContentText("Light control on port " + PORT)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .build();
    }

    // ------------------------------------------------------------ vendor API

    private Object systemManager() throws Exception {
        Class<?> c = Class.forName("com.softwinner.tv.AwTvSystemManager");
        return c.getMethod("getInstance", Context.class).invoke(null, getApplicationContext());
    }

    int setLight(boolean on) throws Exception {
        Object m = systemManager();
        Object r = m.getClass().getMethod("setBacklightEnable", boolean.class).invoke(m, on);
        return (Integer) r;
    }

    String getLight() {
        try {
            Object m = systemManager();
            boolean on = (Boolean) m.getClass().getMethod("getBacklightEnable").invoke(m);
            return on ? "on" : "off";
        } catch (Throwable t) {
            Log.w(TAG, "getBacklightEnable", t);
            return "unknown";
        }
    }

    String getPowerOnMode() {
        try {
            Object m = systemManager();
            return String.valueOf(m.getClass().getMethod("getPowerOnMode").invoke(m));
        } catch (Throwable t) {
            return "unknown";
        }
    }

    int setPowerOnMode(String mode) throws Exception {
        Object m = systemManager();
        Class<?> e = Class.forName("com.softwinner.tv.common.AwTvSystemTypes$EnumPowerMode");
        Object value = null;
        for (Object v : e.getEnumConstants()) {
            if (v.toString().endsWith(mode.toUpperCase())) value = v;
        }
        if (value == null) throw new IllegalArgumentException("unknown mode " + mode);
        Method set = m.getClass().getMethod("setPowerOnMode", e);
        return (Integer) set.invoke(m, value);
    }

    void openHdmi() {
        Intent i = new Intent();
        i.setClassName("com.softwinner.awlivetv", "com.softwinner.awlivetv.MainActivity");
        i.putExtra("input_source", "HDMI1"); // a cold start crashes without it
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    // ------------------------------------------------------------ HTTP

    private void serve() {
        try (ServerSocket ss = new ServerSocket(PORT, 8, InetAddress.getByName("0.0.0.0"))) {
            server = ss;
            Log.i(TAG, "listening on " + PORT);
            while (true) {
                try (Socket s = ss.accept()) {
                    s.setSoTimeout(5000);
                    handle(s);
                } catch (Exception e) {
                    Log.w(TAG, "request", e);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "server", e);
            server = null;
        }
    }

    private void handle(Socket s) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String request = in.readLine();
        if (request == null) return;
        String token = null, line;
        while ((line = in.readLine()) != null && !line.isEmpty()) {
            int c = line.indexOf(':');
            if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("X-Token")) token = line.substring(c + 1).trim();
        }
        String[] parts = request.split(" ");
        String method = parts[0], path = parts.length > 1 ? parts[1] : "/";
        String want = prefs().getString("token", null);

        int code = 200;
        String body;
        try {
            if (want == null || !want.equals(token)) {
                code = 403;
                body = "{\"error\":\"bad or missing X-Token\"}";
            } else if (method.equals("GET") && path.equals("/status")) {
                body = "{\"light\":\"" + getLight() + "\",\"powerOnMode\":\"" + getPowerOnMode() + "\"}";
            } else if (method.equals("POST") && path.equals("/light/off")) {
                body = "{\"result\":" + setLight(false) + "}";
            } else if (method.equals("POST") && path.equals("/light/on")) {
                body = "{\"result\":" + setLight(true) + "}";
            } else if (method.equals("POST") && path.equals("/hdmi")) {
                openHdmi();
                body = "{\"result\":0}";
            } else if (method.equals("POST") && path.startsWith("/poweron/")) {
                body = "{\"result\":" + setPowerOnMode(path.substring("/poweron/".length())) + "}";
            } else {
                code = 404;
                body = "{\"error\":\"not found\"}";
            }
        } catch (Throwable t) {
            Log.e(TAG, path, t);
            Throwable cause = t.getCause() != null ? t.getCause() : t;
            code = 500;
            body = "{\"error\":\"" + cause.toString().replace("\"", "'") + "\"}";
        }
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        OutputStream out = s.getOutputStream();
        out.write(("HTTP/1.0 " + code + " OK\r\nContent-Type: application/json\r\nContent-Length: "
                + b.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }
}
