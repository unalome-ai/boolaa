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
xcrun simctl launch booted com.boolaa.app
```

Seeded logins (password `password123`): `alice@boolaa.test`, `bob@boolaa.test`, `carol@boolaa.test` (Carol has a pending request, so she sees Pending approval).

DEBUG launch hooks for automation and screenshots (see `Boolaa/App/DebugHooks.swift`):

```sh
xcrun simctl launch booted com.boolaa.app -UITestAutoLogin alice@boolaa.test -UITestBubble "Climbing Crew" -UITestTab settings
# -UITestTab home|events|food|marketplace|settings   -UITestOpen chat|links|profile|addBubble|report|blocked|deleteAccount
# -UITestSignOut YES   -UITestRegister YES (start on Create account)
```

## Layout

```
Boolaa/App         BoolaaApp (root), RootView (routing gate switch), DebugHooks
Boolaa/Core        AppConfig (Info.plist keys), Backend (SupabaseClient), BoolaaAPI (every query/RPC/upload),
                   BoolaaJSON (timestamptz decoding), Theme, ImageCompression
Boolaa/Models      Codable rows matching the migration (explicit snake_case CodingKeys) + insert payloads
Boolaa/State       SessionStore (@Observable: auth, profile, memberships, current bubble), RouteGate (pure), ShellRouter
Boolaa/Features    Auth, Onboarding, Shell (header/pill tab bar/FAB), Home, Chat, Events, Food, Marketplace, Links, Settings, Profile
Boolaa/Components  Avatar, chips, cards, PhotoField (PhotosPicker + JPEG compression)
```

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
- To preview a language: `xcrun simctl launch booted com.boolaa.app -AppleLanguages "(ro)" -AppleLocale ro_RO`.

## Safety and account

- **Report**: long-press any chat message, event, food post, market item, link or Home card (or use a member's ⋯ menu in Settings) → Report. Pick one of the 7 reasons, add optional details; afterwards the sheet offers "Also block <name>?". Calls `report_content`.
- **Block / Unblock**: in the same menus; the Profile sheet has **Blocked users** with Unblock. Blocking is enforced by RLS, so screens reload after a change.
- **Delete account**: Profile sheet → Delete account → type the localized confirm word (DELETE, ȘTERGE, SUPPRIMER, ELIMINAR, ELIMINA). The app removes every object under `<uid>/` in avatars, food.images and market.images, calls `delete_my_account()` and signs out.
- **Legal**: the register form needs the 16+ toggle and links to the Terms and Privacy Policy; the Profile sheet has both rows.
- Screenshots: `screenshots/safety/` (en and ro).
