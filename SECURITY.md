# Security policy

Report suspected vulnerabilities privately to the project maintainer before public disclosure. Do not include live gateway tokens, provider API keys, private URLs, prompts, or source code from private projects in a report.

Supported releases are the latest tagged release only.

## Deployment requirements

- Keep OpenCode and the gateway bound to loopback.
- Reach the gateway through trusted HTTPS, preferably Tailscale.
- Use a unique random gateway token of at least 32 characters.
- Never reuse a provider API key as the gateway token.
- Treat `.pairing-code` as sensitive, and restart the gateway if a code is exposed. Pairing codes work once, expire after one hour by default, and are rate-limited.
- Keep Android, WebView, OpenCode, Node.js, and the gateway host updated.
- If a member phone is lost, revoke it from an owner phone under **Edit connection → Manage paired devices**. Maintain a second owner phone where practical. If every owner is lost, use the local `device-admin.mjs` recovery tool; if the server is lost, rotate the bootstrap token and device store immediately.
- Device credentials are generated independently, returned only once during HTTPS pairing, encrypted with Android Keystore on the phone, and stored only as SHA-256 hashes by the gateway.
