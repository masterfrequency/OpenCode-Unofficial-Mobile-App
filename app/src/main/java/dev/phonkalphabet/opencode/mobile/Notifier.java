package dev.phonkalphabet.opencode.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

/** Notification channels, launch intents, and the three notification kinds the app posts. */
final class Notifier {
    static final String ACTION_OPEN_SESSION = "dev.phonkalphabet.opencode.mobile.OPEN_SESSION";
    static final String ACTION_NEW_CHAT = "dev.phonkalphabet.opencode.mobile.NEW_CHAT";
    static final String EXTRA_PROFILE = "profile";
    static final String EXTRA_SESSION = "session";
    static final String EXTRA_TITLE = "title";
    static final int FOREGROUND_ID = 7001;
    static final String CHANNEL_RUNNING = "running";
    static final String CHANNEL_DONE = "done";
    static final String CHANNEL_ATTENTION = "attention";

    private Notifier() { }

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel running = new NotificationChannel(CHANNEL_RUNNING, context.getString(R.string.channel_running), NotificationManager.IMPORTANCE_LOW);
        running.setDescription(context.getString(R.string.channel_running_desc));
        running.setShowBadge(false);
        NotificationChannel done = new NotificationChannel(CHANNEL_DONE, context.getString(R.string.channel_done), NotificationManager.IMPORTANCE_DEFAULT);
        done.setDescription(context.getString(R.string.channel_done_desc));
        NotificationChannel attention = new NotificationChannel(CHANNEL_ATTENTION, context.getString(R.string.channel_attention), NotificationManager.IMPORTANCE_HIGH);
        attention.setDescription(context.getString(R.string.channel_attention_desc));
        manager.createNotificationChannel(running);
        manager.createNotificationChannel(done);
        manager.createNotificationChannel(attention);
    }

    static boolean allowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.areNotificationsEnabled();
    }

    static Intent sessionIntent(Context context, String profile, String session, String title) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_OPEN_SESSION);
        intent.putExtra(EXTRA_PROFILE, profile);
        intent.putExtra(EXTRA_SESSION, session);
        intent.putExtra(EXTRA_TITLE, title);
        intent.setData(Uri.parse("opencode-unofficial://session/" + Uri.encode(session)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    static Intent newChatIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_NEW_CHAT);
        intent.setData(Uri.parse("opencode-unofficial://new-chat"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    static PendingIntent pending(Context context, Intent intent, int requestCode) {
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static int doneId(String session) { return session.hashCode(); }
    static int attentionId(String session) { return ~session.hashCode(); }

    /** Task finished or failed. Content stays generic on the lock screen. */
    static void done(Context context, String profile, String session, String title, boolean failed) {
        post(context, CHANNEL_DONE, doneId(session), profile, session, title,
            context.getString(failed ? R.string.notif_failed : R.string.notif_done), Notification.CATEGORY_STATUS);
    }

    /** OpenCode is waiting for an approval. */
    static void attention(Context context, String profile, String session, String title) {
        post(context, CHANNEL_ATTENTION, attentionId(session), profile, session, title,
            context.getString(R.string.notif_permission), Notification.CATEGORY_MESSAGE);
    }

    private static void post(Context context, String channel, int id, String profile, String session, String title, String headline, String category) {
        if (!allowed(context)) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        ensureChannels(context);
        String text = title == null || title.trim().isEmpty() ? context.getString(R.string.app_name) : title.trim();
        Notification publicVersion = new Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat).setContentTitle(headline).build();
        Notification notification = new Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(headline)
            .setContentText(text)
            .setCategory(category)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(pending(context, sessionIntent(context, profile, session, title), id))
            .build();
        manager.notify(id, notification);
    }

    static void clear(Context context, String session) {
        if (session == null || session.isEmpty()) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.cancel(doneId(session));
        manager.cancel(attentionId(session));
    }

    static void clearAttention(Context context, String session) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(attentionId(session));
    }

    static Notification foreground(Context context, int count, String firstTitle) {
        ensureChannels(context);
        String text = count == 1 && firstTitle != null && !firstTitle.trim().isEmpty()
            ? firstTitle.trim()
            : context.getResources().getQuantityString(R.plurals.notif_running_count, count, count);
        return new Notification.Builder(context, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(context.getString(R.string.notif_running))
            .setContentText(text)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(pending(context, new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), 1))
            .build();
    }
}
