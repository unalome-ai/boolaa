# Boolaa design system

Platform-neutral source of truth for how Boolaa looks, moves and speaks. The iOS app (`apps/boolaa-ios`) is the reference implementation: tokens live in `Boolaa/Core/Theme.swift`, playful building blocks in `Boolaa/Components/Playful.swift`. Android (Jetpack Compose) and the web are restyled from this document. Units are points on iOS, dp on Android and CSS px on the web; they map 1:1.

## 1. Concept and personality

**"Soft pop."** A bubble in Boolaa is a small, private group, so the interface is made of bubbles: glossy round shapes, pill controls, soft tinted surfaces and gentle bounce. Opening the app should feel like opening a fizzy drink, not a spreadsheet.

- **Round.** Circles and pills for anything you tap; large continuous corners for anything that holds content. No sharp corners anywhere.
- **Glossy.** The signature shape is the *bubble orb*: a circle with a radial fill, a faint white rim and a small highlight at 10 o'clock (section 5.5). It is the logo, the bubble avatar, the chat button and the base of every illustration.
- **Colourful with a purpose.** Purple ("grape") is the brand and the primary action. Every bubble has its own colour, and every feature has its own colour. Colour always tells you *where you are* (which bubble) or *what something is* (which feature); it is never decoration only.
- **Alive.** Things float slowly in the background, squish when pressed and pop when they appear. Motion is quick and springy, never slow or showy, and everything has a still fallback.
- **Calm when it matters.** Reporting, blocking and deleting an account are flat and still: no gradients, no bounce, no confetti, no floating bubbles.

## 2. Colour

### 2.1 Hues

A **hue** is a family of five values. `fill` is the same in light and dark mode; `text` is the shade to use when the hue is used as a text or icon colour on a surface.

| Hue | fill | glow (lighter) | deep (darker) | onFill | text, light mode | text, dark mode |
|---|---|---|---|---|---|---|
| **grape** (brand) | `#7357F6` | `#9B86FF` | `#5B3FD9` | white | `#5B3FD9` | `#B7A6FF` |
| coral | `#FF6B5C` | `#FF9A82` | `#E8503F` | ink | `#C0392B` | `#FF9A8F` |
| mint | `#1EC8A0` | `#6BE6C6` | `#12A683` | ink | `#0B7A60` | `#5FE3C2` |
| sky | `#3AA8FF` | `#7CC9FF` | `#1F8DE6` | ink | `#0B6BBF` | `#7CC6FF` |
| sunny | `#FFC93C` | `#FFE07A` | `#F2B21B` | ink | `#8A6400` | `#FFD466` |
| pink | `#F0569F` | `#FF8CC0` | `#D63D86` | ink | `#B8246F` | `#FF9CCB` |
| tangerine | `#FF9A2E` | `#FFBE5C` | `#F07F0C` | ink | `#A85800` | `#FFB866` |
| indigo | `#5468F0` | `#8795FF` | `#3F50D0` | white | `#3F50D0` | `#A3AEFF` |

- **onFill** is the colour of text and icons placed on `fill`: white on grape and indigo, **ink `#1E1638`** on the six bright hues, in both modes. White on the bright hues fails contrast, so never use it there.
- **wash** is the soft tinted surface of a hue: `fill` at 14% opacity in light mode, 24% in dark mode. Use it behind `text`-coloured labels (badges, counters, secondary buttons, empty states).
- **gradient** (top to bottom): for white-onFill hues `fill → deep`; for ink-onFill hues `glow → fill`. This keeps onFill readable over the whole gradient.

The old brand colours map as follows: `#9D78BD` and `#7B61FF` are both replaced by grape `#7357F6` (a little deeper than `#7B61FF` so white text passes AA).

### 2.2 Roles

| Role | Value |
|---|---|
| Primary action, selection, links in text | grape |
| Success, "Going", approve, confirmation banners | mint |
| Owner badge, "Trade" badge | sunny |
| Destructive | danger `#D92D3A` (fill, white text); as text `#D92D3A` light, `#FF8A8F` dark |

