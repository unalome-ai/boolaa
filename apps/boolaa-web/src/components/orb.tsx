import type { CSSProperties, ReactNode } from "react";
import { hueClass, type Hue } from "@/lib/hue";
import { cx } from "@/lib/utils";

// Illustration pieces drawn in CSS (docs/design-system.md 4.5). No hooks: usable from server and
// client components alike.

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export function Orb({ hue, size, className, style }: { hue: Hue; size: number; className?: string; style?: Vars }) {
  return (
    <span
      aria-hidden
      className={cx("orb", hueClass(hue), className)}
      style={{ width: size, height: size, "--orb": `${size}px`, ...style } as Vars}
    />
  );
}

/** Logo: a big grape orb with three bobbing friends. */
export function BubbleLogo({ size = 40, animated = true, className }: { size?: number; animated?: boolean; className?: string }) {
  const friend = (hue: Hue, scale: number, pos: CSSProperties, period: string, bob: number) => (
    <span className={cx("absolute", animated && "anim-bob")} style={{ ...pos, "--bob-period": period, "--bob": `${bob}px` } as Vars}>
      <Orb hue={hue} size={Math.round(size * scale)} />
    </span>
  );
  return (
    <span aria-hidden className={cx("relative inline-block shrink-0", className)} style={{ width: size * 1.25, height: size * 1.2 }}>
      <span className={cx("absolute", animated && "anim-bob")} style={{ left: size * 0.08, top: size * 0.12, "--bob-period": "5.6s", "--bob": `${Math.max(2, size * 0.04)}px` } as Vars}>
        <Orb hue="grape" size={Math.round(size * 0.92)} />
      </span>
      {friend("coral", 0.36, { right: 0, top: 0 }, "4.2s", Math.max(2, size * 0.05))}
      {friend("sunny", 0.2, { right: size * 0.02, top: size * 0.52 }, "3.6s", Math.max(2, size * 0.06))}
      {friend("mint", 0.26, { left: 0, bottom: 0 }, "4.8s", Math.max(2, size * 0.05))}
    </span>
  );
}

const COMPANIONS: Partial<Record<Hue, [Hue, Hue]>> = {
  coral: ["sunny", "grape"],
  tangerine: ["coral", "mint"],
  mint: ["sky", "sunny"],
  sky: ["mint", "pink"],
};

/** The two companion orbs drawn next to a main orb of `hue` (4.5). */
export const companionsFor = (hue: Hue): [Hue, Hue] => COMPANIONS[hue] ?? ["coral", "mint"];

// 16 orbs with fixed (deterministic) placement, so server and client render the same markup.
const AMBIENT: { hue: Hue; x: number; r: number; dur: number; delay: number }[] = [
  { hue: "grape", x: 4, r: 11, dur: 30, delay: -3 },
  { hue: "coral", x: 18, r: 7, dur: 24, delay: -14 },
  { hue: "mint", x: 30, r: 13, dur: 34, delay: -22 },
  { hue: "sunny", x: 44, r: 6, dur: 22, delay: -8 },
  { hue: "sky", x: 56, r: 15, dur: 36, delay: -30 },
  { hue: "pink", x: 70, r: 9, dur: 26, delay: -5 },
  { hue: "grape", x: 84, r: 12, dur: 32, delay: -19 },
  { hue: "coral", x: 94, r: 5, dur: 20, delay: -11 },
  { hue: "mint", x: 10, r: 6, dur: 21, delay: -17 },
  { hue: "sunny", x: 24, r: 10, dur: 29, delay: -26 },
  { hue: "sky", x: 38, r: 5, dur: 23, delay: -2 },
  { hue: "pink", x: 50, r: 11, dur: 31, delay: -13 },
  { hue: "grape", x: 64, r: 7, dur: 25, delay: -21 },
  { hue: "sunny", x: 76, r: 14, dur: 35, delay: -9 },
  { hue: "mint", x: 88, r: 8, dur: 27, delay: -24 },
  { hue: "sky", x: 98, r: 10, dur: 33, delay: -16 },
];

