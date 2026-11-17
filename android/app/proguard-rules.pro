# Keep WebView JS bridge methods
-keepclassmembers class fun.bitdev.telechat.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