**Feature colours**

| Feature | Hue | Where it shows |
|---|---|---|
| Chat | grape | chat button, own message bubbles, Home feed badge |
| Events | coral | dock selection, date tile, add button, RSVP button (not going) |
| Food Circle | tangerine | dock selection, add button, empty states |
| Marketplace | mint | dock selection, add button, filter chips, "Free" badge |
| Links | sky | feed badge, add-link button, tag chips |
| Home / Settings | grape / indigo | dock selection only |

### 2.3 Bubble colour (deterministic)

Each bubble has one hue, used for its chip, its orb, the Home hero card and the glow behind the header. It is derived from the bubble id so every client shows the same colour:

```
palette = [grape, coral, mint, sky, sunny, pink, tangerine, indigo]   // this order
hash    = FNV-1a 32-bit over the UTF-8 bytes of the lowercase, hyphenated UUID string
          (offset basis 2166136261, prime 16777619, wrap at 32 bits, unsigned)
folded  = hash XOR (hash >>> 16)        // mixes the weak low bits
hue     = palette[folded mod 8]
```

Test vectors: `fnv1a("") = 2166136261`, `fnv1a("a") = 3826002220`, `fnv1a("boolaa") = 3352750575`; bubble `aaaaaaaa-0000-0000-0000-000000000001` (seeded "Flatmates") is sky and `aaaaaaaa-0000-0000-0000-000000000002` ("Climbing Crew") is tangerine; user `11111111-1111-1111-1111-111111111111` (Alice) is sunny, Bob pink, Carol indigo.

People without a photo get an avatar colour the same way, from their user id. Chat sender names use the same hue's `text` shade.

### 2.4 Surfaces and text

| Token | Light | Dark |
|---|---|---|
| background | `#FBF8FF` | `#15111F` |
| card | `#FFFFFF` | `#221C33` |
| field (inputs, inactive chips, skeletons) | `#F1ECFB` | `#2C2545` |
| hairline (1 px edges) | `#2A1B5E` at 8% | white at 8% |
| ink (primary text) | `#1E1638` | `#F5F2FF` |
| inkSecondary | `#6A6382` | `#ABA4C4` |

iOS uses the system label colours for body text, which are equivalent. Avoid tertiary label colours for text: they fail AA.

The app background is not flat: behind the header sits a soft radial glow in the current bubble's hue (top-right, radius 340, `fill` at 30% light / 20% dark fading to 0, plus a smaller `glow` wash top-left at 22% / 12%). It cross-fades when the bubble changes.

### 2.5 Contrast (WCAG 2.1 AA, verified)

All text pairs are at least 4.5:1.

| Pair | Ratio |
|---|---|
| white on grape fill / on grape deep | 4.75 / 6.65 |
| white on indigo fill | 4.55 |
| ink on coral / mint / sky / sunny / pink / tangerine fill | 6.1 / 8.0 / 6.7 / 11.1 / 5.3 / 8.1 |
| hue `text` (light) on white card: grape, coral, mint, sky, sunny, pink, tangerine, indigo | 6.7, 5.4, 5.3, 5.4, 5.4, 6.0, 5.2, 6.4 |
| hue `text` (light) on its own wash: same order | 5.5, 4.7, 4.7, 4.8, 5.0, 5.1, 4.7, 5.4 |
| hue `text` (dark) on dark card | 7.7 to 11.6 |

**Accessibility pass (2026-11-23), light mode only, dark unchanged.** Measured in place (axe on the web, token checks on the apps), these pairs failed and were fixed by darkening the *text* shade only; fills are unchanged:

