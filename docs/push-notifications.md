# Push notifications

Backend: migration `supabase/migrations/20261122200000_push_notifications.sql` and the Edge Function `supabase/functions/push-dispatch/`. Providers: **APNs** (iOS), **FCM HTTP v1** (Android, including the sideloaded APK), **Web Push with VAPID** (web). Text is localized in en, ro, fr, es and it.

## 1. Architecture

```mermaid
flowchart LR
  subgraph Clients
    C1[iOS / Android / Web]
  end
  subgraph Postgres
    T[(chat_messages, join_requests,<br/>bubble_members, events,<br/>food_posts, market_items)]
    F{{push_should_notify<br/>author, prefs, mutes,<br/>blocks, suspended}}
    O[(notification_outbox)]
    CR[[pg_cron<br/>reminders every 5 min<br/>due rows every 30 s<br/>prune daily]]
    N[[pg_net]]
  end
  D[push-dispatch<br/>Edge Function]
  A[APNs HTTP/2]
  G[FCM v1]
  W[Web Push service]
  C1 -- insert / RPC --> T
  T -- AFTER INSERT/UPDATE trigger --> F --> O
  CR --> O
  O -- kick, after commit --> N -- POST + x-push-dispatch-secret --> D
  D -- claim_push_batch<br/>FOR UPDATE SKIP LOCKED --> O
  D --> A & G & W
  D -- complete_push_batch<br/>sent / retry / failed,<br/>delete invalid tokens --> O
```

```mermaid
sequenceDiagram
  participant C as Client (Bob)
  participant DB as Postgres
  participant N as pg_net
  participant F as push-dispatch
  participant P as APNs / FCM / Web Push
  C->>DB: insert chat_messages
  DB->>DB: trigger: one outbox row per recipient (filtered, coalesced)
  DB-->>C: insert OK (never waits, never fails because of push)
  DB-->>N: queue POST (once per transaction)
  N->>F: POST /functions/v1/push-dispatch
  F->>DB: claim_push_batch(100): lease 2 min, attempts+1, re-check filters, read text
  F->>F: render per token locale; sign (ES256 / RS256 / VAPID); encrypt (aes128gcm)
  F->>P: send to every device of the recipient
  P-->>F: 200 / 410 / 503 ...
  F->>DB: complete_push_batch(results, invalid token ids)
```

- **Fire-and-forget**: every trigger body runs inside an exception handler. A missing Vault secret, a broken function or a bug in the push code only raises a warning; the user's write always succeeds (tested in `push_rls.sql` case 10).
- **The outbox holds references, not text** (`payload` = `{message_id, count}` and similar). The dispatcher reads the text when it sends, and re-checks the recipient filter, so content deleted by its author or a moderator in the meantime is never pushed (`status = 'skipped'`, `last_error = 'content_gone'`).
- The dispatcher loops `claim → send → complete` for up to 25 s per call. Rows it couldn't finish come back after their 2-minute lease. pg_cron wakes it every 30 s when rows are due (deferred chat pushes, retries), and pg_net wakes it right after every write that queued something.

## 2. Data model

| Table | What | Client access |
|---|---|---|
| `push_tokens` | `id, user_id, platform (ios/android/web), token, endpoint, p256dh, auth, apns_env (ios: sandbox/production), device_hash, session_id, locale, app_version, created_at, last_seen_at`, `unique (platform, token)` | select/delete own rows; writes only through the RPCs below |
| `notification_prefs` | one row per user: `enabled` (master), `chat`, `join_requests`, `approvals`, `new_events`, `event_reminders`, `food`, `market`, `preview_content`, `updated_at` | select/insert/update own row (a row is created for every user) |
| `bubble_mutes` | `(user_id, bubble_id, until)`, `until` null = until unmuted | select/insert/update/delete own rows; insert only for bubbles you're in |
| `notification_outbox` | `id, recipient_id, type, bubble_id, actor_id, target_id, payload, collapse_key, dedupe_key, status (pending/sent/failed/skipped), created_at, next_attempt_at, claimed_at, claimed_until, sent_at, attempts, last_error, token_ids` | none (service role) |
| `push_debug_log` | what `PUSH_DRY_RUN=1` would have sent | none (service role) |

Every new table also has the **restrictive `require_verified_session` policy**, like every other client table, so an unverified device or a suspended account reads and writes none of it.

**Defaults**: everything on except `food` and `market`; `preview_content` on.

