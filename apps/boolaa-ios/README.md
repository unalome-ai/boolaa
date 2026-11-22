# Boolaa iOS (SwiftUI)

Native client for Boolaa, built against the local Supabase stack. The product spec is in `docs/boolaa-spec.md` and the backend contract is in `supabase/migrations/`.

Requirements: Xcode 27, `xcodegen` (`brew install xcodegen`), and a running local Supabase (`supabase start` from the repo root, API on `http://127.0.0.1:55321`).

## Setup

```sh
cd apps/boolaa-ios
cp Config/Local.xcconfig.example Config/Local.xcconfig
# paste ANON_KEY from: (cd ../.. && supabase status -o env)
xcodegen generate            # Boolaa.xcodeproj is generated and gitignored, so edit project.yml instead
```

xcconfig treats `//` as the start of a comment, so URLs are written `http:/$()/127.0.0.1:55321`.

**App ID** `ro.boolaa.app` (tests `ro.boolaa.app.tests` / `.uitests`), team `W5WKF2N472`. The app target has the
*Sign in with Apple* entitlement (`Boolaa/Resources/Boolaa.entitlements`, generated from `project.yml`). Simulator
builds and tests need no signing setup: Xcode signs them "to run locally" and embeds the entitlement without a
provisioning profile. Device and archive builds need the App ID `ro.boolaa.app` with *Sign in with Apple* enabled
in the developer portal (it is), and Xcode's automatic signing.

URL schemes (Info.plist, from `project.yml`): `ro.boolaa.app` for the OAuth / email-link callback
`ro.boolaa.app://auth/callback` (PKCE) and the reversed Google iOS client ID for Google Sign-In. `GIDClientID` is the
iOS client and `GIDServerClientID` the web client (`docs/oauth-clients.md`; public identifiers, not secrets).

`WEB_BASE_URL` (Info.plist `WebBaseURL`) is the web app that serves `/privacy` and `/terms` (opened in `SFSafariViewController` with `?lang=<app language>`): `http:/$()/localhost:3200` locally, `https:/$()/boolaa.app` by default.

## Build / test

```sh
DEST='platform=iOS Simulator,name=iPhone 18 Pro'   # or id=<UDID> if names are duplicated
xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination "$DEST" build
xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination "$DEST" test                               # all tests
xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination "$DEST" test -only-testing:BoolaaTests     # unit + integration
xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination "$DEST" test -only-testing:BoolaaUITests   # UI flow
```

- `BoolaaTests` (Swift Testing) covers decoding of real PostgREST rows (`BoolaaTests/Fixtures`, captured as Alice), the routing gate and the feature logic. It also has integration tests against the local backend: sign in as Alice, load bubbles and the Flatmates chat, RPC errors, and a realtime insert round-trip.
- `BoolaaUITests` (XCUITest) logs in as Alice, sends a chat message, switches bubble and opens Settings. Each run leaves one "Hello from UI test" message in Flatmates.

## Run in the simulator

```sh
xcrun simctl boot "iPhone 18 Pro"
xcrun simctl install booted build/DerivedData/Build/Products/Debug-iphonesimulator/Boolaa.app  # if built with -derivedDataPath build/DerivedData
xcrun simctl launch booted ro.boolaa.app
```

Seeded logins (password `password123`): `alice@boolaa.test`, `bob@boolaa.test`, `carol@boolaa.test` (Carol has a pending request, so she sees Pending approval).

DEBUG launch hooks for automation and screenshots (see `Boolaa/App/DebugHooks.swift`):

```sh
xcrun simctl launch booted ro.boolaa.app -UITestAutoLogin alice@boolaa.test -UITestBubble "Climbing Crew" -UITestTab settings
# -UITestTab home|events|food|marketplace|settings   -UITestOpen chat|links|profile|addBubble|report|blocked|deleteAccount|security
# -UITestSignOut YES   -UITestRegister YES (start on Create account)
# -UITestDeviceID boolaa-test-device   use the device id the seed trusts for alice, bob, carol (instead of the Keychain one)
```

## Marketing screenshots

`Scripts/capture-marketing.sh` regenerates the landing page's screenshots (`apps/boolaa-web/public/screens/<locale>/<light|dark>/<screen>.webp`, 11 screens × 5 languages × 2 themes) from the simulator against the local Supabase:

