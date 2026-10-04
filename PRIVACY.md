# Privacy

**This app collects nothing. It has no backend. There is no analytics, no telemetry, no crash reporting, no advertising, and no third-party SDK.**

The maintainer of this project cannot see your data, because it never reaches them.

## Where your data goes

| Data | Where it lives | Where it goes |
|---|---|---|
| Projects and source files | your machine | nowhere else |
| Provider API keys | your machine, in OpenCode | never sent to the phone |
| Gateway credentials | your phone, Android Keystore | your machine's gateway, as a hash |
| Chat messages and prompts | your machine, in OpenCode | to the model provider you configured |
| Attachments you send | your machine, in OpenCode | to the model provider you configured |

Every byte of network traffic goes in one of two directions:

1. **Phone → your gateway**, over an HTTPS address you configured, typically over a private Tailscale network.
2. **Your gateway → OpenCode on the same machine**, over loopback.

There is no third hop. Nothing is proxied through the maintainer's infrastructure.

## Model providers

If you use a hosted model provider, your prompts, attached files, and images are sent to that provider, governed by **their** terms of service and privacy policy. This project is not a party to that relationship. If you want prompts to stay local, configure a local model.

## What the app stores on your phone

- Your server profiles — address, workspace directory, and a display label
- Chat drafts
- Your gateway token, in the **Android Keystore**, backed by hardware where available

Gateway tokens are stripped from local storage before profile metadata is written, so they do not sit in plain-text browser storage.

## What the gateway stores

- **Hashes** of device credentials — never plaintext tokens
- Device names, roles, and timestamps
- A short-lived pairing code

No message content, prompts, file names, or project contents are stored by the gateway.

## Uninstalling

Removing the app deletes its local storage. To also revoke its access, revoke the device on the gateway:

```bash
DEVICE_STORE_FILE=~/.opencode-gateway/.devices.json node device-admin.mjs list
DEVICE_STORE_FILE=~/.opencode-gateway/.devices.json node device-admin.mjs revoke <device-id>
```

Revoking is immediate — that device's next request is rejected with `401`.

## Permissions

The app requests exactly one Android permission:

- **`INTERNET`** — required to reach your gateway.

It also declares a `<queries>` element for speech recognition so it can detect whether a system voice app is installed. That is a visibility declaration, not a permission: the app requests **no microphone access**. Voice input is delegated entirely to the system voice application, which asks for its own permission.

## Changes to this policy

Material changes will be noted in the repository history. This policy applies to v1.0.0 and later.