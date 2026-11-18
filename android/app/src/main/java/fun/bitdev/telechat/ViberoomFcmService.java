package fun.bitdev.telechat;

import android.content.Context;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class ViberoomFcmService extends FirebaseMessagingService {

    private static final String PREFS_FCM = "viberoom_fcm_prefs";
    private static final String KEY_FCM_TOKEN = "fcm_token";

    public static String getCachedToken(Context ctx) {
        if (ctx == null) return "";
        return ctx.getSharedPreferences(PREFS_FCM, Context.MODE_PRIVATE).getString(KEY_FCM_TOKEN, "");
    }

    public static void saveCachedToken(Context ctx, String token) {
        if (ctx == null || token == null) return;
        ctx.getSharedPreferences(PREFS_FCM, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply();
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        saveCachedToken(this, token);
        MainActivity.notifyFcmTokenUpdated(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (remoteMessage == null) return;

        MessageService.ensureNotificationChannels(this);

        Map<String, String> data = remoteMessage.getData();
        String type = data.getOrDefault("type", "message");
        String chatId = data.getOrDefault("chatId", "");
        String msgId = data.getOrDefault("messageId", "");
        String title = data.getOrDefault("title", data.getOrDefault("senderName", "VibeRoom"));
        String body = data.getOrDefault("body", data.getOrDefault("preview", "New message"));

        if (remoteMessage.getNotification() != null) {
            if (remoteMessage.getNotification().getTitle() != null) {
                title = remoteMessage.getNotification().getTitle();
            }
            if (remoteMessage.getNotification().getBody() != null) {
                body = remoteMessage.getNotification().getBody();
            }
        }

        if ("call".equals(type)) {
            MessageService.showIncomingCallNotification(this, title, "audio", chatId);
            return;
        }

        if (!chatId.isEmpty() && MessageService.isChatActiveInForeground(chatId)) {
            return;
        }
        if (!msgId.isEmpty() && !MessageService.markNotifiedIfNew(this, msgId)) {
            return;
        }

        MessageService.showMessageNotification(this, title, body, chatId, "", "");
    }
}
