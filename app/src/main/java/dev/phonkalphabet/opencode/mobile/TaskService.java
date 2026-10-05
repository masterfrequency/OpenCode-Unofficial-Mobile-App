package dev.phonkalphabet.opencode.mobile;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Foreground service that keeps OpenCode sessions "watched" while the app is in the background.
 * It holds the same authenticated /event stream the web UI uses and posts a notification when a
 * watched session finishes, fails, or asks for permission. Tokens never leave TokenVault.
 */
public final class TaskService extends Service {
    private static final long MAX_WATCH_MS = 6L * 60 * 60 * 1000;
    private static final Object LOCK = new Object();
    private static final Map<String, Watch> WATCHES = new LinkedHashMap<>();
    private static volatile TaskService instance;

    private final Map<String, Stream> streams = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private TokenVault vault;

    static final class Watch {
        final String profile; final String session; final String baseUrl; final String directory;
        volatile String title; final long startedAt = System.currentTimeMillis();
        String baseId = ""; boolean baseFinished; boolean baselineTaken; String lastPermission = "";
        Watch(String profile, String session, String title, String baseUrl, String directory) {
            this.profile = profile; this.session = session; this.title = title; this.baseUrl = baseUrl; this.directory = directory;
        }
    }

    /* ── Registry (called from the JS bridge) ─────────────────────────── */
    static void watch(Context context, String profile, String session, String title, String baseUrl, String directory) {
        if (profile == null || session == null || baseUrl == null || !baseUrl.startsWith("https://")) return;
        synchronized (LOCK) {
            Watch existing = WATCHES.get(session);
            if (existing != null && existing.profile.equals(profile)) existing.title = title;
            else WATCHES.put(session, new Watch(profile, session, title, baseUrl, directory == null ? "" : directory));
        }
        Context app = context.getApplicationContext();
        TaskService running = instance;
        if (running != null) { running.sync(); return; }
        try { app.startForegroundService(new Intent(app, TaskService.class)); }
        catch (Exception ignored) { synchronized (LOCK) { WATCHES.remove(session); } }
    }

    static void unwatch(String session) {
        synchronized (LOCK) { WATCHES.remove(session); }
        TaskService running = instance;
        if (running != null) running.sync();
    }

    static boolean isWatching(String session) {
        synchronized (LOCK) { return WATCHES.containsKey(session); }
    }

