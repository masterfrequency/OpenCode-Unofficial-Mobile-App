# Privacy

OpenCode Unofficial is a local remote client. It does not include advertising, analytics, crash-reporting SDKs, or an application-operated cloud service.

Connection profile metadata is stored locally on the Android device. Gateway access tokens are encrypted with Android Keystore. Provider credentials are transmitted only to the gateway URL selected by the user and are stored by the user's OpenCode installation. The application does not send those credentials to PhonkAlphabet.

During pairing, the Android manufacturer and model are sent only to the user's selected gateway so paired devices can be identified and revoked. The gateway stores that label with the device role and activity timestamps. No telemetry or third-party analytics receive this information.

Background notifications are produced on the phone itself. While a task you started is running, a foreground service keeps an authenticated connection to your own gateway so Android can alert you when it finishes or needs approval; no push provider or third-party service is involved, and the gateway token is read from Android Keystore only inside the app. Notifications show only the session title (hidden on the lock screen). The last session's title and ID are stored in app-private preferences to power the launcher shortcut and home-screen widget; remove the widget and clear app data to erase them.

The remote gateway processes prompts, model responses, project paths, session data, and permission requests solely to relay them between the Android client and the user's OpenCode server. Gateway operators are responsible for securing, updating, and controlling access to their own server.

Users should review the privacy terms of their selected model providers, VPN provider, hosting provider, and OpenCode installation.
