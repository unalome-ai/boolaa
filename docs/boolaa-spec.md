# Boolaa product spec (native iOS + web)

Boolaa is a private, invite-only social app built around **bubbles**: small groups (2–150 people, default 12) of flatmates, friends or clubs. Everything a user sees is scoped to the **current bubble**, which they switch between in the header.

Both clients (`apps/boolaa-ios` SwiftUI, `apps/boolaa-web` Next.js) talk directly to Supabase. The backend contract is `supabase/migrations/*.sql`: tables, RLS policies and RPCs. Clients never bypass RLS. Membership changes only go through RPCs. The legacy React Native app in `apps/boolaa` is a visual and behavioural reference only, and its schema mistakes (`profiles` vs `users`, `desc` vs `description`) are fixed in the migration.

## Backend contract summary

| Table | Columns clients use | Writes |
|---|---|---|
| `users` | id, name, avatar | update own row (name, avatar) |
| `bubbles` | id, name, description, logo, max_size, invite_code, created_by | via `create_bubble`; whoever `can_manage_bubble(id)` (today the owner) may update name, description and logo; no other column is writable by clients |
| `bubble_members` | user_id, bubble_id, approved, role (`owner`/`member`) | delete own row = leave bubble |
| `join_requests` | id, user_id, bubble_id, approver_ids[] | via `request_to_join` / `approve_join_request` / `reject_join_request`; requester may delete own (cancel) |
| `chat_messages` | id, bubble_id, sender_id, content, image_path, deleted_at, created_at | insert own (text and/or photo); delete own via `delete_chat_message`; read pages via `chat_messages_page`; realtime INSERT + UPDATE filtered by `bubble_id=eq.<id>` (see Chat) |
| `chat_reads` | user_id, bubble_id, last_read_at | own rows only, written by `mark_chat_read`; counts via `chat_unread_counts()` |
| `events` | id, bubble_id, creator_id, title, description, datetime, location, rsvp_list[] | CRUD own; RSVP via `toggle_rsvp(p_event_id)` |
| `food_posts` | id, bubble_id, user_id, image, description | CRUD own |
| `market_items` | id, bubble_id, owner_id, image, title, description, status (`free`/`trade`) | CRUD own |
| `shared_links` | id, bubble_id, user_id, url, title, tags[] | CRUD own |

The RPCs, called with named params:
- `create_bubble(p_name, p_description, p_max_size)` returns the bubble row, and the caller becomes its owner.
- `request_to_join(p_invite_code)` returns the join_request row. It raises `invalid invite code`, `already a member`, `bubble is full` or `too many attempts` (see Invite links). The code is normalised (upper-case, letters and digits only), so `flat-2026` works.
- `get_invite_preview(p_code)` and `rotate_invite_code(p_bubble_id)`: see Invite links.
- `approve_join_request(p_request_id)` returns a bool: true when the requester was admitted. A requester is admitted when approvals from **current** members exceed half the approved members **and** there is a free seat. If the bubble is full, the approval is kept and the requester is admitted automatically when a seat frees up. It never raises `bubble is full`.
- `remove_member(p_bubble_id, p_user_id)` is owner-only. It raises `only the owner can remove members`, `use leave to remove yourself` or `member not found`.
- **When a member leaves or is removed**, the database cleans up automatically:
  - If the owner left, ownership passes to the longest-standing member.
  - A bubble with no members left is deleted.
  - The departed member's votes are removed.
  - Queued requests that now have a majority are admitted.
