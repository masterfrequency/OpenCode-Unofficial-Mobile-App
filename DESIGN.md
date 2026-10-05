# UI design notes — "Obsidian Aurora" (v1.0)

Front-end lives in `app/src/main/assets/`:

| File | Role |
|---|---|
| `index.html` | Markup, inline SVG icon sprite, shared tab bar, bottom sheets |
| `app.css` | The only stylesheet: tokens → base → choreography → components → motion |
| `ui.js` | Pure UI helpers: safe Markdown, syntax highlighting, list choreography, ripple, copy |
| `app.js` | App logic (connections, sessions, chat, models) |
| `fonts/` | Inter + JetBrains Mono (OFL), bundled so the look is identical on every phone |

## Animation choreography

Every screen enters in a fixed order, driven by CSS custom properties (`--n`, `--k`, `--i`):

1. Header drops in  →  2. hero (orb → badge → title → text) rises in sequence  →  3. cards cascade (65 ms apart)  →  4. tab bar glides up last.

Animation is used for meaning rather than decoration:

- **Orbiting gradient ring** only appears around the thing that is *live*: the composer while focused/responding and the assistant message while it streams.
- **Tab pill / segmented controls** slide between options with a spring curve.
- **Skeleton shimmer** while loading; **sheen** sweeps once across hero cards and primary buttons.
- Chat messages animate in once; polling never replays animations (keyed DOM reconciliation).
- `prefers-reduced-motion` disables all of it; the background video is paused too.

## Behaviour changes worth knowing

- The duplicate "Home" and "Chats" tabs are now one **Chats** tab; the fourth tab is **Servers** (back to the connection list).
- Assistant replies render Markdown (headings, lists, tables, code blocks with Copy, diffs). Tapping a link opens it in the browser (http/https only).
- Native haptic tap on buttons (`AndroidDevice.tap`).

## Chat upgrades (v1.1)

- **Follow only at the bottom.** `follow` is true while the end of the conversation is within ~56px of the visible area (the "pin the question" padding is ignored). Streaming growth scrolls along only then; otherwise a "New content ↓" pill appears. Sending a message still pins your question to the top and never pulls the view back afterwards.
- **Retry.** The final reply (or error / aborted reply) shows a Retry action that re-sends the last user prompt, including attachments. It uses the selected model, or the original one if none is selected.
- **Queue.** While OpenCode is busy the send button becomes a queue button if the composer has text, and Stop if it is empty. Queued items live in memory per session, run one at a time when OpenCode finishes, and pause after Stop or an error (tray shows Resume).
- **Pinned sessions.** Session sheet → Pin to top. Stored per connection in `localStorage` (`opencode.remote.pins.v1`).
- **Search in conversation.** Header search button. Uses the CSS Custom Highlight API; tool chips are matched on their full command, path and output and are expanded when current.
- **Tool details.** Tap a tool chip. Edits/writes/patches render as a diff view (uses the server's diff when present, otherwise computes one from old/new strings).
- **Code blocks.** Language label, copy button, horizontal scroll, and a global line-wrap toggle (`opencode.remote.wrap.v1`).
- **Usage.** Header shows total tokens and cost summed from assistant messages, only if the server reports them. Tap for the breakdown.

## Phone integration (v1.2)

- **Plan panel.** `setTodos()` renders the latest `todowrite` tool call (or a live `todo.updated` event) above the composer: collapsed it shows the active step, a done/total count and a progress bar; tap to expand the full list. The open state is remembered (`opencode.remote.todoOpen.v1`). Hidden when a session has no plan.
- **Notifications.** `watchSession()` registers a busy session with `AndroidDevice.watch(...)`. `TaskService` (foreground service, `dataSync`) holds the gateway `/event` stream natively, so alerts do not depend on WebView timers. It posts *finished*, *error* and *needs approval* notifications only when the app is not on screen; when it is, `window.nativeTaskEvent` shows a toast instead. On reconnect it re-checks the last message so a task that ended during a network gap is not missed. Android 13+ asks for the notification permission the first time a task is watched; the switch lives under **Servers → On this phone**.
- **Shortcuts and widget.** Static *New chat* shortcut, dynamic *Resume* shortcut and the *Last session* widget all launch `MainActivity` with `NEW_CHAT` / `OPEN_SESSION` actions, handled by `window.nativeNewChat` / `window.nativeOpenSession`. Notification taps use the same path.
- **Haptics.** `haptic('done' | 'attention' | 'error')` → `performHapticFeedback`, so the system touch-feedback setting is respected. Only fires while the app is visible; background alerts use the notification channels.
