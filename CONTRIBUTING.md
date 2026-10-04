# Contributing

Thanks for considering a contribution. This is a small independent project — issues and PRs are read by one person, so focused changes get attention fastest.

## Before you open a pull request

1. **Search existing issues.** It may already be reported or fixed.
2. **Open an issue first for anything substantial.** A short discussion up front avoids wasted work on an approach that won't fit.
3. **Never include secrets in an issue or PR** — live gateway tokens, provider API keys, private Tailnet hostnames, personal file paths, or code from private projects. Report security problems privately instead; see [`SECURITY.md`](SECURITY.md).

## Ground rules

- **Keep the threat model intact.** If your change touches authentication, pairing, the device store, token comparison, or credential storage, say so explicitly in the PR description. Those are the parts most likely to affect other people's security.
- **The gateway must keep working when the filesystem is read-only.** Many users run it in containers with `read-only` roots and explicit writable mounts. `PAIRING_CODE_FILE` and `DEVICE_STORE_FILE` exist for exactly this reason — do not assume you can write next to `server.mjs`.
- **`DEVICE_STORE_FILE` must stay configurable and persistent.** A store that resets on restart silently revokes every paired phone.
- **Non-loopback binding must keep failing closed.** Do not relax the `ALLOW_NON_LOOPBACK_GATEWAY` guard to make local testing easier.
- **No hardcoded personal data.** No hostnames, IPs, file paths, tokens, or pairing codes in committed source. Use generic placeholders.
- **No new Android permissions** without explaining the necessity. The app currently requests `INTERNET` only.
- **No telemetry.** None, ever. See [`PRIVACY.md`](PRIVACY.md).

## Development

### App

Requires JDK 17+ and the Android SDK.

```bash
cp keystore.properties.example keystore.properties   # your own key, never commit it
./gradlew assembleDebug
```

The UI is a WebView served from `app/src/main/assets/`. There is no build step for the JS or CSS — edit them directly.

Before committing asset changes, check that nothing sensitive leaked in:

```bash
strings -a app/src/main/assets/app.js | grep -iE 'token|password|api[_-]?key'
```

### Gateway

Plain Node, no dependencies.

```bash
cd gateway
node --check server.mjs
node device-admin.mjs list
```

**`versionCode` is currently `1`.** Android will not install this build as an update over any earlier release. Bump `app/build.gradle` before publishing a follow-up.

## Reporting bugs

Open an issue with:

- App version and Android version
- Gateway version, and whether it runs in a container
- What you expected versus what happened
- Relevant log output, with tokens and hostnames redacted

## Licence

By contributing you agree that your work is licensed under the MIT licence, as in [`LICENSE`](LICENSE).