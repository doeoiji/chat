package fun.bitdev.telechat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_NOTIF_PERMISSION = 1002;
    private static final int REQ_MEDIA_PERMISSION = 1003;
    private static final long MAX_SHARED_FILE_BYTES = 25L * 1024L * 1024L;

    private PermissionRequest pendingWebPermissionRequest;

    private static final class SharedCachedFile {
        final File file;
        final String mimeType;
        final String displayName;
        final long sizeBytes;

        SharedCachedFile(File file, String mimeType, String displayName, long sizeBytes) {
            this.file = file;
            this.mimeType = mimeType;
            this.displayName = displayName;
            this.sizeBytes = sizeBytes;
        }
    }

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String baseUrl;
    private String baseHost;
    private String pendingOpenChatId;
    private String pendingSharePayloadJson;
    private volatile boolean pageLoaded = false;
    private boolean pendingOpenUpdates = false;
    private volatile boolean activityVisible = true;
    private UpdateManager updateManager;
    private final Map<String, SharedCachedFile> sharedFilesMap = new ConcurrentHashMap<>();

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
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                pageLoaded = false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && baseHost != null && baseHost.equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path != null && path.startsWith("/__android_share__/")) {
                        String id = path.substring("/__android_share__/".length());
                        SharedCachedFile entry = sharedFilesMap.get(id);
                        if (entry != null && entry.file.exists()) {
                            try {
                                Map<String, String> headers = new HashMap<>();
                                headers.put("Cache-Control", "no-store");
                                return new WebResourceResponse(
                                    entry.mimeType,
                                    null,
                                    200,
                                    "OK",
                                    headers,
                                    new FileInputStream(entry.file)
                                );
                            } catch (Exception ignored) {
                            }
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

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
                pageLoaded = true;
                CookieManager.getInstance().flush();
                if (updateManager != null) {
                    pushUpdateStateToWebView(updateManager.toStateJson());
                }
                if (pendingSharePayloadJson != null) {
                    String payload = pendingSharePayloadJson;
                    pendingSharePayloadJson = null;
                    deliverShareToWebView(payload);
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

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (request == null) return;
                    Uri origin = request.getOrigin();
                    if (origin == null || baseHost == null || !baseHost.equalsIgnoreCase(origin.getHost())) {
                        request.deny();
                        return;
                    }
                    ArrayList<String> needed = new ArrayList<>();
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                            && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            needed.add(Manifest.permission.RECORD_AUDIO);
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                            && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            needed.add(Manifest.permission.CAMERA);
                        }
                    }
                    if (needed.isEmpty()) {
                        request.grant(request.getResources());
                    } else {
                        if (pendingWebPermissionRequest != null) {
                            pendingWebPermissionRequest.deny();
                        }
                        pendingWebPermissionRequest = request;
                        requestPermissions(needed.toArray(new String[0]), REQ_MEDIA_PERMISSION);
                    }
                });
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
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            handleShareIntent(intent);
            return;
        }
        String chatId = intent.getStringExtra(MessageService.EXTRA_CHAT_ID);
        if (chatId != null && !chatId.isEmpty()) {
            if (webView != null && pageLoaded) {
                openChatInWebView(chatId);
            } else {
                pendingOpenChatId = chatId;
            }
        }
    }

    private void handleShareIntent(Intent intent) {
        String action = intent.getAction();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String extraText = intent.getStringExtra(Intent.EXTRA_TEXT);
        String combinedText = "";
        if (extraText != null && !extraText.trim().isEmpty()) {
            if (subject != null && !subject.trim().isEmpty() && !extraText.contains(subject.trim())) {
                combinedText = subject.trim() + "\n" + extraText.trim();
            } else {
                combinedText = extraText.trim();
            }
        } else if (subject != null && !subject.trim().isEmpty()) {
            combinedText = subject.trim();
        }

        final String sharedText = combinedText;
        final ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) uris.add(single);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> multi = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multi != null) uris.addAll(multi);
        }

        new Thread(() -> {
            try {
                File shareDir = new File(getCacheDir(), "shared");
                if (!shareDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    shareDir.mkdirs();
                }

                JSONArray filesJson = new JSONArray();
                int count = 0;
                for (Uri uri : uris) {
                    if (uri == null || count >= 10) break;
                    SharedCachedFile cached = copySharedUriToCache(shareDir, uri);
                    if (cached != null) {
                        String token = UUID.randomUUID().toString();
                        sharedFilesMap.put(token, cached);
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("url", baseUrl + "/__android_share__/" + token);
                        fileObj.put("name", cached.displayName);
                        fileObj.put("mime", cached.mimeType);
                        fileObj.put("size", cached.sizeBytes);
                        filesJson.put(fileObj);
                        count++;
                    }
                }

                if (sharedText.isEmpty() && filesJson.length() == 0) return;

                JSONObject payload = new JSONObject();
                payload.put("text", sharedText);
                payload.put("files", filesJson);
                String payloadStr = payload.toString();

                runOnUiThread(() -> {
                    if (webView != null && pageLoaded) {
                        deliverShareToWebView(payloadStr);
                    } else {
                        pendingSharePayloadJson = payloadStr;
                    }
                });
            } catch (Exception ignored) {
            }
        }, "VibeRoom-ShareTarget").start();
    }

    private SharedCachedFile copySharedUriToCache(File shareDir, Uri uri) {
        try {
            String mime = getContentResolver().getType(uri);
            String name = queryDisplayName(uri);
            if (mime == null || mime.trim().isEmpty()) {
                String ext = name != null && name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
                mime = !ext.isEmpty() ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) : null;
            }
            if (mime == null || mime.trim().isEmpty()) {
                mime = "application/octet-stream";
            }
            if (name == null || name.trim().isEmpty()) {
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                name = "shared_" + System.currentTimeMillis() + (ext != null ? "." + ext : "");
            }

            File outFile = new File(shareDir, UUID.randomUUID().toString() + ".bin");
            long total = 0;
            try (InputStream is = getContentResolver().openInputStream(uri);
                 FileOutputStream fos = new FileOutputStream(outFile)) {
                if (is == null) return null;
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_SHARED_FILE_BYTES) {
                        fos.close();
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                        return null;
                    }
                    fos.write(buf, 0, n);
                }
                fos.flush();
            }
            return new SharedCachedFile(outFile, mime, name, total);
        } catch (Exception e) {
            return null;
        }
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return uri.getLastPathSegment();
    }

    private void deliverShareToWebView(String payloadJson) {
        if (webView == null || payloadJson == null) return;
        webView.post(() -> webView.evaluateJavascript(
            "if (window.__telechatReceiveShare) { window.__telechatReceiveShare(" + payloadJson + "); }",
            null
        ));
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
            if (updateManager != null) {
                updateManager.notifyIfUpdatePending();
            }
            return;
        }
        if (requestCode == REQ_MEDIA_PERMISSION && pendingWebPermissionRequest != null) {
            PermissionRequest req = pendingWebPermissionRequest;
            pendingWebPermissionRequest = null;
            ArrayList<String> grantedResources = new ArrayList<>();
            for (String res : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    grantedResources.add(res);
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    grantedResources.add(res);
                }
            }
            if (!grantedResources.isEmpty()) {
                req.grant(grantedResources.toArray(new String[0]));
            } else {
                req.deny();
            }
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
        public void clearSharedFiles() {
            for (SharedCachedFile item : sharedFilesMap.values()) {
                if (item != null && item.file != null) {
                    //noinspection ResultOfMethodCallIgnored
                    item.file.delete();
                }
            }
            sharedFilesMap.clear();
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