**A token disappears when**:
- the session that registered it ends (sign-out deletes `auth.sessions`, cascading to `push_tokens.session_id`);
- its trusted device is revoked (`revoke_device`, composite FK to `trusted_devices`);
- the account is deleted (cascade from `users`);
- a provider says it's gone (APNs 410 / 400 `BadDeviceToken` / `DeviceTokenNotForTopic`, FCM `UNREGISTERED` / 404 / `SENDER_ID_MISMATCH`, Web Push 404 / 410);
- the same device registers a rotated token (same `device_hash` and platform), or the user has more than 20 devices (least recently seen first);
- the client calls `unregister_push_token`.

### RPCs (authenticated)

```
register_push_token(p_platform, p_token, p_endpoint, p_p256dh, p_auth, p_apns_env, p_device_id, p_locale, p_app_version) -> uuid
unregister_push_token(p_token) -> boolean
```

- `register_push_token` upserts on `(platform, token)` and refreshes `last_seen_at`. A token that belonged to another user (shared device, account switch) **moves to the caller**. It needs a verified session (`session not verified`, `account suspended`, `age confirmation required` as for every RPC).
  - **iOS**: `p_token` = the APNs device token as hex; `p_apns_env` is required: `sandbox` for Debug/development-signed builds, `production` for TestFlight/App Store/Ad Hoc.
  - **Android**: `p_token` = the FCM registration token.
  - **Web**: `p_endpoint`, `p_p256dh` and `p_auth` from `PushSubscription.toJSON()`; `p_token` may be null. The endpoint must be a real push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`), so the dispatcher can't be pointed at arbitrary URLs.
  - `p_device_id`: the same device id sent to `start_device_check`. It links the token to the trusted device (revoking the device stops its pushes; a rotated token replaces the old one).
  - `p_locale`: the app's current language (`en`/`ro`/`fr`/`es`/`it`). Register again whenever the user changes language.
  - Errors: `invalid platform`, `invalid push token`, `invalid apns env`, `invalid push endpoint`, `invalid push keys`. Map them to the generic error (they mean a client bug).
- `unregister_push_token(p_token)` deletes the caller's row with that token (web: the endpoint). It works for suspended accounts too. Call it before `signOut()`; the server also drops the token when the session ends, so a failed call is harmless.

## 3. Notification types

| `type` | Trigger | Recipients | Pref | Android channel | iOS category | `collapse_key` | `target_id` |
|---|---|---|---|---|---|---|---|
| `chat` | insert `chat_messages` | approved members except the sender | `chat` | `chat` | `CHAT_MESSAGE` | `chat:<bubble_id>` | message id |
| `join_request` | insert `join_requests` (not a repeated request) | approved members | `join_requests` | `bubble` | `JOIN_REQUEST` | `join:<bubble_id>` | request id |
| `approval` | requester admitted (`bubble_members` inserted/updated to approved, role member) | the requester | `approvals` | `bubble` | `BUBBLE_JOINED` | `approval:<bubble_id>` | bubble id |
| `new_event` | insert `events` | approved members except the creator | `new_events` | `events` | `NEW_EVENT` | `event:<event_id>` | event id |
| `event_reminder` | pg_cron every 5 min: event starts within the next hour | users in `rsvp_list` (the creator too, if RSVPed) | `event_reminders` | `events` | `EVENT_REMINDER` | `reminder:<event_id>` | event id |
| `food` | insert `food_posts` | approved members except the author | `food` (off by default) | `bubble` | `FOOD_POST` | `food:<bubble_id>` | post id |
| `market` | insert `market_items` | approved members except the owner | `market` (off by default) | `bubble` | `MARKET_ITEM` | `market:<bubble_id>` | item id |

### Recipient rules (`push_should_notify`, checked when queued and again when sent)
1. **Never the author.** The only exception is a reminder: everyone who RSVPed gets it.
2. **Active account**: not banned, and not suspended with `status_until` null or in the future (`users.status`, docs/moderation.md).
3. **Prefs**: `enabled` and the type's switch. No prefs row means the defaults.
4. **Still a member** of the bubble.
5. **Mute**: a mute row with `until` null or in the future silences everything from that bubble, reminders included. An `approval` is never muted (it's about your own request).
6. **Blocks, both ways**: nothing about content from someone the recipient blocked, or who blocked the recipient (same rule as the content RLS).
7. **A device**: users with no `push_tokens` row get no outbox row.

### Chat coalescing
- At most **one push per bubble per recipient every 30 s**. The first message of a burst goes out at once. Messages arriving while a row is still waiting are merged into it: the newest message replaces the text and `payload.count` adds up. A message arriving within 30 s of the last push waits in a row with `next_attempt_at = last push + 30 s` (pg_cron wakes the dispatcher).
- Every chat push of a bubble carries the same collapse key (`chat:<bubble_id>`: APNs `apns-collapse-id`, FCM `collapse_key` + `notification.tag`, Web Push `Topic` header + `tag`), so a newer push **replaces** the older one on the device instead of stacking.

### Reminders
pg_cron runs `enqueue_event_reminders()` every 5 minutes. It queues a reminder for each event starting within the next hour, once per `(user, event, start time)` (unique `dedupe_key`). Moving the event re-arms it. The dispatcher drops the reminder if the event already started, was deleted or the user un-RSVPed in the meantime.

## 4. Text, language and privacy

- **Language**: the token's `locale`, then the user's `user_metadata.locale` (the same one the emails use), then English. Strings: `supabase/functions/push-dispatch/locales/{en,ro,fr,es,it}.json`, with the glossary's terms and informal tone. User content is never translated.
- **Truncation**: message text, food descriptions and similar are flattened to one line and cut at 100 characters (graphemes, so emoji and diacritics stay whole) with "…". Names are capped at 40, titles at 80.
- **No email addresses**: the dispatcher never reads `auth.users.email`. Display names that look like an address are cut at the `@`.
- **`preview_content` off**: no names and no content, only the bubble name: title "Boolaa", body "New message in Flatmates" / "3 new messages in Flatmates" (real plural forms), "New join request in Flatmates", "New event in Flatmates" and so on.

| type | Title (preview on, en) | Body (preview on, en) |
|---|---|---|
| chat | Ana in Flatmates | Pizza tonight? (`+2 more messages` when coalesced) |
| join_request | Flatmates | Ana wants to join |
| approval | You're in Flatmates! | Your join request was approved. Say hi! |
| new_event | New event in Flatmates | Ana added Flat dinner |
| event_reminder | Flat dinner | Starts in 1 hour · Kitchen |
| food | Food Circle · Flatmates | Ana: Leftover salad (or "Ana shared something to eat") |
| market | Marketplace · Flatmates | Ana: Old sofa (Free) |

No absolute times are shown, because the server doesn't know the user's time zone.

## 5. Payload contract (what each client receives)

Deep-link data, on every platform: **`{ type, bubble_id, target_id }`** (strings).

| `type` | Open | Web URL (`url` field) |
|---|---|---|
| `chat` | switch to `bubble_id`, open Chat | `/chat?bubble=<id>` |
| `join_request` | switch to `bubble_id`, open Settings → Pending requests | `/settings?bubble=<id>` |
| `approval` | switch to `bubble_id` (it's now in the joined list), open Home; refresh the bubbles first | `/home?bubble=<id>` |
| `new_event`, `event_reminder` | switch to `bubble_id`, open Events, scroll to/highlight `target_id` | `/events?bubble=<id>&event=<id>` |
| `food` | switch to `bubble_id`, open Food Circle, highlight `target_id` | `/food?bubble=<id>&post=<id>` |
| `market` | switch to `bubble_id`, open Marketplace, highlight `target_id` | `/marketplace?bubble=<id>&item=<id>` |

If the bubble isn't in the user's joined list anymore (left, removed), open Home without switching. If the target no longer exists, just show the screen.

**APNs** (`POST /3/device/<token>`, headers `apns-topic: ro.boolaa.app`, `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration`, `apns-collapse-id`):
```json
{ "aps": { "alert": { "title": "Ana in Flatmates", "body": "Pizza tonight?" }, "sound": "default",
           "category": "CHAT_MESSAGE", "thread-id": "<bubble_id>" },
  "type": "chat", "bubble_id": "<bubble_id>", "target_id": "<message_id>" }
