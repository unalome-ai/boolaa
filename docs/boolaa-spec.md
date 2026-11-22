# Boolaa product spec (native iOS + web)

Boolaa is a private, invite-only social app built around **bubbles**: small groups (2–150 people, default 12) of flatmates, friends or clubs. Everything a user sees is scoped to the **current bubble**, which they switch between in the header.

Both clients (`apps/boolaa-ios` SwiftUI, `apps/boolaa-web` Next.js) talk directly to Supabase. The backend contract is `supabase/migrations/*.sql`: tables, RLS policies and RPCs. Clients never bypass RLS. Membership changes only go through RPCs. The legacy React Native app in `apps/boolaa` is a visual and behavioural reference only, and its schema mistakes (`profiles` vs `users`, `desc` vs `description`) are fixed in the migration.

## Backend contract summary

| Table | Columns clients use | Writes |
|---|---|---|
| `users` | id, name, avatar | update own row (name, avatar) |
| `bubbles` | id, name, description, logo, max_size, invite_code, created_by | via `create_bubble`; owner may update name/description |
| `bubble_members` | user_id, bubble_id, approved, role (`owner`/`member`) | delete own row = leave bubble |
| `join_requests` | id, user_id, bubble_id, approver_ids[] | via `request_to_join` / `approve_join_request` / `reject_join_request`; requester may delete own (cancel) |
| `chat_messages` | id, bubble_id, sender_id, content, created_at | insert own; realtime INSERT feed filtered by `bubble_id=eq.<id>` |
| `events` | id, bubble_id, creator_id, title, description, datetime, location, rsvp_list[] | CRUD own; RSVP via `toggle_rsvp(p_event_id)` |
| `food_posts` | id, bubble_id, user_id, image, description | CRUD own |
| `market_items` | id, bubble_id, owner_id, image, title, description, status (`free`/`trade`) | CRUD own |
| `shared_links` | id, bubble_id, user_id, url, title, tags[] | CRUD own |

The RPCs, called with named params:
- `create_bubble(p_name, p_description, p_max_size)` returns the bubble row, and the caller becomes its owner.
- `request_to_join(p_invite_code)` returns the join_request row. It raises `invalid invite code`, `already a member` or `bubble is full`.
- `approve_join_request(p_request_id)` returns a bool: true when the requester was admitted. A requester is admitted when approvals from **current** members exceed half the approved members **and** there is a free seat. If the bubble is full, the approval is kept and the requester is admitted automatically when a seat frees up. It never raises `bubble is full`.
- `remove_member(p_bubble_id, p_user_id)` is owner-only. It raises `only the owner can remove members`, `use leave to remove yourself` or `member not found`.
- **When a member leaves or is removed**, the database cleans up automatically:
  - If the owner left, ownership passes to the longest-standing member.
  - A bubble with no members left is deleted.
  - The departed member's votes are removed.
  - Queued requests that now have a majority are admitted.
- **Realtime tables**: `chat_messages`, `join_requests` and `bubble_members`. Pending screens and Settings should subscribe to them instead of polling.
- `reject_join_request(p_request_id)` takes the request id and returns nothing.
- `toggle_rsvp(p_event_id)` returns the new `rsvp_list`.

Embedding author info: `select('*, author:users!<fk_column>(id, name, avatar)')`, e.g. `sender:users!sender_id(...)`, `creator:users!creator_id(...)`, `owner:users!owner_id(...)`, `user:users!user_id(...)`.

Storage: the public buckets are `avatars`, `food.images` and `market.images`. Object path **must** be `<auth uid>/<uuid>.<ext>` (enforced by policy). Store the public URL in the row.

Local dev: `supabase start` serves the API at `http://127.0.0.1:55321`. `supabase status -o env` prints `ANON_KEY` / `PUBLISHABLE_KEY`. The seeded logins are `alice@boolaa.test`, `bob@boolaa.test` and `carol@boolaa.test`, all with password `password123`. Alice and Bob share the "Flatmates" bubble (invite `FLAT2026`) and "Climbing Crew" (invite `CLIMB123`). Carol has a pending request for Flatmates.

### Safety and account (App Store guidelines 1.2 and 5.1.1(v))
- **Block**: `insert into blocks (blocker_id = me, blocked_id)`, and unblock by deleting your own row. `select` returns only the user's own block list.
  - Blocking is two-way and enforced by RLS: neither side sees the other's chat, events, food, market items or links, live updates included.
  - Members lists still show blocked people, so you can unblock them.
