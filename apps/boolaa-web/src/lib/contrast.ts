/**
 * WCAG 2.2 contrast helpers (docs/design-system.md §2.5, §8). Pure functions over sRGB hex colours, used by
 * tests/contrast.spec.ts to check every text/background pair of the brand tokens (src/lib/brand.ts).
 */
export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.replace(/./g, "$&$&") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** `top` at `alpha` (0..1) over an opaque `bottom` (straight sRGB blending, like browsers and both apps). */
export function over(top: string | RGB, alpha: number, bottom: string | RGB): RGB {
  const a = typeof top === "string" ? hex(top) : top;
  const b = typeof bottom === "string" ? hex(bottom) : bottom;
  return [0, 1, 2].map((i) => a[i] * alpha + b[i] * (1 - alpha)) as RGB;
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: string | RGB): number {
  const [r, g, b] = typeof c === "string" ? hex(c) : c;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio (1..21). */
export function contrast(a: string | RGB, b: string | RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rounded down to 2 decimals, so a documented ratio is never better than the real one. */
export const ratio = (a: string | RGB, b: string | RGB) => Math.floor(contrast(a, b) * 100) / 100;
