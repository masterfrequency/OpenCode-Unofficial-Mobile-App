# Legal Notice, Trademarks, and Independence Statement

**Read this before using, redistributing, or building on this project.**

---

## 1. Independence

OpenCode Unofficial is an independent, unofficial, community-driven project created by **PhonkAlphabet**.

It is **not** affiliated with, associated with, endorsed by, sponsored by, approved by, supervised by, or maintained by the OpenCode project, the SST team, or any of their maintainers, employees, or representatives.

No permission has been granted by the OpenCode project for the use of its name, marks, or artwork in this project. If you represent the OpenCode project and believe something here requires correction, please open an issue and it will be addressed promptly.

---

## 2. Trademarks

"OpenCode" and any associated names, logos, wordmarks, and artwork are trademarks or other intellectual property of their respective owners. **This project claims no ownership of them.**

Their appearance in this repository, in the application, or in documentation is nominative use — it identifies compatibility with, and interoperability between, this client and the OpenCode software. It implies no sponsorship, endorsement, or official relationship.

The word "Unofficial" in the project name is deliberate and load-bearing. It exists specifically to prevent confusion about affiliation. It must not be removed from the name, the README, release titles, or store listings.

The Obsidian Aurora visual theme, the bundled audio, and all original artwork in this repository are the author's own work and are covered by this project's MIT licence.

---

## 3. Licences

| Component | Licence |
|---|---|
| This project's original code | MIT — see [`LICENSE`](LICENSE) |
| OpenCode (the server this client drives) | MIT, © its respective authors |
| Inter font | SIL Open Font License 1.1 |
| JetBrains Mono font | SIL Open Font License 1.1 |

The upstream OpenCode project is MIT-licensed. **No upstream OpenCode source code is bundled in this repository.** This repository contains an independent Android client plus a companion gateway that speaks OpenCode's local API over HTTP. If upstream code is incorporated in a future release, its applicable copyright and permission notices must be preserved.

Full font licence texts are in `app/src/main/assets/fonts/`.

---

## 4. Distribution of prebuilt binaries

This repository publishes prebuilt `.apk`, `.aab`, `.exe`, and `.deb` artifacts for convenience.

- The **APK is signed with a release key that is not published here.** Users cannot verify it against a public key other than by fingerprint comparison.
- The **Windows installer is not code-signed.** SmartScreen and antivirus products may warn about it. This is expected for an unsigned community build.
- Binary distributions are provided **as-is, without warranty**, under the MIT licence.
- Contributors who rebuild from source are responsible for their own signing.

Check the published SHA-256 checksums in the README before installing. GitHub's release attestation, where present, is the more reliable integrity signal.

---

## 5. Security and liability

This software is provided **"as is", without warranty of any kind**, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.

The authors are **not liable** for any damage arising from use of this software, including loss of data, loss of access, unintended disclosure of credentials, or any costs incurred from software malfunction.

**Keep the gateway private.** It is designed to be reached over a private network such as Tailscale. Exposing it directly to the public internet is outside the supported threat model and may grant unauthenticated access to your machine's filesystem and coding agent. Do not do it.

---

## 6. Data collection

**This app collects nothing and transmits nothing to its author.**

There is no analytics, no telemetry, no crash reporting, no advertising, and no third-party SDK. There is no backend operated by the author. All network traffic goes directly from your device to the gateway **you** configured on **your** machine, and from that gateway to whichever model provider **you** configured in OpenCode.

If OpenCode is configured with a provider that itself collects data, that is a relationship between you and that provider, governed by their terms and privacy policy — not by this project.

Provider API keys are stored on your OpenCode machine. They are never sent to the phone and never transit the gateway.

See [`PRIVACY.md`](PRIVACY.md) for the full privacy statement.

---

## 7. Community conduct

Issues and pull requests are contributions. Maintainers may close, lock, or restrict any part of this repository at their discretion to protect contributors from harassment or abuse.

By participating you agree to conduct yourself civilly. Do not impersonate others, do not direct abuse at maintainers, and do not use the project to distribute malware.

---

*This notice is informational and is not legal advice. Consult a qualified professional for advice specific to your situation.*

© 2026 PhonkAlphabet. Released under the MIT licence.