/** Auth / onboarding / landing backdrop: translucent orbs drifting upwards over a soft gradient. */
export function AmbientBackdrop({ className, count = 16 }: { className?: string; count?: number }) {
  return (
    <div aria-hidden className={cx("ambient", className)} data-testid="ambient">
      {AMBIENT.slice(0, count).map((o, i) => (
        <span
          key={i}
          className="ambient-orb"
          style={{ left: `${o.x}%`, "--dur": `${o.dur}s`, "--delay": `${o.delay}s`, "--sway-dur": `${5 + (i % 4)}s` } as Vars}
        >
          <span>
            <span
              className={cx("orb", hueClass(o.hue))}
              style={{ width: `clamp(28px, ${o.r * 2}vw, ${o.r * 18}px)`, aspectRatio: "1", translate: "-50% 0" }}
            />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Feature badge: squircle in the feature gradient with an onFill symbol. */
export function FeatureBadge({ hue, size = 44, children, className }: { hue: Hue; size?: number; children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center bg-hue-grad shadow-glow", hueClass(hue), className)}
      style={{ width: size, height: size, borderRadius: size * 0.32, color: "var(--h-on)" }}
    >
      {children}
    </span>
  );
}

/** Mascot expressions (docs/design-system.md §8.4). */
export type Expression = "curious" | "sleepy" | "cheering" | "worried";

/**
 * The face, on a 100 × 100 box whose circle is the orb (so every value is a percentage of the orb's diameter).
 * iOS (Canvas) and Android (DrawScope) draw the same shapes from the same numbers.
 */
function Face({ expression, white }: { expression: Expression; white: boolean }) {
  const ink = white ? "#ffffff" : "var(--mascot-ink)";
  const shine = white ? "var(--h-deep)" : "#ffffff";
  const stroke = { stroke: ink, strokeWidth: 3.2, strokeLinecap: "round" as const, fill: "none" };
  const cheek = (x: number) => (
    <ellipse cx={x} cy={64} rx={6} ry={3.5} fill="var(--mascot-cheek)" opacity={expression === "cheering" ? 0.65 : 0.45} />
  );
  const openEye = (x: number, y: number, rx: number, ry: number) => (
    <g key={x}>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={ink} />
      <circle cx={x + 1.6} cy={y - 2.4} r={2} fill={shine} />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      {cheek(25)}
      {cheek(75)}
      {expression === "curious" && (
        <>
          <g className="mascot-blink">{[openEye(35, 52, 5.8, 7.6), openEye(65, 52, 5.8, 7.6)]}</g>
          <ellipse cx={50} cy={69} rx={4.4} ry={5} fill={ink} />
        </>
      )}
      {expression === "sleepy" && (
        <>
          <path d="M29 54 Q35 59 41 54 M59 54 Q65 59 71 54" {...stroke} />
          <ellipse cx={50} cy={70} rx={3} ry={2.2} fill={ink} />
          <circle cx={80} cy={28} r={3} fill="#ffffff" opacity={0.7} />
          <circle cx={87} cy={18} r={2} fill="#ffffff" opacity={0.55} />
        </>
      )}
      {expression === "cheering" && (
        <>
          <path d="M29 56 Q35 48 41 56 M59 56 Q65 48 71 56" {...stroke} />
          <path d="M38 64 Q50 82 62 64 Z" fill={ink} stroke={ink} strokeWidth={2} strokeLinejoin="round" />
          <ellipse cx={50} cy={72.5} rx={5} ry={2.6} fill="#ff6b8a" />
        </>
      )}
      {expression === "worried" && (
        <>
          <path d="M28 45 L40 40 M60 40 L72 45" {...stroke} strokeWidth={2.6} />
          <g className="mascot-blink">{[openEye(35, 55, 4.6, 6), openEye(65, 55, 4.6, 6)]}</g>
          <path d="M42 72 Q50 65 58 72" {...stroke} />
        </>
      )}
    </svg>
  );
}

const WHITE_FACE: Hue[] = ["grape", "indigo"];

/**
 * Boolaa's mascot: the empty-state cluster whose main orb has a face (§8.4). Decorative (hidden from assistive
 * tech); the text next to it carries the meaning. Never used on safety surfaces: inside `[data-calm]` it is not
 * drawn at all (globals.css), so a stray use can't reach report, block, delete account or moderation.
 */
export function Mascot({
  expression,
  hue,
  size = 96,
  companions = true,
  className,
}: {
  expression: Expression;
  hue: Hue;
  size?: number;
  companions?: boolean;
  className?: string;
}) {
  const [a, b] = companionsFor(hue);
  const main = Math.round(size * (companions ? 0.8 : 1));
  const motion = expression === "cheering" ? "mascot-cheer" : expression === "sleepy" ? "mascot-breathe" : "anim-bob";
  return (
    <span
      aria-hidden
      data-testid="mascot"
      data-expression={expression}
      className={cx("mascot relative inline-block shrink-0", className)}
      style={{ width: size, height: size, "--mascot": `${main}px` } as Vars}
    >
      <span
        className={cx("absolute", motion)}
        style={{ left: companions ? size * 0.1 : 0, top: companions ? size * 0.1 : 0, "--bob-period": "5.2s", "--bob": "4px" } as Vars}
      >
        <Orb hue={hue} size={main} />
        <span className={cx("absolute inset-0", hueClass(hue))}>
          <Face expression={expression} white={WHITE_FACE.includes(hue)} />
        </span>
      </span>
      {companions && (
        <>
          <span className="anim-bob absolute" style={{ right: -size * 0.06, top: -size * 0.02, "--bob-period": "3.8s", "--bob": "5px" } as Vars}>
            <Orb hue={a} size={size * 0.34} />
          </span>
          <span className="anim-bob absolute" style={{ left: 0, bottom: size * 0.02, "--bob-period": "4.6s", "--bob": "3px" } as Vars}>
            <Orb hue={b} size={size * 0.24} />
          </span>
        </>
      )}
    </span>
  );
}