```
`thread-id` groups a bubble's notifications. No badge is sent (optional; the app can clear delivered notifications of a bubble when the user opens it).

**FCM v1**:
```json
{ "message": { "token": "<fcm token>",
  "notification": { "title": "Ana in Flatmates", "body": "Pizza tonight?" },
  "data": { "type": "chat", "bubble_id": "<id>", "target_id": "<id>", "collapse_key": "chat:<id>" },
  "android": { "priority": "HIGH", "ttl": "86400s", "collapse_key": "chat:<id>",
               "notification": { "channel_id": "chat", "tag": "chat:<id>" } } } }
```

**Web Push** (encrypted with aes128gcm, headers `TTL`, `Urgency`, `Topic`): the service worker gets
```json
{ "title": "Ana in Flatmates", "body": "Pizza tonight?", "tag": "chat:<id>", "url": "/chat?bubble=<id>",
  "type": "chat", "bubble_id": "<id>", "target_id": "<id>" }
```

Messages expire after 24 h if the device stays offline; a reminder expires when its event starts.

## 6. Dispatcher

- **Auth**: header `x-push-dispatch-secret` compared in constant time with `PUSH_DISPATCH_SECRET` (the Vault secret `push_dispatch_secret` holds the same value). `verify_jwt = false` in `config.toml`.
- **Claim**: `claim_push_batch(p_limit)` (service role) takes due rows with `FOR UPDATE SKIP LOCKED`, sets a 2-minute lease and `attempts + 1`, re-checks the recipient filter and the content, and returns names, text, the recipient's tokens, `preview_content` and `user_locale`. Concurrent dispatchers never take the same row.
- **Outcomes per token**: `ok`, `invalid` (token deleted), `retry` (429, 5xx, network, APNs `ExpiredProviderToken`/`InvalidProviderToken`, FCM 401), `failed` (e.g. payload too large, bad VAPID setup: keep the token, don't retry).
- **Row result** (`complete_push_batch`): `retry` if any token is transient. Only those tokens are retried (`token_ids`), so devices that already got it don't get it twice. Backoff is 30 s, 1, 2, 4 min, or the provider's `Retry-After` if longer. The 5th failure is final (`status = 'failed'`). Otherwise the row is `sent` (at least one device got it) or `failed`.
- **Credentials**: the APNs JWT (ES256, `kid` = key id, `iss` = team id) is reused for 50 minutes. The FCM OAuth token (RS256 JWT bearer grant, scope `firebase.messaging`) is cached until 5 minutes before it expires. The VAPID JWT is per push-service origin, valid 12 h.
- **Web Push crypto** is implemented on WebCrypto (`webpush.ts`, no dependency): RFC 8291 key derivation + RFC 8188 aes128gcm, single record of 4096 bytes, and RFC 8292 VAPID. The unit tests check it against the RFC 8291 §5 example byte for byte and with a fresh-key round trip.

### APNs and HTTP/2 (measured)
APNs only speaks HTTP/2: `curl --http1.1` to `api.sandbox.push.apple.com` fails to connect. Deno's `fetch` negotiates h2 through ALPN for `https:` URLs.
- **Deno 2.6 CLI**: `POST https://api.sandbox.push.apple.com/3/device/000…` without a token answers `403 {"reason":"MissingProviderToken"}` with an `apns-id` header. That is an HTTP/2 response from APNs. Same for `api.push.apple.com`.
- **Supabase edge runtime image** (`public.ecr.aws/supabase/edge-runtime:v1.70.0`, the one `supabase start` runs here), run in Docker: the same answer from both hosts. **So plain `fetch` works in the edge runtime, with no HTTP/2 library.**
- **Hosted check** (once deployed, it needs no Apple credentials):
  ```sh
  curl -s -X POST https://<ref>.supabase.co/functions/v1/push-dispatch \
    -H "x-push-dispatch-secret: $PUSH_DISPATCH_SECRET" -d '{"action":"probe_apns"}'
  # expect {"sandbox":{"status":403,...,"body":"{\"reason\":\"MissingProviderToken\"}"},"production":{...}}
  ```