```sh
SIM_UDID=<udid> Scripts/capture-marketing.sh                 # everything (about 15 minutes)
LOCALES="ro" THEMES=dark SCREENS="home chat" SKIP_BUILD=1 Scripts/capture-marketing.sh
```

It loads fictional data per language (`Scripts/marketing/content.json`, written to SQL by `seed.py`: six `mk-*@boolaa.test` users and three bubbles with fixed ids), sets a clean 9:41 status bar, launches each screen with the debug hooks (`-UITestOnboarding`, `-UITestJoinCode`, `-UITestBubbleName`, `-UITestScrollTo requests` exist for this) and deletes the data again on exit. It refuses to run unless both the database URL and `Config/Local.xcconfig` point at the local stack. Don't run `supabase db reset` while it is capturing. Needs `cwebp` (`brew install webp`).

## Layout

```
Boolaa/App         BoolaaApp (root), RootView (routing gate switch), DebugHooks
Boolaa/Core        AppConfig (Info.plist keys), Backend (SupabaseClient), BoolaaAPI (every query/RPC/upload),
                   AuthSecurity (device check, devices, codes, gate decision), DeviceIdentity (Keychain device id),
                   BoolaaJSON (timestamptz decoding), Theme, ImageCompression
Boolaa/Models      Codable rows matching the migration (explicit snake_case CodingKeys) + insert payloads
Boolaa/State       SessionStore (@Observable: auth, profile, memberships, current bubble), RouteGate (pure), ShellRouter
Boolaa/Features    Auth, Onboarding, Shell (header/bubble chips/dock), Home, Chat, Events, Food, Marketplace, Links, Settings, Profile
Boolaa/Components  Avatar, chips, cards, PhotoField (PhotosPicker + JPEG compression),
                   Playful (bubble orb, ambient backdrop, confetti, shimmer skeletons, segmented pill, entrance motion)
```

## Design

The look, motion and voice are specified in `docs/design-system.md` (shared with Android and the web). Tokens are in `Boolaa/Core/Theme.swift`: `Hue` (colour families, the deterministic bubble colour), `Feature` (feature colours), `Theme` (surfaces, radii, spacing), `Motion` (springs) and the button, card and field styles. Rules to keep when adding UI:

- Use `Hue`/`Theme` tokens, never raw colours. Text on a hue's fill uses `hue.onFill`; a hue used as text uses `hue.text`.
- Ambient loops use `TimelineView` + `Canvas` (see `Playful.swift`), not `repeatForever` animations, so XCUITest can still reach idle.
- Every animation has a Reduce Motion path (`Motion.resolve`, `SquishButtonStyle`, `popIn`).
- Safety screens (report, blocked users, delete account) stay calm: `PrimaryButtonStyle(calm: true)`, `DestructiveButtonStyle`, `CalmEmptyState`.

## Localization (en, ro, fr, es, it)

- Strings live in `Boolaa/Resources/Localizable.xcstrings` (development language en) and `InfoPlist.xcstrings` (photo-library prompt). Terms, tone, plural rules and Romanian diacritics follow `docs/i18n-glossary.md`.
- Counts use catalog plural variations. For "x of y" strings, a substitution makes the plural agree with y. Romanian has the one/few/other forms.
- UI text goes through `Text("…")`, `LocalizedStringResource` or `String(localized:)`. User content (chat, names, posts) uses `Text(verbatim:)`, so it is never looked up as a key.
- Backend and RPC errors are mapped to translated messages in `Boolaa/Core/UserFacingError.swift`, so raw Postgres or GoTrue text is never shown.
- The language follows iOS's per-app setting. Profile → Language opens Settings for the app.
- Check the catalogs after a build:

```sh
Scripts/check-localizations.py --derived-data build/DerivedData
```

  It fails on missing or untranslated keys, missing plural forms, mismatched format specifiers, cedilla ş/ţ, English left in other locales, code strings missing from the catalog or stale ones, and keys not compiled into `<lang>.lproj`. `BoolaaTests/LocalizationTests.swift` checks the compiled bundle, plurals and error messages per language.
- To preview a language: `xcrun simctl launch booted ro.boolaa.app -AppleLanguages "(ro)" -AppleLocale ro_RO`.

## Auth security (docs/auth-security.md)

