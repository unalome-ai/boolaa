# Boolaa design system

Platform-neutral **single source of truth** for how Boolaa looks, moves and speaks. Every token below has the same value on all three clients; when one changes, change it here and in all three token files in the same commit:

| Platform | Tokens | Building blocks |
|---|---|---|
| iOS | `apps/boolaa-ios/Boolaa/Core/Theme.swift` | `Boolaa/Components/Playful.swift`, `Components.swift` |
| Android | `apps/boolaa-android/.../ui/theme/Theme.kt` | `ui/components/Playful.kt`, `Components.kt` |
| Web | `apps/boolaa-web/src/app/globals.css` (CSS variables + `@theme`), `src/lib/brand.ts` (the same values as data, for the contrast test) | `src/components/ui.tsx`, `orb.tsx` (orbs, mascot), `cheer.tsx`, `app-shell.tsx` (band, dock) |

Units are points on iOS, dp on Android and CSS px on the web; they map 1:1. Contrast is checked by tests on each platform (`ContrastTest.kt`, axe in `tests/a11y.spec.ts` and the token-table check in `tests/brand.spec.ts`, the XCUITest audit in `AccessibilityUITests.swift`).

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
| **grape** (brand) | `#7357F6` | `#9B86FF` | `#5B3FD9` | white | `#5135CF` | `#B7A6FF` |
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
| Destructive | danger `#D92D3A` (fill, white text); as text (`dangerText`) `#C0272F` light, `#FF8A8F` dark |

**Feature colours**

| Feature | Hue | Where it shows |
|---|---|---|
| Home | grape | header band, dock pill |
| Chat | grape | chat button, Home feed badge and sticker, reactions in chat (own messages take the **bubble** colour, §8.2; the Chat header band too) |
| Events | coral | header band, dock pill, date tile, add button, RSVP button (not going) |
| Food Circle | tangerine | header band, dock pill, add button, empty states |
| Marketplace | mint | header band, dock pill, add button, filter chips, "Free" badge |
| Links | sky | header band, feed badge, add-link button, tag chips |
| Settings | indigo | header band, dock pill |

**Colour roles** (§8.1): the *feature* colour says where you are in the app and owns the top header band and the dock pill; the *bubble* colour says which group you're in and owns the bubble chips, the Home hero card and your own chat messages.

### 2.3 Bubble colour (deterministic)

Each bubble has one hue, used for its chip, its orb, the Home hero card, your own chat messages and the Chat header band (§8.1, §8.2). It is derived from the bubble id so every client shows the same colour:

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
| hairline (1 px edges of cards, dividers) | `#2A1B5E` at 8% | white at 8% |
| fieldBorder (1 px edge of text fields and field-shaped rows) | `#857DA1` | `#80789F` |
| focusRing (2 px, focused field) | grape text `#5135CF` | grape text `#B7A6FF` |
| ink (primary text) | `#1E1638` | `#F5F2FF` |
| inkSecondary | `#5C5574` | `#ABA4C4` |
| danger (fill) | `#D92D3A` | `#D92D3A` |
| dangerText | `#C0272F` | `#FF8A8F` |

Hue `text` shades are for the background, cards and the hue's own wash, not for the `field` fill (tangerine text is 4.46:1 there); text on `field` is ink or inkSecondary. Use `inkSecondary` for secondary text on every platform, never the system secondary or tertiary label colours (iOS `.secondary` is 3.4:1 on white).

The app background is not flat: behind the header sits the **feature band** (§8.1), a wash of the screen's feature colour that fades out at the header's bottom edge and cross-fades on a tab switch. It replaces the bubble-hue header glow of the first design (22/16 % light, 20/12 % dark), which is gone.

### 2.5 Contrast (WCAG 2.2 AA, verified)

Text pairs are at least 4.5:1; large text and UI parts (field edges, focus rings, icons that carry meaning) at least 3:1. Ratios below are for the shared tokens and hold on all three platforms.

| Pair | Light | Dark |
|---|---|---|
| ink on background / card | 16.3 / 17.1 | 16.8 / 14.8 |
| inkSecondary on background / card / field | 6.6 / 7.0 / 6.0 | 7.8 / 6.9 / 6.1 |
| inkSecondary over the feature band (worst hue, §8.6) | 4.58 | 4.64 |
| white on grape fill / grape deep | 4.75 / 6.65 | same |
| white on indigo fill | 4.55 | same |
| ink on coral / mint / sky / sunny / pink / tangerine fill | 6.1 / 8.0 / 6.7 / 11.1 / 5.3 / 8.1 | same |
| hue `text` on card: grape, coral, mint, sky, sunny, pink, tangerine, indigo | 7.6, 5.4, 5.3, 5.4, 5.4, 6.0, 5.2, 6.4 | 7.7 to 11.6 |
| hue `text` on its own wash (over card) | 6.3 (grape), 4.7 to 5.4 | 5.5 to 6.6 |
| grape text on a grape wash over the bubble glow | 5.08 | ≥ 5.9 |
| white on danger fill | 4.8 | 4.8 |
| dangerText on background / on its soft wash (10% light, 16% dark) | 5.6 / 4.8 | 8.2 / 6.3 |
| **fieldBorder** on background / card / field fill (UI, 3:1) | 3.67 / 3.86 / 3.33 | 4.51 / 3.98 / 3.50 |
| **focusRing** on background / card (UI, 3:1) | 7.2 / 7.6 | 8.8 / 7.7 |
| white on the "Taken" badge (`taken` `#6A6382`, both modes) | 5.65 | same |
| ink on coral (unread badge; on an active chip: ink on white) | 6.1 | same |

