import type { Hue } from "@/lib/hue";

/**
 * Brand tokens as data (docs/design-system.md §2 and §8 "Brand redesign (2026-11)"). globals.css holds the same
 * values as CSS variables; tests/contrast.spec.ts checks every text/background pair below and that the CSS
 * strengths match these numbers, so the documented ratios can't drift from what ships.
 */
export type HueTokens = { fill: string; glow: string; deep: string; textLight: string; textDark: string; onFill: string };

export const INK = "#1E1638";
const WHITE = "#FFFFFF";

export const HUE_TOKENS: Record<Hue, HueTokens> = {
  grape: { fill: "#7357F6", glow: "#9B86FF", deep: "#5B3FD9", textLight: "#5135CF", textDark: "#B7A6FF", onFill: WHITE },
  coral: { fill: "#FF6B5C", glow: "#FF9A82", deep: "#E8503F", textLight: "#C0392B", textDark: "#FF9A8F", onFill: INK },
  mint: { fill: "#1EC8A0", glow: "#6BE6C6", deep: "#12A683", textLight: "#0B7A60", textDark: "#5FE3C2", onFill: INK },
  sky: { fill: "#3AA8FF", glow: "#7CC9FF", deep: "#1F8DE6", textLight: "#0B6BBF", textDark: "#7CC6FF", onFill: INK },
  sunny: { fill: "#FFC93C", glow: "#FFE07A", deep: "#F2B21B", textLight: "#8A6400", textDark: "#FFD466", onFill: INK },
  pink: { fill: "#F0569F", glow: "#FF8CC0", deep: "#D63D86", textLight: "#B8246F", textDark: "#FF9CCB", onFill: INK },
  tangerine: { fill: "#FF9A2E", glow: "#FFBE5C", deep: "#F07F0C", textLight: "#A85800", textDark: "#FFB866", onFill: INK },
  indigo: { fill: "#5468F0", glow: "#8795FF", deep: "#3F50D0", textLight: "#3F50D0", textDark: "#A3AEFF", onFill: WHITE },
};

/** Gradient stops of a hue, top to bottom (§2.1): fill → deep under white text, glow → fill under ink. */
export const gradientStops = (h: HueTokens) => (h.onFill === WHITE ? [h.fill, h.deep] : [h.glow, h.fill]);

export type Mode = "light" | "dark";

export const SURFACES: Record<Mode, { background: string; card: string; ink: string; inkSecondary: string; dangerText: string }> = {
  light: { background: "#FBF8FF", card: "#FFFFFF", ink: INK, inkSecondary: "#5C5574", dangerText: "#C0272F" },
  dark: { background: "#15111F", card: "#221C33", ink: "#F5F2FF", inkSecondary: "#ABA4C4", dangerText: "#FF8A8F" },
};

/** Hue wash strength (§2.1). */
export const WASH: Record<Mode, number> = { light: 0.14, dark: 0.24 };

/**
 * §8.1 Feature band: the hue `fill` at this strength over the background, full strength over the top 45 % of the
 * header, fading to 0 at its bottom edge. Decoration circles are white 20 % (light) or the background at 40 %
 * (dark), so they only ever raise the contrast of light text in dark mode.
 */
export const BAND = {
  strength: { light: 0.28, dark: 0.22 } as Record<Mode, number>,
  circle: { light: { color: WHITE, alpha: 0.2 }, dark: { color: "background", alpha: 0.4 } } as const,
};

/**
 * §8.2 Chat: faint orbs behind the thread, their darkest stop (`deep`) at this strength over the panel. Light mode is
 * capped by the worst cross pair: a tangerine sender name over a grape orb (4.61:1 at 6 %, 4.47 at 8 %).
 */
export const CHAT_ORB_ALPHA: Record<Mode, number> = { light: 0.06, dark: 0.1 };
/** The thread panel: card at 50 % over the background. */
export const CHAT_PANEL_ALPHA = 0.5;

/** §8.3 Dock glass: card colour at this opacity (plus blur) over whatever scrolls beneath. */
export const DOCK_GLASS: Record<Mode, number> = { light: 0.72, dark: 0.8 };

/** §8.5 Brand gradient for large titles: hue *text* shades, so the lightest stop still passes 3:1 on the band. */
export const TITLE_GRADIENT: Record<Mode, string[]> = {
  light: [HUE_TOKENS.grape.textLight, HUE_TOKENS.pink.textLight, HUE_TOKENS.tangerine.textLight],
  dark: [HUE_TOKENS.grape.textDark, HUE_TOKENS.pink.textDark, HUE_TOKENS.tangerine.textDark],
};

/**
 * §8.1 Which hue owns the band of each screen. Chat is the one screen that belongs to the bubble rather than to a
 * feature, so its band takes the bubble's hue (`"bubble"`), matching your own messages.
 */
export const BAND_HUE = {
  home: "grape",
  events: "coral",
  food: "tangerine",
  marketplace: "mint",
  links: "sky",
  settings: "indigo",
  chat: "bubble",
} as const satisfies Record<string, Hue | "bubble">;

/** §8.5 Sticker "kind" labels on the Home feed: the feature hue and a fixed tilt per kind (degrees). */
export const STICKER_TILT = { chat: -3, event: 2, food: -2, market: 3, link: -2 } as const;
