# Preserve native methods exposed to the bundled WebView application.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