| Token | Old → new | Ratio old → new | Platforms |
|---|---|---|---|
| danger text | `#D92D3A` → `#C0272F` | 3.93 → 4.8 on its 10% wash; 4.55 → 5.6 on background | web, iOS, Android |
| grape text | `#5B3FD9` → `#5135CF` | 4.43 → 5.08 (grape text on a 15% grape wash over the bubble glow); 7.6 on white | web, iOS (Android has no such pair and keeps `#5B3FD9`) |
| inkSecondary | `#6A6382` → `#5C5574` | 3.8–4.4 → ≥ 4.5 on nested washes and over the header glow; 6.98 on cards | iOS (also replaces the system `.secondary` label colour, 3.44 on white, in 81 places) |
| header glow | fill 30% / glow 22% → 22% / 16% | secondary text over it ≥ 4.5 in every bubble hue | iOS |
| "Taken" badge fill | system gray `#8E8E93` → `#6A6382` | white text 3.26 → 5.65 | iOS |
| web unread badge | white on coral → ink on coral | 2.80 → 6.1 | web |

Text fields are identified by their label and placeholder; their fill against the background is 1.10:1 (no border), a known gap against WCAG 1.4.11 kept for the look.
| hue `text` (dark) on its own wash | 5.5 to 6.6 |
| ink on background (light) / ink on background (dark) | 16.3 / 16.8 |
| inkSecondary on background, card, field (light) | 5.4, 5.7, 4.9 |
| inkSecondary on card, field (dark) | 6.9, 6.1 |
| white on danger / danger text on dark card | 4.8 / 7.2 |

Disabled controls are exempt from contrast rules but must stay legible: a disabled primary button is its fill at 38% with onFill at 85%.

## 3. Typography

Two families, both system fonts. No bundled fonts.

| Role | iOS | Android | Web |
|---|---|---|---|
| Display: titles, buttons, chips, badges, numbers | SF Pro Rounded | Nunito (variable, from Google Fonts) | `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif` |
| Text: body, descriptions, user content, inputs | SF Pro | Roboto (system default) | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

| Style | Size / weight | Family | Used for |
|---|---|---|---|
| wordmark | 46 heavy | display | "Boolaa" on the auth screen |
| screenTitle | 34 heavy (iOS largeTitle) | display | tab titles, onboarding title |
| title | 28 heavy | display | pushed screen titles, hero bubble name |
| title2 | 22 heavy | display | card titles (Settings bubble name, item detail) |
| sectionTitle | 20 heavy | display | section headers |
| headline | 17 bold | display | buttons, card titles, list titles |
| body | 17 regular (semibold for feed titles) | text | content |
| subheadline | 15 regular / bold in display for chips | both | secondary lines, chips |
| caption | 12 bold | display | feed "kind" labels (uppercase), badges, sender names |
| caption2 | 11 | text | timestamps |

Rules: sizes follow the platform's dynamic type scale (iOS text styles, Android `sp`, web `rem`); never fix a text size except the wordmark and symbols inside fixed-size badges. Titles are limited to 1 or 2 lines with a minimum scale factor of 0.6 to 0.75 so long translations shrink before they truncate. Numbers that change use tabular (monospaced) digits.

## 4. Layout

### 4.1 Spacing scale

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 48`. Screen side margin 16 (header 20). Gap between cards 12. Card inner padding 16. Sheets and forms pad 20. Minimum touch target 44 × 44.

### 4.2 Corner radii (continuous / "squircle" corners)

| Token | Value | Used for |
|---|---|---|
| small | 12 to 14 | thumbnails, icon badges (32% of badge size) |
| field | 16 | inputs, calm (safety) buttons, banners, date tile |
| card | 24 | cards, empty states, grid tiles |
| hero | 32 | Home hero card, auth panel, sheets, big images |
| pill | height / 2 | buttons, chips, dock, segmented control, message composer |
| message | 21, tail corner 6 | chat bubbles |

### 4.3 Elevation

| Level | Light | Dark | Used for |
|---|---|---|---|
| 0 | none | none | washes, fields |
| 1 card | shadow `#2A1B5E` 8%, blur 16, y 8, plus 1 px hairline | shadow black 28%, blur 16, y 8, plus 1 px hairline (white 8%) | cards |
| 2 floating | shadow `#2A1B5E` 22%, blur 18, y 10 | black 45%, blur 18, y 10 | dock, chat button |
| glow | shadow in the element's own `fill`, 35 to 45%, blur 8 to 16, y 4 to 10 | same | filled buttons, active chips, hero card |

