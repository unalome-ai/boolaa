# Boolaa for Android

A native Android client for Boolaa, built with Kotlin, Jetpack Compose and Material 3. It mirrors the iOS app and `docs/boolaa-spec.md`.

- **Package:** `com.boolaa.app`, minSdk 26, compile/target 36.
- **Locales:** en, ro, fr, es and it, with a per-app language picker.

## Setup

1. **JDK 17 and the Android SDK.**

   ```sh
   export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.18/libexec/openjdk.jdk/Contents/Home
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   ```

2. **`local.properties`.** This file is gitignored and is passed into the build as `BuildConfig` fields:

   ```properties
   sdk.dir=/opt/homebrew/share/android-commandlinetools
   supabase.url=http://127.0.0.1:55321
   supabase.anonKey=<ANON_KEY from `supabase status -o env`>
   web.baseUrl=http://localhost:3200
   ```

   `web.baseUrl` is the Next.js app that serves `/privacy` and `/terms`.

3. **Emulator port forwarding.** The emulator reaches the Mac's localhost through `adb reverse`:

   ```sh
   adb reverse tcp:55321 tcp:55321   # Supabase API
   adb reverse tcp:3200 tcp:3200     # web app (legal pages)
   ```

   Cleartext HTTP is allowed only for `127.0.0.1` and `localhost` (`res/xml/network_security_config.xml`).

## Build, test, run

```sh
./gradlew assembleDebug lintDebug testDebugUnitTest   # build + lint + JVM unit tests (Robolectric)
./gradlew connectedDebugAndroidTest                    # instrumented tests (needs emulator + adb reverse + local Supabase)
./gradlew installDebug && adb shell am start -n com.boolaa.app/.MainActivity
```

### Unit tests (`app/src/test`)

- **Model decoding** against real rows captured from the local backend (`resources/fixtures`), including the realtime timestamp format.
- **App logic:** the routing gate, chat merge, approvals, storage paths, link tags, feed ordering, error mapping and safety wire values.
- **Translations:**
  - Plural and format checks, with a `Context` configured per locale.
  - `StringsParityTest`: every locale has the same keys, plural quantities and placeholders.
  - `NoHardcodedTextTest`.

### Instrumented tests (`app/src/androidTest`)

- **`BoolaaFlowTest`:**
  - Alice logs in, sends a chat message, switches to Climbing Crew and sees CLIMB123 in Settings.
  - Carol lands on the pending-approval screen.
  - The message the test sent is deleted.
- **`RemoveMemberTest`:** runs `remove_member` as the owner, as a non-owner, on yourself, and on a missing member. It uses a throwaway bubble.
- **`SafetyTest`:** creates two throwaway sign-ups and checks that:
  - report errors are mapped;
  - a block hides chat both ways and an unblock restores it;
  - `delete_my_account` removes the storage objects, the membership, the messages and the login.

### Debug launch hooks (debug builds only)

These are intent extras read by `DebugHooks`. They are used for screenshots and manual QA.

```sh
adb shell am start -n com.boolaa.app/.MainActivity --es autoLogin alice@boolaa.test --es bubble "Climbing Crew" --es tab settings
adb shell am start -n com.boolaa.app/.MainActivity --es open chat     # chat | links | profile | addBubble
adb shell am start -n com.boolaa.app/.MainActivity --es signOut true
```

- `password` defaults to `password123`.
- `tab` takes one of `home`, `events`, `food`, `marketplace` or `settings`.

## Architecture

- **Entry point:** a single `MainActivity`, an AppCompatActivity so that per-app locales work on API 26–32.
  - `AppContainer` holds the Supabase client, `BoolaaApi` and `SessionStore`.
- **`SessionStore`:** the auth and session state.
  - It holds the profile, memberships, pending requests, blocks and the current bubble.
  - The current bubble is persisted in SharedPreferences.
  - It runs a realtime channel on the user's own `bubble_members` and `join_requests` rows. That moves the user Onboarding → Main when approved, and back out when removed.
- **`RouteGate`:** maps the session state to Auth, Onboarding or Main.
- **Main shell:** a NavHost with five tabs plus chat and links, a pill tab bar, a chat FAB and a bubble-chip header.
- **Screens:** each screen has a ViewModel keyed by bubble id, and errors go through `UserFacingError`.
- **Realtime:** chat inserts, plus the members and requests lists in Settings, use `LiveTables`.
- **Safety** (App Store 1.2 and 5.1.1(v)):
  - Every chat message (long press), event, food post, market item, link and member (overflow menu) can be reported.
  - Reporting opens `ReportSheet`: 7 reasons and optional details, then "Also block <name>?".
  - Block and unblock live on members, and the profile sheet has a Blocked users list.
  - Delete account is in the profile sheet. It shows a warning and asks for a typed confirmation word. It removes the `<uid>/` objects in all 3 buckets, calls `delete_my_account()` and signs out.
  - The legal pages open in Custom Tabs at `/privacy?lang=<app language>` and `/terms?lang=…`, from the profile sheet and from Register.
  - Register also requires a 16+ age checkbox.
- **Localization:**
  - Strings live in `res/values{,-ro,-fr,-es,-it}/strings.xml`. Romanian plurals use one, few and other.
  - Dates, times and numbers are formatted with the current locale (`core/Formats.kt`).
  - Lint escalates missing translations, missing plural quantities and hard-coded text to errors.

## Gotchas

- **compileSdk 36 pins.** Newer AndroidX releases need compileSdk 37, so these are pinned in `gradle/libs.versions.toml`:
  - Compose BOM 2026.06.01, navigation 2.9.8, browser 1.8.0, Coil 3.4.0 and OkHttp 5.3.2.
  - `androidx.lifecycle` is forced to 2.10.0 through `resolutionStrategy` in `app/build.gradle.kts`.
- **AGP 9 has Kotlin built in.** Don't add the `kotlin-android` plugin.
- **Realtime timestamps** use `"2026-11-22 10:00:00.123+00"` (space separator, short offset), unlike PostgREST's ISO format. `BoolaaJson.parseTimestamp` accepts both.
- **Realtime DELETE events** ignore filters, and `oldRecord` holds only the primary key (no `REPLICA IDENTITY FULL`). `LiveTables` subscribes to DELETEs unfiltered and matches on the id.
- **Blocking is enforced by RLS.**
  - Content queries simply stop returning blocked authors' rows, and screens reload when the block list changes.
  - Members lists still show blocked people, with a "Blocked" badge and an Unblock action.
- **Account deletion** must remove storage objects from the client first, because SQL cannot delete them. Failures there are ignored, per the spec.
- **Ephemeral clients in tests.** Integration tests call `Backend.createClient(ephemeral = true)`, which keeps them from overwriting the app's stored session.
- **Robolectric** tests run with `@Config(sdk = [35])`.
- **The legal pages** come from the web app. If `localhost:3200` isn't running, or the route doesn't exist yet, the Custom Tab shows the browser's error page or a redirect.
