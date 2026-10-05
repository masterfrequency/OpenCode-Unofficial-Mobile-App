package dev.phonkalphabet.opencode.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.webkit.ValueCallback;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int EXPORT_GATEWAY_REQUEST = 4107;
    private static final int VOICE_REQUEST = 4108;
    private static final int FILE_CHOOSER_REQUEST = 4109;
    private static final int MAX_SHARED_BYTES = 6 * 1024 * 1024;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingShareJs;
    private boolean pageLoaded;
    private WebView webView;
    private TokenVault tokenVault;
    private int topInsetCss;
    private int bottomInsetCss;
    private FrameLayout container;
    private String pendingExportAsset;
    private String pendingExportText;
    private String pendingLaunchJs;
    private static volatile boolean visible;
    private static volatile MainActivity current;
    private static final int NOTIFICATION_REQUEST = 4110;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        Notifier.ensureChannels(this);
        tokenVault = new TokenVault(this);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF05060B);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                applyCssInsets();
                deliverShare();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        webView.addJavascriptInterface(new VaultBridge(), "AndroidVault");
        webView.addJavascriptInterface(new FileBridge(), "AndroidFiles");
        webView.addJavascriptInterface(new DeviceBridge(), "AndroidDevice");
        // The WebView lives inside a container that is padded by the navigation
        // bar / keyboard. This makes the WebView genuinely shorter, so the page
        // viewport is exact on every Android version (including 15+, where
        // adjustResize is ignored because edge-to-edge is enforced).
        container = new FrameLayout(this);
        container.setBackgroundColor(0xFF05060B);
        container.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            int padBottom = 0;
            int padLeft = 0;
            int padRight = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
                top = bars.top;
                bottom = bars.bottom;
                padBottom = Math.max(bottom, ime);
                padLeft = bars.left;
                padRight = bars.right;
            } else {
                top = insets.getStableInsetTop();
                bottom = insets.getStableInsetBottom();
            }
            if (view.getPaddingBottom() != padBottom || view.getPaddingLeft() != padLeft || view.getPaddingRight() != padRight) view.setPadding(padLeft, 0, padRight, padBottom);
            float density = getResources().getDisplayMetrics().density;
            topInsetCss = Math.round(top / density);
            // On R+ the container already keeps content clear of the nav bar.
            bottomInsetCss = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? 0 : Math.round(bottom / density);
            applyCssInsets();
            return insets;
        });
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(container);
        handleShareIntent(getIntent());
        if (state == null) handleLaunchIntent(getIntent());
    }

    static boolean isVisible() { return visible; }

    /** Called from TaskService when a watched session changes while the app is on screen. */
    static void dispatchTaskEvent(String kind, String session, String title) {
        MainActivity activity = current;
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (activity.webView == null) return;
            activity.webView.evaluateJavascript("window.nativeTaskEvent&&window.nativeTaskEvent(" + JSONObject.quote(kind) + "," + JSONObject.quote(session) + "," + JSONObject.quote(title == null ? "" : title) + ")", null);
        });
    }

    @Override protected void onResume() {
        super.onResume();
        visible = true;
    }

    @Override protected void onPause() {
        visible = false;
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Notifier.ACTION_NEW_CHAT.equals(action)) {
            pendingLaunchJs = "window.nativeNewChat&&window.nativeNewChat()";
        } else if (Notifier.ACTION_OPEN_SESSION.equals(action)) {
            String profile = intent.getStringExtra(Notifier.EXTRA_PROFILE);
            String session = intent.getStringExtra(Notifier.EXTRA_SESSION);
            String title = intent.getStringExtra(Notifier.EXTRA_TITLE);
            if (profile == null || session == null) return;
            Notifier.clear(this, session);
            pendingLaunchJs = "window.nativeOpenSession&&window.nativeOpenSession(" + JSONObject.quote(profile) + "," + JSONObject.quote(session) + "," + JSONObject.quote(title == null ? "" : title) + ")";
        } else return;
        intent.setAction(null);
        deliverShare();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
        handleLaunchIntent(intent);
    }

    private void deliverShare() {
        if (webView == null || !pageLoaded) return;
        if (pendingShareJs != null) { webView.evaluateJavascript(pendingShareJs, null); pendingShareJs = null; }
        if (pendingLaunchJs != null) { webView.evaluateJavascript(pendingLaunchJs, null); pendingLaunchJs = null; }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_REQUEST || webView == null) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        webView.evaluateJavascript("window.notifyPermissionResult&&window.notifyPermissionResult(" + granted + ")", null);
    }

    @SuppressWarnings("deprecation")
    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        try {
            JSONObject payload = new JSONObject();
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) payload.put("text", text);
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (one != null) uris.add(one);
            } else {
                ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (many != null) uris.addAll(many);
            }
            JSONArray files = new JSONArray();
            for (Uri uri : uris) {
                JSONObject file = readSharedFile(uri);
                if (file != null) files.put(file);
            }
            payload.put("files", files);
            pendingShareJs = "window.receiveShared&&window.receiveShared(" + payload.toString() + ")";
            deliverShare();
        } catch (Exception ignored) { }
        intent.setAction(null);
    }

    private JSONObject readSharedFile(Uri uri) {
        try {
            String mime = getContentResolver().getType(uri);
            if (mime == null) return null;
            if (!(mime.startsWith("image/") || mime.startsWith("text/") || mime.equals("application/pdf"))) return null;
            String name = "shared";
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0 && cursor.getString(index) != null) name = cursor.getString(index);
                }
            }
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) return null;
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    bytes.write(buffer, 0, read);
                    if (bytes.size() > MAX_SHARED_BYTES) return null;
                }
                JSONObject file = new JSONObject();
                file.put("name", name);
                file.put("mime", mime);
                file.put("dataUrl", "data:" + mime + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                return file;
            }
        } catch (Exception error) {
            return null;
        }
    }

    private void applyCssInsets() {
        if (webView == null) return;
        String script = "document.documentElement.style.setProperty('--android-top-inset','" + topInsetCss + "px');" +
            "document.documentElement.style.setProperty('--android-bottom-inset','" + bottomInsetCss + "px');" +
            "window.updateViewportInsets&&window.updateViewportInsets();";
        webView.evaluateJavascript(script, null);
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false", result -> {
            if (!"true".equals(result)) MainActivity.super.onBackPressed();
        });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileCallback != null) {
                Uri[] result = null;
                try { result = WebChromeClient.FileChooserParams.parseResult(resultCode, data); } catch (Exception ignored) { }
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        if (requestCode == VOICE_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (results != null && !results.isEmpty()) {
                    webView.evaluateJavascript("window.voiceResult&&window.voiceResult(" + JSONObject.quote(results.get(0)) + ")", null);
                }
            }
            return;
        }
        if (requestCode != EXPORT_GATEWAY_REQUEST) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            boolean conversation = pendingExportText != null;
            pendingExportAsset = null;
            pendingExportText = null;
            notifyExport(conversation, false, "Save cancelled");
            return;
        }
        Uri destination = data.getData();
        boolean conversation = pendingExportText != null;
        try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("Android could not open the selected destination");
            if (conversation) {
                output.write(pendingExportText.getBytes(StandardCharsets.UTF_8));
            } else {
                try (InputStream input = getAssets().open(pendingExportAsset == null ? "opencode-unofficial-gateway.zip" : pendingExportAsset)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }
            }
            output.flush();
            pendingExportAsset = null;
            pendingExportText = null;
            notifyExport(conversation, true, conversation ? "Conversation saved" : "File saved");
        } catch (Exception error) {
            pendingExportAsset = null;
            pendingExportText = null;
            notifyExport(conversation, false, error.getMessage() == null ? "Could not save file" : error.getMessage());
        }
    }

    private void notifyExport(boolean conversation, boolean ok, String message) {
        if (conversation) {
            webView.evaluateJavascript("window.conversationExportFinished&&window.conversationExportFinished(" + ok + "," + JSONObject.quote(message) + ")", null);
        } else notifyGatewayExport(ok, message);
    }

    private void notifyGatewayExport(boolean ok, String message) {
        String script = "window.gatewayExportFinished && window.gatewayExportFinished(" + ok + "," + JSONObject.quote(message) + ")";
        webView.evaluateJavascript(script, null);
    }

    public final class FileBridge {
        @JavascriptInterface public void exportText(String filename, String content) {
            runOnUiThread(() -> {
                try {
                    pendingExportAsset = null;
                    pendingExportText = content == null ? "" : content;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("text/markdown");
                    intent.putExtra(Intent.EXTRA_TITLE, filename == null || filename.trim().isEmpty() ? "OpenCode-conversation.md" : filename);
                    startActivityForResult(intent, EXPORT_GATEWAY_REQUEST);
                } catch (Exception error) {
                    pendingExportText = null;
                    webView.evaluateJavascript("window.conversationExportFinished&&window.conversationExportFinished(false,'Android could not open the file picker')", null);
                }
            });
        }

        @JavascriptInterface public void shareText(String filename, String content) {
            runOnUiThread(() -> {
                try {
                    if (content != null && content.length() > 300000) {
                        webView.evaluateJavascript("window.conversationExportFinished&&window.conversationExportFinished(false,'This conversation is too large to share directly. Save the Markdown file instead.')", null);
                        return;
                    }
                    Intent intent = new Intent(Intent.ACTION_SEND);
                    intent.setType("text/markdown");
                    intent.putExtra(Intent.EXTRA_SUBJECT, filename == null ? "OpenCode conversation" : filename);
                    intent.putExtra(Intent.EXTRA_TEXT, content == null ? "" : content);
                    startActivity(Intent.createChooser(intent, "Share conversation"));
                } catch (Exception error) {
                    webView.evaluateJavascript("window.conversationExportFinished&&window.conversationExportFinished(false,'Sharing is not available on this device')", null);
                }
            });
        }

        @JavascriptInterface public void exportGatewayPackage() {
            export("opencode-unofficial-gateway.zip", "OpenCode-Unofficial-Gateway-1.1.0.zip", "application/zip");
        }
        @JavascriptInterface public void exportWindowsInstaller() {
            export("opencode-unofficial-setup.exe", "OpenCode-Unofficial-Setup-1.1.0.exe", "application/vnd.microsoft.portable-executable");
        }
        @JavascriptInterface public void exportDebianInstaller() {
            export("opencode-unofficial-gateway.deb", "opencode-unofficial-gateway_1.1.0_all.deb", "application/vnd.debian.binary-package");
        }
        private void export(String asset, String filename, String mime) {
            runOnUiThread(() -> {
                try (InputStream ignored = getAssets().open(asset)) {
                    pendingExportAsset = asset;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mime);
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    startActivityForResult(intent, EXPORT_GATEWAY_REQUEST);
                } catch (Exception error) {
                    notifyGatewayExport(false, "This installer is not bundled in this build");
                }
            });
        }
    }

    public final class DeviceBridge {
        @JavascriptInterface public void tap() {
            runOnUiThread(() -> { if (webView != null) webView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); });
        }

        @JavascriptInterface public void setTextZoom(int percent) {
            final int safe = Math.max(85, Math.min(140, percent));
            runOnUiThread(() -> { if (webView != null) webView.getSettings().setTextZoom(safe); });
        }

        /** kind: done | attention | error. Honors the user's system touch-feedback setting. */
        @JavascriptInterface public void haptic(String kind) {
            runOnUiThread(() -> {
                if (webView == null) return;
                int effect;
                if ("attention".equals(kind)) effect = HapticFeedbackConstants.LONG_PRESS;
                else if ("error".equals(kind)) effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                else effect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
                webView.performHapticFeedback(effect);
            });
        }

        @JavascriptInterface public boolean notificationsAllowed() {
            return Notifier.allowed(MainActivity.this);
        }

        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_REQUEST);
                } else {
                    boolean granted = Notifier.allowed(MainActivity.this);
                    webView.evaluateJavascript("window.notifyPermissionResult&&window.notifyPermissionResult(" + granted + ")", null);
                }
            });
        }

        /** Start watching a session so the foreground service can alert when it finishes or needs approval. */
        @JavascriptInterface public void watch(String profile, String session, String title, String baseUrl, String directory) {
            TaskService.watch(MainActivity.this, profile, session, title, baseUrl, directory);
        }

        @JavascriptInterface public void unwatch(String session) {
            if (session != null) TaskService.unwatch(session);
        }

        @JavascriptInterface public void clearNotifications(String session) {
            Notifier.clear(MainActivity.this, session);
        }

        /** Remember the latest session for the launcher shortcut and widget. State: idle | working | done. */
        @JavascriptInterface public void recordSession(String profile, String session, String title, String state) {
            if (profile == null || session == null) return;
            LastSession.save(MainActivity.this, profile, session, title, state);
        }

        @JavascriptInterface public void forgetSession() {
            LastSession.clear(MainActivity.this);
        }

        @JavascriptInterface public void voice() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your message");
                    startActivityForResult(intent, VOICE_REQUEST);
                } catch (Exception error) {
                    webView.evaluateJavascript("notify('Voice input is not available on this device')", null);
                }
            });
        }

        @JavascriptInterface public void openUrl(String url) {
            if (url == null) return;
            final String clean = url.trim();
            if (!(clean.startsWith("https://") || clean.startsWith("http://"))) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(clean))); }
                catch (Exception ignored) { }
            });
        }

        @JavascriptInterface public String label() {
            String manufacturer = Build.MANUFACTURER == null ? "Android" : Build.MANUFACTURER.trim();
            String model = Build.MODEL == null ? "device" : Build.MODEL.trim();
            if (model.toLowerCase().startsWith(manufacturer.toLowerCase())) return model;
            return manufacturer + " " + model;
        }
    }

    public final class VaultBridge {
        @JavascriptInterface public String put(String slot, String value) {
            try {
                tokenVault.put(slot, value);
                return "";
            } catch (Exception error) {
                return error.getMessage() == null ? "secure storage failed" : error.getMessage();
            }
        }

        @JavascriptInterface public String read(String slot) {
            JSONObject result = new JSONObject();
            try {
                boolean exists = tokenVault.has(slot);
                result.put("ok", true);
                result.put("exists", exists);
                result.put("value", exists ? tokenVault.get(slot) : "");
                result.put("error", JSONObject.NULL);
            } catch (Exception error) {
                try {
                    result.put("ok", false);
                    result.put("exists", tokenVault.has(slot));
                    result.put("value", "");
                    result.put("error", error.getMessage() == null ? "secure token could not be decrypted" : error.getMessage());
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"exists\":false,\"value\":\"\",\"error\":\"secure storage failed\"}";
                }
            }
            return result.toString();
        }

        @JavascriptInterface public boolean has(String slot) {
            try { return tokenVault.has(slot); }
            catch (Exception ignored) { return false; }
        }

        @JavascriptInterface public void remove(String slot) {
            tokenVault.remove(slot);
        }
    }
}
