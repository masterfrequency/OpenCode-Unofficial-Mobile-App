package dev.phonkalphabet.opencode.mobile;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;

import java.util.Collections;

/** Remembers the most recent session (non-secret metadata) for the launcher shortcut and the widget. */
final class LastSession {
    private static final String PREFS = "opencode_last_session";

    private LastSession() { }

    static void save(Context context, String profile, String session, String title, String state) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("profile", profile).putString("session", session).putString("title", title == null ? "" : title)
            .putString("state", state == null ? "idle" : state).putLong("updated", System.currentTimeMillis()).apply();
        refresh(context);
    }

    static void setState(Context context, String session, String state) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!session.equals(prefs.getString("session", ""))) return;
        prefs.edit().putString("state", state).putLong("updated", System.currentTimeMillis()).apply();
        refresh(context);
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        refresh(context);
    }

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void refresh(Context context) {
        updateShortcut(context);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, LastSessionWidget.class));
        if (ids != null && ids.length > 0) LastSessionWidget.update(context, manager, ids);
    }

    private static void updateShortcut(Context context) {
        try {
            ShortcutManager shortcuts = context.getSystemService(ShortcutManager.class);
            if (shortcuts == null) return;
            SharedPreferences prefs = prefs(context);
            String profile = prefs.getString("profile", "");
            String session = prefs.getString("session", "");
            if (profile.isEmpty() || session.isEmpty()) { shortcuts.removeAllDynamicShortcuts(); return; }
            String title = prefs.getString("title", "");
            if (title.isEmpty()) title = context.getString(R.string.last_session_fallback);
            String shortLabel = title.length() > 22 ? title.substring(0, 21) + "…" : title;
            ShortcutInfo info = new ShortcutInfo.Builder(context, "last_session")
                .setShortLabel(shortLabel)
                .setLongLabel(context.getString(R.string.shortcut_resume_long, title))
                .setIcon(Icon.createWithResource(context, R.drawable.ic_shortcut_chat))
                .setIntent(Notifier.sessionIntent(context, profile, session, title))
                .build();
            shortcuts.setDynamicShortcuts(Collections.singletonList(info));
        } catch (Exception ignored) { }
    }
}
