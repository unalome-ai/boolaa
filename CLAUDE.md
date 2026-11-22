# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Direction (Nov 2026)

Boolaa is being rebuilt as a **native SwiftUI iOS app** (`apps/boolaa-ios`), a **native Kotlin/Jetpack Compose Android app** (`apps/boolaa-android`) and a **Next.js web app** (`apps/boolaa-web`), all talking straight to Supabase. All three ship in **en, ro, fr, es, it**. `docs/i18n-glossary.md` fixes the product terms, the informal tone, the plural and diacritic rules and how backend errors are mapped. Every new user-visible string needs all 5 languages. The Expo app in `apps/boolaa` stays only as a visual and behavioural reference until both new apps reach parity, and then it gets deleted. Don't add features to it.

- **Product spec**: `docs/boolaa-spec.md` lists the screens, flows and visual language, and summarizes the backend contract. Keep both clients in step with it.
- **Backend contract**: `supabase/migrations/*.sql` holds the tables, RLS policies and RPCs. Membership changes go only through RPCs (`create_bubble`, `request_to_join`, `approve_join_request` (majority vote), `reject_join_request`, `remove_member` (owner only), `toggle_rsvp`). After a member is removed, a trigger hands ownership to the oldest member, deletes a bubble once it has no members, and admits queued requests that now have a majority. `try_admit_join_request` is internal only. Change the schema with a new migration, never by editing an applied one. Then regenerate the web types with `yarn db:types`.
- **Fixed names**: the Expo app's queries use a `profiles` table and a `desc` column. The real names are `users` and `description`.
- **Storage**: the buckets are `avatars`, `food.images` and `market.images`. Object paths must start with `<auth uid>/`, which RLS enforces.

## Local Supabase

`supabase start` / `yarn db:start` runs on the **553xx ports** (API `http://127.0.0.1:55321`, DB `55322`, Studio `55323`, Mailpit `55324`), because CleanMyMac holds 54321. `yarn db:reset` re-applies the migrations and `supabase/seed.sql`. `supabase status -o env` prints the keys. Seeded logins are `alice@`, `bob@` and `carol@boolaa.test`, all with password `password123`. To check RLS in SQL, set `role authenticated` and `request.jwt.claims` with `sub` in a transaction.

The old root `docker-compose.yml` and `supabase/Dockerfile` predate the CLI project and are superseded by it.

## Repository layout and actual state

The root `package.json` yarn workspace covers only `apps/boolaa` and `packages/*`. `boolaa-web` uses npm with its own lockfile, so it doesn't hoist Expo's React and React Native versions.

