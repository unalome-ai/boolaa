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

## How it fits together

- `src/proxy.ts` (Next 16's name for middleware) refreshes the Supabase session cookies on every
  request and gates routes: signed out -> `/login`; signed in with no approved bubble -> `/onboarding`.
- Pages under `src/app/(main)` are client components (`view.tsx`) that query Supabase with the
  browser client from `src/lib/supabase/client.ts`, so RLS applies and realtime works. Each
  `page.tsx` is a thin server wrapper that sets the translated page title (`generateMetadata`).
  Cache Components is off: the root layout reads the locale cookie to render `<html lang>`.
- The current bubble is stored in the `boolaa_bubble` cookie (`BoolaaProvider`).
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