History: the accessibility pass (2026-11-23) darkened danger text (`#D92D3A` → `#C0272F`), grape text (`#5B3FD9` → `#5135CF`), inkSecondary (`#6A6382` → `#5C5574`) and the light header glow (30/22% → 22/16%), first on iOS and partly on the web; the visual polish pass (2026-11-23) made all three platforms use these values, and added `fieldBorder` and `focusRing` so text fields meet WCAG 1.4.11 (their fill alone was 1.10:1 against the background).

Disabled controls are exempt from contrast rules but must stay legible: a disabled primary button is its fill at 38% with onFill at 85%.

## 3. Typography

Two families. No bundled fonts except Nunito on Android.

| Role | iOS | Android | Web |
|---|---|---|---|
| Display: titles, buttons, chips, badges, numbers | SF Pro Rounded | Nunito (variable, from Google Fonts) | `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif` |
| Text: body, descriptions, user content, inputs | SF Pro | Roboto (system default) | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

| Style | Size / weight | Family | Used for |
|---|---|---|---|
| wordmark | 46 heavy | display | "Boolaa" on the auth screen |
| screenTitle | **38 black (900), tracking −0.025 em** (§8.5; was 34 heavy) | display | tab titles, onboarding title |
| title | 28 heavy | display | pushed screen titles, hero bubble name |
| title2 | 22 heavy | display | card titles (Settings bubble name, item detail) |
| sectionTitle | 20 **black (900)**, tracking −0.01 em | display | section headers |
| headline | 17 bold | display | buttons, card titles, list titles |
| body | 17 regular (semibold for feed titles) | text | content |
| subheadline | 15 regular / bold in display for chips | both | secondary lines, chips |
| caption | 12 bold | display | badges, sender names; feed "kind" labels are **stickers** (12 black, §8.5) |
| caption2 | 11 | text | timestamps |

The sizes are the same on every platform: iOS text styles at the default Dynamic Type size, Android `Type.*` in `sp`, and on the web Tailwind's `text-xs` / `text-sm` / `text-base` are remapped to caption 12 / subheadline 15 / body 17 (in `rem`), with the larger styles as explicit sizes. Text inputs use body (17).

Rules: sizes follow the platform's dynamic type scale (iOS text styles, Android `sp`, web `rem`); never fix a text size except the wordmark and symbols inside fixed-size badges. Titles are limited to 1 or 2 lines with a minimum scale factor of 0.6 to 0.75 so long translations shrink before they truncate. Numbers that change use tabular (monospaced) digits.

## 4. Layout

