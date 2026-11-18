package fun.bitdev.telechat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {

    private static volatile IncomingCallActivity activeInstance = null;
    private static volatile String activeCallId = "";

    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoFinishTask = () -> {
        MessageService.cancelIncomingCallNotification(this, callId);
        finish();
    };

    private String callId = "";
    private String chatId = "";
    private String callMode = "audio";
    private String callerName = "Incoming Call";
    private String avatarUrl = "";
    private String avatarColor = "";

    public static void dismissIfMatches(String targetCallId) {
        IncomingCallActivity inst = activeInstance;
        if (inst == null) return;
        if (targetCallId == null || targetCallId.isEmpty() || targetCallId.equals(activeCallId)) {
            inst.runOnUiThread(inst::finish);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyLockScreenFlags();
        parseIntent(getIntent());
        activeInstance = this;
        activeCallId = callId;

        buildUi();
        timeoutHandler.removeCallbacks(autoFinishTask);
        timeoutHandler.postDelayed(autoFinishTask, 46_000L);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        parseIntent(intent);
        activeCallId = callId;
        buildUi();
        timeoutHandler.removeCallbacks(autoFinishTask);
        timeoutHandler.postDelayed(autoFinishTask, 46_000L);
    }

    @Override
    protected void onDestroy() {
        timeoutHandler.removeCallbacks(autoFinishTask);
        if (activeInstance == this) {
            activeInstance = null;
            activeCallId = "";
        }
        super.onDestroy();
    }

    private void applyLockScreenFlags() {
        Window w = getWindow();
        if (w != null) {
            w.setStatusBarColor(Color.parseColor("#11171B"));
            w.setNavigationBarColor(Color.parseColor("#11171B"));
            w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                w.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                );
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }

    private void parseIntent(Intent intent) {
        if (intent == null) return;
        String cId = intent.getStringExtra(MainActivity.EXTRA_CALL_ID);
        String chId = intent.getStringExtra(MessageService.EXTRA_CHAT_ID);
        String md = intent.getStringExtra(MainActivity.EXTRA_CALL_MODE);
        String nm = intent.getStringExtra(MainActivity.EXTRA_CALLER_NAME);
        String av = intent.getStringExtra(MainActivity.EXTRA_AVATAR_URL);
        String ac = intent.getStringExtra(MainActivity.EXTRA_AVATAR_COLOR);
        if (cId != null) callId = cId;
        if (chId != null) chatId = chId;
        if (md != null && !md.isEmpty()) callMode = md;
        if (nm != null && !nm.isEmpty()) callerName = nm;
        if (av != null) avatarUrl = av;
        if (ac != null) avatarColor = ac;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#11171B"));
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(56), dp(24), dp(48));

        TextView brandView = new TextView(this);
        brandView.setText("VibeRoom");
        brandView.setTextColor(Color.parseColor("#8CA0B0"));
        brandView.setTextSize(14f);
        brandView.setTypeface(Typeface.DEFAULT_BOLD);
        brandView.setGravity(Gravity.CENTER);
        root.addView(brandView);

        TextView nameView = new TextView(this);
        nameView.setText(callerName);
        nameView.setTextColor(Color.WHITE);
        nameView.setTextSize(26f);
        nameView.setTypeface(Typeface.DEFAULT_BOLD);
        nameView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        nameLp.topMargin = dp(10);
        root.addView(nameView, nameLp);

        TextView subView = new TextView(this);
        subView.setText("video".equalsIgnoreCase(callMode) ? "Incoming Video Call" : "Incoming Voice Call");
        subView.setTextColor(Color.parseColor("#9CB0C5"));
        subView.setTextSize(15f);
        subView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        subLp.topMargin = dp(6);
        root.addView(subView, subLp);

        View topSpacer = new View(this);
        root.addView(topSpacer, new LinearLayout.LayoutParams(1, 0, 1f));

        ImageView avatarView = new ImageView(this);
        avatarView.setImageBitmap(MessageService.createInitialsAvatar(callerName, avatarColor));
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(dp(140), dp(140));
        avLp.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(avatarView, avLp);

        if (avatarUrl != null && !avatarUrl.isEmpty() && !"null".equals(avatarUrl)) {
            new Thread(() -> {
                Bitmap bmp = MessageService.fetchAvatarBitmap(getApplicationContext(), avatarUrl);
                if (bmp != null) {
                    runOnUiThread(() -> avatarView.setImageBitmap(bmp));
                }
            }, "VibeRoom-CallAvatar").start();
        }

        View bottomSpacer = new View(this);
        root.addView(bottomSpacer, new LinearLayout.LayoutParams(1, 0, 1.3f));

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);

        LinearLayout declineCol = createRoundCallButton(
            "Decline",
            "✕",
            Color.parseColor("#EA3346"),
            v -> onDeclinePressed()
        );
        LinearLayout.LayoutParams decLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        decLp.rightMargin = dp(64);
        btnRow.addView(declineCol, decLp);

        LinearLayout answerCol = createRoundCallButton(
            "Answer",
            "✓",
            Color.parseColor("#28B454"),
            v -> onAnswerPressed()
        );
        btnRow.addView(answerCol);

        root.addView(btnRow);
        setContentView(root);
    }

    private LinearLayout createRoundCallButton(String label, String glyph, int bgColor, View.OnClickListener listener) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView circle = new TextView(this);
        circle.setText(glyph);
        circle.setTextColor(Color.WHITE);
        circle.setTextSize(26f);
        circle.setTypeface(Typeface.DEFAULT_BOLD);
        circle.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(bgColor);
        circle.setBackground(bg);
        circle.setOnClickListener(listener);
        col.addView(circle, new LinearLayout.LayoutParams(dp(72), dp(72)));

        TextView lbl = new TextView(this);
        lbl.setText(label);
        lbl.setTextColor(Color.parseColor("#D7E0E5"));
        lbl.setTextSize(13.5f);
        lbl.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lblLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lblLp.topMargin = dp(10);
        col.addView(lbl, lblLp);
        return col;
    }

    private void onDeclinePressed() {
        MessageService.cancelIncomingCallNotification(this, callId);
        if (callId != null && !callId.isEmpty()) {
            CallActionReceiver.declineCallAsync(getApplicationContext(), callId, null);
        }
        finish();
    }

    private void onAnswerPressed() {
        MessageService.cancelIncomingCallNotification(this, callId);
        Intent answerIntent = new Intent(this, MainActivity.class);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (chatId != null && !chatId.isEmpty()) {
            answerIntent.putExtra(MessageService.EXTRA_CHAT_ID, chatId);
        }
        answerIntent.putExtra(MainActivity.EXTRA_CALL_ID, callId);
        answerIntent.putExtra(MainActivity.EXTRA_CALL_MODE, callMode);
        answerIntent.putExtra(MainActivity.EXTRA_CALL_ACTION, "answer");
        startActivity(answerIntent);
        finish();
    }
}