Shadows are tinted purple, never neutral grey.

### 4.4 Icons

Filled, bold, rounded. iOS uses SF Symbols at bold/heavy weight; Android and web use **Material Symbols Rounded** (fill 1, weight 600).

| Meaning | SF Symbol | Material Symbol |
|---|---|---|
| Home tab | `house` / `house.fill` | `home` |
| Events | `calendar` | `calendar_month` |
| Food Circle | `fork.knife` | `restaurant` |
| Marketplace | `tag` / `tag.fill` | `sell` |
| Settings | `gearshape` / `gearshape.fill` | `settings` |
| Chat | `bubble.left.and.bubble.right.fill` | `forum` |
| Links | `link` | `link` |
| Add | `plus` | `add` |
| Back | `chevron.left` | `arrow_back_ios_new` |
| Disclosure | `chevron.right` | `chevron_right` |
| More | `ellipsis` | `more_horiz` |
| Edit / Delete | `pencil` / `trash.fill` | `edit` / `delete` |
| Time / Place | `clock.fill` / `mappin.circle.fill` | `schedule` / `location_on` |
| RSVP / Going | `plus.circle.fill` / `checkmark.circle.fill` | `add_circle` / `check_circle` |
| Send | `arrow.up` | `arrow_upward` |
| Copy / Copied / Share | `doc.on.doc.fill` / `checkmark` / `square.and.arrow.up` | `content_copy` / `check` / `share` |
| Owner | `crown.fill` | `crown` |
| Free / Trade | `gift.fill` / `arrow.left.arrow.right` | `redeem` / `swap_horiz` |
| Open link | `arrow.up.right` | `arrow_outward` |
| Leave / Sign out | `rectangle.portrait.and.arrow.right` | `logout` |
| Language / Privacy / Terms | `globe` / `lock.shield.fill` / `doc.text.fill` | `language` / `shield_lock` / `description` |
| Blocked / Report | `hand.raised.fill` / `flag` | `front_hand` / `flag` |
| Photo / Camera | `photo` / `camera.fill` | `image` / `photo_camera` |
| Pending | `hourglass` | `hourglass_top` |
| Warning / Done | `exclamationmark.triangle.fill` / `checkmark.seal.fill` | `warning` / `verified` |
| Empty Home | `sparkles` | `auto_awesome` |
| Empty food (others) / new event | `takeoutbag.and.cup.and.straw.fill` / `calendar.badge.plus` | `takeout_dining` / `calendar_add_on` |

### 4.5 Illustration

Shapes only, drawn in code; no image assets.

- **Bubble orb.** Circle filled with a radial gradient `glow → fill → deep`, centred at (35%, 30%), radius 75% of the diameter. A white rim at 28% opacity, 3% of the diameter wide. A white highlight ellipse at 60% opacity, 26% × 16% of the diameter, rotated −35°, offset (−20%, −24%) from the centre.
- **Logo.** One large grape orb with three small friends: coral (36% size, top-right), sunny (20%, right), mint (26%, bottom-left). Each bobs on its own period.
- **Bubble cluster** (empty states, photo placeholder, editors): a main orb (80% of the cluster size) carrying a bold symbol in onFill, plus two small companion orbs in other hues (34% top-right, 24% bottom-left). Companions: coral→sunny+grape, tangerine→coral+mint, mint→sky+sunny, sky→mint+pink, otherwise coral+mint.
- **Ambient backdrop** (auth, onboarding): 16 translucent orbs in grape, coral, mint, sunny, sky and pink drifting upwards over a vertical gradient (`#E9E0FF → background → #FFEDE3` light; `#241A45 → background → #1F1430` dark). Orb radius 4.5 to 15.5% of the screen width; fill opacity 42% light, 22% dark.
- **Hero decoration**: plain white circles at 14 to 16% opacity and one outlined ring, clipped to the card.

