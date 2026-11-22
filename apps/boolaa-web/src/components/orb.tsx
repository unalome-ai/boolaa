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

/** Empty-state cluster: a main orb carrying a symbol, plus two companions. */
export function BubbleCluster({ hue, size = 84, children, animated = true }: { hue: Hue; size?: number; children?: ReactNode; animated?: boolean }) {
  const [a, b] = COMPANIONS[hue] ?? ["coral", "mint"];
  return (
    <span aria-hidden className="relative inline-block" style={{ width: size, height: size }}>
      <span className={cx("absolute", animated && "anim-bob")} style={{ left: size * 0.1, top: size * 0.1, "--bob-period": "5.2s", "--bob": "4px" } as Vars}>
        <Orb hue={hue} size={size * 0.8} />
        <span className={cx("absolute inset-0 flex items-center justify-center", hueClass(hue))} style={{ color: "var(--h-on)" }}>
          {children}
        </span>
      </span>
      <span className={cx("absolute", animated && "anim-bob")} style={{ right: -size * 0.06, top: -size * 0.02, "--bob-period": "3.8s", "--bob": "5px" } as Vars}>
        <Orb hue={a} size={size * 0.34} />
      </span>
      <span className={cx("absolute", animated && "anim-bob")} style={{ left: 0, bottom: size * 0.02, "--bob-period": "4.6s", "--bob": "3px" } as Vars}>
        <Orb hue={b} size={size * 0.24} />
      </span>
    </span>
  );
}

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
