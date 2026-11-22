# OAuth clients (public identifiers, not secrets)

Google Cloud project **boolaa**. The consent screen is "Boolaa" (External; scopes email, profile, openid).

| Client | Client ID | Notes |
|---|---|---|
| Web | `816126337836-0k4begddfi0f1usm1hg2e6va9fddni3m.apps.googleusercontent.com` | Redirect URI `https://rstugahfcpwllumgxwrm.supabase.co/auth/v1/callback`, origin `https://boolaa.ro`. Its secret is in the macOS Keychain as `google-boolaa-web-secret`. |
| iOS | `816126337836-4111v58ciqce0gavcrcvuks2tj2c6un7.apps.googleusercontent.com` | Bundle `ro.boolaa.app`. URL scheme (reversed client ID): `com.googleusercontent.apps.816126337836-4111v58ciqce0gavcrcvuks2tj2c6un7`. |
| Android | `816126337836-9rh7pa6bqa4jjpi1c5goq0jke1ag4cfp.apps.googleusercontent.com` | Package `ro.boolaa.app`, debug SHA-1 `12:A2:87:9E:69:B4:DB:F0:BE:50:96:8C:FC:EC:F6:72:2E:14:6B:AC`. Debug only. A **second Android client** is needed for release builds, with SHA-1 `59:E9:05:80:E4:E7:05:75:D7:5B:CD:20:3F:09:5A:70:19:58:AF:9F` (the self-managed key `~/.boolaa-signing/boolaa-release.jks`; there's no Play Store, the APK is distributed from boolaa.ro). |

**Supabase**: production has Google enabled, with `external_google_client_id` set to `web,ios,android` (the web ID first). Native apps call `signInWithIdToken(provider: google, idToken, nonce)`. Android's Credential Manager must request the token with the **web** client ID as `serverClientId`; iOS GoogleSignIn uses the iOS client ID.

**Apple**: team `W5WKF2N472` (personal), bundle `ro.boolaa.app`. The Services ID and key are still to be created.

**App ID**: the apps move from `com.boolaa.app` to `ro.boolaa.app` (pending rename in iOS `project.yml` and Android `applicationId`).
