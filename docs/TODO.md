# Boolaa: launch to-do list

Status: ✅ done · 🔄 in progress · ⬜ not started. Rows are grouped by phase. Everything in **P0** must be done before submitting to the App Store or Play Store or launching publicly.

## P0: Launch blockers

### Product and safety (store requirements)
- ✅ **Database (Supabase): account deletion** (`delete_my_account`).
- ✅ **Account deletion UI** (web, iOS, Android): a confirmation step, and the user's stored images are deleted first.
- ✅ **Database: block users**, two-way, enforced by the database's access rules (RLS), including live chat.
- ✅ **Database: report content and users** (`report_content`), into a moderation queue.
- ✅ **Report and block UI** on every message, post, item, event, link and member, plus a "Blocked users" list in the profile.
- ⬜ **Moderation process.** Apple requires acting on reports within 24 hours. It needs:
  - an alert to the team for each new report (database webhook → email or Slack);
  - an admin view of open reports with actions: delete content, remove the user from a bubble, suspend the account.
- ⬜ **Suspended/banned accounts** (`users.status`): blocked at sign-in and hidden from everyone.
- ✅ **Privacy Policy and Terms of Service pages** (web, all 5 languages), linked from register, the profile/settings screens and the store listings.
- ⬜ **Legal review** of the Privacy Policy and Terms. Fill in the controller's company name, address, contact email and DPO (if any).
- 🔄 **Age rating: 16+** (decided; matches the GDPR digital-consent age in Romania). ✅ "I'm 16 or older" checkbox at sign-up on web, iOS and Android, and the 16+ clause in Privacy and Terms, in all 5 languages. ⬜ Store questionnaires: App Store age rating **16+**, Google Play target audience **16+** only (no under-16 groups, so the Families policy doesn't apply).

### Auth
- ⬜ **Forgot password and reset**, by email link, with a deep link into the apps.
- ✅ **Email confirmation** using a real email provider (custom SMTP such as Resend or Postmark), with branded email templates in all 5 languages.
- ⬜ **Sign in with Apple.** Required on iOS if any other third-party login (Google) is offered.
- ⬜ **Google sign-in** (optional; the old app had it).
- ⬜ **Rate limits and CAPTCHA** on sign-up (Supabase Auth settings).

### Infrastructure and release
- ✅ **Git repository** and **Remote** (`unalome-ai/boolaa`). ⬜ and **CI**: build, lint and test all 3 apps, and run migrations against a fresh database.
- ✅ **Hosted Supabase project** (Zurich; `boolaa.ro`): run the migrations, set up the storage buckets, auth settings, backups (PITR) and the redirect URLs.
- ⬜ **Separate staging and production environments.** Never run `seed.sql` in production.
- ✅ **Domain**: landing page and web app (e.g. boolaa.app), with legal URLs that never change.
- ✅ **Web hosting** (DigitalOcean App Platform, Frankfurt), with environment variables and preview deploys.
- ⬜ **iOS**:
  - Apple Developer account, bundle ID, signing and the App Store Connect record.
  - Privacy "nutrition labels" and the `PrivacyInfo.xcprivacy` manifest.
  - TestFlight, then submission.
- 🔄 **Android: direct download from boolaa.ro (no Play Store)**:
  - ✅ Release signing key: `~/.boolaa-signing/boolaa-release.jks` (alias `boolaa`), password in the Keychain as `boolaa-android-keystore`. **Back up both** (e.g. 1Password). Losing the key means existing installs can never be updated.
  - ✅ A second Google OAuth Android client with the release SHA-1 `59:E9:05:80:E4:E7:05:75:D7:5B:CD:20:3F:09:5A:70:19:58:AF:9F`.
  - ⬜ Gradle `release` signing config (reads the Keychain/env, never committed), R8/minify, `versionCode` from CI.
  - ⬜ Download page `boolaa.ro/android`: the APK, version, size, SHA-256 of the file and of the signing certificate, and "allow installs from your browser" instructions in 5 languages. Host the APK on GitHub Releases or DO Spaces, not in the web build.
  - ⬜ In-app update check: the app reads `https://boolaa.ro/android/latest.json` (versionCode, url, sha256, minSupported) and prompts to download. Force an update below `minSupported`.
  - ⬜ Google **developer verification** for sideloaded apps: Google is phasing in a requirement that apps installed outside the Play Store come from a verified developer, country by country. Check the Romania/EU timeline and register in the Android Developer Console before it applies.
  - ⬜ Push via FCM still works (needs Google Play services on the device); no Play Console needed.
- ⬜ **App icons, splash screen, App Store screenshots and descriptions** in all 5 languages (iOS only; Android gets the download page instead).
- ⬜ **Error reporting** (Sentry or Crashlytics) and basic product analytics. Both must be covered by consent and by the privacy policy.

## P1: Core experience expected of a social app
- ✅ **Native Android app**, at parity with iOS.
- ✅ **Live membership** (pending screen, members list) and the remove-member UI.
- ⬜ **Push notifications** (APNs, FCM, Web Push) for new chat messages, join requests (to members), approval (to the requester), event reminders and new events. Includes per-bubble mute and notification settings.
- ⬜ **Invite links and universal/app links** (`https://boolaa.app/join/CODE`) that open the app or the store. Optionally a QR code.
- ⬜ **Chat**: load older messages, delete your own message, send photos, unread counts and a last-read marker.
- ⬜ **Live updates** for events, food, market and links, not only chat.
- ⬜ **Bubble logo/cover image**: upload and display.
- 🔄 **Modern visual redesign**: playful animations, haptics, a happy brand (Fable design pass).
- ⬜ **Native-speaker review** of the ro, fr, es and it translations.
- ⬜ **Accessibility pass**: Dynamic Type and font scaling, VoiceOver and TalkBack labels, contrast, reduced motion.
- ⬜ **Offline and poor-network handling**: cached last view, retry states.
- ⬜ **Image handling**: resizing and thumbnails (Supabase image transformations), size limits, and stripping EXIF location data.

## P2: Nice to have
- ⬜ Reactions on messages and posts.
- ⬜ Calendar export (.ics) and "Add to calendar" for events.
- ⬜ Marketplace "Reserved" and "Taken" states, and a "message the owner" shortcut.
- ⬜ Link previews (Open Graph title and image) for shared links.
- ⬜ Search inside a bubble.
- ⬜ Transfer ownership manually, and bubble roles (admins).
- ⬜ An in-app light/dark toggle on the web.
- ⬜ Data export (GDPR right of access): download everything about me as JSON or ZIP.

## Housekeeping
- ⬜ Delete the legacy Expo app (`apps/boolaa`), `docker-compose.yml` and `supabase/Dockerfile`, and rewrite the root README.
- ⬜ Remove the dead Unalome types in `packages/supabase-config`, or delete the package.
- ⬜ Upgrade the Supabase CLI (v2.75 → v3.x).