### 4.1 Spacing scale

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 48`. Screen side margin 16 (header 20). Gap between cards 12. Card inner padding 16. Sheets and forms pad 20. Minimum touch target 44 × 44.

### 4.2 Corner radii (continuous / "squircle" corners)

| Token | Value | Used for |
|---|---|---|
| small | 12 | thumbnails, icon badges (badges use 32% of their size) |
| field | 16 | inputs, code boxes, calm (safety) buttons, banners, date tile |
| row | 20 | settings and profile rows |
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

Shadows are tinted purple, never neutral grey. Web equivalents: `--shadow-soft` = `0 8px 24px -6px` tint + 1 px hairline ring (level 1), `--shadow-float` = `0 10px 30px -6px` (level 2), `--h-glow-shadow` = `0 6px 16px -2px` fill at 42% (glow); CSS blur radii are about twice the SwiftUI shadow radius for the same look.

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
- **Bubble cluster** (photo placeholder, editors; empty states use the mascot, §8.4, which has the same layout): a main orb (80% of the cluster size) carrying a bold symbol in onFill, plus two small companion orbs in other hues (34% top-right, 24% bottom-left). Companions: coral→sunny+grape, tangerine→coral+mint, mint→sky+sunny, sky→mint+pink, otherwise coral+mint.
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
| **Tab switch** | The dock pill (icon + label, §8.3) slides and stretches to the new tab with `snappy` and changes to that tab's colour; the label fades in. The header band cross-fades to the new feature colour (400 ms ease-out). The new icon bounces once and switches to its filled variant. The screen title rolls its characters (numeric-text style transition). New content rises 14 pt with scale 0.98→1 and fades in; old content fades out. Haptic: selection. |
| **Bubble switch** | The filled capsule slides between chips with `snappy` and takes the new bubble's colour; the chip's orb pulses to 1.45× and back with `bouncy`; the header glow cross-fades to the new hue with `gentle`; content is replaced with the tab-switch transition; the chip row scrolls the active chip to the centre. Haptic: medium impact. |
| **Segmented pill, filter chips** | Selection pill slides with `snappy`; grid or list items leaving scale to 0.85 and fade, arriving ones pop in. Haptic: selection. |
| **Send a chat message** | The send button's arrow bounces; haptic light impact. The new bubble pops in from its tail corner: scale 0.4→1 anchored bottom-trailing (own) or bottom-leading (others), opacity 0→1, `bouncy`. The list scrolls to the bottom in 200 ms. Messages present at first load do not animate. The send button scales 0.88→1 with `bouncy` when the field becomes non-empty. |
| **RSVP** | On tap: light impact. When the server confirms "going": the pill turns from coral wash to mint fill, the icon morphs plus→check (symbol replace), the count rolls (numeric text), 22 confetti pieces burst from the button (900 ms: fast start, ease-out, gravity, fade over the last 300 ms), haptic success. Un-RSVP reverses the pill without confetti. |
| **Pull to refresh** | Platform-native indicator tinted grape. When the reload finishes: haptic success, and new items pop in. |
| **Screen entrance** | List items fade up: offset 18→0, scale 0.96→1, opacity 0→1 with `bouncy`, staggered. On the auth screen the logo, each letter of the wordmark, the tagline and the form panel enter in that order. |
| **Scroll** | Cards entering or leaving the viewport scale to 0.94 and fade to 55%, interpolated with scroll position. |
| **Loading (skeleton)** | Placeholder blocks in `field` colour shaped like the content (badge + 3 lines for lists, tiles for the grid) with a white 45% highlight sweeping left to right every 1.3 s. No spinners for first loads; spinners only inside buttons. |
| **Empty states** | The mascot (§8.4) floats and blinks; the block pops in like a list item. |
| **Success** | Mint. Inline banner pops in (scale 0.9→1 + fade, `bouncy`) or the control itself turns mint (copy button: icon morphs to a check for 1.5 s). Big moments (RSVP confirmed, first event / post / item, admitted to a bubble) also show the cheer toast with the cheering mascot (§8.4). Haptic success. |
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

Haptics follow the system setting. The web has none (no `navigator.vibrate`). The complete motion and haptics vocabulary is the table in §8.3.

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

- **Pill tab bar**: the labelled glass dock of §8.3 (it replaces the icon-only bar: active tab = icon + label pill in the feature colour, inactive tabs = icons, glass surface, label fallback rules). Each button keeps an accessibility label and the selected trait.
- **Chat button**: 60 × 60 grape bubble orb with a white 21 bold chat symbol, elevation 2 tinted grape. A 2 px grape ring pulses outward (scale 1→1.4, opacity 45%→0) every 3.2 s. Press: squish 0.88, symbol bounce, light impact. Label "Open chat".

### 6.2 Header and bubble switcher

- Row 1 (side margin 20): screen title (screenTitle style, §8.5: up to 2 lines, shrinks to 26 on narrow screens) and the user's avatar (44) at the trailing edge, which opens the profile sheet.
- Row 2: horizontally scrolling chips, gap 8, vertical padding 6 so glows are not clipped.
  - **Bubble chip**: height 38, padding 11 leading / 16 trailing, a 16 orb in the bubble's hue + the bubble name (subheadline, display, bold, 1 line). Inactive: card fill, hairline edge, ink text. Active: capsule in the bubble hue's gradient with glow, text in onFill, orb gets a 1.5 white ring.
  - **"+ New" chip**: same height, dashed 1.5 outline (dash 5, gap 4) in grape text colour at 55%, plus symbol and label in grape text.
- The header sits on the feature band (§8.1). Everything on the band except the title has its own opaque surface (chips: card fill; "+ New": card fill with its dashed edge; search and avatar buttons), so only `ink` text ever sits on the band itself.

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
- **Section header**: sectionTitle text plus a counter badge (caption bold in the feature text colour on its wash, capsule). An optional add button sits at the trailing edge and wraps below the title when the translation is long. Events and Food Circle use the same layout on every platform: the Add button on the first section ("My events" / "My posts"), a counter on both sections, an empty state per empty section.

### 6.4 Buttons

| Button | Spec |
|---|---|
| **Primary** | One per screen or sheet (the main action; everything else is secondary, ghost or a section Add button). Full width, minimum height 54, radius 27 (pill), hue gradient (grape by default; a feature hue inside that feature), 1 px white 22% inner edge, glow shadow, label headline in onFill. Disabled: fill at 38%, no shadow. Busy: spinner in onFill replaces the label. |
| **Secondary** | Same size and shape, hue wash, label in hue text. |
| **Add (section action)** | Capsule, minimum height 40, padding 16, feature gradient, plus symbol (heavy) + label (subheadline bold) in onFill, glow shadow. The plus bounces on tap. |
| **Round icon** | 38 to 44 circle: hue wash with hue text symbol, or hue gradient with onFill symbol (filled variant). |
| **Calm primary** (safety) | Radius 16, flat `fill`, no gradient, shadow or squish; pressed = 80% opacity. |
| **Destructive** | Radius 16, flat danger `#D92D3A`, white label; disabled at 35%. Soft destructive (Leave bubble): pill, danger at 10% fill, danger text. |

### 6.5 Inputs

