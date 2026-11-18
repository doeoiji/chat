package fun.bitdev.telechat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.LocusId;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MessageService extends Service {

    public static final String CHANNEL_MESSAGES = "telechat_messages_v2";
    public static final String CHANNEL_CALLS = "viberoom_calls";
    public static final String EXTRA_CHAT_ID = "extra_chat_id";
    private static final int CALL_NOTIF_ID = 303;
    private static final int LEGACY_FOREGROUND_ID = 101;
    private static final String LEGACY_SERVICE_CHANNEL = "telechat_service";
    private static final String PREFS_NOTIF = "telechat_notif_prefs";
    private static final String KEY_USERNAME = "saved_username";
    private static final String KEY_NOTIFIED_IDS = "notified_ids_csv";
    private static final Pattern HEX_COLOR_PATTERN = Pattern.compile("#([0-9a-fA-F]{6})");

    private volatile boolean running = false;
    private Thread workerThread;
    private static volatile String currentUsername = "";
    private static volatile String activeChatId = "";
    private static volatile boolean appInForeground = false;
    private static final Set<String> notifiedMessageIds = Collections.synchronizedSet(new LinkedHashSet<>());

    public static void updateAppState(Context ctx, String username, String chatId, boolean inForeground) {
        currentUsername = username != null ? username : "";
        activeChatId = chatId != null ? chatId : "";
        appInForeground = inForeground;
        if (ctx != null && !currentUsername.isEmpty()) {
            ctx.getSharedPreferences(PREFS_NOTIF, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_USERNAME, currentUsername)
                .apply();
        }
    }

    public static String getSavedUsername(Context ctx) {
        if (!currentUsername.isEmpty()) return currentUsername;
        if (ctx == null) return "";
        return ctx.getSharedPreferences(PREFS_NOTIF, Context.MODE_PRIVATE).getString(KEY_USERNAME, "");
    }

    public static boolean isChatActiveInForeground(String chatId) {
        return appInForeground && chatId != null && chatId.equals(activeChatId);
    }

    public static boolean markNotifiedIfNew(Context ctx, String msgId) {
        if (msgId == null || msgId.isEmpty()) return true;
        synchronized (notifiedMessageIds) {
            if (notifiedMessageIds.isEmpty() && ctx != null) {
                String saved = ctx.getSharedPreferences(PREFS_NOTIF, Context.MODE_PRIVATE).getString(KEY_NOTIFIED_IDS, "");
                if (!saved.isEmpty()) {
                    for (String part : saved.split(",")) {
                        if (!part.isEmpty()) notifiedMessageIds.add(part);
                    }
                }
            }
            if (notifiedMessageIds.contains(msgId)) return false;
            notifiedMessageIds.add(msgId);
            while (notifiedMessageIds.size() > 100) {
                String first = notifiedMessageIds.iterator().next();
                notifiedMessageIds.remove(first);
            }
            if (ctx != null) {
                StringBuilder sb = new StringBuilder();
                for (String id : notifiedMessageIds) {
                    if (sb.length() > 0) sb.append(',');
                    sb.append(id);
                }
                ctx.getSharedPreferences(PREFS_NOTIF, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_NOTIFIED_IDS, sb.toString())
                    .apply();
            }
            return true;
        }
    }

    public static void clearLegacyForegroundNotification(Context ctx) {
        try {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (manager == null) return;
            manager.cancel(LEGACY_FOREGROUND_ID);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.deleteNotificationChannel(LEGACY_SERVICE_CHANNEL);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        clearLegacyForegroundNotification(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            workerThread = new Thread(this::listenLoop, "TeleChat-SSE");
            workerThread.setDaemon(true);
            workerThread.start();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (workerThread != null) {
            workerThread.interrupt();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void listenLoop() {
        String baseUrl = getString(R.string.app_url);
        while (running) {
            HttpURLConnection conn = null;
            try {
                String cookie = CookieManager.getInstance().getCookie(baseUrl);
                if (cookie == null || !cookie.contains("telechat_session=")) {
                    Thread.sleep(3000);
                    continue;
                }

                URL url = new URL(baseUrl + "/api/events");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Cookie", cookie);
                conn.setRequestProperty("Accept", "text/event-stream");
                conn.setRequestProperty("Cache-Control", "no-cache");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);

                int status = conn.getResponseCode();
                if (status != 200) {
                    Thread.sleep(5000);
                    continue;
                }

                try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
                )) {
                    String currentEvent = null;
                    StringBuilder dataBuf = new StringBuilder();
                    String line;
                    while (running && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (currentEvent != null && dataBuf.length() > 0) {
                                handleSseEvent(currentEvent, dataBuf.toString());
                            }
                            currentEvent = null;
                            dataBuf.setLength(0);
                        } else if (line.startsWith("event:")) {
                            currentEvent = line.substring(6).trim();
                        } else if (line.startsWith("data:")) {
                            if (dataBuf.length() > 0) dataBuf.append('\n');
                            dataBuf.append(line.substring(5).trim());
                        }
                    }
                }
            } catch (InterruptedException ignored) {
                break;
            } catch (Exception ignored) {
                try {
                    Thread.sleep(3500);
                } catch (InterruptedException ie) {
                    break;
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }

    private void handleSseEvent(String eventName, String jsonStr) {
        try {
            if ("connected".equals(eventName)) {
                JSONObject obj = new JSONObject(jsonStr);
                String uname = obj.optString("username", "");
                if (!uname.isEmpty()) {
                    currentUsername = uname;
                    getSharedPreferences(PREFS_NOTIF, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_USERNAME, uname)
                        .apply();
                }
                return;
            }
            if ("call_ended".equals(eventName) || "call_declined".equals(eventName) || "call_accepted".equals(eventName)) {
                NotificationManager mgr = getSystemService(NotificationManager.class);
                if (mgr != null) mgr.cancel(CALL_NOTIF_ID);
                return;
            }
            if ("call_incoming".equals(eventName)) {
                if (appInForeground) return;
                JSONObject obj = new JSONObject(jsonStr);
                JSONObject call = obj.optJSONObject("call");
                JSONObject caller = obj.optJSONObject("callerProfile");
                String callerName = caller != null ? caller.optString("displayName", call != null ? call.optString("caller", "Someone") : "Someone") : "Someone";
                String mode = call != null ? call.optString("mode", "audio") : "audio";
                String chatId = call != null ? call.optString("chatId", "") : "";
                showIncomingCallNotification(this, callerName, mode, chatId);
                return;
            }
            if (!"new_message".equals(eventName)) return;

            JSONObject obj = new JSONObject(jsonStr);
            String chatId = obj.optString("chatId", "");
            JSONObject msg = obj.optJSONObject("message");
            if (msg == null) return;

            String msgId = msg.optString("id", "");
            String sender = msg.optString("sender", "");
            if (sender.isEmpty() || sender.equals(getSavedUsername(this))) return;
            if (isChatActiveInForeground(chatId)) return;
            if (!markNotifiedIfNew(this, msgId)) return;

            JSONObject senderProfile = obj.optJSONObject("senderProfile");
            String displayName = senderProfile != null && !senderProfile.isNull("displayName")
                ? senderProfile.optString("displayName", sender)
                : sender;
            String avatarUrl = senderProfile != null && !senderProfile.isNull("avatarUrl")
                ? senderProfile.optString("avatarUrl", "")
                : "";
            String avatarColor = senderProfile != null && !senderProfile.isNull("avatarColor")
                ? senderProfile.optString("avatarColor", "")
                : "";

            String body = msg.optString("text", "").trim();
            if (body.isEmpty()) {
                JSONArray attachments = msg.optJSONArray("attachments");
                if (attachments != null && attachments.length() > 0) {
                    JSONObject first = attachments.optJSONObject(0);
                    boolean isImg = first != null && first.optBoolean("isImage", false);
                    String origName = first != null ? first.optString("originalName", "file") : "file";
                    body = isImg ? "📷 Sent a photo" : ("📎 " + origName);
                } else {
                    body = "New message";
                }
            }

            showMessageNotification(this, displayName, body, chatId, avatarUrl, avatarColor);
        } catch (Exception ignored) {
        }
    }

    public static void ensureNotificationChannels(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = ctx.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel msgChannel = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        msgChannel.setDescription("Incoming chat message notifications");
        msgChannel.enableVibration(true);
        msgChannel.enableLights(true);
        manager.createNotificationChannel(msgChannel);

        NotificationChannel callChannel = new NotificationChannel(
            CHANNEL_CALLS,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callChannel.setDescription("Incoming voice and video call alerts");
        callChannel.enableVibration(true);
        callChannel.enableLights(true);
        manager.createNotificationChannel(callChannel);
    }

    private void createNotificationChannel() {
        ensureNotificationChannels(this);
    }

    public static void showIncomingCallNotification(Context ctx, String callerName, String mode, String chatId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        NotificationManager manager = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (chatId != null && !chatId.isEmpty()) {
            openIntent.putExtra(EXTRA_CHAT_ID, chatId);
        }

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(
            ctx,
            CALL_NOTIF_ID,
            openIntent,
            piFlags
        );

        String label = "video".equalsIgnoreCase(mode) ? "Incoming video call" : "Incoming voice call";
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL_CALLS)
            : new Notification.Builder(ctx);

        builder.setSmallIcon(R.drawable.ic_stat_telechat)
            .setContentTitle(callerName)
            .setContentText(label + " — Tap to answer")
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(pi);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_MAX);
        }

        manager.notify(CALL_NOTIF_ID, builder.build());
    }

    private static Bitmap fetchAvatarBitmap(Context ctx, String avatarUrl) {
        if (avatarUrl == null || avatarUrl.isEmpty() || "null".equals(avatarUrl)) return null;
        HttpURLConnection conn = null;
        try {
            String baseUrl = ctx.getString(R.string.app_url);
            String fullUrl = avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")
                ? avatarUrl
                : baseUrl + (avatarUrl.startsWith("/") ? "" : "/") + avatarUrl;

            URL url = new URL(fullUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            String cookie = CookieManager.getInstance().getCookie(baseUrl);
            if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", cookie);
            }
            if (conn.getResponseCode() != 200) return null;

            try (InputStream is = conn.getInputStream()) {
                Bitmap decoded = BitmapFactory.decodeStream(is);
                if (decoded == null) return null;
                return toCircularBitmap(decoded, 128);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static Bitmap toCircularBitmap(Bitmap source, int sizePx) {
        int srcW = source.getWidth();
        int srcH = source.getHeight();
        int cropSize = Math.min(srcW, srcH);
        int cropX = (srcW - cropSize) / 2;
        int cropY = (srcH - cropSize) / 2;

        Bitmap square = Bitmap.createBitmap(source, cropX, cropY, cropSize, cropSize);
        Bitmap scaled = Bitmap.createScaledBitmap(square, sizePx, sizePx, true);
        if (square != source) square.recycle();

        Bitmap out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        float r = sizePx / 2f;
        canvas.drawCircle(r, r, r, paint);
        scaled.recycle();
        return out;
    }

    private static Bitmap createInitialsAvatar(String displayName, String avatarColor) {
        int sizePx = 128;
        Bitmap out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);

        int bgColor = Color.parseColor("#5288C1");
        if (avatarColor != null && !avatarColor.isEmpty()) {
            Matcher m = HEX_COLOR_PATTERN.matcher(avatarColor);
            if (m.find()) {
                try {
                    bgColor = Color.parseColor("#" + m.group(1));
                } catch (Exception ignored) {
                }
            }
        }

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setColor(bgColor);
        float r = sizePx / 2f;
        canvas.drawCircle(r, r, r, bgPaint);

        String initials = "?";
        if (displayName != null && !displayName.trim().isEmpty()) {
            String[] words = displayName.trim().split("\\s+");
            if (words.length >= 2) {
                initials = ("" + words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
            } else {
                String w = words[0];
                initials = w.substring(0, Math.min(2, w.length())).toUpperCase();
            }
        }

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(50f);
        textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float textY = r - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(initials, r, textY, textPaint);
        return out;
    }

    public static void showMessageNotification(Context ctx, String title, String body, String chatId) {
        showMessageNotification(ctx, title, body, chatId, "", "");
    }

    public static void showMessageNotification(
        Context ctx,
        String title,
        String body,
        String chatId,
        String avatarUrl,
        String avatarColor
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        NotificationManager manager = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_MESSAGES);
            if (existing == null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_MESSAGES,
                    "Messages",
                    NotificationManager.IMPORTANCE_HIGH
                );
                ch.setDescription("Incoming chat message notifications");
                ch.enableVibration(true);
                ch.enableLights(true);
                manager.createNotificationChannel(ch);
            }
        }

        String safeTitle = title != null && !title.isEmpty() ? title : "VibeRoom";
        String safeBody = body != null && !body.isEmpty() ? body : "New message";
        String shortcutId = (chatId != null && !chatId.isEmpty())
            ? chatId
            : ("chat_" + Math.abs(safeTitle.hashCode()));

        Bitmap avatarBmp = fetchAvatarBitmap(ctx, avatarUrl);
        if (avatarBmp == null) {
            avatarBmp = createInitialsAvatar(safeTitle, avatarColor);
        }

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setAction(Intent.ACTION_VIEW);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (chatId != null && !chatId.isEmpty()) {
            openIntent.putExtra(EXTRA_CHAT_ID, chatId);
        }

        int msgPiFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            msgPiFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
            ctx,
            shortcutId.hashCode(),
            openIntent,
            msgPiFlags
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, CHANNEL_MESSAGES)
            : new Notification.Builder(ctx);

        builder.setSmallIcon(R.drawable.ic_stat_telechat)
            .setLargeIcon(avatarBmp)
            .setContentTitle(safeTitle)
            .setContentText(safeBody)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Icon avatarIcon = Icon.createWithBitmap(avatarBmp);
            Person sender = new Person.Builder()
                .setName(safeTitle)
                .setKey(shortcutId)
                .setIcon(avatarIcon)
                .build();
            Person me = new Person.Builder()
                .setName("Me")
                .setKey("me")
                .build();

            try {
                ShortcutManager shortcutManager = ctx.getSystemService(ShortcutManager.class);
                if (shortcutManager != null) {
                    ShortcutInfo.Builder scBuilder = new ShortcutInfo.Builder(ctx, shortcutId)
                        .setShortLabel(safeTitle)
                        .setIcon(avatarIcon)
                        .setIntent(openIntent);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        scBuilder.setLongLived(true)
                            .setPerson(sender)
                            .setLocusId(new LocusId(shortcutId));
                    }
                    ShortcutInfo shortcut = scBuilder.build();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        shortcutManager.pushDynamicShortcut(shortcut);
                    } else {
                        shortcutManager.addDynamicShortcuts(Collections.singletonList(shortcut));
                    }
                    builder.setShortcutId(shortcutId);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        builder.setLocusId(new LocusId(shortcutId));
                    }
                }
            } catch (Exception ignored) {
            }

            Notification.MessagingStyle style = new Notification.MessagingStyle(me)
                .setGroupConversation(false)
                .addMessage(safeBody, System.currentTimeMillis(), sender);
            builder.setStyle(style);
        } else {
            builder.setStyle(new Notification.BigTextStyle().bigText(safeBody));
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setDefaults(Notification.DEFAULT_ALL);
        }

        manager.notify(shortcutId.hashCode(), builder.build());
    }
}
