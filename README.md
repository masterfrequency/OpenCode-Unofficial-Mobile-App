# OpenCode Unofficial for Android

An Android-only remote client for connecting to an existing OpenCode installation on a VPS or home PC. This project is independent and is not affiliated with, maintained by, sponsored by, or endorsed by the OpenCode team.

UI design notes: see [DESIGN.md](DESIGN.md).

## Download

<table>
<tr><th>Platform</th><th>File</th><th>SHA-256</th></tr>
| Android 8+ | [OpenCode-Unofficial-v1.2.apk](https://github.com/masterfrequency/OpenCode-Unofficial-Mobile-App/releases/download/v1.2.0/OpenCode-Unofficial-v1.2.apk) | `6622120e6eb2bff3dbc9d595156ebfe75c90f7b6a53693f252b85b3013f9dced` |
| Windows | [OpenCode-Unofficial-Setup-v1.2.com](https://github.com/masterfrequency/OpenCode-Unofficial-Mobile-App/releases/download/v1.2.0/OpenCode-Unofficial-Setup-v1.2.com) | `eca0edc9f117ebfcd50be9fe0e2999d04fb8f8a2d9165c264232df52e095ecbb` |
| Debian / Ubuntu | [opencode-unofficial-gateway_1.2.deb](https://github.com/masterfrequency/OpenCode-Unofficial-Mobile-App/releases/download/v1.2.0/opencode-unofficial-gateway_1.2.deb) | `e082a4c14e795655a27514d66c9f2ff60b2707511ea2ed2e57dcb7888281c213` |

The APKs are deliberately not committed to git (`.gitignore` excludes `*.apk`) and are distributed as release assets.
</table>

The gateway installers are also downloadable from inside the app under **Help**.

> **Android will warn about sideloading.** Play Protect flags any APK installed from a browser, chat, or file manager. This is expected for a self-signed build and is not an indication of a problem with the file. Verify the SHA-256 above against your download.

## What's new in v1.2

1. **Smart auto-scroll** — follows growing answers only when you are already at the bottom. Scroll up and the app leaves you alone while showing *New content ↓*.
2. **Retry & regenerate** — retry failed requests or regenerate the latest answer instantly.
3. **Message queue** — prepare and queue your next instructions while OpenCode is still working.
4. **Pinned sessions** — keep important projects and conversations at the top.
5. **Conversation search** — quickly find commands, filenames, errors, or previous answers.
6. **Expandable tool activity** — inspect commands, tool output, operations, and file changes.
7. **Improved code blocks** — language labels, copy buttons, horizontal scrolling, and optional wrapping.
8. **Token & cost information** — view usage when the connected server and provider report it.
9. **Live plan panel** — follow OpenCode's task list and progress while it works.
10. **Task notifications** — alerts when work finishes, fails, or requires permission, even when the app is in the background.
11. **Android integration** — app-icon shortcuts for *New chat* and *Resume last session*, plus a last-session home-screen widget.
12. **Central settings** — sound volume, haptics, notification behaviour, auto-scroll mode, reduced motion, and text size.
13. **Markdown conversation export** — save complete sessions or share them with another Android app.
14. **Polished chat experience** — keyboard-safe composer, question positioning, translucent animated glass, iridescent borders, video backgrounds, typewriter responses, and stable rendering for extremely long answers without bubble flashing.

Each phone pairs with its own encrypted credential stored through Android Keystore. Owners can review devices, revoke access, transfer ownership, and recover the gateway locally.

Built by 🇭🇷 PhonkAlphabet — your OpenCode, your machine, anywhere.

## Architecture

The Android app never runs OpenCode itself. OpenCode and its provider credentials remain on the remote machine. The included gateway authenticates mobile requests, then forwards them to `opencode serve` over loopback only.

**Never expose port 4096 directly to the internet.** Expose the gateway through HTTPS using Caddy, Tailscale Serve, Cloudflare Tunnel, or an equivalent trusted reverse proxy.

## Build a signed release

Production releases are built by `.github/workflows/release.yml`. The workflow builds and signs the Windows installer, builds the Debian package, embeds both in the Android app, and then creates the signed APK and AAB.

Create the key once:

```bash
keytool -genkeypair -v -keystore release-key.jks -alias opencode-unofficial -keyalg RSA -keysize 4096 -validity 10000
cp keystore.properties.example keystore.properties
```

Configure these GitHub Actions secrets before publishing a release:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

The workflow publishes the signed APK/AAB, signed Windows installer, and Debian package. Local debug builds do not require signing credentials. Release builds intentionally fail when signing configuration or bundled installers are missing.

## Distribution and Android warnings

For normal public distribution, upload the signed `.aab` to Google Play and enable Play App Signing. Google Play distribution is the reliable way to establish application identity, scanning, and update trust.

Android or Play Protect can warn about any APK installed directly from a browser, chat, or file manager. Signing and clean source code do not guarantee removal of that sideload warning. Do not rename a debug APK as a release or encourage users to bypass security prompts.

## Run on a VPS or home PC

Requirements: OpenCode, Node.js 20+, and an HTTPS route to the gateway.

### Getting the gateway as an APK user

No source archive is required. In the Android app open **Help** and save the Windows `.exe`, Debian/Ubuntu `.deb`, or portable `.zip`. Transfer it to the same computer or VPS where OpenCode is installed. The gateway is a companion process: it does **not** replace, patch, or belong inside the OpenCode installation or configuration directories.

The signed release workflow builds the Windows installer and Debian package before the APK, embeds both installers in the APK, and publishes them beside the APK. A production Windows release requires `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD` in addition to the Android signing secrets. Signing establishes publisher identity, but Microsoft SmartScreen reputation and distribution policy still determine whether Windows displays a warning.

Source-code users already have the identical files in this repository's `gateway/` directory.

```bash
cd ~/opencode-unofficial-gateway/gateway
chmod +x start.sh
export OPENCODE_REMOTE_TOKEN="$(openssl rand -hex 32)"
./start.sh
```

This starts:

- OpenCode on `127.0.0.1:4096`
- The authenticated gateway on `127.0.0.1:4174`

Put Caddy in front using `gateway/Caddyfile.example`, or use Tailscale Serve for a home PC. The gateway prints a six-digit, single-use pairing code valid for one hour.

For private Tailscale access, install Tailscale on the server and Android device, sign both into the same tailnet, then run:

```bash
tailscale serve --bg localhost:4174
```

Tailscale provisions the HTTPS endpoint. Enter that URL and the six-digit gateway code in the app, then tap **Pair securely**. The app retrieves the long gateway token once over HTTPS and saves it through Android Keystore. Restart the gateway if the code expires or has already been used.

### Windows home PC

Install OpenCode, Node.js 20+, and Tailscale. Extract the package into its own folder, for example `C:\OpenCode-Unofficial-Gateway`; do not overwrite OpenCode. Then run:

```powershell
cd C:\OpenCode-Unofficial-Gateway\gateway
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

The launcher securely stores a persistent gateway token and prints a six-digit one-time pairing code. Keep that window open. In a second PowerShell window run:

```powershell
tailscale serve --bg localhost:4174
```

Enter the resulting HTTPS URL and six-digit pairing code in the Android app, then tap **Pair securely**. Do not create public Windows Firewall rules for ports 4096 or 4174.

## Capabilities

- Multiple authenticated OpenCode server profiles and project directories
- Sessions, streaming messages, tool progress, permissions, projects, providers, and model selection
- OpenRouter and custom OpenAI-compatible provider setup
- HTTPS-only pairing with Android Keystore-backed per-device credentials
- Owner/member roles, device revocation, ownership transfer, and local recovery tools
- Gateway health, version, uptime, Tailscale, and device diagnostics
- Embedded Windows, Debian/Ubuntu, and portable gateway installers
- Android keyboard-safe composer, waiting-state positioning, and typewriter response rendering
- Animated translucent glass interface and shared video background across primary screens
- Local send, receive, and interface sounds with adjustable volume and reduced-motion support
- App settings for haptics, notification preferences, smart/always/off auto-scroll, and three text-size levels
- Native conversation export: save a session as Markdown or share its Markdown text to another Android app
- Actionable re-pair guidance when a device credential expires, is revoked, or the gateway is reset
- Collapsible plan panel that mirrors OpenCode's task list with live progress
- Notifications when a task finishes, fails, or needs permission while the app is in the background (foreground service, opt-out in **Servers → On this phone**)
- Launcher shortcuts (long-press the app icon: **New chat** and **Resume last session**) and a **Last session** home-screen widget
- Light haptics when a reply finishes, errors, or a permission is requested

## Gateway deployment variables

The secure default binds the gateway to `127.0.0.1`. Tailscale Serve and Caddy running on the same host can proxy that loopback address; do not change `GATEWAY_HOST` for those setups.

Container and immutable deployments can use:

- `PAIRING_CODE_FILE=/writable/private/path/pairing-code` to place the code in writable storage.
- `DEVICE_STORE_FILE=/writable/private/path/devices.json` to persist hashed device credentials on immutable or containerized systems.
- `PAIRING_TTL_MINUTES=60` to change the single-use code lifetime; accepted range is 5–1440 minutes.
- `MAX_PAIRED_DEVICES=20` to cap paired devices; accepted range is 1–100.
- `GATEWAY_HOST=0.0.0.0` only together with `ALLOW_NON_LOOPBACK_GATEWAY=true`. This explicit override is intended for isolated container networks. Never publish port 4174 directly.

## Security notes

- The gateway binds to loopback by default.
- Use a unique random bootstrap token for each installation. Pairing never exposes it to new clients.
- HTTPS is mandatory in the Android client.
- Do not reuse a provider API key as the gateway token.
- Non-secret profile metadata is stored in Android WebView app storage. Gateway tokens are encrypted through Android Keystore and are not written to WebView storage.
- The gateway stores only SHA-256 hashes of device credentials. The first paired phone is the owner; subsequent phones are members and can be revoked independently.
- Restrict the gateway further with Tailscale or a firewall allowlist when possible.
- The gateway rate-limits repeated authentication failures. Provider secrets are never written to gateway logs.

## Owner recovery

Owners can promote another paired phone with **Edit connection → Manage paired devices → Make owner**. Keep at least two owner devices if uninterrupted recovery matters.

If every owner phone is lost, run these commands locally in the installed gateway folder:

```bash
node device-admin.mjs list
node device-admin.mjs promote DEVICE_ID
```

To revoke a lost phone locally use `node device-admin.mjs revoke DEVICE_ID`. As a last resort, `node device-admin.mjs reset --confirm` disconnects every phone; restart the gateway afterward and pair a new owner.

## Compatibility

OpenCode API changes may require client updates. The app checks the gateway version and reports compatibility warnings where possible.

## Independence notice

“OpenCode” and related names or artwork may belong to their respective owners. Their use here identifies compatibility only. See `NOTICE.md`.
