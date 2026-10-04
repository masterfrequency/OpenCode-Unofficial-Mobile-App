# OpenCode Unofficial gateway

This gateway runs beside an existing OpenCode installation. It is a separate companion service and must not replace or be copied into OpenCode itself. Keep it in a permanent writable folder such as `C:\OpenCode-Unofficial-Gateway\gateway` or `~/opencode-unofficial-gateway/gateway`. It keeps OpenCode on loopback, authenticates the Android client, and provides one-time pairing with a separate revocable credential for every phone.

Requirements: OpenCode on `PATH`, Node.js 20 or newer, and Tailscale.

## Windows

Open PowerShell in this extracted `gateway` folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Keep that window open. In another PowerShell window:

```powershell
tailscale serve --bg localhost:4174
```

Enter the printed HTTPS URL and six-digit pairing code in the Android app. The pairing code is also stored in `.pairing-code`; it works once and expires after one hour by default.

The first paired phone becomes the owner. Restart the gateway to print a fresh one-time code before pairing each additional phone. Later phones become members. The owner can open **Edit connection → Manage paired devices** to revoke any member without disconnecting the others.

After confirming that everything works, `install-windows-task.ps1` can register automatic startup at sign-in.

## Linux or VPS

```bash
chmod +x start.sh
export OPENCODE_REMOTE_TOKEN="$(openssl rand -hex 32)"
./start.sh
```

In another terminal:

```bash
tailscale serve --bg localhost:4174
```

Enter the printed HTTPS URL and six-digit pairing code in the Android app. After testing, `install-linux-service.sh` can install automatic per-user startup.

Never expose OpenCode port 4096 or gateway port 4174 directly to the public internet. See the parent project's `SECURITY.md` for the complete policy.

## Device ownership and recovery

An owner phone can promote another phone to owner or revoke it from **Edit connection → Manage paired devices**. If all owner phones are unavailable, administer the device store locally from this gateway folder:

```text
node device-admin.mjs list
node device-admin.mjs promote DEVICE_ID
node device-admin.mjs revoke DEVICE_ID
node device-admin.mjs reset --confirm
```

`reset` disconnects every phone. Restart the gateway afterward to create a new pairing code and establish a new owner.

## Containers and immutable filesystems

Set `PAIRING_CODE_FILE` and `DEVICE_STORE_FILE` to writable private paths. The device store contains credential hashes, roles, and activity timestamps—not usable plaintext credentials. The gateway refuses a non-loopback bind unless `ALLOW_NON_LOOPBACK_GATEWAY=true` is also set. Use that override only inside an isolated container network behind an authenticated HTTPS proxy. `PAIRING_TTL_MINUTES` can customize the code lifetime from 5 to 1440 minutes. `MAX_PAIRED_DEVICES` accepts 1–100 and defaults to 20.
