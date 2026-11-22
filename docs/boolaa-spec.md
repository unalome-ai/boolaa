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
- **Live feeds** (migration `20261123110000_realtime_feeds.sql`): `events` (RSVPs arrive as an UPDATE of the event's `rsvp_list`), `food_posts`, `market_items` and `shared_links` are in `supabase_realtime` too. The Events, Food, Marketplace and Links screens subscribe while shown, on one channel per screen named `<table>:<bubble id>`:
  - INSERT and UPDATE with the filter `bubble_id=eq.<current bubble>`. Realtime checks them against the subscriber's SELECT policies, so blocked authors, other bubbles and unverified sessions (`require_verified_session`) get nothing.
  - DELETE unfiltered (Realtime can't filter deletes and, with RLS on, sends only the primary key): remove the row by id and ignore ids the list doesn't hold. The tables keep the default replica identity.
  - A new id is fetched once with its author join (RLS decides again). An UPDATE of a row in the list is merged in place, keeping the joined author. Merges are by id, so the echo of the client's own write changes nothing, and lists keep their sort order (events by `datetime`, the rest newest first).
  - Once the subscription is live the screen reloads once, to catch changes made while connecting. Subscriptions end when the screen goes away, the bubble changes or the user signs out.
- **Push notifications** (`docs/push-notifications.md`): clients call `register_push_token(...)` after the device check and on every start, and `unregister_push_token(p_token)` before signing out. They read and update their own `notification_prefs` row (master switch, per type, `preview_content`) and `bubble_mutes` rows. Pushes carry `{type, bubble_id, target_id}` for deep links.
- `reject_join_request(p_request_id)` takes the request id and returns nothing.
- `toggle_rsvp(p_event_id)` returns the new `rsvp_list`.

Embedding author info: `select('*, author:users!<fk_column>(id, name, avatar)')`, e.g. `sender:users!sender_id(...)`, `creator:users!creator_id(...)`, `owner:users!owner_id(...)`, `user:users!user_id(...)`.

Storage: the public buckets are `avatars`, `food.images` and `market.images`. Object path **must** be `<auth uid>/<uuid>.<ext>` (enforced by policy). Store the public URL in the row.

### Images
Every client runs a picked photo through the same pipeline before upload (web `src/lib/image.ts`, iOS and Android `ImageCompression`):
- **Decode, then make upright**: apply the EXIF orientation to the pixels (web `createImageBitmap(..., {imageOrientation: "from-image"})`, iOS ImageIO thumbnail with transform, Android `ExifInterface` + matrix).
- **Downsize**: long edge at most **1600 px** (avatars **512 px**), aspect ratio kept, never upscaled. Rounding is `round(side * maxSide / longEdge)`, so all clients produce the same size (e.g. 4032x3024 → 1600x1200; the shared fixture `exif-gps.jpg` → 1067x1600, avatar 341x512).
- **Re-encode as JPEG, quality 0.82**, on a white background (transparent PNG areas don't turn black). Upload as `<uid>/<uuid>.jpg` with `content-type: image/jpeg`. WebP is not used: Safari's canvas can't encode it.
- **No metadata**: only pixels reach the encoder, so EXIF, GPS location, camera, XMP and IPTC from the source are gone. iOS and Android also drop any APP1–APP15/COM segment the encoder writes itself (ImageIO adds a small Exif and Photoshop block). Each platform's tests check the uploaded bytes for this.
- **Limits** (`20261123100000_image_limits.sql`, checked by Storage on upload only, so older objects keep loading): `avatars` 2 MB, `food.images` and `market.images` 5 MB; MIME types `image/jpeg` and `image/webp` only. Clients refuse inputs above 50 MB before decoding.
- **Errors** (glossary, "Image upload errors"): too large (client check, or Storage `statusCode` 413 / `EntityTooLarge`) → `imageTooLarge`; undecodable file, or Storage 415 / `invalid_mime_type` → `imageUnsupported`. Storage answers both with HTTP 400 locally and 413/415 hosted.
- **Thumbnails**: none. Supabase image transformations are a paid feature, and a `_thumb` variant would double the uploads and the deletion paths (replace, delete, account deletion, moderation cleanup). Lists show the same image, sized by CSS / native views and loaded lazily; a 1600 px JPEG is a few hundred KB.

Local dev: `supabase start` serves the API at `http://127.0.0.1:55321`. `supabase status -o env` prints `ANON_KEY` / `PUBLISHABLE_KEY`. The seeded logins are `alice@boolaa.test`, `bob@boolaa.test` and `carol@boolaa.test`, all with password `password123`. Alice and Bob share the "Flatmates" bubble (invite `FLAT2026`) and "Climbing Crew" (invite `CLIMB123`). Carol has a pending request for Flatmates.

### Safety and account (App Store guidelines 1.2 and 5.1.1(v))
- **Block**: `insert into blocks (blocker_id = me, blocked_id)`, and unblock by deleting your own row. `select` returns only the user's own block list.
  - Blocking is two-way and enforced by RLS: neither side sees the other's chat, events, food, market items or links, live updates included.
  - Members lists still show blocked people, so you can unblock them.
- **Report**: `report_content(p_target_type, p_target_id, p_reason, p_details)`.
  - Target types: `user`, `chat_message`, `event`, `food_post`, `market_item`, `shared_link`.
  - Reasons: `spam`, `harassment`, `hate`, `sexual`, `violence`, `self_harm`, `other`.
  - The server works out the author and bubble. Errors: `cannot report yourself`, `report target not found`.
  - Reports go to a moderation queue that only admins (`public.admins`, through the admin RPCs) and the service role can read. Each report emails moderation@boolaa.ro with a link to `/admin`.
  - After reporting, offer "Also block <name>?".
- **Delete account**: `delete_my_account()`. First list and remove every object under `<uid>/` in `avatars`, `food.images` and `market.images`, ignoring failures. Then call the RPC and sign out locally.
  - The deletion cascades to the user's profile, memberships and all their content. Owned bubbles pass to the next member, and bubbles left empty are deleted.
  - The UI must warn clearly that this can't be undone and ask for a confirmation step.
- **Suspended or banned accounts** (`users.status`: `active` / `suspended` / `banned`, plus `status_reason`, `status_until`, `status_changed_at`). Moderators set them from the web admin view (`/admin`, see `docs/moderation.md`).
  - An inactive account (banned, or suspended with `status_until` null or in the future) reads nothing and can't post or call RPCs (`account suspended`). It can still read its own `users` row and call `delete_my_account()`. A suspension ends by itself at `status_until`.
  - Sign-in and token refresh fail with the Auth error code `user_banned` while it lasts.
  - Every client shows a **suspended screen** instead of the app: title, "You can use Boolaa again from <date>" (suspended), the reason (report-reason labels), an appeal link to privacy@boolaa.ro, and sign out. On `user_banned` at sign-in, show it without date or reason. Texts: `suspended.*` in the web's `messages/*.json`.
  - Their posts stay visible to their bubbles; a ban also removes them from every bubble.

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
7. **Events**: "My events" and "Bubble events" sections sorted by date. Create, edit and delete your own events (title, description, date and time, location). RSVP toggle with a count. Other members' events and RSVPs update live.
8. **Food Circle**: "My posts" and "From the bubble" sections. Create and edit (photo upload, description) and delete your own. Other members' posts appear, change and disappear live.
9. **Marketplace**: grid of items with a Free/Trade badge and filter chips (All/Free/Trade). Create, edit and delete your own (photo, title, description, status). Updates live.
10. **Links** (opened from Home and Settings): add a URL with a title and comma-separated tags, filter by tag, open the link, delete your own. Updates live.
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
