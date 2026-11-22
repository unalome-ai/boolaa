import type { CSSProperties } from "react";

const COLORS = ["var(--grape)", "var(--coral)", "var(--mint)", "var(--sky)", "var(--sunny)", "var(--pink)", "var(--tangerine)"];

/**
 * 22-piece burst from the centre of the parent (RSVP, 5.3): 900 ms, fast start, a little gravity,
 * fading over the last 300 ms. Hidden entirely under reduced motion (see .confetti in globals.css).
 * Re-mount (change `key`) to play again.
 */
export function Confetti() {
  return (
    <span aria-hidden className="confetti pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.35;
        const dist = 46 + ((i * 37) % 40);
        const style = {
          left: "50%",
          top: "50%",
          width: i % 3 === 0 ? 6 : 8,
          height: i % 3 === 0 ? 6 : 4,
          borderRadius: i % 3 === 0 ? 9999 : 2,
          background: COLORS[i % COLORS.length],
          "--dx": `${Math.round(Math.cos(angle) * dist)}px`,
          "--dy": `${Math.round(Math.sin(angle) * dist * 0.8 - 18)}px`,
          "--rot": `${(i * 97) % 540 - 270}deg`,
          animation: "confetti 900ms cubic-bezier(0.15, 0.85, 0.35, 1) forwards",
        } as CSSProperties;
        return <span key={i} className="absolute" style={style} />;
      })}
    </span>
  );
}