- **Text field**: minimum height 52, radius 16, `field` fill, horizontal padding 16, text in body (17), a **1 px `fieldBorder` edge** (≥ 3:1 against background and card, WCAG 1.4.11). Focused: the edge becomes a **2 px `focusRing`** (grape text shade), 200 ms fade; on the web the second pixel is an inset shadow so the text doesn't move. Errors use `dangerText` at 2 px. Multi-line fields add 12 vertical padding. Placeholder in `inkSecondary` (web) or the platform's placeholder colour.
- **Field-shaped rows** (date, stepper) and **code boxes** use the same shell: `field` fill, radius 16, 1 px `fieldBorder` (code boxes: 2 px `focusRing` on the active box).
- **Chat composer** and **search field**: radius 24 on the card colour with the 1 px `fieldBorder` (2 px `focusRing` when focused), composer 1 to 5 lines, plus a 48 round send button (grape gradient with glow when it can send; `field` fill and secondary arrow when it cannot). The composer bar has a blurred background.
- **Segmented pill**: capsule track in `field`, padding 4; segments minimum height 40, label subheadline bold, shrinks to 70%; the selected segment is a capsule in the hue gradient with onFill text that slides between positions.
- **Filter / tag chip**: height 38, padding 16, `field` fill and secondary text when inactive; hue gradient, onFill text and glow when active.
- **Stepper row, date row**: same shell as a text field (52, radius 16, `field`); the value in grape text, display heavy.
- **Photo picker**: dashed-outline wash block (radius 24) with a camera bubble cluster and "Choose a photo".

### 6.6 Avatars

Circle with a 2 px ring in the card colour (1.5 below 32). With a photo: the photo, scaled to fill. Without: initials (up to two, display bold, 38% of the diameter) in onFill on the gradient of the person's hue (2.3). Sizes: 20 to 24 inline, 30 in chat, 40 in lists, 44 in the header, 112 in the profile sheet, where it also gets a 3 px rainbow ring (grape, pink, sunny, mint, sky) and a 38 grape camera badge.

### 6.7 Sheets

Platform bottom sheet with radius 32, a visible grabber and the app `background` colour. Title in the navigation bar (inline), "Cancel"/"Close" leading, "Save"/"Done" trailing. Forms inside use the inputs above on the background, never grouped system lists.

### 6.8 Empty states

