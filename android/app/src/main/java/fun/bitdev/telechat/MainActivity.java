package fun.bitdev.telechat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_NOTIF_PERMISSION = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String baseUrl;
    private String baseHost;
    private String pendingOpenChatId;
    private boolean pendingOpenUpdates = false;
    private volatile boolean activityVisible = true;
    private UpdateManager updateManager;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        baseUrl = getString(R.string.app_url);
        baseHost = Uri.parse(baseUrl).getHost();

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#17212B"));
        window.setNavigationBarColor(Color.parseColor("#0E1621"));

        // Root container applies status-bar, cutout, navigation-bar, and IME insets cleanly (fixes Android 15 edge-to-edge overlap)
        FrameLayout rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(Color.parseColor("#17212B"));
        rootContainer.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()
                );
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            } else {
                v.setPadding(
                    insets.getSystemWindowInsetLeft(),
                    insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(),
                    insets.getSystemWindowInsetBottom()
                );
                return insets.consumeSystemWindowInsets();
            }
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0E1621"));
        rootContainer.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootContainer);
        rootContainer.requestApplyInsets();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.getDecorView();
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(baseHost)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                if (updateManager != null) {
                    pushUpdateStateToWebView(updateManager.toStateJson());
                }
                if (pendingOpenUpdates) {
                    pendingOpenUpdates = false;
                    openUpdatesInWebView();
                } else if (pendingOpenChatId != null) {
                    String chatId = pendingOpenChatId;
                    pendingOpenChatId = null;
                    openChatInWebView(chatId);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        });

        updateManager = new UpdateManager(this, this::pushUpdateStateToWebView);
        updateManager.cleanupOldApks(true);
        MessageService.clearLegacyForegroundNotification(this);

        requestNotificationPermissionIfNeeded();
        startMessageServiceIfPermitted();
        MessagePollJobService.schedule(this);
        handleIntent(getIntent());
        webView.loadUrl(baseUrl);
        updateManager.checkForUpdate(false, true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityVisible = true;
        MessageService.clearLegacyForegroundNotification(this);
        startMessageServiceIfPermitted();
        if (updateManager != null) {
            updateManager.onActivityResumed(this);
            pushUpdateStateToWebView(updateManager.toStateJson());
        }
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if (window.__telechatSyncState) window.__telechatSyncState(true);", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        activityVisible = false;
        CookieManager.getInstance().flush();
        if (hasNotificationPermission()) {
            MessagePollJobService.schedule(this);
        }
        if (webView != null) {
            webView.evaluateJavascript("if (window.__telechatSyncState) window.__telechatSyncState(false);", null);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(UpdateManager.EXTRA_OPEN_UPDATES, false)) {
            if (webView != null && webView.getProgress() == 100) {
                openUpdatesInWebView();
            } else {
                pendingOpenUpdates = true;
            }
            return;
        }
        String chatId = intent.getStringExtra(MessageService.EXTRA_CHAT_ID);
        if (chatId != null && !chatId.isEmpty()) {
            if (webView != null && webView.getProgress() == 100) {
                openChatInWebView(chatId);
            } else {
                pendingOpenChatId = chatId;
            }
        }
    }

    private void openUpdatesInWebView() {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(
            "if (window.__telechatOpenUpdates) { window.__telechatOpenUpdates(); }",
            null
        ));
    }

    private void pushUpdateStateToWebView(JSONObject stateJson) {
        if (webView == null || stateJson == null) return;
        String payload = stateJson.toString();
        webView.post(() -> webView.evaluateJavascript(
            "if (window.__telechatOnUpdateStatus) { window.__telechatOnUpdateStatus(" + payload + "); }",
            null
        ));
    }

    private void openChatInWebView(String chatId) {
        String quoted = JSONObject.quote(chatId);
        webView.post(() -> webView.evaluateJavascript(
            "if (window.__telechatOpenChat) { window.__telechatOpenChat(" + quoted + "); }",
            null
        ));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE_CHOOSER || filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF_PERMISSION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startMessageServiceIfPermitted();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){ return window.__telechatHandleBack ? window.__telechatHandleBack() : false; })()",
            value -> {
                if ("true".equals(value)) return;
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    MainActivity.super.onBackPressed();
                }
            }
        );
    }

    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!hasNotificationPermission()) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF_PERMISSION);
            }
        }
    }

    private void startMessageServiceIfPermitted() {
        if (!hasNotificationPermission() || !activityVisible) return;
        try {
            startService(new Intent(this, MessageService.class));
        } catch (Exception ignored) {
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void setAppState(String username, String chatId, boolean isForeground) {
            CookieManager.getInstance().flush();
            MessageService.updateAppState(MainActivity.this, username, chatId, isForeground);
            if (username != null && !username.isEmpty() && isForeground) {
                runOnUiThread(MainActivity.this::startMessageServiceIfPermitted);
            }
        }

        @JavascriptInterface
        public String getAppVersionName() {
            return updateManager != null ? updateManager.getInstalledVersionName() : "1.0.0";
        }

        @JavascriptInterface
        public String getUpdateStateJson() {
            return updateManager != null ? updateManager.toStateJson().toString() : "{}";
        }

        @JavascriptInterface
        public void checkForAppUpdate(boolean manual) {
            if (updateManager != null) {
                updateManager.checkForUpdate(manual, !manual);
            }
        }

        @JavascriptInterface
        public void startAppUpdate() {
            if (updateManager != null) {
                runOnUiThread(() -> updateManager.startDownloadAndInstall(MainActivity.this));
            }
        }

        @JavascriptInterface
        public void showNotification(String title, String body, String chatId) {
            showNotification(title, body, chatId, "", "", "");
        }

        @JavascriptInterface
        public void showNotification(String title, String body, String chatId, String messageId) {
            showNotification(title, body, chatId, messageId, "", "");
        }

        @JavascriptInterface
        public void showNotification(
            String title,
            String body,
            String chatId,
            String messageId,
            String avatarUrl,
            String avatarColor
        ) {
            if (messageId != null && !messageId.isEmpty() && !MessageService.markNotifiedIfNew(MainActivity.this, messageId)) {
                return;
            }
            new Thread(() -> MessageService.showMessageNotification(
                MainActivity.this,
                title,
                body,
                chatId,
                avatarUrl,
                avatarColor
            )).start();
        }
    }
}
