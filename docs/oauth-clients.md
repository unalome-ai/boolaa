# OAuth clients (public identifiers, not secrets)

Google Cloud project **boolaa**. The consent screen is "Boolaa" (External; scopes email, profile, openid).

| Client | Client ID | Notes |
|---|---|---|
| Web | `816126337836-0k4begddfi0f1usm1hg2e6va9fddni3m.apps.googleusercontent.com` | Redirect URI `https://rstugahfcpwllumgxwrm.supabase.co/auth/v1/callback`, origin `https://boolaa.ro`. Its secret is in the macOS Keychain as `google-boolaa-web-secret`. |
| iOS | `816126337836-4111v58ciqce0gavcrcvuks2tj2c6un7.apps.googleusercontent.com` | Bundle `ro.boolaa.app`. URL scheme (reversed client ID): `com.googleusercontent.apps.816126337836-4111v58ciqce0gavcrcvuks2tj2c6un7`. |
| Android | `816126337836-9rh7pa6bqa4jjpi1c5goq0jke1ag4cfp.apps.googleusercontent.com` | Package `ro.boolaa.app`, debug SHA-1 `12:A2:87:9E:69:B4:DB:F0:BE:50:96:8C:FC:EC:F6:72:2E:14:6B:AC`. Debug builds (this Mac's debug key). |
| Android (release) | `816126337836-evtclje9amstba7rdvdmuh6gq8sbr74r.apps.googleusercontent.com` | Package `ro.boolaa.app`, release SHA-1 `59:E9:05:80:E4:E7:05:75:D7:5B:CD:20:3F:09:5A:70:19:58:AF:9F` (key `~/.boolaa-signing/boolaa-release.jks`; the APK is distributed from boolaa.ro, not Play). |

**Supabase**: production has Google enabled, with `external_google_client_id` set to `web,ios,android-debug,android-release` (the web ID first). Native apps call `signInWithIdToken(provider: google, idToken, nonce)`. Android's Credential Manager must request the token with the **web** client ID as `serverClientId`; iOS GoogleSignIn uses the iOS client ID.

**Apple** (team `W5WKF2N472`, personal):
- App ID `ro.boolaa.app` has Sign In with Apple, Push Notifications and Associated Domains. Native iOS uses `signInWithIdToken(provider: apple)`; the audience is the bundle ID.
- Services ID `ro.boolaa.web` covers web and Android (OAuth redirect). Domains: `rstugahfcpwllumgxwrm.supabase.co`, `boolaa.ro`. Return URL: `https://rstugahfcpwllumgxwrm.supabase.co/auth/v1/callback`.
- Key ID `HTL62BCS2D`, file `~/.boolaa-signing/AuthKey_HTL62BCS2D.p8` (backed up; never commit it).
- Supabase: `external_apple_client_id = ro.boolaa.web,ro.boolaa.app`. The client secret is an ES256 JWT valid for at most 6 months. **Renew it with `node scripts/apple-client-secret.mjs` before it expires** (current: 2027-05-21).
- Private relay emails: register `boolaa.ro` and `noreply@boolaa.ro` under "Sign in with Apple for Email Communication".

**App ID**: the apps move from `com.boolaa.app` to `ro.boolaa.app` (pending rename in iOS `project.yml` and Android `applicationId`).
