# Mobile Apps Monorepo

This monorepo contains two Expo (React Native) apps powered by Supabase:

- **Unalome**: A 7-day AI-powered journaling journey (apps/unalome)
- **Boolaa**: Private social networking with invite-only group chats (apps/boolaa)

## Prerequisites
- [Node.js](https://nodejs.org/) (18+ recommended)
- [Yarn](https://classic.yarnpkg.com/en/docs/install/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Supabase](https://supabase.com/) project (free tier is fine)

## Setup
1. **Clone the repo**
2. **Install dependencies**
   ```sh
   yarn install
   ```
3. **Configure Supabase**
   - Copy `.env.example` to `.env` in each app and fill in your Supabase project URL and anon key.
   - Run the SQL in `supabase/schema.sql` in your Supabase SQL editor to set up tables and policies.

4. **Start an app**
   ```sh
   cd apps/unalome   # or cd apps/boolaa
   yarn start        # or npm run start
   ```

## Environment Variables
Each app expects a `.env` file with:
```
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Project Structure
```
mobile_apps/
  apps/
    unalome/    # Journaling app
    boolaa/     # Social app
  packages/
    supabase-config/  # Shared Supabase client/types
  supabase/
    schema.sql  # Database schema for both apps
```

## Supabase Setup
- Create a project at [supabase.com](https://supabase.com/)
- Get your project URL and anon key from Project Settings > API
- Run the SQL in `supabase/schema.sql` in the SQL editor
- Enable email auth in Supabase Auth settings

## Development
- Both apps use TypeScript, React Navigation, and Supabase-js
- Shared Supabase config/types are in `packages/supabase-config`
- Use Expo Go or a simulator to run the apps

## Expanding
- See code comments for where to add features (AI, chat, feeds, etc.)
- Each screen is scaffolded for rapid development

---
MIT License 