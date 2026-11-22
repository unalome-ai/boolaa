import Link from "next/link";
import { Smartphone } from "lucide-react";

/** App Store / Android download button; with no `href` (not live yet) it shows a "Coming soon" badge. */
export function StoreButton({ href, label, soon, testId }: { href: string | null; label: string; soon: string; testId: string }) {
  const shape = "flex min-h-[50px] w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-[25px] px-5 py-2 font-display text-[15px] font-bold";
  if (href)
    return (
      <Link href={href} className={`press ${shape} bg-card text-fg shadow-soft ring-1 ring-line`} data-testid={testId}>
        <Smartphone size={18} strokeWidth={2.4} aria-hidden /> {label}
      </Link>
    );
  return (
    <span className={`${shape} bg-card/70 text-muted ring-1 ring-line`} data-testid={testId}>
      <span className="inline-flex items-center gap-2">
        <Smartphone size={18} strokeWidth={2.4} className="shrink-0" aria-hidden /> {label}
      </span>
      <span className="hue-grape whitespace-nowrap rounded-full bg-hue-wash px-2.5 py-0.5 text-xs font-extrabold text-hue-ink">{soon}</span>
    </span>
  );
}
