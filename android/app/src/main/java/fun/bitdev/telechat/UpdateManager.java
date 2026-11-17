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
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class UpdateManager {

    public static final String CHANNEL_UPDATES = "telechat_updates";
    public static final String EXTRA_OPEN_UPDATES = "extra_open_updates";
    private static final int UPDATE_NOTIF_ID = 202;
    private static final String PREFS_NAME = "telechat_update_prefs";
    private static final String KEY_NOTIFIED_VERSION = "notified_version";
    private static final String KEY_PENDING_APK_VERSION = "pending_apk_version";
    private static final String KEY_PENDING_APK_FILE = "pending_apk_file";
    private static final String KEY_LAST_CHECK_AT = "last_check_at";
    private static final String KEY_LAST_ETAG = "last_etag";
    private static final String KEY_CACHED_RELEASE_JSON = "cached_release_json";
    private static final String KEY_CACHED_VERSION = "cached_version";
    private static final String KEY_CACHED_APK_URL = "cached_apk_url";
    private static final String KEY_CACHED_NOTES = "cached_notes";
    private static final String KEY_CACHED_HTML_URL = "cached_html_url";
    private static final String KEY_CACHED_SIZE_BYTES = "cached_size_bytes";
    private static final String KEY_CACHED_FOR_INSTALLED_VER = "cached_for_installed_ver";
    private static final String KEY_API_BLOCKED_UNTIL = "api_blocked_until";
    private static final Pattern APK_HREF_PATTERN = Pattern.compile(
        "href=[\"']([^\"']*/releases/download/[^\"']+\\.apk)[\"']",
        Pattern.CASE_INSENSITIVE
    );

    private static final class ReleaseMeta {
        final String tag;
        final String notes;
        final String htmlUrl;
        final String apkUrl;
        final long apkSize;

        ReleaseMeta(String tag, String notes, String htmlUrl, String apkUrl, long apkSize) {
            this.tag = tag;
            this.notes = notes;
            this.htmlUrl = htmlUrl;
            this.apkUrl = apkUrl;
            this.apkSize = apkSize;
        }
    }

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
    private volatile long lastNetworkCheckMs = 0;
    private volatile String notifiedVersionThisSession = "";
    private static WeakReference<UpdateManager> activeInstance = new WeakReference<>(null);

    public UpdateManager(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        activeInstance = new WeakReference<>(this);
        createUpdateChannel();
        restoreCachedState();
    }

    private void restoreCachedState() {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String currentVer = getInstalledVersionName();
            String cachedVer = prefs.getString(KEY_CACHED_VERSION, "");
            String cachedApk = prefs.getString(KEY_CACHED_APK_URL, "");
            if (!cachedVer.isEmpty() && !cachedApk.isEmpty() && compareVersions(cachedVer, currentVer) > 0) {
                latestVersion = cachedVer;
                downloadUrl = cachedApk;
                releaseNotes = prefs.getString(KEY_CACHED_NOTES, "");
                releaseHtmlUrl = prefs.getString(KEY_CACHED_HTML_URL, "");
                apkSizeBytes = prefs.getLong(KEY_CACHED_SIZE_BYTES, 0);
                updateAvailable = true;
                status = "available";
            } else if (!cachedVer.isEmpty()) {
                latestVersion = compareVersions(cachedVer, currentVer) >= 0 ? cachedVer : currentVer;
                updateAvailable = false;
                status = "up_to_date";
            }
        } catch (Exception ignored) {
        }
    }

    public void notifyIfUpdatePending() {
        if (updateAvailable && !latestVersion.isEmpty() && !latestVersion.equals(notifiedVersionThisSession)) {
            notifiedVersionThisSession = latestVersion;
            showUpdateNotification(latestVersion);
        }
    }

    public static void notifyInstallSuccess() {
        UpdateManager mgr = activeInstance.get();
        if (mgr == null) return;
        mgr.deleteDownloadedApkNow();
        mgr.updateAvailable = false;
        mgr.status = "up_to_date";
        mgr.errorMessage = "";
        mgr.emitState();
    }

    public static void notifyInstallFailure(String message) {
        UpdateManager mgr = activeInstance.get();
        if (mgr == null) return;
        mgr.deleteDownloadedApkNow();
        mgr.status = "error";
        mgr.errorMessage = message != null ? message : "Installation failed.";
        mgr.emitState();
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
        String currentVer = getInstalledVersionName();
        long nowMs = System.currentTimeMillis();
        // Avoid duplicate concurrent/back-to-back auto checks within 15 seconds while still
        // checking live on every app restart and page refresh.
        if (!manual && (nowMs - lastNetworkCheckMs) < 15_000L && !latestVersion.isEmpty()) {
            if (notifyIfFound && updateAvailable && !latestVersion.equals(notifiedVersionThisSession)) {
                notifiedVersionThisSession = latestVersion;
                showUpdateNotification(latestVersion);
            }
            emitState();
            return;
        }

        checking = true;
        errorMessage = "";
        if (manual) {
            status = "checking";
            emitState();
        }

        new Thread(() -> {
            try {
                String repo = ctx.getString(R.string.github_repo);
                ReleaseMeta release = fetchLatestRelease(repo, prefs);
                lastNetworkCheckMs = System.currentTimeMillis();

                prefs.edit()
                    .putLong(KEY_LAST_CHECK_AT, lastNetworkCheckMs)
                    .putString(KEY_CACHED_FOR_INSTALLED_VER, currentVer)
                    .apply();

                if (release == null || release.tag.isEmpty()) {
                    // No GitHub release published yet — treat cleanly as up to date
                    updateAvailable = false;
                    latestVersion = currentVer;
                    releaseNotes = "";
                    downloadUrl = "";
                    releaseHtmlUrl = "";
                    apkSizeBytes = 0;
                    status = "up_to_date";
                    prefs.edit()
                        .putString(KEY_CACHED_VERSION, latestVersion)
                        .remove(KEY_CACHED_APK_URL)
                        .apply();
                    emitState();
                    return;
                }

                String cleanRemote = release.tag.replaceFirst("^[vV]", "");
                prefs.edit()
                    .putString(KEY_CACHED_VERSION, !cleanRemote.isEmpty() ? cleanRemote : currentVer)
                    .putString(KEY_CACHED_APK_URL, release.apkUrl)
                    .putString(KEY_CACHED_NOTES, release.notes)
                    .putString(KEY_CACHED_HTML_URL, release.htmlUrl)
                    .putLong(KEY_CACHED_SIZE_BYTES, release.apkSize)
                    .apply();

                if (!cleanRemote.isEmpty() && !release.apkUrl.isEmpty() && compareVersions(cleanRemote, currentVer) > 0) {
                    latestVersion = cleanRemote;
                    releaseNotes = release.notes;
                    downloadUrl = release.apkUrl;
                    releaseHtmlUrl = release.htmlUrl;
                    apkSizeBytes = release.apkSize;
                    updateAvailable = true;
                    status = "available";

                    if (notifyIfFound && !cleanRemote.equals(notifiedVersionThisSession)) {
                        notifiedVersionThisSession = cleanRemote;
                        prefs.edit().putString(KEY_NOTIFIED_VERSION, cleanRemote).apply();
                        showUpdateNotification(cleanRemote);
                    }
                } else {
                    latestVersion = !cleanRemote.isEmpty() ? cleanRemote : currentVer;
                    releaseNotes = release.notes;
                    downloadUrl = "";
                    releaseHtmlUrl = release.htmlUrl;
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
            }
        }, "VibeRoom-UpdateCheck").start();
    }

    private ReleaseMeta fetchLatestRelease(String repo, SharedPreferences prefs) throws Exception {
        long now = System.currentTimeMillis();
        long apiBlockedUntil = prefs.getLong(KEY_API_BLOCKED_UNTIL, 0);
        Exception apiError = null;

        if (now >= apiBlockedUntil) {
            try {
                return fetchLatestReleaseViaApi(repo, prefs);
            } catch (Exception e) {
                apiError = e;
            }
        }

        // Fallback to github.com web redirect + expanded_assets (does not hit the 60/hr API rate limit)
        try {
            return fetchLatestReleaseViaWeb(repo, prefs);
        } catch (Exception webError) {
            throw apiError != null ? apiError : webError;
        }
    }

    private String getApkAssetPrefix() {
        try {
            String p = ctx.getString(R.string.apk_asset_prefix);
            if (p != null && !p.isEmpty()) return p;
        } catch (Exception ignored) {
        }
        return "VibeRoom-v";
    }

    private String getAppDisplayName() {
        try {
            String n = ctx.getString(R.string.app_name);
            if (n != null && !n.isEmpty()) return n;
        } catch (Exception ignored) {
        }
        return "VibeRoom";
    }

    private ReleaseMeta fetchLatestReleaseViaApi(String repo, SharedPreferences prefs) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            conn.setRequestProperty("User-Agent", "VibeRoom-Android/" + getInstalledVersionName());
            String cachedEtag = prefs.getString(KEY_LAST_ETAG, "");
            String cachedJson = prefs.getString(KEY_CACHED_RELEASE_JSON, "");
            if (!cachedEtag.isEmpty() && !cachedJson.isEmpty()) {
                conn.setRequestProperty("If-None-Match", cachedEtag);
            }
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            String expectedPrefix = getApkAssetPrefix();
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED && !cachedJson.isEmpty()) {
                return parseReleaseJson(new JSONObject(cachedJson), expectedPrefix);
            }
            if (code == 404) {
                return new ReleaseMeta("", "", "", "", 0);
            }
            if (code == 403 || code == 429) {
                long blockedUntil = System.currentTimeMillis() + 15 * 60 * 1000L;
                String resetHdr = conn.getHeaderField("X-RateLimit-Reset");
                if (resetHdr != null && !resetHdr.trim().isEmpty()) {
                    try {
                        long resetMs = Long.parseLong(resetHdr.trim()) * 1000L;
                        if (resetMs > System.currentTimeMillis()) {
                            blockedUntil = Math.min(resetMs, System.currentTimeMillis() + 60 * 60 * 1000L);
                        }
                    } catch (NumberFormatException ignored) {
                    }
                }
                prefs.edit().putLong(KEY_API_BLOCKED_UNTIL, blockedUntil).apply();
                throw new Exception("GitHub rate limit reached. Please try again in a few minutes.");
            }
            if (code != 200) {
                throw new Exception("GitHub returned HTTP " + code);
            }

            String body = readStream(conn.getInputStream());
            JSONObject rel = new JSONObject(body);
            String etag = conn.getHeaderField("ETag");
            SharedPreferences.Editor editor = prefs.edit().putString(KEY_CACHED_RELEASE_JSON, body);
            if (etag != null && !etag.trim().isEmpty()) {
                editor.putString(KEY_LAST_ETAG, etag.trim());
            }
            editor.remove(KEY_API_BLOCKED_UNTIL).apply();

            return parseReleaseJson(rel, expectedPrefix);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private ReleaseMeta fetchLatestReleaseViaWeb(String repo, SharedPreferences prefs) throws Exception {
        HttpURLConnection conn = null;
        String latestUrl = "https://github.com/" + repo + "/releases/latest";
        try {
            conn = (HttpURLConnection) new URL(latestUrl).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "VibeRoom-Android/" + getInstalledVersionName());
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code == 404) {
                return new ReleaseMeta("", "", "", "", 0);
            }

            String location = null;
            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                location = conn.getHeaderField("Location");
            }
            if (location == null || location.isEmpty()) {
                throw new Exception("GitHub returned HTTP " + code);
            }

            String resolvedLocation = new URL(new URL(latestUrl), location).toString();
            int tagMarker = resolvedLocation.indexOf("/releases/tag/");
            if (tagMarker < 0) {
                // Redirected to /releases when repository has no published releases yet
                return new ReleaseMeta("", "", "", "", 0);
            }

            String rawTag = resolvedLocation.substring(tagMarker + "/releases/tag/".length()).split("[?#]")[0];
            String tag = URLDecoder.decode(rawTag, "UTF-8").trim();
            if (tag.isEmpty()) {
                return new ReleaseMeta("", "", "", "", 0);
            }

            String encodedTag = URLEncoder.encode(tag, "UTF-8").replace("+", "%20");
            String htmlUrl = "https://github.com/" + repo + "/releases/tag/" + encodedTag;
            String notes = "";
            long apkSize = 0;
            String expectedPrefix = getApkAssetPrefix();

            String cachedJson = prefs.getString(KEY_CACHED_RELEASE_JSON, "");
            if (!cachedJson.isEmpty()) {
                try {
                    ReleaseMeta cached = parseReleaseJson(new JSONObject(cachedJson), expectedPrefix);
                    if (tag.equals(cached.tag)) {
                        notes = cached.notes;
                        apkSize = cached.apkSize;
                    }
                } catch (Exception ignored) {
                }
            }

            String apkUrl = findApkAssetViaWeb(repo, encodedTag, expectedPrefix);
            return new ReleaseMeta(tag, notes, htmlUrl, apkUrl, apkSize);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static boolean matchesVariantApk(String lowerName, String expectedPrefix) {
        if (!lowerName.endsWith(".apk")) return false;
        String lowerPrefix = expectedPrefix.toLowerCase();
        if (lowerName.startsWith(lowerPrefix)) return true;
        // Legacy flavor must only install legacy APK; standard flavor skips legacy APKs
        if (lowerPrefix.contains("legacy")) {
            return lowerName.contains("legacy");
        }
        return !lowerName.contains("legacy") && !lowerName.contains("compat");
    }

    private String findApkAssetViaWeb(String repo, String encodedTag, String expectedPrefix) {
        String[] candidatePages = new String[] {
            "https://github.com/" + repo + "/releases/expanded_assets/" + encodedTag,
            "https://github.com/" + repo + "/releases/tag/" + encodedTag
        };
        for (String pageUrl : candidatePages) {
            HttpURLConnection conn = null;
            try {
                conn = openFollowingRedirects(pageUrl, 3);
                if (conn.getResponseCode() == 200) {
                    String html = readStream(conn.getInputStream());
                    Matcher m = APK_HREF_PATTERN.matcher(html);
                    while (m.find()) {
                        String href = m.group(1);
                        String fileName = href.substring(href.lastIndexOf('/') + 1).toLowerCase();
                        if (matchesVariantApk(fileName, expectedPrefix)) {
                            return new URL(new URL("https://github.com"), href).toString();
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        String cleanVer = encodedTag.replaceFirst("^[vV]", "");
        return "https://github.com/" + repo + "/releases/download/" + encodedTag + "/" + expectedPrefix + cleanVer + ".apk";
    }

    private static ReleaseMeta parseReleaseJson(JSONObject rel, String expectedPrefix) {
        String tag = rel.optString("tag_name", "").trim();
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
                if (matchesVariantApk(name, expectedPrefix)) {
                    apkUrl = asset.optString("browser_download_url", "");
                    apkSize = asset.optLong("size", 0);
                    break;
                }
            }
        }
        return new ReleaseMeta(tag, notes, htmlUrl, apkUrl, apkSize);
    }

    private static String readStream(InputStream is) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
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

                String fileName = getApkAssetPrefix() + (latestVersion.isEmpty() ? "update" : latestVersion) + ".apk";
                File targetFile = new File(updatesDir, fileName);

                conn = openFollowingRedirects(downloadUrl, 5);
                int code = conn.getResponseCode();
                if (code != 200) {
                    throw new Exception("Download failed (HTTP " + code + ")");
                }

                long total = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                    ? conn.getContentLengthLong()
                    : conn.getContentLength();
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

                installApkViaPackageInstaller(targetFile);
            } catch (Exception e) {
                deleteDownloadedApkNow();
                status = "error";
                errorMessage = e.getMessage() != null ? e.getMessage() : "Update download failed.";
                emitState();
            } finally {
                downloading = false;
                if (conn != null) conn.disconnect();
            }
        }, "VibeRoom-UpdateDownload").start();
    }

    private void installApkViaPackageInstaller(File apkFile) throws Exception {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(ctx.getPackageName());

        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apkFile);
                 OutputStream out = session.openWrite("telechat_update.apk", 0, apkFile.length())) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
                session.fsync(out);
            }

            Intent callbackIntent = new Intent(ctx, UpdateInstallReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent pi = PendingIntent.getBroadcast(ctx, sessionId, callbackIntent, flags);
            session.commit(pi.getIntentSender());
        } finally {
            // PackageInstaller already holds its staged copy; remove downloaded file immediately to free storage
            //noinspection ResultOfMethodCallIgnored
            apkFile.delete();
        }
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
            conn.setRequestProperty("User-Agent", "VibeRoom-Android/" + getInstalledVersionName());
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
            ch.setDescription("Alerts when a new VibeRoom Android app version is available");
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

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(
            ctx,
            UPDATE_NOTIF_ID,
            openIntent,
            piFlags
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL_UPDATES)
            : new Notification.Builder(ctx);

        builder.setSmallIcon(R.drawable.ic_stat_telechat)
            .setContentTitle(getAppDisplayName() + " Update Available (v" + newVersion + ")")
            .setContentText("Tap to download and install the new app version.")
            .setAutoCancel(true)
            .setContentIntent(pi);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_HIGH);
        }

        manager.notify(UPDATE_NOTIF_ID, builder.build());
    }
}