## 5. Motion

### 5.1 Principles

1. **Springs, not curves.** Everything that moves uses a spring; only fades use a curve.
2. **Fast.** Feedback starts within one frame; nothing blocks input; no transition is longer than about half a second.
3. **Motion carries meaning.** The selection slides (it is the same thing moving), new things pop from where they come from, pressed things squish.
4. **Ambient motion is slow and small.** It sits behind content and never loops fast enough to distract.
5. **Always a still version.** See 5.5.

### 5.2 Tokens

iOS springs are `response` (seconds) and `dampingFraction`. For Compose use `spring(dampingRatio, stiffness)` with stiffness = (2π / response)².

| Token | response | damping | Compose stiffness | Used for |
|---|---|---|---|---|
| press | 0.25 | 0.60 | ≈ 630 | press and release |
| snappy | 0.32 | 0.78 | ≈ 385 | tab, chip and segment selection, counters |
| bouncy | 0.45 | 0.62 | ≈ 195 | pop-ins, badges, staggered entrances, RSVP |
| gentle | 0.55 | 0.86 | ≈ 130 | layout changes, screen and route changes |
| fade | ease-out, 200 ms | | | opacity only, and the reduced-motion replacement for every spring |

Durations for non-spring effects: confetti 900 ms, shimmer sweep 1300 ms per pass, error shake 530 ms, "copied" state 1500 ms. Stagger: 45 ms between siblings, only the first 8 are delayed (maximum 315 ms), later ones start immediately. Ambient: orbs cross the screen in 20 to 36 s with a horizontal sway of ±3% of the width; floating elements bob 3 to 6 pt on a 3.6 to 6 s sine; the chat button's ring pulses every 3.2 s.

### 5.3 Micro-interaction catalogue

| Interaction | What happens |
|---|---|
| **Button press (squish)** | Scales to 0.96 (cards, pills) or 0.88 (round icon buttons) with `press`; springs back on release. Filled buttons also tighten their glow shadow (blur 14→6, y 8→3). |
| **Tab switch** | The filled circle in the dock slides to the new tab (shared-element / matched geometry) with `snappy` and changes to that tab's colour. The new icon bounces once and switches to its filled variant. The screen title rolls its characters (numeric-text style transition). New content rises 14 pt with scale 0.98→1 and fades in; old content fades out. Haptic: selection. |
| **Bubble switch** | The filled capsule slides between chips with `snappy` and takes the new bubble's colour; the chip's orb pulses to 1.45× and back with `bouncy`; the header glow cross-fades to the new hue with `gentle`; content is replaced with the tab-switch transition; the chip row scrolls the active chip to the centre. Haptic: medium impact. |
| **Segmented pill, filter chips** | Selection pill slides with `snappy`; grid or list items leaving scale to 0.85 and fade, arriving ones pop in. Haptic: selection. |
| **Send a chat message** | The send button's arrow bounces; haptic light impact. The new bubble pops in from its tail corner: scale 0.4→1 anchored bottom-trailing (own) or bottom-leading (others), opacity 0→1, `bouncy`. The list scrolls to the bottom in 200 ms. Messages present at first load do not animate. The send button scales 0.88→1 with `bouncy` when the field becomes non-empty. |
| **RSVP** | On tap: light impact. When the server confirms "going": the pill turns from coral wash to mint fill, the icon morphs plus→check (symbol replace), the count rolls (numeric text), 22 confetti pieces burst from the button (900 ms: fast start, ease-out, gravity, fade over the last 300 ms), haptic success. Un-RSVP reverses the pill without confetti. |
| **Pull to refresh** | Platform-native indicator tinted grape. When the reload finishes: haptic success, and new items pop in. |
| **Screen entrance** | List items fade up: offset 18→0, scale 0.96→1, opacity 0→1 with `bouncy`, staggered. On the auth screen the logo, each letter of the wordmark, the tagline and the form panel enter in that order. |
| **Scroll** | Cards entering or leaving the viewport scale to 0.94 and fade to 55%, interpolated with scroll position. |
| **Loading (skeleton)** | Placeholder blocks in `field` colour shaped like the content (badge + 3 lines for lists, tiles for the grid) with a white 45% highlight sweeping left to right every 1.3 s. No spinners for first loads; spinners only inside buttons. |
| **Empty states** | The bubble cluster floats (each orb on its own period); the block pops in like a list item. |
| **Success** | Mint. Inline banner pops in (scale 0.9→1 + fade, `bouncy`) or the control itself turns mint (copy button: icon morphs to a check for 1.5 s). Haptic success. |
| **Error** | The submit button shakes horizontally (−10, 9, −6, 3, 0 pt over 530 ms), haptic error, then the platform alert with a translated message. Never colour-only. |
| **Counters and steppers** | Digits roll (numeric text transition) with `snappy`; haptic selection per step. |
| **Route change** (auth → onboarding → main) | New screen fades in from scale 0.94 with `gentle`, old one fades out. |
| **Sheets** | Platform sheet, 32 radius, grabber visible, app background. |

