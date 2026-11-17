package fun.bitdev.telechat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String CHANNEL_ID = "telechat_messages";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_NOTIF_PERMISSION = 1002;
    private static final String EXTRA_CHAT_ID = "extra_chat_id";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String baseUrl;
    private String baseHost;
    private String pendingOpenChatId;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        baseUrl = getString(R.string.app_url);
        baseHost = Uri.parse(baseUrl).getHost();

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#17212B"));
        window.setNavigationBarColor(Color.parseColor("#0E1621"));

        createNotificationChannel();
        requestNotificationPermissionIfNeeded();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0E1621"));
        setContentView(webView);

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
                if (pendingOpenChatId != null) {
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

        handleIntent(getIntent());
        webView.loadUrl(baseUrl);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String chatId = intent.getStringExtra(EXTRA_CHAT_ID);
        if (chatId != null && !chatId.isEmpty()) {
            if (webView != null && webView.getProgress() == 100) {
                openChatInWebView(chatId);
            } else {
                pendingOpenChatId = chatId;
            }
        }
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

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Chat Messages",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Incoming message alerts from TeleChat");
            channel.enableVibration(true);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF_PERMISSION);
            }
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void showNotification(String title, String body, String chatId) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }

            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager == null) return;

            Intent openIntent = new Intent(MainActivity.this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (chatId != null) {
                openIntent.putExtra(EXTRA_CHAT_ID, chatId);
            }

            PendingIntent pendingIntent = PendingIntent.getActivity(
                MainActivity.this,
                chatId != null ? chatId.hashCode() : 0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(MainActivity.this, CHANNEL_ID)
                : new Notification.Builder(MainActivity.this);

            builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title != null && !title.isEmpty() ? title : "TeleChat")
                .setContentText(body != null ? body : "New message")
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                builder.setPriority(Notification.PRIORITY_HIGH);
                builder.setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
            }

            int notifId = chatId != null ? chatId.hashCode() : (int) System.currentTimeMillis();
            manager.notify(notifId, builder.build());
        }
    }
}
