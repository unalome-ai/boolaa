# Boolaa web

Next.js (App Router, TypeScript, Tailwind v4) client for Boolaa. It talks directly to Supabase; the
contract is `../../supabase/migrations/*.sql` and the product spec is `../../docs/boolaa-spec.md`.
This app is a standalone npm project (it is not part of the root yarn workspace).

## Setup

```bash
# from the repo root: local Supabase must be running
supabase start
supabase status -o env            # copy API_URL and ANON_KEY

cd apps/boolaa-web
cp .env.example .env.local        # fill NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
```

Seeded logins (password `password123`): `alice@boolaa.test`, `bob@boolaa.test`, `carol@boolaa.test`.

## Run

```bash
npm run dev -- -p 3100            # http://localhost:3100
npm run build && npm start        # production build
npm run lint && npm run typecheck   # lint also runs the i18n check
npm run i18n:check                # message files only
```

Regenerate DB types after a migration change (from the repo root):

```bash
supabase gen types typescript --local > apps/boolaa-web/src/lib/database.types.ts
```

## Test

```bash
npx playwright install chromium   # once
npm run test:e2e                  # reuses a dev server on :3100, or starts one
```

`tests/smoke.spec.ts` covers login, chat + realtime (second browser as Bob), bubble switching,
events + RSVP, marketplace upload, links and Carol's pending-approval screen. `tests/flows.spec.ts`
registers two throwaway users (create bubble, join, approve, leave). Test data is deleted afterwards;
deleting uploads and auth users needs the local service-role key, which the tests read from
`SUPABASE_SERVICE_ROLE_KEY` or from `supabase status` (the flows test is skipped without it).
`tests/i18n.spec.ts` covers Accept-Language/cookie resolution, switching to Romanian in the profile
sheet (reload + session kept) and a per-locale pass over `/settings` that fails on any English string.
Selectors use ids, test ids and roles, never UI copy, so tests run in any locale (default `en-US`).
`tests/membership.spec.ts` (three throwaway users, bubble of 2) covers live approval from the pending
screen, "waiting for a free spot" in a full bubble, ownership hand-over and auto-admission when the
owner leaves, and removal (bounced to onboarding, or to the next bubble with a notice).
`tests/storage.spec.ts` checks that deleting/replacing photos removes the old files. Throwaway users
get unique per-run names; only they are deleted (service-role key), never seeded data.

## How it fits together

- `src/proxy.ts` (Next 16's name for middleware) refreshes the Supabase session cookies on every
  request and gates routes: signed out -> `/login`; signed in with no approved bubble -> `/onboarding`.
- Pages under `src/app/(main)` are client components (`view.tsx`) that query Supabase with the
  browser client from `src/lib/supabase/client.ts`, so RLS applies and realtime works. Each
  `page.tsx` is a thin server wrapper that sets the translated page title (`generateMetadata`).
  Cache Components is off: the root layout reads the locale cookie to render `<html lang>`.
- The current bubble is stored in the `boolaa_bubble` cookie (`BoolaaProvider`).
- Realtime (`src/lib/realtime.ts` `liveChannel`): chat, `/onboarding` pending requests, Settings
  (requests and members) and the provider's own membership subscribe to `postgres_changes`. A channel
  counts as live only after the server's `system` ack (not just `SUBSCRIBED`, which can precede the
  change stream); the view reloads at that point to catch anything in between, and on window focus.
  DELETE events carry only the primary key and can't be filtered, so they're matched client-side.
- Routes: `/login`, `/register`, `/onboarding`, `/home`, `/chat`, `/events`, `/food`,
  `/marketplace`, `/links`, `/settings`.

## Languages (i18n)

English, Romanian, French, Spanish and Italian, with [next-intl](https://next-intl.dev) in
"without i18n routing" mode (URLs carry no locale). Terms follow `docs/i18n-glossary.md`.

- Locale: `boolaa_locale` cookie, else the best `Accept-Language` match, else `en`
  (`src/i18n/config.ts`, `src/i18n/request.ts`). The root layout sets `<html lang>`.
- Pickers: the profile sheet (`LocalePicker`, names in their own language) and a compact select on
  `/login`, `/register` and `/onboarding`. Choosing one writes the cookie and calls `router.refresh()`;
  the Supabase session is untouched.
- Messages: `messages/{en,ro,fr,es,it}.json`, English is the source. Plurals use ICU
  (`{count, plural, one {...} few {...} other {...}}`; Romanian needs `few`).
  Keys are type-checked (`src/global.d.ts`).
- Backend errors: `src/i18n/errors.ts` maps RPC messages, GoTrue codes, RLS (42501) and network
  failures to `errors.*` keys; anything unknown shows `errors.generic`.
- Dates, times and numbers: `src/i18n/format.ts` (`useFormat`), in the browser's time zone.
- `scripts/i18n-check.mjs` (run by `npm run lint`) fails on missing/extra keys, invalid ICU,
  arguments that differ from English, missing plural categories, cedilla ş/ţ in Romanian, and values
  left identical to English (allow-list in the script).

To add a string: add it to `messages/en.json`, then the same key to every other file, and run
`npm run i18n:check`.

## Safety, account and public pages

- **Report / block** (`src/components/safety.tsx`): a "…" menu on other people's chat messages, events,
  food posts, market items, links and members. Report = 7 reasons + optional details via
  `report_content`, then "Also block <name>?". Blocking inserts into `blocks`; RLS hides both sides'
  content (live feeds too) and views also filter instantly. Blocked users + Unblock live in the
  profile sheet.
- **Delete account** (profile sheet): warning + typed localized confirm word, then removes every object
  under `<uid>/` in the 3 buckets, calls `delete_my_account()`, signs out locally and goes to `/`.
- **Landing** at `/` for signed-out visitors (signed-in users are redirected by the proxy). Styles go
  through the `--landing-*` tokens in `globals.css`; motion uses CSS scroll timelines and is disabled
  under `prefers-reduced-motion`. SEO: metadata/Open Graph, `icon.svg`, `opengraph-image`,
  `sitemap.xml`, `robots.txt` (set `NEXT_PUBLIC_SITE_URL` in production).
- **/privacy and /terms**: text in `content/legal/<locale>.json` (sections, "- " bullets, `[...]`
  placeholders highlighted), marked as a draft pending legal review. `?lang=xx` overrides the locale
  and sets the cookie (handled in the proxy), for links from the mobile apps.
- `/register` requires a 16+ checkbox and links the Terms and Privacy Policy.

Tests: `tests/landing.spec.ts` (landing, redirect, legal pages per locale) and `tests/safety.spec.ts`
(report + also block, unblock, delete account incl. images and auth user), all with throwaway users.