- **Fallback** if a future runtime breaks h2 (symptom: `network:` errors or connection resets for every `ios:` token in `last_error`): send iOS through FCM instead. Add the Firebase iOS SDK to the app (FCM then talks to APNs with the same .p8 key, uploaded in Firebase → Project settings → Cloud Messaging → Apple app configuration), and register the iOS FCM token under a new platform `ios_fcm` (a small migration adding it to the `platform` check, plus a few lines in `dispatch.ts` that reuse `sendFcm` with an `apns` block carrying `thread-id` and `category`). The existing FCM path then delivers. A small HTTP/2 relay (for example on Cloudflare Workers or Fly) is the other option, but it's one more thing to run.

## 7. Local testing

`supabase/functions/.env` (gitignored; template in `.env.example`) has `PUSH_DISPATCH_SECRET`, `PUSH_DRY_RUN=1` and a local VAPID pair. `seed.sql` stores the local URL (`http://kong:8000/functions/v1/push-dispatch`) and the secret in Vault.

- **`PUSH_DRY_RUN=1`**: the dispatcher builds every real request (VAPID signing and Web Push encryption included; APNs/FCM credentials are not used), then writes it to **`public.push_debug_log`** (`provider, token, title, body, collapse_key, request, simulated`) instead of sending it. Dry run only works when `SUPABASE_URL` is local (or `PUSH_DRY_RUN_ALLOW_REMOTE=1`). **Never set it in production.**
- **Simulated provider answers** in dry run: a token containing `invalid` (or an iOS token starting with `dead`) answers like an unregistered device; `transient` (or `beef`) answers like an outage. So token deletion and retries are tested end to end.
- Look at it: `select provider, title, body, collapse_key from push_debug_log order by id desc limit 20;` and `select type, status, attempts, last_error from notification_outbox order by id desc limit 20;`.
- Run the dispatcher by hand: `curl -s -X POST http://127.0.0.1:55321/functions/v1/push-dispatch -H 'x-push-dispatch-secret: local-push-dispatch-secret-change-me' -d '{}'`.
- After changing `functions/.env` or adding a function, restart the stack (`supabase stop && supabase start`): the edge runtime reads both at start.