### 5.4 Haptics

| Moment | iOS (`sensoryFeedback`) | Android (`HapticFeedbackConstants`) |
|---|---|---|
| Tab change, segment, filter chip, tag, stepper, report reason | `.selection` | `SEGMENT_TICK` (fallback `CLOCK_TICK`) |
| Bubble switch | `.impact(.medium)` | `CONTEXT_CLICK` |
| Send message, RSVP tap, add buttons, chat button | `.impact(.light)` | `VIRTUAL_KEY` |
| RSVP confirmed, invite code copied, refresh finished | `.success` | `CONFIRM` |
| Sign-in or form failure | `.error` | `REJECT` |

Haptics follow the system setting. The web has none.

### 5.5 Reduced motion

When the system "Reduce Motion" setting is on (iOS `accessibilityReduceMotion`, Android animator duration scale 0 or `Settings.Global.TRANSITION_ANIMATION_SCALE` = 0, web `prefers-reduced-motion: reduce`):

- Every spring becomes the 200 ms fade; nothing scales, slides, rolls or bounces.
- Press feedback is a dim to 70% opacity instead of a squish.
- The ambient backdrop, floating orbs and the chat button ring are drawn once and do not move.
- Confetti is not drawn; RSVP still changes colour and icon and plays the haptic.
- Shimmer stops: skeletons are static blocks.
- Staggered entrances lose their delay and offset (opacity only).
- Scroll scale/fade and the error shake are off.

## 6. Components

### 6.1 Dock (pill tab bar + chat button)

One row floating 8 above the bottom safe area, side margin 16, gap 10: the **pill tab bar** on the left and the **chat button** on the right. Behind the row a gradient from transparent to `background` at 92% lets content dissolve underneath. Scroll content keeps a bottom inset of 112.

- **Pill tab bar**: capsule, padding 6, translucent blurred surface (iOS regular material; Compose: card colour at 85% + blur where available), 1 px hairline, elevation 2. Five icon buttons, each up to 52 × 52 with 2 between them; they shrink evenly on narrow screens. Inactive icon: 20 bold, inkSecondary, outline variant. Active: filled variant in the tab hue's onFill on a 52 circle filled with the tab hue's gradient and a glow shadow. No text labels; each button has an accessibility label and the selected trait.
- **Chat button**: 60 × 60 grape bubble orb with a white 21 bold chat symbol, elevation 2 tinted grape. A 2 px grape ring pulses outward (scale 1→1.4, opacity 45%→0) every 3.2 s. Press: squish 0.88, symbol bounce, light impact. Label "Open chat".

### 6.2 Header and bubble switcher