A block with radius 24, the feature's wash at 60%, a dashed 1.5 outline (dash 6, gap 6) in the feature text colour at 25%, padding 28 × 24: the **curious mascot** (96, §8.4) · title (headline, display, black) · one line of secondary text, all centred. One per empty section, in the section's feature colour (Home and Chat: the bubble's colour). Copy: `docs/i18n-glossary.md`, "Brand redesign".

### 6.9 Safety surfaces (report, blocked users, delete account)

Same tokens, but deliberately still: no floating orbs, no confetti, no bouncy entrances, no gradients on buttons, **no mascot** (§8.4). Use calm primary and destructive buttons, plain cards, a system symbol instead of a bubble cluster, and standard fades. Every safety container is marked calm (web `data-calm`; iOS/Android a `calm` environment value / CompositionLocal) and the mascot refuses to draw inside one. The only colour accents are grape for the selected reason, mint for "report sent" and danger for deletion.

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

## 8. Brand redesign (2026-11)

Five changes that together make Boolaa louder and more of a character: **bubble-hue chat** (8.2), a **labelled glass dock with one motion and haptics vocabulary** (8.3), **feature-coloured headers** (8.1), the **bubble mascot** for empty and waiting states (8.4) and **chunky display type with sticker labels** (8.5). Every value here is normative for all three clients. Status: web done (`apps/boolaa-web`, tokens in `src/lib/brand.ts` + `globals.css`); iOS and Android follow this section exactly. Existing guarantees stay: axe clean in light and dark, 44 pt / 48 dp / 24 px targets, every animation has its reduced-motion form, visible focus ring.

### 8.1 Colour roles: feature colour on top, bubble colour on the bubble

The rule that lets feature headers and bubble-hue chat coexist:

- **Feature colour = where you are in the app.** It owns the **header band** of each screen and the **dock pill**. Home grape, Events coral, Food Circle tangerine, Marketplace mint, Links sky, Settings indigo.
- **Bubble colour = which group you're in.** It owns the **bubble chips** (active chip gradient + glow), the **Home hero card**, **your own chat messages**, the chat composer's send button and the chat orbs.
- **Chat is the one exception:** its band takes the **bubble** colour, not grape. Chat is the bubble's own room, its content is mostly your messages in the bubble colour, and a grape band would put a third colour on the screen. Links keeps sky (it is a feature list, like Events), and Settings keeps indigo: distinct from Home's grape, calm, and the same colour as its dock pill.
- Grape stays the colour of the chat *feature* outside the chat (chat button, feed badge and sticker, reactions).

**Band geometry.** The band is the full width of the content area (on wide layouts it starts at the sidebar edge) and exactly as tall as the header (title row + chip row + bottom padding 16). It never reaches the content below, so section titles, counters and cards never sit on it.

| Band layer | Light | Dark |
|---|---|---|
| Tint | the feature hue's `fill` at **28 %** over `background` | `fill` at **22 %** over `background` |
| Fade (applied to the tint and the circles together, as a mask) | opaque from the top to 45 % of the band height, linear to transparent at 100 % | same |
| Circle 1 | Ø 220, right edge −70, top −110 (mostly off-screen), white 20 % | Ø 220, same place, `background` at 40 % |
| Circle 2 | Ø 110, right 26 % of the width, top −62, white 20 % | `background` at 40 % |
| Ring | Ø 30, 2 px stroke, right 38 %, top 22, white 20 % | `background` at 40 % |
| Cross-fade on tab or bubble change | the tint colour animates 400 ms ease-out (web: registered `--band` colour property) | same; reduced motion 200 ms |

Dark-mode circles are the background colour, not white, so they only ever *raise* the contrast of light text. What may sit directly on the band: the screen title (ink) and nothing else; every other control on it has its own opaque surface (card-filled chips, the "+ New" chip on card, search and avatar buttons). Measured ratios: §8.6.

### 8.2 Chat: your messages in the bubble's colour

| Element | Spec |
|---|---|
| **Your message** | Fill = the **bubble's** gradient (§2.1: `fill → deep` for grape/indigo, `glow → fill` for the six bright hues) with its glow shadow; text, links and icons in the hue's **onFill** (white on grape and indigo, ink on the rest). Shape as before: radius 21, tail corner 6 bottom-trailing. |
| **Gloss highlight** | A pill 26 × 6, white 45 %, rotated −4°, at (14, 3) from the bubble's top-leading corner: inside the 10 pt top padding, so it never touches text. Not drawn on photo messages. |
| **Others' message** | Fill = the **sender's** wash (§2.1: `fill` 14 % light / 24 % dark) over `card`, plus a **3 px edge** in the sender's `fill` on the leading side (inside the shape) and the level-1 card shadow; text `ink`. The edge is decorative: the name above the first message of a group and the avatar carry identity. Shape: radius 21, tail corner 6 bottom-leading. |
| **Links** | Your messages: onFill, underlined (decoration onFill at 70 %). Others': the sender hue's `text` shade, underlined at 60 %. Both ≥ 4.5:1 on every hue (§8.6). |
| **Sender name** | The sender hue's `text` shade on the thread panel (unchanged). "You" over your own group in `inkSecondary`. |
| **"Sending…"** | The message keeps its full colours (no dimming, so the text keeps its contrast) but drops its glow; below it a status line with a clock icon (12) and "Sending…" in `inkSecondary`. |
| **"Not sent"** | Full colours, a **2 px `dangerText` outline** offset 2 around the bubble, and below it a warning-triangle icon (13) + "Not sent" in `dangerText` (bold), then Try again (grape text, underlined) and Don't send (`inkSecondary`). Never colour-only: icon + words. |
| **Reactions** | Chips under the message on the thread panel keep the chat feature colour whatever the bubble hue: `field` fill + ink when it isn't yours, the grape gradient + white when you reacted (plus "You reacted" in its accessible label, so never colour-only). |
| **Deleted** | Unchanged on every hue: dashed 1.5 `hairline` outline, no fill, italic "This message was deleted" in `inkSecondary`. |
| **Photo** | The photo fills the bubble edge to edge (your fill or the sender's wash shows around the caption only); no gloss. |
| **Replies** | There are no replies yet. When they arrive: the quoted block inside a bubble uses onFill at 12 % (yours) or the sender's `text` shade at 10 % (others) with a 3 px bar in onFill 60 % / the quoted sender's `fill`, text in onFill / ink. |
| **"Mine" is never colour-only** | Your messages stay right-aligned (trailing), carry "You" on their group and in their accessible label ("You, 3:08 PM"). |
| **Thread panel** | Card at 50 % over the background, radius 32, level-1 shadow (unchanged). |
| **Background orbs** | Three bubble orbs (§4.5) behind the thread, clipped to the panel: the bubble's hue Ø 220 at right −14 % / top 6 %; its first companion Ø 110 at left −8 % / bottom 14 %; its second companion Ø 64 at right 18 % / bottom −4 % (companions as in §4.5). Opacity **6 % light / 10 % dark** (light is capped by the worst pair: a tangerine name over a grape orb). They bob 5 to 6 pt on 7 / 9 / 8 s sines; under reduced motion they are drawn once and never move. |

### 8.3 Labelled glass dock, motion and haptics

**Geometry** (pt / dp / px):

| Part | Value |
|---|---|
| Row | floats 8 above the bottom safe area; side margin 16 (12 below 360 wide); gap 10; chat orb 60 at the trailing end (unchanged) |
| Bar | capsule, padding 5, fills the row's width left of the chat orb; tab height 46 |
| Inactive tab | icon 20 (outline variant, stroke 2.2), `inkSecondary`; slot at least 40 wide, the slots share the free width equally; touch target ≥ 44 pt / 48 dp (enlarge the hit area), web ≥ 24 |
| Active tab, labelled | a capsule 46 high in the feature gradient with glow: padding 14 leading / 16 trailing, icon 20 (filled variant, stroke 2.6) + gap 6 + label (display, 14, extra-bold 800, 1 line, onFill) |
| Active tab, icon only | a 46 circle in the feature gradient, centred in its slot |

**When the label shows.** Measure the label in its font at the current text size. It shows when `2 × 5 + 4 × 40 + (14 + 20 + 6 + labelWidth + 16) ≤ barWidth`, where `barWidth = rowWidth − 2 × sideMargin − 60 − 10`. Otherwise the active tab falls back to the icon-only circle and the label survives only as the accessibility label. Never truncate or shrink the label. Also icon-only, whatever the width: iOS at `dynamicTypeSize ≥ .accessibility1` (the dock offers the Large Content Viewer instead) and Android at `fontScale ≥ 1.5`. In practice (en, 390 wide): Home, Events and Settings show their label, Food Circle and Marketplace fall back; at 320 wide every tab is icon-only. Re-measure on rotation, window resize, text-size change and locale change.

**Accessibility.** Every tab keeps its accessibility label (the visible label is the same word) and the selected trait / `aria-current="page"`; the inactive tabs keep a tooltip/long-press label.

**Glass.**

| Layer | Light | Dark |
|---|---|---|
| Surface | `card` at **72 %** + background blur 24 with saturation ×1.8 (iOS `.ultraThinMaterial` tinted with card 72 %; Compose: card 72 % + `Modifier.blur`/RenderEffect on API 31+, card 90 % without blur below) | `card` at **80 %**, same blur |
| Top edge | 1 px inner highlight, white 75 % | white 14 % |
| Hairline | 1 px `hairline` | same |
| Shadow | `#2A1B5E` 32 %, blur 36, y 16, spread −12; plus `#2A1B5E` 8 %, blur 6, y 2 | black 60 %, blur 36, y 16, spread −12; plus black 30 %, blur 6, y 2 |

**The pill moves** with the `snappy` spring (response 0.32 s, damping 0.78; Compose `spring(dampingRatio = 0.78f, stiffness = 385f)`; web `--ease-snappy` over 420 ms): its position and its width animate together, so it slides *and* stretches from the old tab to the new one and changes colour (200 ms). The label fades in over 200 ms ease-out after a 60 ms delay while moving 4 → 0 from the leading side; the new icon pops (bouncy). Reduced motion: the pill jumps (no slide, no stretch), the label only fades.

**Motion and haptics vocabulary.** One table for every interaction; springs are §5.2. iOS haptics are `UIFeedbackGenerator` subclasses (SwiftUI `sensoryFeedback` equivalents), Android `View.performHapticFeedback(HapticFeedbackConstants.*)`. The **web has no haptics: `navigator.vibrate` is never used** (it ignores the system haptics setting and only exists on some Android browsers).

| Interaction | Animation | Reduced motion | iOS | Android | Web |
|---|---|---|---|---|---|
| Tab switch | pill slides + stretches (`snappy`), band cross-fades 400 ms ease-out, icon pop (`bouncy`, scale 0.4 → 1), label fade 200 ms + 4 pt slide, content rises 14 pt with scale 0.98 → 1 (`gentle`) | pill jumps, band and label 200 ms fade, content fades | `UISelectionFeedbackGenerator.selectionChanged()` | `SEGMENT_TICK` (API 34+, else `CLOCK_TICK`) | none |
| Bubble switch | chip capsule slides (`snappy`), chip orb pulses 1.45× (`bouncy`), band of the Chat screen cross-fades, content as tab switch | jump + 200 ms fades | `UIImpactFeedbackGenerator(style: .medium)` | `CONTEXT_CLICK` | none |
| Add (section Add, "+ New", chat button, photo picker) | press squish 0.96 (pills) / 0.88 (round) with `press`; plus symbol bounces; the sheet rises from below (`gentle`, scale 0.98 → 1) | dim to 70 %, sheet fades 200 ms | `UIImpactFeedbackGenerator(style: .light)` | `VIRTUAL_KEY` | none |
| Success: RSVP confirmed, first event / post / item, admitted to a bubble | cheer toast pops (scale 0.9 → 1, `bouncy`) with the cheering mascot hopping 3 × 600 ms (up 8 % of the orb, `bouncy`); RSVP also turns mint and bursts 22 confetti (900 ms) | toast fades in 200 ms, mascot still, no confetti | `UINotificationFeedbackGenerator.notificationOccurred(.success)` | `CONFIRM` (API 30+, else `VIRTUAL_KEY`) | none |
| Small success: copied, saved, refresh finished | the control turns mint, icon morphs to a check for 1.5 s; "Saved" banner pops (`bouncy`) | colour change + 200 ms fade | `.success` | `CONFIRM` | none |
| Destructive: delete, leave, remove member, block, delete account | **never bounces**: no squish (pressed = 80 % opacity), no pop; the confirmation dialog fades 200 ms; the removed row simply disappears (no exit animation, no scale) | same | `UIImpactFeedbackGenerator(style: .rigid)` on confirm | `LONG_PRESS` on confirm | none |
| Error: form or sign-in failure, failed send | submit button shakes (−10, 9, −6, 3, 0 pt over 530 ms); a failed load shows the worried mascot | no shake; mascot still; the error text and alert carry it | `.error` | `REJECT` (API 30+, else `LONG_PRESS`) | none |
| Pull to refresh | platform indicator tinted grape; new items pop in (`bouncy`, staggered 45 ms, first 8) | items fade in | `.success` when the reload finishes | `CONFIRM` when it finishes | browser native, none |
| Reaction | a chip that appears pops (scale 0.4 → 1, `bouncy`); a changed count pops softly (scale 0.9 → 1, `bouncy`); a chip whose count reaches 0 is removed (no exit animation) | 200 ms fade, count changes in place | add `.impact(.light)`, remove `.selection` | add `VIRTUAL_KEY`, remove `CLOCK_TICK` | none |
| Send message | arrow bounces; the bubble pops from its tail corner (scale 0.4 → 1, `bouncy`); list scrolls to the end in 200 ms | bubble fades in, list jumps | `.impact(.light)` | `VIRTUAL_KEY` | none |
| RSVP tap | pill squish (`press`); see Success when the server confirms; un-RSVP reverses the colour without confetti | dim, colour change | `.impact(.light)` on tap | `VIRTUAL_KEY` | none |
| Toggle (switch, filter chip, segmented pill, "Hide taken") | thumb / selection capsule slides (`snappy`) | jumps | `.selection` | `TOGGLE_ON` / `TOGGLE_OFF` (API 34+, else `CLOCK_TICK`) | none |

Haptics always follow the system setting (iOS "System Haptics", Android "Touch feedback"); they play under reduced motion too.

### 8.4 The mascot

The main orb of the empty-state cluster gets a face. Drawn in code (SVG on the web, `Canvas` on iOS, `DrawScope` on Android), never an image asset; decorative (hidden from assistive tech: the text next to it carries the meaning).

**Composition.** Default size 96 (empty states), 72 (load error), 40 without companions (cheer toast). The main orb is 80 % of the size at (10 %, 10 %), the companions as in §4.5 (34 % top-right, 24 % bottom-left, same companion pairs). The main orb is the normal bubble orb (§4.5) in the screen's hue: the feature colour, or the bubble colour on Home and in Chat; grape for load errors.

**Face geometry** on a 100 × 100 box laid over the main orb (so every number is a percentage of the orb's diameter; y grows downwards). Face colour = the hue's onFill (**ink** on the bright hues, **white** on grape and indigo); eye shine = white on ink faces, the hue's `deep` on white faces. Strokes have round caps and joins.

| Part | curious (empty) | sleepy (offline) | cheering (success) | worried (error) |
|---|---|---|---|---|
| Eyes | filled ellipses rx 5.8, ry 7.6 at (35, 52) and (65, 52); shine circle r 2 at (+1.6, −2.4) from each eye centre | closed: two arcs `M29 54 Q35 59 41 54` and `M59 54 Q65 59 71 54` (curving down), stroke 3.2 | happy arcs `M29 56 Q35 48 41 56` and `M59 56 Q65 48 71 56` (curving up), stroke 3.2 | ellipses rx 4.6, ry 6 at (35, 55) and (65, 55), shine as curious |
| Brows | none | none | none | `M28 45 L40 40` and `M60 40 L72 45` (inner ends up), stroke 2.6 |
| Mouth | small "o": ellipse rx 4.4, ry 5 at (50, 69), filled | tiny ellipse rx 3, ry 2.2 at (50, 70), filled | open smile: `M38 64 Q50 82 62 64 Z` filled (stroke 2, round join) + tongue ellipse rx 5, ry 2.6 at (50, 72.5) in `#FF6B8A` | frown `M42 72 Q50 65 58 72`, stroke 3.2 |
| Cheeks | ellipses rx 6, ry 3.5 at (25, 64) and (75, 64), `#FF4F8B` at 45 % | same, 45 % | same, **65 %** | same, 45 % |
| Extra | none | two "breath" bubbles: white circles r 3 at (80, 28) 70 % and r 2 at (87, 18) 55 % | none | none |
| Motion | blink + bob | breathe: scale 1 → 1.03 → 1 over 4.8 s, ease-in-out, no blink | hop: up 8 % of the orb and back, 600 ms (`bouncy`), 3 times, then rests | blink + bob |

- **Blink** (curious, worried): the eyes scale vertically to 10 % and back around their own centre, closed at 96 % of a 4.2 s loop (closing 94 → 96 %, opening 96 → 98 %, ≈ 170 ms in all).
- **Bob**: the face orb 4 pt on a 5.2 s sine, companions 5 pt / 3.8 s and 3 pt / 4.6 s (as the cluster).
- **Reduced motion**: no blink, bob, breathe or hop: the mascot is drawn once, still.
- **Never on safety surfaces**: report, block / blocked users, delete account, the suspended screen, moderation (`/admin`) and any safety confirmation. Those containers are marked calm and the mascot refuses to draw inside them (web: `[data-calm] .mascot { display: none }`; apps: a `calm` environment value / CompositionLocal that the mascot reads and returns an empty view for). They keep the plain system symbol of §6.9.

**Where each expression appears:**

| Expression | Screens and states |
|---|---|
| curious | every empty state: Home feed (bubble colour), Chat with no messages (bubble colour), Events "My events" / "Bubble events" / no events at all (coral), Food Circle "My posts" / "From the bubble" / nothing at all (tangerine), Marketplace (mint), Links (sky), Search with no results (grape) |
| sleepy | the inline load error ("Couldn't load this…") while the connection state is `offline` or `unreachable`: nothing to show and no connection. The offline pill itself stays a plain pill. |
| worried | the same inline load error while online (the server answered with an error) |
| cheering | the cheer toast: RSVP confirmed ("You're going!", mint), your first event (coral), your first food post (tangerine), your first market item (mint), admitted to a bubble ("You're in…", in the bubble's colour, once, on the Home of that bubble) |

"First" means you had none in this bubble before the save (events: none upcoming). The **cheer toast** is a pill (card fill, level-2 shadow, hairline) floating 96 above the bottom safe area, centred: the cheering mascot 40 without companions + the text (display 15, extra-bold, ink). It stays 2.8 s, is announced politely, never takes focus and never blocks taps. Copy for empty states and cheers: `docs/i18n-glossary.md`, "Brand redesign".

### 8.5 Display type and stickers

**Screen title** (tab titles, the onboarding title):

| | Web | iOS | Android |
|---|---|---|---|
| Face | `ui-rounded, "SF Pro Rounded", Nunito` | SF Pro Rounded | Nunito (variable) |
| Size | `clamp(1.625rem, 15vw − 1.375rem, 2.375rem)`: 26 px at 320 wide, 38 px from 400 up | 38 pt `.system(size: 38, weight: .black, design: .rounded)`, scaled with `@ScaledMetric(relativeTo: .largeTitle)`; `minimumScaleFactor(0.68)` | 38.sp, auto-size down to 26.sp when it doesn't fit |
| Weight | 900 | `.black` | `FontWeight.Black` (900) |
| Tracking | −0.025 em | −0.95 pt (`.tracking(-0.95)`) | `letterSpacing = (-0.025).em` |
| Line height | 1.08 | default | 41.sp |
| Lines | up to 2, wraps (hyphenates where the language allows), never truncates | `lineLimit(2)` | `maxLines = 2` |

Pushed screens (Chat, Links) use the same face and weight at 32 (web `clamp(1.5rem, 10vw − 0.5rem, 2rem)`). Section titles: 20, black, −0.01 em. Feed titles (event, item, link titles and chat previews on Home): display face, 17 bold.

**Brand gradient text** is reserved for the **Home title** (its band is the brand colour) and the marketing wordmark/hero; other titles are ink. It is only ever used at **≥ 24 pt bold** (large text, 3:1): stops are the hue **text** shades, `grape → pink (55 %) → tangerine`, angle 100° (leading → trailing, slightly downwards): light `#5135CF → #B8246F → #A85800`, dark `#B7A6FF → #FF9CCB → #FFB866`. Lightest stop: tangerine text, **3.39:1** on the Home band in light mode (4.91 on the plain background), 8.66 in dark. In forced-colours / high-contrast modes the gradient is replaced by the plain text colour. (iOS `.foregroundStyle(LinearGradient(...))`, Android `TextStyle(brush = Brush.linearGradient(...))`, web `background-clip: text`.)

**Sticker "kind" labels** (Home feed: CHAT, EVENT, FOOD CIRCLE, MARKETPLACE, LINK):

| Property | Value |
|---|---|
| Text | display 12, black (900), uppercase, tracking 0.06 em, 1 line, onFill of the feature hue |
| Pill | min height 22, padding 2 × 8, capsule, the feature gradient (§2.1), 2 margin around it |
| Die-cut edge | 2 px white at 95 % around the pill (both modes) + shadow in the hue's `fill` at 45 %, blur 8, y 3, spread −2 |
| Tilt | fixed per kind: chat −3°, event +2°, food −2°, market +3°, link −2° |
| Contrast | onFill on the gradient: ≥ 4.55:1 on every hue (§8.6) |
| Large text | the tilt is 0° when it could clip: web below 360 CSS px wide (which also covers 200 % zoom on phones), iOS at `dynamicTypeSize ≥ .accessibility1`, Android at `fontScale ≥ 1.5`. The relative time next to it stays plain `inkSecondary` text. |

Reading order is unaffected: the sticker is plain text in the card's accessible label. (RTL, when it comes: mirror the tilt sign.)

### 8.6 Contrast of the new pairs (WCAG 2.2 AA, measured)

Checked by `apps/boolaa-web/tests/brand.spec.ts` over the token table in `src/lib/brand.ts` (and that `globals.css` ships the same strengths). Ratios are rounded down.

| Pair | Light | Dark |
|---|---|---|
| ink (title) on the feature band, incl. circles, worst hue | 11.22 (grape) | 10.0 (sunny) |
| inkSecondary on the band, worst hue | 4.58 (grape) | 4.64 (sunny) |
| ink on the band per hue: grape, coral, mint, sky, sunny, pink, tangerine, indigo | 11.2, 12.3, 13.1, 12.7, 14.5, 11.9, 13.3, 11.3 | 13.4, 12.0, 11.2, 11.6, 10.0, 12.4, 11.1, 13.2 |
| gradient title stops on the Home band (grape, pink, tangerine text) | 4.99, 3.91, **3.39** (large text) | 6.98, 7.66, 8.66 |
| onFill on own message / sticker / dock pill gradient (top / bottom stop): grape, coral, mint, sky, sunny, pink, tangerine, indigo | 4.74/6.65, 8.30/6.11, 11.2/8.00, 9.49/6.70, 13.1/11.1, 7.95/5.32, 10.4/8.07, 4.55/6.42 | same |
| ink on others' message (sender wash over card), worst | 14.2 | 8.19 |
| sender `text` (links) on its own wash over card: grape … indigo | 6.32, 4.71, 4.73, 4.78, 5.05, 5.09, **4.65**, 5.37 | 5.96, 5.46, 6.52, 5.82, 6.40, 6.00, 5.96, 5.98 |
| over the chat orbs, worst pair: sender names / inkSecondary / dangerText | 4.61 (tangerine over grape) / 6.22 / 5.24 | 6.89 / 6.14 / 6.45 |
| inactive dock icon (inkSecondary) on the glass over black / white content (UI, 3:1) | 3.50 | 3.61 |
| ink on the cheer toast and stickers' card | as §2.5 | as §2.5 |

The 3 px sender edge and the band circles are decorative (no contrast requirement).