Tests:
```sh
deno test -A --no-check supabase/tests/push_unit.test.ts   # no stack: JWTs, RFC 8291, VAPID, classification, rendering
deno test -A --no-check supabase/tests/push.test.ts        # local stack, end to end through the dry-run dispatcher
psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/push_rls.sql
```

## 8. Client contract

All three clients do the same four things:
1. Ask for permission only after a user action (never at launch or page load). A good moment is right after joining or creating the first bubble, or from Settings → Notifications. Explain first in the app's own UI ("Get a ping when your bubble talks to you"), then trigger the OS prompt.
2. After sign-in / session restore, once `start_device_check` says `verified` and permission is granted: get the token and call **`register_push_token`** with the device id, locale and app version. Do it **on every app start** and whenever the OS hands out a new token or the language changes.
3. On sign-out: call `unregister_push_token(token)`, then `signOut()`. On account deletion nothing is needed.
4. On open: read `{type, bubble_id, target_id}` and route (table in §5). While the app is in the foreground and the user is already looking at that bubble's chat, don't show a banner for `chat`.

### iOS (SwiftUI, `apps/boolaa-ios`)
- **Capability**: Signing & Capabilities → **Push Notifications** (adds `aps-environment`). In `project.yml`, add the entitlement (`aps-environment: development`, automatically `production` for distribution builds) and regenerate with xcodegen.
- **Bundle id**: the APNs topic must be the app's bundle id. `project.yml` currently has `com.boolaa.app`, while the backend defaults to `ro.boolaa.app` (Android's `applicationId`). Either move the iOS bundle id to `ro.boolaa.app` (needs a new App ID) or set the secret `APNS_TOPIC=com.boolaa.app`.
- **Register**: `UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])` after a user action → `UIApplication.shared.registerForRemoteNotifications()` → in `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` hex-encode the token (`map { String(format: "%02x", $0) }.joined()`) → `register_push_token(p_platform: "ios", p_token: hex, p_apns_env: env, p_device_id:, p_locale:, p_app_version:)`. Use a `UIApplicationDelegateAdaptor` in the SwiftUI app.
- **`apns_env`**: `sandbox` in DEBUG builds run from Xcode, `production` for TestFlight, App Store and Ad Hoc. Decide it at compile time (`#if DEBUG`) or from the embedded provisioning profile's `aps-environment`. Getting it wrong gives `BadDeviceToken`, the server deletes the token, and the next launch registers it again.
- **Categories**: register `CHAT_MESSAGE`, `JOIN_REQUEST`, `BUBBLE_JOINED`, `NEW_EVENT`, `EVENT_REMINDER`, `FOOD_POST`, `MARKET_ITEM` with `UNUserNotificationCenter.setNotificationCategories`. No actions are required now. `CHAT_MESSAGE` with a text-input "Reply" action and `JOIN_REQUEST` with Approve/Reject (which must require unlocking the device, `.authenticationRequired`) are good later additions; they'd call the existing RPCs.
- **Open handling**: `userNotificationCenter(_:didReceive:)` reads `type`, `bubble_id`, `target_id` from `response.notification.request.content.userInfo` and routes. `willPresent`: show `[.banner, .sound]` unless it's a chat push for the chat currently on screen.
- `thread-id` = bubble id already groups notifications per bubble in Notification Center.

