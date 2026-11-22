import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { AmbientBackdrop, BubbleLogo } from "@/components/orb";
import { CompactLocalePicker } from "@/i18n/locale-picker";

/** Auth layout (design-system 4.5 / 5.3): ambient orbs, logo, wordmark, then a frosted panel. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const step = (i: number) => ({ "--i": i }) as CSSProperties;
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-4 py-16">
      <AmbientBackdrop className="-z-10" />
      {/* The picker's own root is `relative`, so position a wrapper (a class on it would be overridden). */}
      <div className="absolute right-4 top-4 z-10">
        <CompactLocalePicker />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Link href="/" aria-label="Boolaa" className="anim-rise" style={step(0)}>
            <BubbleLogo size={76} />
          </Link>
          <p aria-hidden className="mt-2 font-display text-[46px] font-black leading-none tracking-tight">
            {"Boolaa".split("").map((ch, i) => (
              <span key={i} className="anim-rise inline-block" style={step(i + 1)}>
                {ch}
              </span>
            ))}
          </p>
        </div>
        <div
          className="anim-rise rounded-hero bg-card/75 p-6 shadow-float ring-1 ring-line backdrop-blur-2xl sm:p-7"
          style={step(7)}
        >
          <div className="mb-5">
            <h1 className="text-[22px] font-black tracking-tight">{title}</h1>
            <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