The root README is outdated. It mentions an Unalome app (it doesn't exist) and a `schema.sql` (replaced by migrations). The Unalome types in `packages/supabase-config` are dead code.

- The root directory is **not** a git repo. `apps/boolaa` has its own `.git`.
- `node_modules` is not installed. Run `yarn install` at the root first.
- `packages/supabase-config/index.ts` holds the shared row types (`Boolaa*`, `Unalome*`). Its client uses placeholder strings for URL and key, and Boolaa does not import it. Boolaa only gets `@supabase/supabase-js` and `@react-native-async-storage/async-storage` because yarn hoists this workspace's dependencies (Boolaa's own `package.json` doesn't list them).

## Commands

**Web** (`apps/boolaa-web`, npm). Run `npm run dev -- -p 3100`, plus `npm run build`, `npm run lint`, `npm run typecheck` and `npm run test:e2e` (Playwright against the local Supabase). To run one test: `npx playwright test tests/smoke.spec.ts -g "carol"`. Some Next 16 details matter here:
- The middleware file is `src/proxy.ts`.
- Pages are thin server wrappers around a client-side `view.tsx` and export `instant = false`.
- The current bubble is stored in the `boolaa_bubble` cookie.
- Visited routes stay mounted but hidden, so Playwright selectors must be scoped to the visible page.

**iOS** (`apps/boolaa-ios`). The project is generated with xcodegen and the `.xcodeproj` is gitignored, so edit `project.yml` and then run `xcodegen generate`. Build and test with `xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -destination 'platform=iOS Simulator,id=<UDID>' build|test`. To run one target or test, add `-only-testing:BoolaaTests/<Suite>`. Use `id=` rather than `name=`, because simulator names are duplicated on this machine. To view a simulator, run `open -a DeviceHub`; Xcode 27 replaced Simulator.app with DeviceHub. Other details:
- Supabase settings live in `Config/Local.xcconfig` (gitignored). Write the URL as `http:/$()/…`, because xcconfig treats `//` as a comment.
- The project uses Swift 6 strict concurrency.
- The DEBUG-only launch arguments are listed in `Boolaa/App/DebugHooks.swift`. For example, `-UITestAutoLogin` signs in automatically.

**Legacy Expo app**, from the repo root:
```sh
yarn install
yarn boolaa start        # same as: cd apps/boolaa && yarn start (expo start)
yarn boolaa ios | android | web
yarn boolaa lint         # expo lint (eslint-config-expo flat config)
npx tsc --noEmit -p apps/boolaa   # type-check (strict mode)
```
There is no test framework or test script.

## Environment

`apps/boolaa/.env` must define `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, which `apps/boolaa/supabaseClient.ts` reads. The README's `SUPABASE_URL` / `SUPABASE_ANON_KEY` names are outdated. Expo only exposes vars with the `EXPO_PUBLIC_` prefix.

## Legacy Expo app architecture (`apps/boolaa`, reference only)

An invite-only "bubble" social app: small groups with chat, events, a food circle, a marketplace and shared links. It uses Expo SDK 53, expo-router v5 (file-based, typed routes), React 19, RN 0.79 with the new architecture enabled, and the `@/*` path alias pointing at the app root.

**Providers** (`app/_layout.tsx`): `AuthProvider` wraps `BubbleProvider`, which wraps `ThemeProvider` and then a root `Stack` with three route groups.
- `AuthContext.tsx`: the Supabase session plus `userProfile` (row in the `users` table) and `joinedBubbles` (`bubble_members` where `approved = true`, joined to `bubbles`). Sign-in, sign-up and auth-state changes all refetch both.
- `BubbleContext.tsx`: `currentBubble`, which defaults to the first joined bubble and resets when the user or `joinedBubbles` changes, plus `join_requests` for that bubble. **Every feature screen scopes its queries by `currentBubble.id`.**

**Route groups** (`app/`):
- `(auth)`: login, register, profile-settings, and `callback` (the deep-link target, scheme `boolaa://`). The index redirects to login.
- `(onboarding)`: create-or-join-bubble and bubble-approval. The index redirects to create-or-join-bubble.
- `(main)`: a `Tabs` navigator with a custom pill tab bar (home, events, food, marketplace, settings), a custom header with a horizontal bubble switcher and profile sheet, and a floating chat button. `chat`, `links` and `index` are hidden from the tab bar with `href: null`. To add a visible tab, update both `MAIN_TABS` and the `<Tabs.Screen>` list in `app/(main)/_layout.tsx`.
- There's no root `app/index.tsx` and no central auth guard. Screens redirect themselves (for example, login sends the user to `/(main)/home`).

**Supabase usage** (queries live inline in screens and components, with no data layer):
- Tables: `users`, `bubbles`, `bubble_members`, `join_requests`, `chat_messages`, `events`, `food_posts`, `market_items`. The row shapes are in `packages/supabase-config/index.ts`.
- Realtime: `app/(main)/chat.tsx` subscribes to channel `public:chat_messages`.
- Storage: `components/FoodSheet.tsx` uploads to bucket `food.images` and uses public URLs.
- Bottom sheets (`FoodSheet`, `EventSheet`, `ProfileSettingsSheet`) handle create and edit flows.

**Styling**: mostly inline styles and `StyleSheet`, with brand purple `#9D78BD` and dark mode via `useColorScheme`. The `Themed*`, `ParallaxScrollView`, `HelloWave` and `Collapsible` components are leftovers from the create-expo-app template.