### Android (Kotlin/Compose, `apps/boolaa-android`, sideloaded APK)
- **FCM without the Play Store**: FCM only needs Google Play services on the device, not Play Store distribution. A sideloaded APK receives pushes normally. Devices without Play services (Huawei, de-Googled ROMs) get none, so pushes are best effort; the app stays usable.
- **Firebase setup**: add the `com.google.gms.google-services` Gradle plugin and `firebase-messaging` (via the Firebase BoM). **`google-services.json` must not be committed** (the repo is public; the file isn't secret in a strict sense, but it shouldn't sit in a public repo). Keep it out of git (`apps/boolaa-android/app/google-services.json` in `.gitignore`) and write it at build time: store it base64-encoded as a CI secret (`GOOGLE_SERVICES_JSON_B64`) and run `echo "$GOOGLE_SERVICES_JSON_B64" | base64 -d > app/google-services.json` before `./gradlew assembleRelease`. Locally, download it from the Firebase console. Alternatively, skip the plugin and call `FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApiKey(BuildConfig.FCM_API_KEY).setApplicationId(...).setProjectId(...).setGcmSenderId(...).build())` with values from `local.properties` / CI env through `buildConfigField`.
- **Channels** (create on start, Android 8+): `chat` (importance HIGH), `bubble` (DEFAULT), `events` (HIGH). User-visible names are in §9.
- **Permission**: Android 13+ (API 33) needs the runtime permission `POST_NOTIFICATIONS`. Declare it in the manifest and request it only after a user action (same moment as iOS). On API 26–32 notifications are allowed by default.
- **Token**: `FirebaseMessaging.getInstance().token` on start, plus `FirebaseMessagingService.onNewToken` → `register_push_token(p_platform = "android", p_token, p_device_id, p_locale, p_app_version)`. Queue the call if there's no verified session yet.
- **Receiving**: messages carry `notification`, so the system draws them when the app is in the background (channel and tag included). In the foreground, `onMessageReceived` gets them: show a `NotificationCompat` notification yourself with the same `channel_id` and `tag`, or skip it if that chat is open. On tap, the launcher activity's intent extras hold the `data` keys (`type`, `bubble_id`, `target_id`); route from there.

### Web (Next.js, `apps/boolaa-web`)
- **Service worker** `public/sw.js`, registered after sign-in:
  ```js
  self.addEventListener("push", (e) => {
    const d = e.data.json();
    e.waitUntil(self.registration.showNotification(d.title, {
      body: d.body, tag: d.tag, renotify: d.type === "chat", data: d, icon: "/icon-192.png", badge: "/badge-72.png" }));
  });
  self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      const w = ws.find((c) => new URL(c.url).origin === self.location.origin);
      return w ? w.focus().then(() => w.navigate(e.notification.data.url)) : clients.openWindow(e.notification.data.url);
    }));
  });
  ```
  Handle `?bubble=<id>` in the app: set the `boolaa_bubble` cookie to it (if it's one of the user's bubbles), then show the page. `event`/`post`/`item` scroll to and highlight the target.
