# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities **privately** to the maintainer. Do **not** open a public issue.

Use [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories) on this repository, or contact the maintainer directly.

Please do not include live gateway tokens, provider API keys, private URLs or Tailnet hostnames, personal file paths, prompts, or source code from private projects in a report.

You can expect an acknowledgement within a few days. Please give reasonable time for a fix before public disclosure.

## What to report

Genuinely report anything that could let a third party:

- Authenticate to a gateway without a valid credential
- Read or guess another device's credential
- Escalate from `member` to `owner`
- Bypass pairing, or use a code more than once
- Bypass the rate limit to brute-force a token
- Inject script into the app's WebView via model output or a shared file
- Escape the app sandbox, or reach files outside the intended scope
- Persist a paired device across a restart when the operator did not expect it
- Trigger remote code execution on the gateway machine

Not vulnerabilities:

- Weaknesses in OpenCode itself — report those upstream
- A user who deliberately published their gateway to the public internet
- Weakness in a model provider, or in Tailscale
- Missing hardening the documentation already tells you to apply

## Threat model

This project assumes:

- **The machine running OpenCode and the gateway is trusted.** The agent can read your files and run commands there by design.
- **The network is private**, typically a Tailscale tailnet.
- **The phone is trusted**, in the sense that its Keystore is intact.

The app and gateway protect the phone-to-gateway link, the pairing exchange, and the device credential lifecycle. They do **not** defend a compromised host, a compromised phone, or an operator who publishes the gateway to the internet.

## Deployment requirements

- Keep the gateway bound to loopback (`GATEWAY_HOST=127.0.0.1`).
- Reach it over trusted HTTPS, preferably Tailscale.
- **Never publish the gateway port directly to the internet.** The gateway can reach OpenCode's local API, which can read and write files. There is no authentication in front of OpenCode itself inside a typical deployment.
- Use a unique random `OPENCODE_REMOTE_TOKEN` of at least 32 characters.
- **Never reuse a provider API key as the gateway token.** The token bypasses device revocation.
- Treat `OPENCODE_REMOTE_TOKEN` as a root credential. It is the recovery path when all owner devices are lost, and it bypasses owner-only checks on device administration.
- Use a strong, unique `DEVICE_STORE_FILE` path that only the gateway user can read.

## Credential handling

- Pairing codes are single-use and expire (`PAIRING_TTL_MINUTES`, default 60, range 5–1440).
- The device store keeps **hashes only**. Tokens are compared in constant time.
- The app stores tokens in Android Keystore and strips them from local storage before persisting profile metadata.
- Revoking a device invalidates its token immediately.

## Known limitations

Reported honestly so they are not mistaken for safety guarantees:

- **Shared-token bypass.** Any device still using the bootstrap `OPENCODE_REMOTE_TOKEN` keeps working and counts as owner. Revocation is only meaningful for devices that paired with per-device tokens.
- **Read-only filesystem deployments.** `DEVICE_STORE_FILE` must point at writable, persistent storage. If it is left on tmpfs, every restart revokes every paired phone.
- **`/health` executes binaries.** The gateway runs `opencode --version` and `tailscale --version` via `PATH` lookup at startup to populate version fields. This is not remotely exploitable — it requires write access to a `PATH` directory — but it is a code-execution path worth knowing about.
- **Shared files are passed to the model.** Files sent through the Android share sheet, including PDFs, are handed to whatever provider OpenCode is configured to use.

## Supported versions

The latest tagged release only.

## Licence

Security-relevant contributions are accepted under the MIT licence in [`LICENSE`](LICENSE).