# Boolaa auth security: emails, device codes, password reset, sensitive actions, age, Apple/Google

This is the contract the web, iOS and Android teams implement. Backend sources:

| Piece | Where |
|---|---|
| Schema, RLS, RPCs | `supabase/migrations/20261122160000_device_verification.sql` |
| Moderation alerts | `supabase/migrations/20261122170000_moderation_alerts.sql`, `docs/moderation.md` |
| Auth "Send Email" hook | `supabase/functions/send-email` |
| Device and sensitive-action codes | `supabase/functions/device-code` |
| Email renderer and strings (en, ro, fr, es, it) | `supabase/functions/_shared/email/render.ts`, `.../locales/*.json` |
| Local config | `supabase/config.toml`, `supabase/.env` + `supabase/functions/.env` (gitignored; see the `.env.example` files) |
| Tests | `supabase/tests/auth_security.test.ts`, `supabase/tests/rls_regression.sql` |

## 1. Feature flags (`public.app_settings`, one row)

| Flag | Default | When ON |
|---|---|---|
| `device_verification_enforced` | `false` | An unverified session reads and writes nothing (RLS returns 0 rows, RPCs raise `session not verified`, realtime delivers nothing). `delete_my_account()` also needs a fresh `sensitive_action` code. |
| `age_confirmation_required` | `false` | Email sign-ups without `age_confirmed: true` are rejected. Accounts without `users.age_confirmed_at` (Apple/Google sign-ups, invites, accounts from before this change) can do nothing except `confirm_age()` and `delete_my_account()`. |

With both flags OFF the app behaves exactly as before. The clients ship first, and then each flag is switched on with a one-line migration (section 10).

## 2. Device verification

### Device id
Each install (iOS, Android) or browser profile (web) generates **32 random bytes** once and keeps them as the `device_id`, encoded as base64url (43 characters) or hex (64). The server accepts 16 to 512 characters and stores only `sha256(device_id)` in lowercase hex.

| Platform | Storage |
|---|---|
| iOS | Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronizable. It survives sign-out. A reinstall that wipes the keychain counts as a new device. |
| Android | `EncryptedSharedPreferences` or DataStore with a Keystore key, excluded from backup (`android:dataExtractionRules`), so a restore onto a new phone counts as a new device. |
| Web | `localStorage["boolaa_device_id"]` from `crypto.getRandomValues`. Each browser profile is one device. Clearing site data makes it a new device. |

The **label** is human-readable and contains no personal data: `"iPhone · iOS 19"`, `"Pixel 9 · Android 16"`, `"Chrome on macOS"`. It is at most 120 characters.

**Seeded test device (local only):** `seed.sql` pre-trusts the device id **`boolaa-test-device`** for alice, bob and carol. Client test suites that send this id get `{"status":"verified"}` with no email. It never exists in production.

### When a session counts as verified (`is_session_verified()`)
It is verified when the device check passes and, if `age_confirmation_required` is on, `users.age_confirmed_at` is set. The device check passes when **any** of these holds:
1. `device_verification_enforced` is off;
2. the session is in `verified_sessions` (it passed `start_device_check` on a trusted device, or entered a device code);
3. the JWT `amr` contains a method from `public.verified_amr_methods()`, meaning the sign-in itself proved the mailbox or came from Apple or Google (section 6).

`session_id` is `auth.jwt()->>'session_id'`, which is `auth.sessions.id`. It stays the same across token refreshes (tested). Rows in `verified_sessions` are deleted automatically when the session ends, through a cascade from `auth.sessions` on sign-out or expiry.

