package fun.bitdev.telechat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class CallActionReceiver extends BroadcastReceiver {

    public static String getDeclineAction(Context ctx) {
        return ctx.getPackageName() + ".ACTION_DECLINE_CALL";
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        if (!getDeclineAction(context).equals(intent.getAction())) return;

        String callId = intent.getStringExtra(MainActivity.EXTRA_CALL_ID);
        MessageService.cancelIncomingCallNotification(context, callId);

        if (callId == null || callId.isEmpty()) return;
        PendingResult pending = goAsync();
        declineCallAsync(context.getApplicationContext(), callId, pending::finish);
    }

    public static void declineCallAsync(Context ctx, String callId, Runnable onDone) {
        if (ctx == null || callId == null || callId.isEmpty()) {
            if (onDone != null) onDone.run();
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String baseUrl = ctx.getString(R.string.app_url);
                String cookie = CookieManager.getInstance().getCookie(baseUrl);
                URL url = new URL(baseUrl + "/api/calls/" + callId + "/decline");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                if (cookie != null && !cookie.isEmpty()) {
                    conn.setRequestProperty("Cookie", cookie);
                }
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write("{}".getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
                if (onDone != null) onDone.run();
            }
        }, "VibeRoom-DeclineCall").start();
    }
}