- Row 1 (side margin 20): screen title (screenTitle style, 1 line, shrinks to 60%) and the user's avatar (44) at the trailing edge, which opens the profile sheet.
- Row 2: horizontally scrolling chips, gap 8, vertical padding 6 so glows are not clipped.
  - **Bubble chip**: height 38, padding 11 leading / 16 trailing, a 16 orb in the bubble's hue + the bubble name (subheadline, display, bold, 1 line). Inactive: card fill, hairline edge, ink text. Active: capsule in the bubble hue's gradient with glow, text in onFill, orb gets a 1.5 white ring.
  - **"+ New" chip**: same height, dashed 1.5 outline (dash 5, gap 4) in grape text colour at 55%, plus symbol and label in grape text.
- The header has no background of its own; the bubble glow (2.4) shows through.

Pushed screens (Chat, Links) use a 44 round back button (card fill, elevation 1), a title (title style) and, below it, the bubble name with a 12 orb in the bubble's text colour.

### 6.3 Cards

Base card: card colour, radius 24, padding 16, elevation 1.

- **Home hero**: radius 32, padding 20, diagonal gradient in the bubble's hue with white decoration circles and a glow shadow. Content in onFill: greeting (subheadline, semibold), bubble name (title), description (up to 3 lines), and a "Links" pill (height 36, onFill at 16% fill with a 25% outline).
- **Feed card** (Home): 44 feature badge (squircle, radius 32% of its size, feature gradient, onFill symbol) · kind label (caption, uppercase, feature text colour) with the relative time right-aligned · title (body semibold, 2 lines) · subtitle (subheadline, secondary) · optional 60 thumbnail, radius 14.
- **Event card**: date tile 56 × 64, radius 16, rotated −4°: month on a coral gradient strip (caption2 heavy, onFill), day number below (title2 heavy, coral text) on coral wash. Title (headline), time and place rows with filled icons, description. Footer: creator avatar (24) + name, "N going" counter, RSVP pill (height 38): not going = coral wash + coral text + plus-circle; going = mint gradient + ink + check-circle + glow. The footer drops the RSVP pill onto its own row when it does not fit (large text, long translations); the date tile scales with the text size up to 84 × 96.
- **Food card**: photo 210 high, full width, with an author pill floating bottom-left on a blurred surface (avatar 24, name, relative time). Description (body medium) and the owner's "more" menu below.
- **Market tile** (2-column grid, gap 12): photo 140 with a status badge top-left (Free = mint gradient + gift; Trade = sunny gradient + swap; caption heavy, ink), title (subheadline bold, 1 line), owner avatar 20 + name.
- **Link row**: 44 sky badge · title (headline, 2 lines), host, tags in sky text, author · round "open" button (38, sky wash) and, for your own, a round delete button (danger at 12% fill).
- **Invite code** ("ticket"): grape wash, radius 24, dashed 1.5 outline (dash 7, gap 6) in grape text at 45%. Label (caption heavy, uppercase), the code in title heavy display with 3 tracking in grape text, a 44 copy button (grape 16% fill; turns mint with a check when copied) and a 44 share button (grape gradient).
- **Settings rows / profile rows**: height 56, radius 20, card fill, hairline, a 34 badge in a hue, label (body medium), trailing chevron or arrow in secondary.
- **Section header**: sectionTitle text plus a counter badge (caption bold in the feature text colour on its wash, capsule). An optional add button sits at the trailing edge and wraps below the title when the translation is long.

### 6.4 Buttons

| Button | Spec |
|---|---|
| **Primary** | Full width, minimum height 54, radius 27 (pill), hue gradient (grape by default; a feature hue inside that feature), 1 px white 22% inner edge, glow shadow, label headline in onFill. Disabled: fill at 38%, no shadow. Busy: spinner in onFill replaces the label. |
| **Secondary** | Same size and shape, hue wash, label in hue text. |
| **Add (section action)** | Capsule, minimum height 40, padding 16, feature gradient, plus symbol (heavy) + label (subheadline bold) in onFill, glow shadow. The plus bounces on tap. |
| **Round icon** | 38 to 44 circle: hue wash with hue text symbol, or hue gradient with onFill symbol (filled variant). |
| **Calm primary** (safety) | Radius 16, flat `fill`, no gradient, shadow or squish; pressed = 80% opacity. |
| **Destructive** | Radius 16, flat danger `#D92D3A`, white label; disabled at 35%. Soft destructive (Leave bubble): pill, danger at 10% fill, danger text. |

