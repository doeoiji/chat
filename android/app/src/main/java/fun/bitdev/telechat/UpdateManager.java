package fun.bitdev.telechat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class UpdateManager {

    public static final String CHANNEL_UPDATES = "telechat_updates";
    public static final String EXTRA_OPEN_UPDATES = "extra_open_updates";
    private static final int UPDATE_NOTIF_ID = 202;
    private static final String PREFS_NAME = "telechat_update_prefs";
    private static final String KEY_NOTIFIED_VERSION = "notified_version";
    private static final String KEY_PENDING_APK_VERSION = "pending_apk_version";
    private static final String KEY_PENDING_APK_FILE = "pending_apk_file";
    private static final String KEY_LAST_CHECK_AT = "last_check_at";

    public interface Listener {
        void onStateChanged(JSONObject stateJson);
    }

    private final Context ctx;
    private final Listener listener;
    private volatile boolean checking = false;
    private volatile boolean downloading = false;
    private volatile int downloadProgress = 0;
    private volatile String status = "idle"; // idle | checking | available | up_to_date | downloading | installing | permission_needed | error
    private volatile String errorMessage = "";
    private volatile String latestVersion = "";
    private volatile String releaseNotes = "";
    private volatile String downloadUrl = "";
    private volatile String releaseHtmlUrl = "";
    private volatile long apkSizeBytes = 0;
    private volatile boolean updateAvailable = false;
    private volatile boolean waitingInstallPermission = false;

    public UpdateManager(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        createUpdateChannel();
    }

    public String getInstalledVersionName() {
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return info.versionName != null ? info.versionName : "1.0.0";
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    public void cleanupOldApks(boolean showSuccessState) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String pendingVer = prefs.getString(KEY_PENDING_APK_VERSION, "");
            String currentVer = getInstalledVersionName();

            File updatesDir = new File(ctx.getFilesDir(), "updates");
            if (updatesDir.exists() && updatesDir.isDirectory()) {
                File[] files = updatesDir.listFiles();
                if (files != null) {
                    boolean updated = !pendingVer.isEmpty() && compareVersions(currentVer, pendingVer) >= 0;
                    long now = System.currentTimeMillis();
                    for (File f : files) {
                        if (!f.getName().endsWith(".apk")) continue;
                        // Delete once the app is running the new (or newer) version, or if file is stale (> 2 hours)
                        if (updated || (now - f.lastModified() > 2 * 60 * 60 * 1000L)) {
                            //noinspection ResultOfMethodCallIgnored
                            f.delete();
                        }
                    }
                }
            }
            if (!pendingVer.isEmpty() && compareVersions(currentVer, pendingVer) >= 0) {
                prefs.edit()
                    .remove(KEY_PENDING_APK_VERSION)
                    .remove(KEY_PENDING_APK_FILE)
                    .apply();
                if (showSuccessState) {
                    status = "up_to_date";
                    updateAvailable = false;
                }
            }
        } catch (Exception ignored) {
        }
    }

    public void deleteDownloadedApkNow() {
        try {
            File updatesDir = new File(ctx.getFilesDir(), "updates");
            if (updatesDir.exists() && updatesDir.isDirectory()) {
                File[] files = updatesDir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (f.getName().endsWith(".apk")) {
                            //noinspection ResultOfMethodCallIgnored
                            f.delete();
                        }
                    }
                }
            }
            ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_PENDING_APK_VERSION)
                .remove(KEY_PENDING_APK_FILE)
                .apply();
        } catch (Exception ignored) {
        }
    }

    public JSONObject toStateJson() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("currentVersion", getInstalledVersionName());
            obj.put("latestVersion", latestVersion);
            obj.put("available", updateAvailable);
            obj.put("status", status);
            obj.put("progress", downloadProgress);
            obj.put("notes", releaseNotes);
            obj.put("downloadUrl", downloadUrl);
            obj.put("releaseUrl", releaseHtmlUrl);
            obj.put("sizeBytes", apkSizeBytes);
            obj.put("error", errorMessage);
            obj.put("canInstallPackages", canInstallPackages());
        } catch (Exception ignored) {
        }
        return obj;
    }

    private void emitState() {
        if (listener != null) {
            listener.onStateChanged(toStateJson());
        }
    }

    public boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return ctx.getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    public void checkForUpdate(boolean manual, boolean notifyIfFound) {
        if (checking || downloading) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!manual) {
            long lastCheck = prefs.getLong(KEY_LAST_CHECK_AT, 0);
            // Auto-check at most once every 30 minutes unless manually requested
            if (System.currentTimeMillis() - lastCheck < 30 * 60 * 1000L && !latestVersion.isEmpty()) {
                emitState();
                return;
            }
        }

        checking = true;
        errorMessage = "";
        if (manual) {
            status = "checking";
            emitState();
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String repo = ctx.getString(R.string.github_repo);
                URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setRequestProperty("User-Agent", "TeleChat-Android/" + getInstalledVersionName());
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                int code = conn.getResponseCode();
                if (code == 404) {
                    // No GitHub release published yet — treat cleanly as up to date
                    prefs.edit().putLong(KEY_LAST_CHECK_AT, System.currentTimeMillis()).apply();
                    updateAvailable = false;
                    latestVersion = getInstalledVersionName();
                    status = "up_to_date";
                    emitState();
                    return;
                }
                if (code != 200) {
                    throw new Exception("GitHub returned HTTP " + code);
                }

                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line);
                    }
                }

                JSONObject rel = new JSONObject(sb.toString());
                String tag = rel.optString("tag_name", "").trim();
                String cleanRemote = tag.replaceFirst("^[vV]", "");
                String notes = rel.optString("body", "").trim();
                String htmlUrl = rel.optString("html_url", "");

                String apkUrl = "";
                long apkSize = 0;
                JSONArray assets = rel.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.optJSONObject(i);
                        if (asset == null) continue;
                        String name = asset.optString("name", "").toLowerCase();
                        if (name.endsWith(".apk")) {
                            apkUrl = asset.optString("browser_download_url", "");
                            apkSize = asset.optLong("size", 0);
                            break;
                        }
                    }
                }

                prefs.edit().putLong(KEY_LAST_CHECK_AT, System.currentTimeMillis()).apply();

                String currentVer = getInstalledVersionName();
                if (!cleanRemote.isEmpty() && !apkUrl.isEmpty() && compareVersions(cleanRemote, currentVer) > 0) {
                    latestVersion = cleanRemote;
                    releaseNotes = notes;
                    downloadUrl = apkUrl;
                    releaseHtmlUrl = htmlUrl;
                    apkSizeBytes = apkSize;
                    updateAvailable = true;
                    status = "available";

                    if (notifyIfFound) {
                        String alreadyNotified = prefs.getString(KEY_NOTIFIED_VERSION, "");
                        if (!cleanRemote.equals(alreadyNotified)) {
                            prefs.edit().putString(KEY_NOTIFIED_VERSION, cleanRemote).apply();
                            showUpdateNotification(cleanRemote);
                        }
                    }
                } else {
                    latestVersion = !cleanRemote.isEmpty() ? cleanRemote : currentVer;
                    releaseNotes = notes;
                    downloadUrl = "";
                    releaseHtmlUrl = htmlUrl;
                    apkSizeBytes = 0;
                    updateAvailable = false;
                    status = "up_to_date";
                }
                emitState();
            } catch (Exception e) {
                if (manual) {
                    status = "error";
                    errorMessage = e.getMessage() != null ? e.getMessage() : "Could not check for updates.";
                    emitState();
                }
            } finally {
                checking = false;
                if (conn != null) conn.disconnect();
            }
        }, "TeleChat-UpdateCheck").start();
    }

    public void startDownloadAndInstall(Context activityCtx) {
        if (downloading) return;
        if (downloadUrl == null || downloadUrl.isEmpty()) {
            checkForUpdate(true, false);
            return;
        }

        if (!canInstallPackages()) {
            waitingInstallPermission = true;
            status = "permission_needed";
            emitState();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent permIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName())
                );
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activityCtx.startActivity(permIntent);
            }
            return;
        }

        waitingInstallPermission = false;
        downloading = true;
        downloadProgress = 0;
        errorMessage = "";
        status = "downloading";
        emitState();

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File updatesDir = new File(ctx.getFilesDir(), "updates");
                if (!updatesDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    updatesDir.mkdirs();
                }
                // Clear any older APK before downloading the new one
                File[] existing = updatesDir.listFiles();
                if (existing != null) {
                    for (File old : existing) {
                        if (old.getName().endsWith(".apk")) {
                            //noinspection ResultOfMethodCallIgnored
                            old.delete();
                        }
                    }
                }

                String fileName = "TeleChat-v" + (latestVersion.isEmpty() ? "update" : latestVersion) + ".apk";
                File targetFile = new File(updatesDir, fileName);

                conn = openFollowingRedirects(downloadUrl, 5);
                int code = conn.getResponseCode();
                if (code != 200) {
                    throw new Exception("Download failed (HTTP " + code + ")");
                }

                long total = conn.getContentLengthLong();
                if (total <= 0) total = apkSizeBytes;

                try (InputStream is = conn.getInputStream();
                     FileOutputStream fos = new FileOutputStream(targetFile)) {
                    byte[] buf = new byte[16384];
                    long readSum = 0;
                    int lastPct = -1;
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        readSum += n;
                        if (total > 0) {
                            int pct = (int) Math.min(100, (readSum * 100L) / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                downloadProgress = pct;
                                emitState();
                            }
                        }
                    }
                    fos.flush();
                }

                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_PENDING_APK_VERSION, latestVersion)
                    .putString(KEY_PENDING_APK_FILE, fileName)
                    .apply();

                downloadProgress = 100;
                status = "installing";
                emitState();

                Uri contentUri = ApkFileProvider.getUriForUpdateApk(ctx, fileName);
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(contentUri, ApkFileProvider.APK_MIME);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                ctx.startActivity(installIntent);
            } catch (Exception e) {
                deleteDownloadedApkNow();
                status = "error";
                errorMessage = e.getMessage() != null ? e.getMessage() : "Update download failed.";
                emitState();
            } finally {
                downloading = false;
                if (conn != null) conn.disconnect();
            }
        }, "TeleChat-UpdateDownload").start();
    }

    public void onActivityResumed(Context activityCtx) {
        cleanupOldApks(true);
        if (waitingInstallPermission && canInstallPackages()) {
            waitingInstallPermission = false;
            startDownloadAndInstall(activityCtx);
        }
    }

    private HttpURLConnection openFollowingRedirects(String urlStr, int maxRedirects) throws Exception {
        String current = urlStr;
        for (int i = 0; i <= maxRedirects; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "TeleChat-Android/" + getInstalledVersionName());
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Exception("Redirect location missing");
                }
                current = new URL(new URL(current), location).toString();
                continue;
            }
            return conn;
        }
        throw new Exception("Too many redirects");
    }

    public static int compareVersions(String a, String b) {
        String[] pa = String.valueOf(a).replaceAll("[^0-9.]", "").split("\\.");
        String[] pb = String.valueOf(b).replaceAll("[^0-9.]", "").split("\\.");
        int len = Math.max(pa.length, pb.length);
        for (int i = 0; i < len; i++) {
            int va = (i < pa.length && !pa[i].isEmpty()) ? parseIntSafe(pa[i]) : 0;
            int vb = (i < pb.length && !pb[i].isEmpty()) ? parseIntSafe(pb[i]) : 0;
            if (va != vb) return Integer.compare(va, vb);
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private void createUpdateChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_UPDATES,
                "App Updates",
                NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Alerts when a new TeleChat Android app version is available");
            manager.createNotificationChannel(ch);
        }
    }

    private void showUpdateNotification(String newVersion) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra(EXTRA_OPEN_UPDATES, true);

        PendingIntent pi = PendingIntent.getActivity(
            ctx,
            UPDATE_NOTIF_ID,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL_UPDATES)
            : new Notification.Builder(ctx);

        builder.setSmallIcon(R.drawable.ic_stat_telechat)
            .setContentTitle("TeleChat Update Available (v" + newVersion + ")")
            .setContentText("Tap to download and install the new app version.")
            .setAutoCancel(true)
            .setContentIntent(pi);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_HIGH);
        }

        manager.notify(UPDATE_NOTIF_ID, builder.build());
    }
}