### Flow: password sign-in on a new device
```mermaid
sequenceDiagram
  participant C as Client
  participant A as Supabase Auth
  participant DB as Postgres (RPC/RLS)
  participant F as device-code function
  participant M as Mailbox
  C->>A: signInWithPassword(email, password)
  A-->>C: session (amr=password)
  C->>DB: rpc start_device_check(device_id, label)
  alt device trusted / email-proven / OAuth session
    DB-->>C: {"status":"verified"}
    C->>C: continue to the routing gate
  else unknown device
    DB-->>C: {"status":"code_required"}
    C->>F: POST {action:"send", purpose:"device", device_id, label}
    F->>DB: issue_email_challenge (HMAC of code, limits)
    F->>M: "Your Boolaa sign-in code" (localized)
    F-->>C: 200 {"status":"sent","expires_at":...}
    C->>C: code screen (6 digits)
    C->>F: POST {action:"verify", purpose:"device", device_id, code, label}
    F->>DB: attempt (atomic, max 5) then complete: trust device + verify session
    F-->>C: 200 {"status":"verified"}
    C->>C: reload data, continue
  end
```

### Flow: "Forgot password?" (code-based reset)
Screens: **Login → "Forgot password?" → Email → 6-digit code → New password → signed in.**
```mermaid
sequenceDiagram
  participant C as Client
  participant A as Supabase Auth
  participant H as send-email hook
  participant DB as Postgres
  C->>A: resetPasswordForEmail(email)
  A->>H: hook (email_action_type=recovery, token=6 digits)
  H-->>C: (email) "Your Boolaa password reset code" + secondary link
  Note over C: Code screen (resend after 60 s)
  C->>A: verifyOtp({ email, token, type: "recovery" })
  A-->>C: session (amr=otp, counts as verified)
  Note over C: New password screen
  C->>A: updateUser({ password })
  C->>DB: rpc start_device_check(device_id, label)
  DB-->>C: {"status":"verified"} (this device is now trusted)
  Note over C: Signed in, so go to the routing gate
```
- **Email screen**: always show "If an account exists, we've sent a code", whether or not the email exists. Auth answers 200 in both cases.
- **Code screen**: 6 digits, numeric keyboard, one-time-code autofill (iOS `textContentType = .oneTimeCode`, Android `autofillHints = SMS_OTP` / `AUTOFILL_HINT_ONE_TIME_CODE` doesn't apply to email, so paste-friendly input; web `autocomplete="one-time-code"`). "Resend code" is disabled for 60 s (`max_frequency`). The code is valid for 10 minutes. Errors: `otp_expired` → "That code is wrong or expired."
- **New password screen**: the minimum length is 6 (config), 8+ recommended in the UI. A fresh recovery session doesn't need a nonce.
- The link in the email (`/auth/v1/verify?...type=recovery&redirect_to=...`) is a fallback. It opens `redirect_to` with a session. Web handles it on `/auth/callback`. Apps may treat it as a deep link (`boolaa://auth/callback`), but the code is the primary path.

### Flow: change password (signed in)
```mermaid
sequenceDiagram
  participant C as Client
  participant A as Supabase Auth
  C->>A: reauthenticate()
  A-->>C: (email) "Your Boolaa confirmation code"
  C->>A: updateUser({ password, nonce: code })
  A-->>C: ok / reauthentication_not_valid
```
`secure_password_change = true`. **GoTrue only enforces the nonce for sessions older than 24 hours** (tested): a session younger than that may change the password with no nonce, or a wrong one. Clients must **always** run reauthenticate → code → `updateUser({ password, nonce })`, so the UX is the same for every session.

### Flow: delete account
```mermaid
sequenceDiagram
  participant C as Client
  participant F as device-code function
  participant DB as Postgres
  C->>C: warning + confirm ("This can't be undone.")
  C->>F: POST {action:"send", purpose:"sensitive_action", sensitive_action:"delete_account"}
  F-->>C: 200 sent (email: "confirm: delete your account")
  C->>F: POST {action:"verify", purpose:"sensitive_action", code}
  F-->>C: 200 verified
  C->>C: delete own storage objects (<uid>/...)
  C->>DB: rpc delete_my_account()  (same session, within 10 min)
  DB-->>C: ok, then sign out locally
```
The proof belongs to the **session** that requested the code, so another signed-in device can't use it, and it expires 10 minutes after verification. While `device_verification_enforced` is off, `delete_my_account()` still works without a code, so today's clients keep working. New clients should always do the code step.

### Flow: revoke a device ("Your devices")
`list_my_devices()` → the user taps revoke → `revoke_device(hash)`. The revoked device is no longer trusted, and **every other session of the user** drops out of `verified_sessions`, the caller's own session excepted. The next `start_device_check` passes again on still-trusted devices and needs a code on the revoked one. A revoked device is not signed out: it just sees no data until it verifies again.

## 3. Contracts

### RPCs (PostgREST, named parameters)

| RPC | Returns | Notes |
|---|---|---|
| `start_device_check(p_device_id text, p_label text default null)` | `{"status":"verified"\|"code_required","needs_age_confirmation":bool}` | Call after **every sign-in and every session restore** (app launch, browser reload), before loading data. It never sends email. It doesn't depend on the enforcement flag, so devices get trusted before the switch. On a trusted device, an email-proven session or an OAuth session, it trusts the device, bumps `last_seen_at` and verifies the session. Errors: `not authenticated`, `invalid device id`. |
| `list_my_devices()` | rows `device_hash, label, created_at, last_seen_at`, newest first | Mark "This device" by comparing with `sha256(device_id)`. Needs a verified session. |
| `revoke_device(p_device_hash text)` | `boolean` (found) | See the revoke flow above. Needs a verified session. |
| `is_session_verified()` | `boolean` | Optional diagnostic. |
| `confirm_age(p_terms_version text)` | `timestamptz` | Sets `age_confirmed_at` (only if null) and `terms_version` for the caller. Needs the device check, not the age check. Errors: `invalid terms version`. |
| `delete_my_account()` | void | Errors: `session not verified`, `reauthentication required`. |
| Existing RPCs (`create_bubble`, `request_to_join`, `approve_join_request`, `reject_join_request`, `remove_member`, `toggle_rsvp`, `report_content`) | unchanged | Can additionally raise `session not verified` or `age confirmation required`. |

Trusted devices are capped at **10 per user**: the least recently seen one is dropped. Expired codes are pruned (rows older than one day) on every send.

### Edge Function `device-code`
`POST {SUPABASE_URL}/functions/v1/device-code`, with headers `Authorization: Bearer <user access token>` and `apikey: <anon/publishable key>`. From supabase-js / supabase-swift / supabase-kt, use `functions.invoke("device-code", body)`.

| Body | Success |
|---|---|
| `{"action":"send","purpose":"device","device_id":"…","label":"iPhone · iOS 19"}` | `200 {"status":"sent","expires_at":"…"}` |
| `{"action":"verify","purpose":"device","device_id":"…","code":"123456","label":"…"}` | `200 {"status":"verified"}` |
| `{"action":"send","purpose":"sensitive_action","sensitive_action":"delete_account"}` | `200 {"status":"sent","expires_at":"…"}` |
| `{"action":"verify","purpose":"sensitive_action","code":"123456"}` | `200 {"status":"verified"}` |

`sensitive_action` names the action in the email: `delete_account`, or `generic` (the default). An optional `locale` is used only when `user_metadata.locale` is missing.

| HTTP | `error` | Meaning, and what the client shows |
|---|---|---|
| 400 | `invalid_request` | Bad body or a malformed code (not 6 digits). |
| 400 | `invalid_code` (+ `attempts_left`) | Wrong code: "That code isn't right. N tries left." |
| 401 | `unauthorized` | Missing or expired JWT, or the session no longer exists: refresh and retry once, then sign out. |
| 403 | `session_not_verified` | A `sensitive_action` from a session that hasn't passed the device check. |
| 404 | `no_active_code` | No pending code for this purpose (and device / session): offer "Send a new code". |
| 410 | `code_expired` | More than 10 minutes old: "Send a new code". |
| 423 | `too_many_attempts` | 5 wrong tries, so the code is locked: "Send a new code". |
| 429 | `rate_limited` | More than 5 codes in the last hour for this user (all purposes): "Too many codes. Try again later." |
| 502 | `email_failed` | The email provider failed: "Couldn't send the email. Try again." |
| 500 | `server_error` | Generic error. |

Codes: 6 digits, uniformly random, valid 10 minutes, at most 5 verify attempts each, at most 5 sends per user per rolling hour. Sending a new code supersedes the previous one. Only `HMAC-SHA256(DEVICE_CODE_SECRET, user:purpose:device:code)` is stored, and it is compared in constant time.

### Why this split
The RPC decides and the function sends. `start_device_check` is a fast SQL call that every launch makes, and it never touches email. Generating, hashing and emailing a code needs a secret and an HTTP client, so it lives in the Edge Function. The function authenticates the user through Auth (`auth.getUser(jwt)`), takes `session_id` from that JWT, and calls three **service-role-only** SQL helpers (`issue_email_challenge`, `attempt_email_challenge`, `complete_email_challenge`). These hold the attempt counter and the send limit inside a row lock or advisory lock, so parallel requests can't exceed 5 attempts or 5 sends. Clients have no privileges on the tables or the helpers.

### Backend error texts to translate (add to the glossary mapping)
`session not verified`, `age confirmation required`, `reauthentication required`, `invalid device id`, `invalid terms version`, plus the function `error` codes above. Auth errors: `over_email_send_rate_limit` (429), `otp_expired`, `reauthentication_needed`, `reauthentication_not_valid`, and sign-up `age confirmation required` (HTTP 400; supabase-js `error.message`).

## 4. `amr` findings (measured, local GoTrue v2.186 and v2.198)

| Flow | `amr[].method` | Counts as verified |
|---|---|---|
| `signInWithPassword` | `password` | no (device check needed) |
| `refreshSession` | unchanged (keeps the original method and the same `session_id`) | as before |
| Signup confirmation via `verifyOtp({type:'signup'})` **or** the email link | `otp` | yes |
| Magic link / email OTP (`verifyOtp({type:'email'})`, `{type:'magiclink'}` token_hash, or the link) | `otp` | yes |
| Recovery (`verifyOtp({type:'recovery'})` or the link) | `otp` | yes |
| Invite (code or link) | `otp` | yes |
| Email change confirmation | `otp` | yes |
| Sign in with Apple / Google (`signInWithIdToken` or the OAuth redirect) | expected `oauth` (GoTrue `models.OAuth`). **Not measurable locally without provider credentials**: confirm on staging with the first real login (`select auth.jwt()->'amr'`) | yes |

GoTrue emits a single `otp` method for every email flow. The older names `magiclink`, `recovery`, `invite`, `email/signup` and `email_change` are also accepted, along with `id_token`. They all live in **one constant**, `public.verified_amr_methods()`. If staging shows a different value for Apple or Google, change only that function, in a new migration. Caveat: `otp` would also cover phone OTP if SMS sign-in were ever enabled.

## 5. Emails (Send Email hook)

GoTrue calls `send-email` for every auth email. The function verifies the `standardwebhooks` signature (`SEND_EMAIL_HOOK_SECRET`), renders, and sends through **Resend** (`noreply@boolaa.ro`, sender name "Boolaa", `RESEND_API_KEY`). When that key is unset, it sends to the local **Mailpit** over SMTP (`supabase_inbucket_boolaa:1025` inside the Docker network). `device-code` and `report-alert` use the same renderer.

| `email_action_type` | Template | Content |
|---|---|---|
| `signup` | signup | Code + "Confirm email" link |
| `recovery` | recovery | **Code shown big**, link as a secondary option |
| `magiclink` / `email` | magiclink | Code + link |
| `invite` | invite | "Accept invite" button |
| `email_change` | email_change_current + email_change_new | One email to each address, both naming old and new |
| `reauthentication` | reauthentication | Code |
| (device-code) | device / sensitive_action | Code, device label or action |
| other / notifications | generic, password_changed | Text only |

- **Language** comes from `user.user_metadata.locale` (`en`, `ro`, `fr`, `es`, `it`), with `en` as the fallback. Clients **must** send `locale` at sign-up and call `updateUser({ data: { locale } })` whenever the user changes language, and once after the first OAuth sign-in.
- **Look**: "Soft pop", table-based and inline-styled, with the CSS orb logo (no images), the grape code box and a pill button. Dark mode uses `prefers-color-scheme` and Outlook's `[data-ogsc]`. The footer links to https://boolaa.ro/privacy.
- **Links** use `AUTH_PUBLIC_URL/auth/v1/verify?token=<hash>&type=<type>&redirect_to=<redirect_to>`. PKCE `pkce_` token hashes work the same way.
- **Email change**: measured on v2.186, `token` verifies with the current address and `token_new` with the new one. **A single verified code completes the change**, even with `secure_email_change` (double confirm) on. Clients should therefore ask for a `sensitive_action` code before calling `updateUser({ email })`. That is a UX gate only (see Risks).

## 6. Age confirmation (16+)

- Column `public.users.age_confirmed_at timestamptz` and `terms_version text`. Users can read their own; clients can't write them (column grants: clients may update only `name` and `avatar`).
- **Email sign-up**: the clients send exactly
  ```js
  supabase.auth.signUp({ email, password, options: { data: {
    name: "Ana", locale: "ro", age_confirmed: true, terms_version: "2026-11-22" } } })
  ```
  (Swift: `data: ["name": .string(n), "locale": .string(l), "age_confirmed": .bool(true), "terms_version": .string("2026-11-22")]`; Kotlin: `data = buildJsonObject { put("name", n); put("locale", l); put("age_confirmed", true); put("terms_version", "2026-11-22") }`).
  The sign-up trigger stores `age_confirmed_at = now()` and the terms version. Existing users are not backfilled.
- **Rejection**: done by the **before-user-created auth hook** (`public.hook_before_user_created`). With the flag on, a sign-up without `age_confirmed: true` gets **HTTP 400 `age confirmation required`**. A raise in the `auth.users` trigger would surface as an opaque 500 "Database error saving new user", which is why it's a hook. The payload does not tell admin-created users apart, and `signInWithOtp` sign-ups skip the hook (measured), so the hook is the friendly first line only. **The real gate is RLS**: no `age_confirmed_at` means nothing but `confirm_age` and `delete_my_account`. Admin tooling that creates users passes `user_metadata.age_confirmation_deferred = true`.
- **Accounts without it** (Apple/Google, invites, older accounts once the flag is on): `start_device_check` returns `needs_age_confirmation: true`. The client then shows the one-time **"I'm 16 or older" + "I accept the Terms"** screen, calls `confirm_age("2026-11-22")` and reloads. A "Delete account" link stays available on that screen.

## 7. Sign in with Apple and Google

**Server state**: `config.toml` has `[auth.external.apple]` and `[auth.external.google]` with `enabled = false`, secrets from `env(...)`, and `skip_nonce_check = false`. The redirect allow-list includes `https://boolaa.ro/auth/callback`, `http://127.0.0.1:3100/auth/callback`, `http://localhost:3100/auth/callback` and `boolaa://auth/callback`. To try OAuth locally, put the values in `supabase/.env` (see `supabase/.env.example`), set `enabled = true` and restart. The provider callback URL locally is `http://127.0.0.1:55321/auth/v1/callback`.

**Device verification**: an OAuth or id_token session counts as verified (`oauth` in `verified_amr_methods()`). There is no email code, and `start_device_check` trusts the device straight away.

**Names**: `handle_new_auth_user` takes `name`, then `full_name` (Google sends both), then the email's local part. Apple sends the name **only on the first authorization**, and never inside the id_token. On first sign-in the iOS client reads `ASAuthorizationAppleIDCredential.fullName` and then calls `updateUser({ data: { name, full_name: name, locale } })` **and** `update users set name = … where id = me`. Apple private-relay emails (`…@privaterelay.appleid.com`) are fine. Note that relay addresses only receive our mail once `noreply@boolaa.ro` is registered in Apple's "Sign in with Apple for Email Communication" (see below).

**Identity linking** (GoTrue automatic linking, as documented by Supabase; not measurable locally without a provider): when an OAuth sign-in returns a **verified** email that equals an existing user's email, GoTrue adds the identity to that user rather than creating a new one, so an email/password user who taps "Sign in with Google" lands in the same account. Google always sends `email_verified=true`. Apple sends it for real addresses, but private-relay addresses never match an existing account, so they create a new user. If the existing account's email is **unconfirmed**, GoTrue does not link it (protection against pre-registration takeover). Confirm the behaviour on staging with a test account.

### What the user must create, and where each value goes

| Item | Create in | Value goes to |
|---|---|---|
| **Google**: OAuth consent screen + Web, iOS and Android client IDs | Already done; IDs in **`docs/oauth-clients.md`** (not duplicated here) | Supabase → Auth → Providers → Google: *Client IDs* = `web,ios,android` (web first), *Client secret* = the web secret (Keychain `google-boolaa-web-secret`). Management API: `external_google_enabled`, `external_google_client_id`, `external_google_secret`. |
| Google: Android **release** SHA-1 | Play Console → App signing → SHA-1 | Google Cloud → Android client `ro.boolaa.app` (add next to the debug SHA-1). |
| Google iOS client | (exists) | iOS `Info.plist`: `GIDClientID` = iOS client ID, URL scheme = reversed client ID, `GIDServerClientID` = **web** client ID. |
| Google Android | (exists) | Credential Manager `GetGoogleIdOption.setServerClientId(<web client ID>)`. |
| Google web | (exists) | Nothing client-side beyond `signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://boolaa.ro/auth/callback' } })`. |
| **Apple**: App ID `ro.boolaa.app` with the *Sign in with Apple* capability | Apple Developer → Identifiers (team **W5WKF2N472**) | iOS entitlement `com.apple.developer.applesignin = [Default]` (`project.yml`, after the bundle id moves to `ro.boolaa.app`). |
| Apple: **Services ID** (e.g. `ro.boolaa.web`), *Sign in with Apple* configured with domain `boolaa.ro` (and the project's `<ref>.supabase.co`) and return URL `https://<ref>.supabase.co/auth/v1/callback` | Apple Developer → Identifiers → Services IDs | Supabase → Providers → Apple: *Client IDs* = `ro.boolaa.web,ro.boolaa.app` (Services ID for web, bundle id for native id_tokens). |
| Apple: **Sign in with Apple key** (`.p8`) + its **Key ID** | Apple Developer → Keys | Generate the **client secret JWT** (ES256, `iss` = Team ID `W5WKF2N472`, `sub` = Services ID, `kid` = Key ID, max 6 months) → Supabase → Providers → Apple → *Secret Key*. **Rotate before it expires (every ≤ 6 months)**; only the web redirect flow needs it. Keep the `.p8` in a password manager, never in git. |
| Apple: email relay | Apple Developer → Services → Sign in with Apple for Email Communication | Register `boolaa.ro` / `noreply@boolaa.ro` (SPF via Resend) so relay users receive codes. |
| Android Apple sign-in | none | Android uses the web OAuth redirect (`signInWithOAuth(apple)` in a Custom Tab, deep link `boolaa://auth/callback`). |

### Client flows
- **iOS, Apple**: generate a raw nonce, then `ASAuthorizationAppleIDProvider` request with `nonce = sha256(raw)` and scopes `.fullName, .email`. Then `signInWithIdToken(.init(provider: .apple, idToken: credential.identityToken, nonce: raw))`. Save the name (above), then `start_device_check` (→ verified), then show the age screen if `needs_age_confirmation`.
- **iOS, Google**: GoogleSignIn (v8+), `signIn(withPresenting:hint:additionalScopes:nonce: sha256(raw))`, then `signInWithIdToken(.google, idToken, accessToken, nonce: raw)`.
- **Android, Google**: Credential Manager `GetGoogleIdOption` (`serverClientId` = web ID, `nonce` = sha256(raw)), then `auth.signInWith(IDToken) { provider = Google; idToken; nonce = raw }`.
- **Android, Apple**: `auth.signInWith(Apple)` (OAuth in a Custom Tab, PKCE, deep link `boolaa://auth/callback`).
- **Web, both**: `signInWithOAuth({ provider, options: { redirectTo: origin + '/auth/callback' } })`, and `/auth/callback` runs `exchangeCodeForSession(code)`.
- After any OAuth sign-in: `updateUser({ data: { locale } })` if missing → `start_device_check` → age screen if needed → routing gate.

## 8. What each client must implement

Common to web, iOS and Android:
1. **Device id + label** (section 2), created once and kept across sign-outs.
2. **Device gate**: after every sign-in and session restore, call `start_device_check`. On `code_required`, show the **"Check your email"** screen. Send the code automatically once on entry, but not again if one was sent less than 60 s ago. Then take the 6-digit input, a "Resend code" button with a 60 s cooldown, and "Use another account" (sign out). Verify with `device-code`, map the errors in section 3, and on success reload all data and resubscribe to realtime. Until then, show nothing from the bubble screens.
3. **Age screen** when `needs_age_confirmation` is true: `confirm_age(TERMS_VERSION)`.
4. **Sign-up** metadata: `{ name, locale, age_confirmed: true, terms_version }`. On a language change: `updateUser({ data: { locale } })`.
5. **Forgot password** (section 2): Login "Forgot password?" → email → code → new password → signed in.
6. **Change password** in the profile: `reauthenticate()` → code → `updateUser({ password, nonce })`.
7. **Change email** (if offered): `sensitive_action` code first, then `updateUser({ email })`. Tell the user both addresses get an email.
8. **Delete account**: `sensitive_action` code (`sensitive_action: "delete_account"`) → delete storage objects → `delete_my_account()` within 10 minutes in the same session → sign out locally.
9. **Your devices** in the profile: `list_my_devices()`, "This device" marked by comparing hashes, last seen as a relative time, and a revoke button with a confirmation that hides revoke on the current device.
10. **Error mapping**: the new texts and codes in section 3, in all 5 languages, following the glossary.
11. **RPC failure `session not verified` at any time** (for example after another device revoked this one): run the device gate again.
12. **Apple/Google** buttons per section 7 (Apple is required on iOS once Google is offered).

Platform notes:
- **Web**: keep the device id in `localStorage`. The device gate runs client-side in the layout, after the Supabase session loads. `src/proxy.ts` can't check it because the device id is client-only. Add the `/auth/callback` route for OAuth and email links.
- **iOS**: Keychain (`ThisDeviceOnly`). Run the gate in `SessionStore` before loading bubbles. Use `.oneTimeCode` for the code field.
- **Android**: encrypted prefs, excluded from backup. Run the gate in `SessionStore` before loading bubbles.
- **Tests**: use device id `boolaa-test-device` with the seeded users. For throwaway users, either keep enforcement off (the local default) or read the code from Mailpit (`GET http://127.0.0.1:55324/api/v1/search?query=to:"<email>"`).

## 9. Local development
- `supabase start` serves the three functions through its edge runtime and reads `supabase/functions/.env`. `config.toml` reads **`supabase/.env`**, so `SEND_EMAIL_HOOK_SECRET` lives in both files with the same value (CLI limitation). Copy both `.env.example` files. After editing `_shared/` code, run `docker restart supabase_edge_runtime_boolaa`, because hot reload misses shared files.
- Mail lands in Mailpit at http://127.0.0.1:55324.
- Run the tests:
  ```sh
  supabase db reset
  (cd supabase/tests && deno test -A auth_security.test.ts)
  psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -f supabase/tests/rls_regression.sql
  ```
- Local `enable_confirmations` stays **off**, because the client suites expect a session right after `signUp`. The suite tests the confirmation email through `resend({ type: 'signup' })`. Production has it on.
- **GoTrue version pin**: `supabase link` wrote `supabase/.temp/gotrue-version = v2.198.0`. With CLI 2.75 that image rejects the HS256 service-role key (admin API: `signing method HS256 is invalid`). The file was renamed to `gotrue-version.disabled-v2.198`, so local runs use the CLI default, v2.186. Upgrading the CLI to v3 (it's in TODO) should remove the need for this. The `amr` results were identical on both versions.

## 10. Production rollout checklist

1. **Resend**: verify the `boolaa.ro` domain (SPF, DKIM, DMARC) and create an API key with send-only access.
2. **Migrations**: `supabase db push` (`20261122160000_device_verification`, `20261122170000_moderation_alerts`). Both flags start **off**. Check that `pg_net` is enabled.
3. **Function secrets**: `supabase secrets set --project-ref <ref>` with
   `RESEND_API_KEY`, `DEVICE_CODE_SECRET` (`openssl rand -hex 32`), `SEND_EMAIL_HOOK_SECRET` (step 5), `REPORT_ALERT_SECRET` (`openssl rand -hex 32`), `AUTH_PUBLIC_URL=https://<ref>.supabase.co`, `AUTH_OTP_EXPIRY_MINUTES=10` and `MODERATION_EMAIL=moderation@boolaa.ro`. Never set `SMTP_HOST` in production.
4. **Deploy**: `supabase functions deploy send-email device-code report-alert --project-ref <ref>`. `verify_jwt = false` comes from `config.toml`. The functions authenticate themselves.
5. **Send Email hook**: Dashboard → Authentication → Hooks → *Send Email* → HTTPS → `https://<ref>.supabase.co/functions/v1/send-email` → *Generate secret*. Copy it to `SEND_EMAIL_HOOK_SECRET` (step 3), redeploy or wait for the secret to apply, **then** enable. Alternatively, Management API `PATCH /v1/projects/{ref}/config/auth` with `hook_send_email_enabled`, `hook_send_email_uri` and `hook_send_email_secrets`. Check: request a password reset for a test account.
6. **Before-user-created hook**: Hooks → *Before User Created* → Postgres → `public.hook_before_user_created` (or `hook_before_user_created_enabled` / `hook_before_user_created_uri = pg-functions://postgres/public/hook_before_user_created`). It is harmless while `age_confirmation_required` is off.
7. **Auth settings** (dashboard or Management API):
   - Email OTP expiry 600 s (`mailer_otp_exp`).
   - OTP length 6.
   - *Secure password change* on (`security_update_password_require_reauthentication`).
   - *Secure email change* on.
   - Minimum interval per user 60 s (`smtp_max_frequency`).
   - Confirm email on.
   - Rate limit for emails sent: 100/h to start (`rate_limit_email_sent`). Watch it, and raise it with growth.
   - Token verifications 30 / 5 min per IP. Sign-ups and sign-ins 30 / 5 min per IP.
   - Redirect URLs: add `https://boolaa.ro/auth/callback` and `boolaa://auth/callback`.
   - CAPTCHA (Turnstile) on sign-up, from TODO.
8. **Moderation**: the Vault secrets and the Cloudflare Email Routing rule (`docs/moderation.md`).
9. **Apple/Google**: section 7, once the credentials exist. Then measure the OAuth `amr` with one real login.
10. **Ship the clients** with sections 7 and 8. Watch adoption: `select count(*) from trusted_devices` grows, and old app versions fade.
11. **Switch on** (new migration, one line each, when old clients are gone):
    ```sql
    update public.app_settings set device_verification_enforced = true, updated_at = now();
    update public.app_settings set age_confirmation_required = true, updated_at = now();
    ```
    Every existing session becomes unverified until the next `start_device_check`. Devices trusted while the flag was off pass silently, and others get one code. The rollback is the same line with `false`.

## 11. Risks and limits
- **Password change without a nonce for sessions younger than 24 h** (GoTrue behaviour). A stolen fresh session can change the password. It is mitigated by the device gate, since a stolen token from another device is still bound to its session, which must already be verified.
- **Email change completes with one code** (measured on v2.186), despite double confirm. The `sensitive_action` code before `updateUser({ email })` is enforced in the UI only. A server-side gate would need an `auth.users` trigger; ask before adding one.
- **OAuth `amr` value not measured locally**: it is a single constant to adjust after the first staging login.
- **Revocation doesn't sign out** the revoked device. It loses access to data until it verifies again. Sign-out everywhere is `auth.signOut({ scope: 'global' })`.
- **`signInWithOtp` creates users** (`shouldCreateUser` defaults to true) without running the before-user-created hook. The RLS age gate still applies. Clients should pass `shouldCreateUser: false` for email-code sign-in.
- **Send limits**: 5 codes per user per hour are shared by the device and sensitive-action purposes. GoTrue's own per-user 60 s interval applies only to auth emails.
- **Storage**: a restrictive policy also gates uploads, updates and deletes on `storage.objects`. Public image URLs stay readable without a session, as before.