### 6.5 Inputs

- **Text field**: minimum height 52, radius 16, `field` fill, horizontal padding 16, no border. Focused: 2 px grape (`fill`) border, 200 ms fade. Multi-line fields add 12 vertical padding. Placeholder in the platform's placeholder colour.
- **Chat composer**: field with radius 24 on the card colour and a hairline (2 px grape when focused), 1 to 5 lines, plus a 48 round send button (grape gradient with glow when it can send; `field` fill and secondary arrow when it cannot). The composer bar has a blurred background.
- **Segmented pill**: capsule track in `field`, padding 4; segments minimum height 40, label subheadline bold, shrinks to 70%; the selected segment is a capsule in the hue gradient with onFill text that slides between positions.
- **Filter / tag chip**: height 38, padding 16, `field` fill and secondary text when inactive; hue gradient, onFill text and glow when active.
- **Stepper row, date row**: same shell as a text field (52, radius 16, `field`); the value in grape text, display heavy.
- **Photo picker**: dashed-outline wash block (radius 24) with a camera bubble cluster and "Choose a photo".

### 6.6 Avatars

Circle with a 2 px ring in the card colour (1.5 below 32). With a photo: the photo, scaled to fill. Without: initials (up to two, display bold, 38% of the diameter) in onFill on the gradient of the person's hue (2.3). Sizes: 20 to 24 inline, 30 in chat, 40 in lists, 44 in the header, 112 in the profile sheet, where it also gets a 3 px rainbow ring (grape, pink, sunny, mint, sky) and a 38 grape camera badge.

### 6.7 Sheets

Platform bottom sheet with radius 32, a visible grabber and the app `background` colour. Title in the navigation bar (inline), "Cancel"/"Close" leading, "Save"/"Done" trailing. Forms inside use the inputs above on the background, never grouped system lists.

### 6.8 Empty states

A block with radius 24, the feature's wash at 60%, a dashed 1.5 outline (dash 6, gap 6) in the feature text colour at 25%, padding 28 × 24: bubble cluster (84) · title (headline, display) · one line of secondary text, all centred. The cluster floats. One per empty section, in the section's feature colour.

### 6.9 Safety surfaces (report, blocked users, delete account)

Same tokens, but deliberately still: no floating orbs, no confetti, no bouncy entrances, no gradients on buttons. Use calm primary and destructive buttons, plain cards, a system symbol instead of a bubble cluster, and standard fades. The only colour accents are grape for the selected reason, mint for "report sent" and danger for deletion.

## 7. Voice

Boolaa talks like a friendly flatmate: short, warm, a little playful, never cute at the user's expense. Product terms and translations are fixed in `docs/i18n-glossary.md`.

- **Short.** Titles up to 3 words, helper lines one sentence, buttons 1 to 3 words starting with a verb ("Share food", "Request to join").
- **Warm and informal.** Use contractions; address the user as *tu* in ro, fr, es and it. Greet by first name on Home ("Hi, Alice!").
- **Playful in empty and happy moments.** Empty states invite an action ("Leftovers? Snap a photo and share them."). An exclamation mark is fine in greetings and successes, one at most.
- **Plain when something goes wrong.** Say what happened and what to do next; no jokes, no blame, no raw backend text.
- **Serious in safety flows.** Reports, blocks and deletion use neutral, exact wording and state consequences clearly ("This can't be undone.").
- **No emoji in interface text.** The shapes and colours carry the playfulness; emoji stay in what people write.
- **Sentence case everywhere.** Uppercase only for small category labels (feed kinds, "Invite code").
- **Every string ships in en, ro, fr, es and it,** with real plural forms, and must fit: check Romanian and French, which run longest.
