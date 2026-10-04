package dev.phonkalphabet.opencode.mobile;

import android.app.Activity;
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

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
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
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void deliverShare() {
        if (webView == null || !pageLoaded || pendingShareJs == null) return;
        webView.evaluateJavascript(pendingShareJs, null);
        pendingShareJs = null;
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
            pendingExportAsset = null;
            notifyGatewayExport(false, "Save cancelled");
            return;
        }
        Uri destination = data.getData();
        try (InputStream input = getAssets().open(pendingExportAsset == null ? "opencode-unofficial-gateway.zip" : pendingExportAsset);
             OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("Android could not open the selected destination");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.flush();
            pendingExportAsset = null;
            notifyGatewayExport(true, "File saved");
        } catch (Exception error) {
            pendingExportAsset = null;
            notifyGatewayExport(false, error.getMessage() == null ? "Could not save gateway package" : error.getMessage());
        }
    }

    private void notifyGatewayExport(boolean ok, String message) {
        String script = "window.gatewayExportFinished && window.gatewayExportFinished(" + ok + "," + JSONObject.quote(message) + ")";
        webView.evaluateJavascript(script, null);
    }

    public final class FileBridge {
        @JavascriptInterface public void exportGatewayPackage() {
            export("opencode-unofficial-gateway.zip", "OpenCode-Unofficial-Gateway-1.0.0.zip", "application/zip");
        }
        @JavascriptInterface public void exportWindowsInstaller() {
            export("opencode-unofficial-setup.exe", "OpenCode-Unofficial-Setup-1.0.0.exe", "application/vnd.microsoft.portable-executable");
        }
        @JavascriptInterface public void exportDebianInstaller() {
            export("opencode-unofficial-gateway.deb", "opencode-unofficial-gateway_1.0.0_all.deb", "application/vnd.debian.binary-package");
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