- **Realtime tables**: `chat_messages`, `join_requests` and `bubble_members`. Pending screens and Settings should subscribe to them instead of polling. `bubbles` too (`20261123130000_bubble_cover.sql`): clients listen to UPDATE on `bubbles` (no filter, RLS decides) while signed in and merge name, description and logo into their bubble list by id; the pending screen reloads.
- **Live feeds** (migration `20261123110000_realtime_feeds.sql`): `events` (RSVPs arrive as an UPDATE of the event's `rsvp_list`), `food_posts`, `market_items` and `shared_links` are in `supabase_realtime` too. The Events, Food, Marketplace and Links screens subscribe while shown, on one channel per screen named `<table>:<bubble id>`:
  - INSERT and UPDATE with the filter `bubble_id=eq.<current bubble>`. Realtime checks them against the subscriber's SELECT policies, so blocked authors, other bubbles and unverified sessions (`require_verified_session`) get nothing.
  - DELETE unfiltered (Realtime can't filter deletes and, with RLS on, sends only the primary key): remove the row by id and ignore ids the list doesn't hold. The tables keep the default replica identity.
  - A new id is fetched once with its author join (RLS decides again). An UPDATE of a row in the list is merged in place, keeping the joined author. Merges are by id, so the echo of the client's own write changes nothing, and lists keep their sort order (events by `datetime`, the rest newest first).
  - Once the subscription is live the screen reloads once, to catch changes made while connecting. Subscriptions end when the screen goes away, the bubble changes or the user signs out.
- **Push notifications** (`docs/push-notifications.md`): clients call `register_push_token(...)` after the device check and on every start, and `unregister_push_token(p_token)` before signing out. They read and update their own `notification_prefs` row (master switch, per type, `preview_content`) and `bubble_mutes` rows. Pushes carry `{type, bubble_id, target_id}` for deep links.
- `reject_join_request(p_request_id)` takes the request id and returns nothing.
- `toggle_rsvp(p_event_id)` returns the new `rsvp_list`.

Embedding author info: `select('*, author:users!<fk_column>(id, name, avatar)')`, e.g. `sender:users!sender_id(...)`, `creator:users!creator_id(...)`, `owner:users!owner_id(...)`, `user:users!user_id(...)`.

Storage: the public buckets are `avatars`, `food.images` and `market.images`. Object path **must** be `<auth uid>/<uuid>.<ext>` (enforced by policy). Store the public URL in the row. The exception is `bubble.images`, whose paths are `<bubble id>/<uuid>.jpg` (see "Bubble photo"). The **private** bucket `chat.images` works differently: store the object path (not a URL) in `chat_messages.image_path` and show photos through signed URLs (see Chat).

### Images
Every client runs a picked photo through the same pipeline before upload (web `src/lib/image.ts`, iOS and Android `ImageCompression`):
- **Decode, then make upright**: apply the EXIF orientation to the pixels (web `createImageBitmap(..., {imageOrientation: "from-image"})`, iOS ImageIO thumbnail with transform, Android `ExifInterface` + matrix).
- **Downsize**: long edge at most **1600 px** (avatars **512 px**), aspect ratio kept, never upscaled. Rounding is `round(side * maxSide / longEdge)`, so all clients produce the same size (e.g. 4032x3024 → 1600x1200; the shared fixture `exif-gps.jpg` → 1067x1600, avatar 341x512).
- **Re-encode as JPEG, quality 0.82**, on a white background (transparent PNG areas don't turn black). Upload as `<uid>/<uuid>.jpg` with `content-type: image/jpeg`. WebP is not used: Safari's canvas can't encode it.
- **No metadata**: only pixels reach the encoder, so EXIF, GPS location, camera, XMP and IPTC from the source are gone. iOS and Android also drop any APP1–APP15/COM segment the encoder writes itself (ImageIO adds a small Exif and Photoshop block). Each platform's tests check the uploaded bytes for this.
- **Limits** (`20261123100000_image_limits.sql`, checked by Storage on upload only, so older objects keep loading): `avatars` and `bubble.images` 2 MB (512 px), `food.images` and `market.images` 5 MB; MIME types `image/jpeg` and `image/webp` only. Clients refuse inputs above 50 MB before decoding.
- **Errors** (glossary, "Image upload errors"): too large (client check, or Storage `statusCode` 413 / `EntityTooLarge`) → `imageTooLarge`; undecodable file, or Storage 415 / `invalid_mime_type` → `imageUnsupported`. Storage answers both with HTTP 400 locally and 413/415 hosted.
- **Thumbnails**: none. Supabase image transformations are a paid feature, and a `_thumb` variant would double the uploads and the deletion paths (replace, delete, account deletion, moderation cleanup). Lists show the same image, sized by CSS / native views and loaded lazily; a 1600 px JPEG is a few hundred KB.

### Bubble photo (`20261123130000_bubble_cover.sql`)
- **Column**: `bubbles.logo`, the public URL of the photo or null. A trigger refuses anything but an existing object in `bubble.images/<this bubble id>/` (`invalid bubble logo`, shown as the generic error).
- **Who edits**: `can_manage_bubble(p_bubble_id)`, today the approved owner. Bubble roles (admins, P2) only need to widen that function; the row policy and the storage policies all call it.
- **Storage**: public bucket `bubble.images`, path `<bubble id>/<uuid>.jpg`. The folder is the bubble, not the uploader, so a new owner (after the owner leaves or deletes their account) can replace or remove the old file, and account deletion doesn't break the bubble's photo. Managers may upload, update, list and delete in that folder; everyone reads the public URL.
- **Pipeline**: the avatar settings (long edge 512 px, JPEG 0.82, no metadata, 2 MB). No crop: every client shows it in a circle (cover/fill). A square photo looks best, as the hint says.
- **Flow**: upload, then `update bubbles set logo = <url>`, then delete the previous object (best effort). If the row update fails, delete the new upload. Remove: set `logo = null`, then delete the object.
- **Cleanup**: anything clients miss (failed deletes, abandoned uploads, and the photo of a bubble that was deleted because its last member left, deleted their account or was banned) is an orphan. pg_cron runs `sweep_bubble_images()` hourly; it asks the Storage API (through pg_net) to delete up to 100 orphans older than an hour. It needs the Vault secrets `storage_sweep_url` (project URL) and `storage_sweep_key` (service role key) and does nothing without them. Bubble photos can't be reported yet.
- **Display**: the photo, or a fallback on the bubble's own colour (derived from its id): initials in large places, the coloured orb in the switcher chip. Shown in the header switcher chips, Settings (large, with the owner's controls) and the pending-approval list.
- **Strings** (all clients): `bubblePhoto` "Bubble photo", `addBubblePhoto` "Add a photo", `changeBubblePhoto` "Change photo", `removeBubblePhoto` "Remove photo", `bubblePhotoHint` "Everyone in the bubble sees it. Square photos look best.", `bubblePhotoOf` "Photo of {name}" (accessibility label).

### Invite links (migration `20261123140000_invite_links.sql`)
- **Link**: `https://boolaa.ro/join/<CODE>`, where CODE is the bubble's `invite_code`. Typed code, link and QR code are one secret: one thing to share, one thing to revoke. A link never bypasses approval: it opens a preview, and joining is `request_to_join` plus the members' majority vote, as with a typed code.
- **Codes**: new bubbles and rotated codes get 10 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O, 1/I/L; about 49 bits). Older 8-character codes keep working until rotated. No expiry: rotation is the revocation, and approval gates every join anyway.
- **Who**: every member sees, copies and shares the code, link and QR code. Only the **owner** rotates it (`rotate_invite_code(p_bubble_id)` returns the new code; raises `only the owner can change the invite code`), because rotation kills every link in circulation, including other members' invites. Clients can't change `invite_code` with an UPDATE (column grant, plus a trigger).
- **Preview**: `get_invite_preview(p_code)` returns no row (unknown code) or one row `{bubble_id, name, logo, member_count, max_size, status}`. `status` is `member` (then `bubble_id` is set, to switch to it), `pending` (the caller already asked), `full` or `open`; for non-members `bubble_id` is null. Nothing else (description, members, content) is shown. Signed-in, verified sessions only (not anon), so link previews in chat apps and signed-out web visitors see a generic "You've got an invite".
- **Throttle**: each preview of an unknown code is logged per user (`invite_lookup_failures`, no client access). After 20 in an hour, both the preview and `request_to_join` raise `too many attempts` (errors `tooManyInviteAttempts`; `onlyOwnerCanRotate` for the rotation error).
- **Web** `/join/CODE` (open path in the proxy): signed out → sign in / create account with `?next=/join/CODE` (also through Google/Apple and the device gate), plus a `boolaa_invite` cookie that sends a new user from onboarding back to the invite after email confirmation; App Store / Android download buttons (`APP_STORE_URL` / `ANDROID_URL` in `src/lib/site.ts`, "Coming soon" while null). Signed in → preview and "Request to join", "already asked" with a link to the pending list, or "Open bubble".
- **App links**: `/.well-known/apple-app-site-association` (applinks `/join/*` for `W5WKF2N472.ro.boolaa.app`) and `/.well-known/assetlinks.json` (`ro.boolaa.app`, SHA-256 of the release certificate), served as JSON by route handlers and skipped by the proxy matcher (`src/lib/app-links.ts`). iOS: Associated Domains `applinks:boolaa.ro`; Android: `autoVerify` intent filter for `https://boolaa.ro/join/*`. Both apps also accept `boolaa://join/CODE` and `ro.boolaa.app://join/CODE`, keep the code through sign-in, device gate and onboarding, then show the same preview. Without the app, the link opens the web page.
- **QR code**: shown in Settings on iOS (CoreImage) and Android; it encodes the link, so the system camera opens the app or the web page. No in-app scanner.

Local dev: `supabase start` serves the API at `http://127.0.0.1:55321`. `supabase status -o env` prints `ANON_KEY` / `PUBLISHABLE_KEY`. The seeded logins are `alice@boolaa.test`, `bob@boolaa.test` and `carol@boolaa.test`, all with password `password123`. Alice and Bob share the "Flatmates" bubble (invite `FLAT2026`) and "Climbing Crew" (invite `CLIMB123`). Carol has a pending request for Flatmates.

### Chat (migration `20261123120000_chat_improvements.sql`)
- **Pages**: `rpc('chat_messages_page', {p_bubble_id, p_before_id, p_limit: 50}).select('*, sender:users!sender_id(id, name, avatar)')` returns a page **newest first** (reverse it for display). `p_before_id = null` gives the newest page; for older ones pass the id of the oldest message loaded. The keyset is `(created_at, id)` on the server, so clients never send timestamps (Swift `Date` would drop the microseconds and skip messages). A page shorter than 50 means the start of the chat is reached. Load the next page when the list is scrolled to (near) the top, and keep the scroll position anchored on the message that was first before the page arrived. The server sets `created_at` on insert, so messages can't be backdated.
- **Live**: one channel `chat:<bubble id>` with INSERT **and** UPDATE, both filtered by `bubble_id=eq.<id>`. Merge by id: an INSERT adds a message, an UPDATE replaces it in place (this is how deletions arrive). Realtime runs the SELECT policies on both, so blocked senders, other bubbles and unverified sessions get nothing.
- **Delete your own message** (only yours: context menu / long press, with a confirmation): `rpc('delete_chat_message', {p_message_id})` returns `{id, image_path}`. If `image_path` is set, remove that object from `chat.images` (best effort). Show the message as a placeholder ("This message was deleted", no report menu) right away; everyone else gets the UPDATE live.
  - **Soft delete, not hard delete.** The row stays with `deleted_at` set and its text and `image_path` wiped (a check constraint enforces both). Why: members see it vanish live through an RLS-checked UPDATE (a DELETE event carries only the primary key and skips RLS); the placeholder keeps replies around it understandable; paging cursors and unread markers never point at a missing row; and moderation keeps the row, its author and its place in the conversation (`admin_get_report` context).
  - **Report evidence**: if the message has an **open** report, its text and photo path are first copied into `chat_message_evidence` (no client access) and the photo object is kept, so deleting can't destroy evidence. The admin view shows it as "deleted by its author". When the report is resolved (any action), the photo is named for removal like a `delete_content` photo, and the evidence row is dropped once no report on the message is open. Admin **Delete content** still hard-deletes the row (and its photo).
  - Clients can no longer delete (`chat_delete_own` dropped) or update chat rows directly.
- **Photos**: a photo button in the composer. The picked image goes through the image pipeline ("Images", 1600 px, JPEG 0.82, no metadata) and is uploaded to `chat.images` at `<uid>/<uuid>.jpg`; then the message is inserted with `image_path` and the composer text as an optional caption (`content` may be empty when there is a photo). If the insert fails, remove the uploaded object. The insert policy checks that the photo is in the sender's own folder and already uploaded, and `image_path` is unique (one message per photo).
  - **Private bucket**: `chat.images` is not public (5 MB, JPEG/WebP). A member can read a photo only while a live message they can see references it: same bubble, no block either way, verified session. Deleting the message revokes access at once, even if the object removal fails. Clients show photos through **signed URLs** (`createSignedUrl(s)`, 1 hour, cached per path; batch per page where the SDK allows). Public URLs don't work. Why private: chat is the most personal content, and unlike food and market photos nothing in chat is meant to be shown outside the bubble; the price is one signed-URL call per page.
  - Photos are removed on message deletion (above), on account deletion (the `<uid>/` folder of `chat.images` with the other buckets) and by moderation (`admin_resolve_report` names `chat.images` + path; the admin view removes it).
- **Unread counts**: `rpc('chat_unread_counts')` returns one row per approved bubble: `bubble_id`, `unread_count` (messages from others after the marker, not deleted, blocked senders excluded, **capped at 100**: show "99+" above 99) and `last_read_at`. Without a `chat_reads` row the marker is the time the user joined. Show a badge on each bubble chip in the switcher and on the chat button (current bubble). Refresh on start / foreground, when the bubble list changes, after marking read, and (debounced) on any `chat_messages` INSERT or UPDATE (a deleted unread message leaves the count) from someone else, on a second channel `unread:<user id>` with no filter (RLS limits it to the user's bubbles).
- **Last-read marker**: `rpc('mark_chat_read', {p_bubble_id, p_message_id})` with the newest message shown; the marker never moves back. Call it when the chat opens and as new messages arrive, only while the chat is actually visible (app in the foreground / tab visible).
- **"New messages" divider**: when the chat opens, keep that bubble's `last_read_at` from before marking read and draw the divider above the first message from someone else that is newer than it and not deleted (as the server counts). It stays until the chat is closed.
- **Home** shows the latest messages that aren't deleted; a photo without a caption shows the "Photo" label.
- **Push**: a photo without a caption is pushed as "📷 Photo" (localized); a message deleted before the push is sent is skipped.
- Errors: `message not found` → `chatMessageGone` (glossary).

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
- **Delete account**: `delete_my_account()`. First list and remove every object under `<uid>/` in `avatars`, `food.images`, `market.images` and `chat.images`, ignoring failures (not `bubble.images`: a bubble's photo belongs to the bubble and stays with its next owner). Then call the RPC and sign out locally.
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
   - **Join a bubble**: invite code, or an invite link (`/join/CODE`, see Invite links).
   - **Pending approval**: the user's pending requests, each showing its bubble name and approvals so far, with a cancel button. Refreshes periodically or on pull.
4. **Main shell**:
   - **Header**: large screen title, avatar button (opens the profile sheet), and a horizontal bubble-switcher chip row with a "+ New" chip that opens create or join.
   - **Tabs**: Home, Events, Food Circle, Marketplace, Settings.
   - **Chat**: a floating chat button on every tab.
5. **Home**: a combined, recency-sorted feed for the current bubble: latest chat messages, food posts, market items, upcoming events and links. Each card deep-links to its section.
6. **Chat**: messages in chronological order with sender avatar and name. Your own messages are aligned right. Realtime inserts, auto-scroll to the newest message, composer at the bottom. Details in "Chat" below.
7. **Events**: "My events" and "Bubble events" sections sorted by date. Create, edit and delete your own events (title, description, date and time, location). RSVP toggle with a count. Other members' events and RSVPs update live.
8. **Food Circle**: "My posts" and "From the bubble" sections. Create and edit (photo upload, description) and delete your own. Other members' posts appear, change and disappear live.
9. **Marketplace**: grid of items with a Free/Trade badge and filter chips (All/Free/Trade). Create, edit and delete your own (photo, title, description, status). Updates live.
10. **Links** (opened from Home and Settings): add a URL with a title and comma-separated tags, filter by tag, open the link, delete your own. Updates live.
11. **Settings** (for the current bubble):
    - Bubble photo, name and description, which the owner can edit (photo: add, change, remove).
    - **Invite code** with copy and share buttons, and the **invite link** with copy link, share link and QR code (apps); the owner can replace the code ("New code", with a confirmation).
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