- **Device id**: 32 random bytes, base64url, created once per install in the Keychain
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronised; `Core/DeviceIdentity.swift`). It survives
  sign-out; a reinstall that wipes the Keychain is a new device. Label: `"iPhone · iOS 27"`.
- **Gate** (`SessionStore.gate()`): after every sign-in and session restore, `start_device_check`, then (only when it
  says `code_required`) `is_device_verified()`: while enforcement is off that is true and the user goes on, as on the
  web. Then the own `users` row: suspended or banned → the suspended screen; `needs_age_confirmation`, or a first
  Apple/Google sign-in without `age_confirmed_at` → the 16+ and Terms screen (`confirm_age`). Only then realtime and the
  bubble data. A `session not verified` or `account suspended` error from any call runs the gate again
  (`SecurityEvents`). The decision itself is pure (`DeviceGateDecision`, `RouteGate`) and unit tested.
- **Check your email** (`GateViews.swift`): 6 boxes over one `.oneTimeCode` field (Mail suggests the code above the
  keyboard), paste button, auto-submit, resend after 60 s, "N tries left" with plural forms, shake and an error haptic
  on a wrong code, a success haptic on a right one, "Use another account".
- **Sign-up** sends `{name, locale, age_confirmed: true, terms_version: "2026-11-22"}`. The app's language is synced to
  `user_metadata.locale` (emails come in that language) whenever it differs.
- **Forgot password**: Sign in → "Forgot password?" → email → 6-digit code (`verifyOTP(.recovery)`) → new password →
  the gate. The emailed link is a fallback that opens `ro.boolaa.app://auth/callback`.
- **Sign in with Apple**: `SignInWithAppleButton`, sha256 nonce, `signInWithIdToken(.apple)`; the name Apple sends on
  the first authorization goes to user metadata and `users.name`.
- **Google**: the GoogleSignIn SDK (SPM, v10): `signIn(withPresenting:hint:additionalScopes:nonce: sha256(raw))`, then
  `signInWithIdToken(.google, idToken, accessToken, nonce: raw)`. No `skip_nonce_check` is needed.
- **Profile → Sign-in & security**: change password (`reauthenticate` → code → `updateUser(password, nonce)`), change
  email (`sensitive_action` code, then `updateUser(email)`), *Your devices* (this device marked by hash, revoke with
  a confirmation). **Delete account** always asks for the typed word and a `delete_account` code.
- **Suspended** (`docs/moderation.md`): reason, end date, `mailto:privacy@boolaa.ro`, sign out, delete account. A
  `user_banned` sign-in shows the same screen without details.

Tests: `BoolaaTests/AuthSecurityTests.swift` (device id, gate decision, routing, wire format, error mapping, plurals)
and `AuthSecurityIntegrationTests.swift` (local stack, flags off). The UI tests in
`BoolaaUITests/AuthSecurityUITests.swift` read codes from Mailpit and need the local keys in the test runner's
environment (never commit them):

```sh
eval "$(cd ../.. && supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
TEST_RUNNER_BOOLAA_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" TEST_RUNNER_BOOLAA_ANON_KEY="$ANON_KEY" \
  xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination "$DEST" test -only-testing:BoolaaUITests
```

They create throwaway `ios-*@boolaa.test` users and delete them. The device-verification test turns enforcement on
only around the sign-in and always turns it off again in teardown (the local DB is shared). Without the keys those
tests are skipped.

## Safety and account

- **Report**: long-press any chat message, event, food post, market item, link or Home card (or use a member's ⋯ menu in Settings) → Report. Pick one of the 7 reasons, add optional details; afterwards the sheet offers "Also block <name>?". Calls `report_content`.
- **Block / Unblock**: in the same menus; the Profile sheet has **Blocked users** with Unblock. Blocking is enforced by RLS, so screens reload after a change.
- **Delete account**: Profile sheet → Delete account → type the localized confirm word (DELETE, ȘTERGE, SUPPRIMER, ELIMINAR, ELIMINA) → enter the emailed `delete_account` code. The app removes every object under `<uid>/` in avatars, food.images and market.images, calls `delete_my_account()` and signs out.
- **Legal**: the register form needs the 16+ toggle and links to the Terms and Privacy Policy; the Profile sheet has both rows.
- Screenshots: `screenshots/safety/` (en and ro).