- **Subscribe**: `const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY })`, then `const j = sub.toJSON()` → `rpc("register_push_token", { p_platform: "web", p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_locale, p_device_id })`. The public key is `VAPID_PUBLIC_KEY` (it's public; put it in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).
- **Permission UX**: call `Notification.requestPermission()` **only from a click** ("Turn on notifications" in Settings, or a dismissible card after joining a bubble), **never on page load**. If it's `denied`, show how to re-enable it in the browser settings instead of asking again. Safari needs the site installed to the Home Screen on iOS (16.4+); on macOS Safari it works directly.
- On sign-out: `unregister_push_token(sub.endpoint)`, then `sub.unsubscribe()`, then `signOut()`.
- Re-subscribe on every app start (`pushManager.getSubscription()` → register again), because browsers rotate subscriptions.

## 9. Settings UI each client needs

Settings → **Notifications** (account level):
- Master switch (`enabled`). When off, grey out the rest.
- Per type: Chat messages (`chat`), Join requests (`join_requests`), Request approved (`approvals`), New events (`new_events`), Event reminders (`event_reminders`), Food Circle (`food`), Marketplace (`market`).
- **Show message previews** (`preview_content`), with the hint "Off: only 'New message in Flatmates', no names or text."
- The OS permission state: if notifications are blocked at the OS/browser level, show a banner with a button to the system settings.

Read and write the user's own `notification_prefs` row (`select` / `update ... eq('user_id', me)`).

Bubble Settings (current bubble) → **Mute this bubble**: 1 hour, 8 hours, 1 week, Until I turn it back on (`until` null). Show "Muted until <date>" and Unmute (delete the row). `upsert` into `bubble_mutes` `{user_id: me, bubble_id, until}`.

Strings (add to each client's catalog; glossary terms, informal tone):

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| `notifications.title` | Notifications | Notificări | Notifications | Notificaciones | Notifiche |
| `notifications.enabled` | Allow notifications | Permite notificările | Autoriser les notifications | Permitir notificaciones | Consenti le notifiche |
| `notifications.chat` | Chat messages | Mesaje din chat | Messages de discussion | Mensajes del chat | Messaggi in chat |
| `notifications.joinRequests` | Join requests | Cereri de alăturare | Demandes d'adhésion | Solicitudes para unirse | Richieste di adesione |
| `notifications.approvals` | My request was approved | Cererea mea a fost aprobată | Ma demande a été acceptée | Mi solicitud fue aprobada | La mia richiesta è stata approvata |
| `notifications.newEvents` | New events | Evenimente noi | Nouveaux événements | Eventos nuevos | Nuovi eventi |
| `notifications.eventReminders` | Event reminders (1 hour before) | Mementouri pentru evenimente (cu o oră înainte) | Rappels d'événements (1 heure avant) | Recordatorios de eventos (1 hora antes) | Promemoria degli eventi (1 ora prima) |
| `notifications.food` | Food Circle | Cercul culinar | Cercle gourmand | Círculo de comida | Cerchio del cibo |
| `notifications.market` | Marketplace | Piață | Marché | Mercadillo | Mercatino |
| `notifications.preview` | Show message previews | Arată previzualizarea mesajelor | Afficher l'aperçu des messages | Mostrar vista previa de los mensajes | Mostra l'anteprima dei messaggi |
| `notifications.previewHint` | When off, notifications only say "New message in Flatmates", without names or text. | Când e oprită, notificările spun doar „Mesaj nou în Flatmates”, fără nume sau text. | Désactivé, les notifications disent seulement « Nouveau message dans Flatmates », sans nom ni texte. | Si está desactivada, las notificaciones solo dicen «Nuevo mensaje en Flatmates», sin nombres ni texto. | Se disattivata, le notifiche dicono solo «Nuovo messaggio in Flatmates», senza nomi né testo. |
| `notifications.blocked` | Notifications are turned off for Boolaa in your settings. | Notificările pentru Boolaa sunt oprite din setări. | Les notifications de Boolaa sont désactivées dans tes réglages. | Las notificaciones de Boolaa están desactivadas en tus ajustes. | Le notifiche di Boolaa sono disattivate nelle impostazioni. |
| `notifications.ask` | Turn on notifications | Activează notificările | Activer les notifications | Activar notificaciones | Attiva le notifiche |
| `notifications.askHint` | Get a ping when your bubbles talk to you. | Primește un semn când bulele tale vorbesc cu tine. | Reçois un signal quand tes bulles te parlent. | Recibe un aviso cuando tus burbujas te hablen. | Ricevi un avviso quando le tue bolle ti parlano. |
| `mute.title` | Mute this bubble | Pune bula pe silențios | Mettre la bulle en sourdine | Silenciar la burbuja | Silenzia la bolla |
| `mute.1h` / `mute.8h` / `mute.1w` / `mute.forever` | 1 hour / 8 hours / 1 week / Until I turn it back on | O oră / 8 ore / O săptămână / Până o reactivez | 1 heure / 8 heures / 1 semaine / Jusqu'à ce que je la réactive | 1 hora / 8 horas / 1 semana / Hasta que la reactive | 1 ora / 8 ore / 1 settimana / Finché non la riattivo |
| `mute.until` | Muted until {date} | Pe silențios până {date} | En sourdine jusqu'au {date} | Silenciada hasta el {date} | Silenziata fino al {date} |
| `mute.unmute` | Unmute | Reactivează notificările | Réactiver | Reactivar | Riattiva |
| Android channel `chat` | Chat | Chat | Discussion | Chat | Chat |
| Android channel `bubble` | Bubble activity | Activitate în bule | Activité des bulles | Actividad de las burbujas | Attività delle bolle |
| Android channel `events` | Events | Evenimente | Événements | Eventos | Eventi |

## 10. Production checklist

1. **APNs key** (Apple Developer, team `W5WKF2N472`):
   - developer.apple.com → Account → **Certificates, Identifiers & Profiles** → **Identifiers** → the app's App ID (`ro.boolaa.app`, or `com.boolaa.app`, see §8) → Capabilities → tick **Push Notifications** → Save. Regenerate the provisioning profiles (Xcode's automatic signing does it).
   - **Keys** → **+** → name "Boolaa APNs" → tick **Apple Push Notifications service (APNs)** → Configure: environment **Sandbox & Production**, key restriction **Team Scoped (All Topics)** → Save → Continue → **Register** → **Download** `AuthKey_<KEYID>.p8` (it can be downloaded **once**; store it in the password manager) and note the **Key ID**.
2. **Firebase project** (for Android):
   - console.firebase.google.com → **Create a project** "Boolaa" (Google Analytics not needed).
   - Project settings (gear) → General → **Add app** → Android → package name **`ro.boolaa.app`** → Register → download **`google-services.json`** (keep it out of git, see §8).
   - Project settings → **Cloud Messaging**: check that **Firebase Cloud Messaging API (V1)** is *Enabled* (if not, the ⋮ menu → Manage API in Google Cloud Console → Enable).
   - Service account for the server, least privilege: Google Cloud console (same project) → IAM & Admin → **Service Accounts** → Create "boolaa-push" → role **Firebase Cloud Messaging API Admin** → Done → open it → Keys → Add key → **JSON**. (Quicker but broader: Firebase → Project settings → Service accounts → Firebase Admin SDK → *Generate new private key*.) Keep the JSON in the password manager; never commit it.
3. **VAPID keys**: `deno run supabase/functions/push-dispatch/gen-vapid.ts`. Generate them once and keep them: changing them invalidates every web subscription. The public key goes to the web app as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (DigitalOcean app env).
4. **Function secrets** (never in the repo):
   ```sh
   supabase secrets set --project-ref <ref> \
     PUSH_DISPATCH_SECRET="$(openssl rand -hex 32)" \
     APNS_KEY_ID=<KEYID> APNS_TEAM_ID=W5WKF2N472 APNS_KEY_P8="$(cat AuthKey_<KEYID>.p8)" \
     FCM_SERVICE_ACCOUNT_JSON="$(cat boolaa-push.json)" \
     VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv> VAPID_SUBJECT=mailto:hello@boolaa.ro
   # plus APNS_TOPIC=com.boolaa.app if the iOS bundle id stays com.boolaa.app
   ```
   Do **not** set `PUSH_DRY_RUN`.
5. **pg_cron and pg_net**: the migration runs `create extension if not exists pg_cron` and `pg_net`. If `db push` refuses it, enable **pg_cron** first in Dashboard → Database → Extensions (or Integrations → Cron), then push again.
6. **Migration**: `supabase db push` (applies `20261122200000_push_notifications.sql`; it creates the three cron jobs `push-event-reminders`, `push-dispatch-due`, `push-outbox-prune`).
7. **Vault** (SQL editor), the same secret as step 4:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
   select vault.create_secret('<PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');
   ```
   Rotate with `vault.update_secret(...)` and `supabase secrets set` together.
8. **Deploy**: `supabase functions deploy push-dispatch --project-ref <ref>` (`verify_jwt = false` comes from `config.toml`).
9. **Check**:
   - HTTP/2 to APNs: the `probe_apns` call in §6.
   - `select jobname, schedule, active from cron.job;` shows the three jobs; `select * from cron.job_run_details order by start_time desc limit 10;` shows them running.
   - With a TestFlight build: send a message from another account, then `select type, status, attempts, last_error from notification_outbox order by id desc limit 10;` and `select * from net._http_response order by created desc limit 5;`.
10. **Clients**: ship the iOS build with the Push Notifications capability and `apns_env = production`, the Android build with `google-services.json` injected at build time, and the web app with `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `sw.js`.
