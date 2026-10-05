package dev.phonkalphabet.opencode.mobile;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Home-screen widget: opens the last session, or starts a new chat. */
public final class LastSessionWidget extends AppWidgetProvider {
    private static final long STALE_MS = 6L * 60 * 60 * 1000;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        update(context, manager, ids);
    }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        SharedPreferences prefs = LastSession.prefs(context);
        String profile = prefs.getString("profile", "");
        String session = prefs.getString("session", "");
        String title = prefs.getString("title", "");
        String state = prefs.getString("state", "idle");
        boolean has = !profile.isEmpty() && !session.isEmpty();
        boolean stale = System.currentTimeMillis() - prefs.getLong("updated", 0) > STALE_MS;
        if (stale && "working".equals(state)) state = "idle";

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_last_session);
        views.setTextViewText(R.id.widget_session, has ? (title.isEmpty() ? context.getString(R.string.last_session_fallback) : title) : context.getString(R.string.widget_empty));
        int statusText = !has ? R.string.widget_empty_hint : "working".equals(state) ? R.string.widget_working : "done".equals(state) ? R.string.widget_done : R.string.widget_continue;
        views.setTextViewText(R.id.widget_status, context.getString(statusText));
        views.setTextColor(R.id.widget_status, "working".equals(state) ? 0xFF22E8F2 : "done".equals(state) ? 0xFF66D6AD : 0xFFA8ACC3);
        Intent open = has ? Notifier.sessionIntent(context, profile, session, title)
            : new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        views.setOnClickPendingIntent(R.id.widget_root, Notifier.pending(context, open, 20));
        views.setOnClickPendingIntent(R.id.widget_new, Notifier.pending(context, Notifier.newChatIntent(context), 21));
        manager.updateAppWidget(ids, views);
    }
}
