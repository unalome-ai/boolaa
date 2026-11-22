# Boolaa: launch to-do list

Status: ✅ done · 🔄 in progress · ⬜ not started. Rows are grouped by phase. Everything in **P0** must be done before submitting to the App Store or Play Store or launching publicly.

## P0: Launch blockers

### Product and safety (store requirements)
- ✅ **Database (Supabase): account deletion** (`delete_my_account`).
- ✅ **Account deletion UI** (web, iOS, Android): a confirmation step, and the user's stored images are deleted first.
- ✅ **Database: block users**, two-way, enforced by the database's access rules (RLS), including live chat.
- ✅ **Database: report content and users** (`report_content`), into a moderation queue.
- ✅ **Report and block UI** on every message, post, item, event, link and member, plus a "Blocked users" list in the profile.
- 🔄 **Moderation process.** Apple requires acting on reports within 24 hours. ✅ Email alert per report to moderation@boolaa.ro (live), linking to the report in the admin view. ✅ Admin view at `/admin` (web, admins only, 404 for everyone else): queue with context, dismiss / delete content / remove from bubble / suspend 1-7-30 days / ban, user search and unsuspend, audit log (`moderation_actions`); local only so far. ⬜ Production rollout (`docs/moderation.md`: push the migration, insert the admin, redeploy `report-alert`, deploy web). ⬜ Daily queue check as a team habit.
- 🔄 **Suspended/banned accounts** (`users.status`): ✅ backend (RLS blocks inactive accounts, GoTrue `banned_until` blocks sign-in; content stays visible, a ban leaves every bubble) and the web suspended screen (5 languages). ⬜ Suspended screen in iOS and Android (`docs/moderation.md` → Clients). ✅ "Delete content" also deletes the post's photo (public buckets; `20261122210000_moderation_image_cleanup.sql`).
- ✅ **Privacy Policy and Terms of Service pages** (web, all 5 languages), linked from register, the profile/settings screens and the store listings.
- 🔄 **Legal texts**: ✅ rewritten for a private, not-for-profit individual controller (Bogdan Raduta), free/no ads/no AI training, Apache 2.0, Apple/Google sign-in, processors (Zurich/Frankfurt); no placeholders left. ⬜ Optional review by a lawyer, then remove the "Draft" banner.
- ⬜ **App Store EU "trader" status (DSA)**: App Store Connect asks before the first EU submission. Saying *trader* publishes the address, phone and email on the EU store page. A free, ad-free, non-profit app by an individual is likely a **non-trader**; decide deliberately before submitting.
- 🔄 **Age rating: 16+** (decided; matches the GDPR digital-consent age in Romania). ✅ "I'm 16 or older" checkbox at sign-up on web, iOS and Android, and the 16+ clause in Privacy and Terms, in all 5 languages. ⬜ Store questionnaires: App Store age rating **16+**, Google Play target audience **16+** only (no under-16 groups, so the Families policy doesn't apply).

### Auth
- 🔄 **Forgot password, emailed device codes, branded emails, age record**: ✅ backend live in production (2026-11-22: migrations, `send-email`/`device-code`/`report-alert` functions, Send Email + before-user-created hooks, 6-digit codes valid 10 min; flags `device_verification_enforced` and `age_confirmation_required` still **off**). ⬜ Client screens in web, iOS and Android (`docs/auth-security.md` §9), then turn the flags on.
- ✅ **Email confirmation** using a real email provider (custom SMTP such as Resend or Postmark), with branded email templates in all 5 languages.
- 🔄 **Sign in with Apple and Google**: ✅ Google (4 clients) and Apple (Services ID, key, secret) are enabled on production Supabase; see `docs/oauth-clients.md`. ⬜ Client buttons, plus the 16+ screen after the first OAuth sign-in. ⬜ **Renew the Apple secret before 2027-05-21** (`node scripts/apple-client-secret.mjs`).
- 🔄 **Rate limits and CAPTCHA** on sign-up: ✅ rate limits set (emails 100/h, 60 s per user). ⬜ Cloudflare Turnstile CAPTCHA.

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
- ⬜ **Invite links and universal/app links** (`https://boolaa.ro/join/CODE`) that open the app or the store. Optionally a QR code.
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
- ⬜ Delete the legacy Expo app (`apps/boolaa`), `docker-compose.yml` and `supabase/Dockerfile`. ✅ Root README rewritten; repo public (Apache 2.0).
- ⬜ Remove the dead Unalome types in `packages/supabase-config`, or delete the package.
- ⬜ Upgrade the Supabase CLI (v2.75 → v3.x).
