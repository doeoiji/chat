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
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
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
    public static final String CHANNEL_SERVICE = "telechat_service";
    public static final String EXTRA_CHAT_ID = "extra_chat_id";
    private static final int FOREGROUND_ID = 101;
    private static final Pattern HEX_COLOR_PATTERN = Pattern.compile("#([0-9a-fA-F]{6})");

    private volatile boolean running = false;
    private Thread workerThread;
    private static volatile String currentUsername = "";
    private static volatile String activeChatId = "";
    private static volatile boolean appInForeground = false;
    private static final Set<String> notifiedMessageIds = Collections.synchronizedSet(new LinkedHashSet<>());

    public static void updateAppState(String username, String chatId, boolean inForeground) {
        currentUsername = username != null ? username : "";
        activeChatId = chatId != null ? chatId : "";
        appInForeground = inForeground;
    }

    public static boolean markNotifiedIfNew(String msgId) {
        if (msgId == null || msgId.isEmpty()) return true;
        synchronized (notifiedMessageIds) {
            if (notifiedMessageIds.contains(msgId)) return false;
            notifiedMessageIds.add(msgId);
            if (notifiedMessageIds.size() > 150) {
                String first = notifiedMessageIds.iterator().next();
                notifiedMessageIds.remove(first);
            }
            return true;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat();
        if (!running) {
            running = true;
            workerThread = new Thread(this::listenLoop, "TeleChat-SSE");
            workerThread.setDaemon(true);
            workerThread.start();
        }
        return START_STICKY;
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

    private void startForegroundCompat() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_SERVICE)
            : new Notification.Builder(this);

        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notif = builder
            .setSmallIcon(R.drawable.ic_stat_telechat)
            .setContentTitle("TeleChat")
            .setContentText("Connected for incoming messages")
            .setOngoing(true)
            .setContentIntent(pi)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(FOREGROUND_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(FOREGROUND_ID, notif);
        }
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
                if (!uname.isEmpty()) currentUsername = uname;
                return;
            }
            if (!"new_message".equals(eventName)) return;

            JSONObject obj = new JSONObject(jsonStr);
            String chatId = obj.optString("chatId", "");
            JSONObject msg = obj.optJSONObject("message");
            if (msg == null) return;

            String msgId = msg.optString("id", "");
            String sender = msg.optString("sender", "");
            if (sender.isEmpty() || sender.equals(currentUsername)) return;
            if (appInForeground && chatId.equals(activeChatId)) return;
            if (!markNotifiedIfNew(msgId)) return;

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

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
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

            NotificationChannel svcChannel = new NotificationChannel(
                CHANNEL_SERVICE,
                "Background Connection",
                NotificationManager.IMPORTANCE_MIN
            );
            svcChannel.setDescription("Keeps TeleChat connected for instant notifications");
            svcChannel.setShowBadge(false);
            manager.createNotificationChannel(svcChannel);
        }
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

        String safeTitle = title != null && !title.isEmpty() ? title : "TeleChat";
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

        PendingIntent pendingIntent = PendingIntent.getActivity(
            ctx,
            shortcutId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
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

            // Publish dynamic conversation shortcut so Android 11+ shows the large circular avatar directly (Messenger-style)
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
