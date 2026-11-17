package fun.bitdev.telechat;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Lightweight background JobService that checks /api/chats for unread messages
 * without displaying any persistent "Connected" foreground notification.
 */
public class MessagePollJobService extends JobService {

    private static final int JOB_ID = 303;
    private volatile boolean cancelled = false;

    public static void schedule(Context ctx) {
        try {
            JobScheduler scheduler = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            ComponentName component = new ComponentName(ctx, MessagePollJobService.class);
            JobInfo job = new JobInfo.Builder(JOB_ID, component)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(20_000L)
                .setOverrideDeadline(60_000L)
                .setPersisted(false)
                .build();
            scheduler.schedule(job);
        } catch (Exception ignored) {
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        cancelled = false;
        new Thread(() -> {
            try {
                pollUnreadMessages();
            } finally {
                if (!cancelled) {
                    schedule(getApplicationContext());
                }
                jobFinished(params, false);
            }
        }, "TeleChat-PollJob").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        cancelled = true;
        return true;
    }

    private void pollUnreadMessages() {
        String baseUrl = getString(R.string.app_url);
        HttpURLConnection conn = null;
        try {
            String cookie = CookieManager.getInstance().getCookie(baseUrl);
            if (cookie == null || !cookie.contains("telechat_session=")) return;

            URL url = new URL(baseUrl + "/api/chats");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Cookie", cookie);
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            if (conn.getResponseCode() != 200) return;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }

            JSONObject data = new JSONObject(sb.toString());
            JSONArray chats = data.optJSONArray("chats");
            if (chats == null) return;

            String me = MessageService.getSavedUsername(this);
            for (int i = 0; i < chats.length(); i++) {
                JSONObject chat = chats.optJSONObject(i);
                if (chat == null) continue;
                int unread = chat.optInt("unreadCount", 0);
                if (unread <= 0) continue;

                String chatId = chat.optString("id", "");
                if (MessageService.isChatActiveInForeground(chatId)) continue;

                JSONObject lastMsg = chat.optJSONObject("lastMessage");
                if (lastMsg == null) continue;
                String msgId = lastMsg.optString("id", "");
                String sender = lastMsg.optString("sender", "");
                if (sender.isEmpty() || sender.equals(me)) continue;
                if (!MessageService.markNotifiedIfNew(this, msgId)) continue;

                JSONObject peer = chat.optJSONObject("peer");
                String displayName = (peer != null && !peer.isNull("displayName"))
                    ? peer.optString("displayName", sender)
                    : sender;
                String avatarUrl = (peer != null && !peer.isNull("avatarUrl"))
                    ? peer.optString("avatarUrl", "")
                    : "";
                String avatarColor = (peer != null && !peer.isNull("avatarColor"))
                    ? peer.optString("avatarColor", "")
                    : "";
                String preview = lastMsg.optString("preview", "New message");

                MessageService.showMessageNotification(this, displayName, preview, chatId, avatarUrl, avatarColor);
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