    /* ── Service lifecycle ────────────────────────────────────────────── */
    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        vault = new TokenVault(this);
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opencode-unofficial:tasks");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_WATCH_MS);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        showForeground();
        sync();
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        instance = null;
        synchronized (streams) { for (Stream stream : streams.values()) stream.stop(); streams.clear(); }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    /** Android 15 caps dataSync services; stop cleanly instead of being killed. (No @Override: API 35 method.) */
    public void onTimeout(int startId, int fgsType) {
        synchronized (LOCK) { WATCHES.clear(); }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void showForeground() {
        int count; String first = null;
        synchronized (LOCK) { count = WATCHES.size(); for (Watch watch : WATCHES.values()) { first = watch.title; break; } }
        android.app.Notification notification = Notifier.foreground(this, Math.max(1, count), first);
        if (Build.VERSION.SDK_INT >= 29) startForeground(Notifier.FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(Notifier.FOREGROUND_ID, notification);
    }

    /** Start/stop one event stream per profile and end the service when nothing is watched. */
    void sync() {
        main.post(() -> {
            long now = System.currentTimeMillis();
            List<String> profiles = new ArrayList<>();
            synchronized (LOCK) {
                WATCHES.values().removeIf((watch) -> now - watch.startedAt > MAX_WATCH_MS);
                for (Watch watch : WATCHES.values()) if (!profiles.contains(watch.profile)) profiles.add(watch.profile);
            }
            synchronized (streams) {
                for (String profile : profiles) {
                    Stream stream = streams.get(profile);
                    if (stream == null || !stream.alive()) { stream = new Stream(profile); streams.put(profile, stream); stream.start(); }
                }
                List<String> gone = new ArrayList<>();
                for (String profile : streams.keySet()) if (!profiles.contains(profile)) gone.add(profile);
                for (String profile : gone) { Stream stream = streams.remove(profile); if (stream != null) stream.stop(); }
            }
            if (profiles.isEmpty()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return; }
            showForeground();
        });
    }

    private static Watch find(String profile, String session) {
        synchronized (LOCK) {
            Watch watch = WATCHES.get(session);
            return watch != null && watch.profile.equals(profile) ? watch : null;
        }
    }

    private static List<Watch> forProfile(String profile) {
        List<Watch> list = new ArrayList<>();
        synchronized (LOCK) { for (Watch watch : WATCHES.values()) if (watch.profile.equals(profile)) list.add(watch); }
        return list;
    }

    private void finish(Watch watch, boolean failed) {
        synchronized (LOCK) { if (WATCHES.get(watch.session) != watch) return; WATCHES.remove(watch.session); }
        LastSession.setState(this, watch.session, "done");
        if (MainActivity.isVisible()) MainActivity.dispatchTaskEvent(failed ? "failed" : "done", watch.session, watch.title);
        else Notifier.done(this, watch.profile, watch.session, watch.title, failed);
        sync();
    }

    private void attention(Watch watch, String permissionId) {
        if (permissionId.isEmpty() || permissionId.equals(watch.lastPermission)) return;
        watch.lastPermission = permissionId;
        if (MainActivity.isVisible()) MainActivity.dispatchTaskEvent("permission", watch.session, watch.title);
        else Notifier.attention(this, watch.profile, watch.session, watch.title);
    }

    /* ── Event stream ─────────────────────────────────────────────────── */
    private final class Stream implements Runnable {
        private final String profile;
        private volatile boolean stopped;
        private volatile HttpURLConnection connection;
        private Thread thread;

        Stream(String profile) { this.profile = profile; }
        void start() { thread = new Thread(this, "opencode-events"); thread.setDaemon(true); thread.start(); }
        boolean alive() { return thread != null && thread.isAlive() && !stopped; }
        void stop() {
            stopped = true;
            HttpURLConnection current = connection;
            if (current != null) current.disconnect();
            if (thread != null) thread.interrupt();
        }

        @Override public void run() {
            int failures = 0;
            while (!stopped) {
                List<Watch> watches = forProfile(profile);
                if (watches.isEmpty()) break;
                Watch first = watches.get(0);
                HttpURLConnection conn = null;
                try {
                    String token = vault.get(profile);
                    if (token == null || token.isEmpty()) { dropProfile(); break; }
                    conn = open(first, "/api/event", token, "text/event-stream", 75000);
                    connection = conn;
                    if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
                    failures = 0;
                    catchUp(token);
                    readEvents(conn.getInputStream());
                } catch (Exception error) {
                    if (stopped) break;
                    failures++;
                } finally {
                    connection = null;
                    if (conn != null) conn.disconnect();
                }
                if (stopped) break;
                if (failures > 14) { dropProfile(); break; }
                try { Thread.sleep(Math.min(30000L, 1000L << Math.min(failures, 5))); }
                catch (InterruptedException interrupted) { break; }
            }
            sync();
        }

        private void dropProfile() {
            synchronized (LOCK) { WATCHES.values().removeIf((watch) -> watch.profile.equals(profile)); }
        }

        private void readEvents(InputStream input) throws IOException {
            BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
            StringBuilder data = new StringBuilder();
            String line;
            while (!stopped && (line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0) { handle(data.toString()); data.setLength(0); }
                    if (forProfile(profile).isEmpty()) return;
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                }
            }
        }

        private void handle(String json) {
            try {
                JSONObject event = new JSONObject(json);
                String type = event.optString("type");
                JSONObject props = event.optJSONObject("properties");
                if (props == null) return;
                String sessionId = props.optString("sessionID", "");
                if (sessionId.isEmpty()) { JSONObject info = props.optJSONObject("info"); if (info != null) sessionId = info.optString("sessionID", ""); }
                if (sessionId.isEmpty()) return;
                Watch watch = find(profile, sessionId);
                if (watch == null) return;
                if (type.equals("session.idle")) finish(watch, false);
                else if (type.equals("session.status")) {
                    JSONObject status = props.optJSONObject("status");
                    if (status != null && "idle".equals(status.optString("type"))) finish(watch, false);
                } else if (type.equals("session.error")) {
                    JSONObject error = props.optJSONObject("error");
                    boolean aborted = error != null && "MessageAbortedError".equals(error.optString("name"));
                    if (aborted) unwatch(sessionId); else finish(watch, true);
                } else if (type.equals("permission.replied")) {
                    Notifier.clearAttention(TaskService.this, sessionId);
                } else if (type.startsWith("permission.")) {
                    attention(watch, props.optString("id", props.optString("requestID", "")));
                }
            } catch (Exception ignored) { }
        }

        /** After (re)connecting, look at the latest message so a task that ended in the gap is not missed. */
        private void catchUp(String token) {
            for (Watch watch : forProfile(profile)) {
                if (stopped) return;
                HttpURLConnection conn = null;
                try {
                    conn = open(watch, "/api/session/" + URLEncoder.encode(watch.session, "UTF-8") + "/message", token, "application/json", 20000);
                    if (conn.getResponseCode() != 200) continue;
                    JSONArray messages = new JSONArray(readAll(conn.getInputStream()));
                    if (messages.length() == 0) continue;
                    JSONObject last = messages.getJSONObject(messages.length() - 1);
                    JSONObject info = last.optJSONObject("info");
                    if (info == null) continue;
                    String id = info.optString("id", "");
                    boolean assistant = "assistant".equals(info.optString("role"));
                    JSONObject time = info.optJSONObject("time");
                    boolean finished = assistant && ((time != null && time.has("completed") && !time.isNull("completed")) || info.has("error"));
                    if (!watch.baselineTaken) { watch.baselineTaken = true; watch.baseId = id; watch.baseFinished = finished; if (finished) continue; }
                    if (finished && !(id.equals(watch.baseId) && watch.baseFinished)) {
                        JSONObject error = info.optJSONObject("error");
                        boolean aborted = error != null && "MessageAbortedError".equals(error.optString("name"));
                        if (aborted) unwatch(watch.session); else finish(watch, error != null);
                    }
                } catch (Exception ignored) {
                } finally { if (conn != null) conn.disconnect(); }
            }
        }

        private HttpURLConnection open(Watch watch, String path, String token, String accept, int readTimeout) throws IOException {
            String query = watch.directory.isEmpty() ? "" : "?directory=" + URLEncoder.encode(watch.directory, "UTF-8");
            String base = watch.baseUrl.endsWith("/") ? watch.baseUrl.substring(0, watch.baseUrl.length() - 1) : watch.baseUrl;
            HttpURLConnection conn = (HttpURLConnection) new URL(base + path + query).openConnection();
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", accept);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(readTimeout);
            return conn;
        }

        private String readAll(InputStream input) throws IOException {
            StringBuilder out = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                char[] buffer = new char[8192]; int read;
                while ((read = reader.read(buffer)) != -1) { out.append(buffer, 0, read); if (out.length() > 24 * 1024 * 1024) throw new IOException("response too large"); }
            }
            return out.toString();
        }
    }
}
