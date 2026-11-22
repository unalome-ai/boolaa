# Boolaa

**Your people, in one cosy bubble.** Boolaa is a small, private, invite-only space for flatmates, friends and clubs. It has chat, events, a Food Circle for sharing leftovers, a marketplace for swapping things, and shared links. Everything lives inside a *bubble* of people you actually know.

- **Free.** No ads, no fees, no tracking. User data is never sold or used to train AI.
- **Private.** Bubbles are invite-only. New members are admitted by majority vote, and access control is enforced in the database with row-level security.
- **In 5 languages:** English, Română, Français, Español, Italiano.
- Made with joy by Bogdan Raduta as a non-profit, personal project. Live at **[boolaa.ro](https://boolaa.ro)**.

## Apps

| Path | What | Stack |
|---|---|---|
| `apps/boolaa-web` | Landing page and web app (boolaa.ro) | Next.js, TypeScript, Tailwind, next-intl, Playwright |
| `apps/boolaa-ios` | Native iOS app | SwiftUI, supabase-swift, String Catalogs (xcodegen) |
| `apps/boolaa-android` | Native Android app (downloaded from boolaa.ro) | Kotlin, Jetpack Compose, supabase-kt |
| `supabase/` | Backend: schema, RLS, RPCs, Edge Functions, tests | Supabase (Postgres, Auth, Storage, Realtime) |
| `apps/boolaa` | Legacy Expo prototype, kept as a reference only | Expo / React Native |

## Docs

- [`docs/boolaa-spec.md`](docs/boolaa-spec.md): product spec and backend contract
- [`docs/design-system.md`](docs/design-system.md): the "Soft pop" design system
- [`docs/auth-security.md`](docs/auth-security.md): emailed device codes, OTP reset, OAuth, age confirmation
- [`docs/moderation.md`](docs/moderation.md): reports and moderation alerts
- [`docs/i18n-glossary.md`](docs/i18n-glossary.md): translation glossary
- [`docs/TODO.md`](docs/TODO.md): launch to-do list
- [`CLAUDE.md`](CLAUDE.md): developer notes (commands, local setup, gotchas)

## Run it locally

You need Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker.

```sh
supabase start            # local stack on ports 553xx (API http://127.0.0.1:55321)
supabase db reset         # apply migrations and seed data
cd apps/boolaa-web && cp .env.example .env.local && npm install && npm run dev -- -p 3100
```

Seeded logins (local only): `alice@boolaa.test`, `bob@boolaa.test` and `carol@boolaa.test`, password `password123`. For iOS and Android setup, see `CLAUDE.md` and each app's README.

## Security

Please report vulnerabilities privately to **privacy@boolaa.ro**, not in public issues.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Bogdan Raduta.
