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
