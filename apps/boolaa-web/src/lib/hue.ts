/**
 * Deterministic colours (docs/design-system.md, 2.3). Every client derives a bubble's or a
 * person's hue from its id the same way, so Flatmates is sky on iOS, Android and the web.
 */
export const HUES = ["grape", "coral", "mint", "sky", "sunny", "pink", "tangerine", "indigo"] as const;
export type Hue = (typeof HUES)[number];

const encoder = new TextEncoder();

/** FNV-1a, 32-bit, over the UTF-8 bytes of `input`. Unsigned result. */
export function fnv1a(input: string): number {
  let hash = 2166136261;
  for (const byte of encoder.encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Hue for a bubble or user id (lowercase, hyphenated UUID). */
export function hueFor(id: string | null | undefined): Hue {
  if (!id) return "grape";
  const hash = fnv1a(id.toLowerCase());
  const folded = (hash ^ (hash >>> 16)) >>> 0;
  return HUES[folded % HUES.length];
}

/** Class that scopes the hue tokens (`--h`, `--h-ink`, ...) to an element. */
export const hueClass = (hue: Hue) => `hue-${hue}`;

/** Feature colours (2.2). */
export const FEATURE_HUE = {
  home: "grape",
  chat: "grape",
  events: "coral",
  food: "tangerine",
  marketplace: "mint",
  links: "sky",
  settings: "indigo",
} as const satisfies Record<string, Hue>;