- **Report**: `report_content(p_target_type, p_target_id, p_reason, p_details)`.
  - Target types: `user`, `chat_message`, `event`, `food_post`, `market_item`, `shared_link`.
  - Reasons: `spam`, `harassment`, `hate`, `sexual`, `violence`, `self_harm`, `other`.
  - The server works out the author and bubble. Errors: `cannot report yourself`, `report target not found`.
  - Reports go to a moderation queue that only the service role can read.
  - After reporting, offer "Also block <name>?".
- **Delete account**: `delete_my_account()`. First list and remove every object under `<uid>/` in `avatars`, `food.images` and `market.images`, ignoring failures. Then call the RPC and sign out locally.
  - The deletion cascades to the user's profile, memberships and all their content. Owned bubbles pass to the next member, and bubbles left empty are deleted.
  - The UI must warn clearly that this can't be undone and ask for a confirmation step.

## Screens and flows

1. **Auth**: login (email and password) and register (name, email, password), with the name passed as sign-up metadata `{ name }`. Register requires the **"I'm 16 or older"** checkbox and links to Terms and Privacy: Boolaa is rated **16+**. Sign out lives in the profile sheet.
2. **Routing gate**: signed out goes to Auth. Signed in with 0 approved bubbles goes to Onboarding. Otherwise the user lands in Main.
3. **Onboarding**:
   - **Create a bubble**: name, description, max size.
   - **Join a bubble**: invite code.
   - **Pending approval**: the user's pending requests, each showing its bubble name and approvals so far, with a cancel button. Refreshes periodically or on pull.
4. **Main shell**:
   - **Header**: large screen title, avatar button (opens the profile sheet), and a horizontal bubble-switcher chip row with a "+ New" chip that opens create or join.
   - **Tabs**: Home, Events, Food Circle, Marketplace, Settings.
   - **Chat**: a floating chat button on every tab.
5. **Home**: a combined, recency-sorted feed for the current bubble: latest chat messages, food posts, market items, upcoming events and links. Each card deep-links to its section.
6. **Chat**: messages in chronological order with sender avatar and name. Your own messages are aligned right. Realtime inserts, auto-scroll to the newest message, composer at the bottom.
7. **Events**: "My events" and "Bubble events" sections sorted by date. Create, edit and delete your own events (title, description, date and time, location). RSVP toggle with a count.
8. **Food Circle**: "My posts" and "From the bubble" sections. Create and edit (photo upload, description) and delete your own.
9. **Marketplace**: grid of items with a Free/Trade badge and filter chips (All/Free/Trade). Create, edit and delete your own (photo, title, description, status).
10. **Links** (opened from Home and Settings): add a URL with a title and comma-separated tags, filter by tag, open the link, delete your own.
11. **Settings** (for the current bubble):
    - Bubble name and description, which the owner can edit.
    - **Invite code** with copy and share buttons.
    - **Members** list with an owner badge.
    - **Pending join requests**: requester, approvals so far versus members needed, and approve and reject buttons. Hide approve if you already approved.
    - **Leave bubble** with a confirmation step.
12. **Profile sheet**: avatar (upload or replace), editable name, email (read-only), sign out.

## Visual language

The full design system (colour, typography, layout, motion, components, voice) is in `docs/design-system.md`. In short:

- **Colours**: brand purple "grape" `#7357F6` (evolved from `#9D78BD` / `#7B61FF`) with a joyful secondary palette (coral, mint, sky, sunny, pink, tangerine, indigo). Each bubble gets its own colour, derived from its id; each feature has its own colour (chat grape, events coral, food tangerine, marketplace mint, links sky). Light background `#FBF8FF`, dark background `#15111F` with dark cards `#221C33`.
- **Navigation**: a floating dock: a rounded "pill" tab bar with circular icon buttons (the active one is filled with the tab's colour and slides between tabs) and, beside it, the round chat button, a glossy purple 60pt bubble.
- **Shapes**: glossy bubbles, pills and rounded cards (24pt radius) with soft purple-tinted shadows. Avatars are circles; users without a photo get initials on their own colour.
- **Motion**: springy and quick, with still fallbacks under Reduce Motion.
