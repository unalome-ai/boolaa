"use client";

/* eslint-disable @next/next/no-img-element -- images come from Supabase storage / Unsplash; plain <img> on purpose */
import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { ArrowLeftRight, Gift, ImagePlus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { BubbleCluster } from "@/components/orb";
import { hueClass, hueFor, type Hue } from "@/lib/hue";
import { cx, initials } from "@/lib/utils";

/** Photo, or initials on the person's hue (derived from their id, see lib/hue). */
export function Avatar({
  name,
  src,
  id,
  size = 40,
  className,
}: {
  name?: string | null;
  src?: string | null;
  /** User id, for the deterministic colour. Falls back to the name. */
  id?: string | null;
  size?: number;
  className?: string;
}) {
  const t = useTranslations("common");
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38) };
  const label = t("avatarOf", { name: name || t("someone") });
  return src ? (
    <img
      src={src}
      alt={label}
      style={style}
      className={cx("shrink-0 rounded-full bg-field object-cover", size < 32 ? "ring-[1.5px]" : "ring-2", "ring-card", className)}
    />
  ) : (
    <span
      role="img"
      aria-label={label}
      style={style}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-hue-grad font-display font-extrabold text-hue-on",
        size < 32 ? "ring-[1.5px]" : "ring-2",
        "ring-card",
        hueClass(hueFor(id ?? name)),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * A bubble's photo (bubbles.logo), or its initials on the bubble's own hue (derived from its id, so the
 * fallback matches the switcher's colour on every client).
 */
export function BubblePhoto({
  bubble,
  size = 40,
  className,
}: {
  bubble: { id: string; name: string; logo?: string | null } | null | undefined;
  size?: number;
  className?: string;
}) {
  const t = useTranslations("common");
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36) };
  const label = t("bubblePhotoOf", { name: bubble?.name ?? "" });
  return bubble?.logo ? (
    <img
      src={bubble.logo}
      alt={label}
      style={style}
      data-testid="bubble-photo"
      className={cx("shrink-0 rounded-full bg-field object-cover ring-2 ring-card", className)}
    />
  ) : (
    <span
      role="img"
      aria-label={label}
      style={style}
      data-testid="bubble-photo-fallback"
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-hue-grad font-display font-extrabold text-hue-on ring-2 ring-card",
        hueClass(hueFor(bubble?.id)),
        className,
      )}
    >
      {initials(bubble?.name)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  const t = useTranslations("common");
  return <Loader2 className={cx("animate-spin text-grape", className)} size={22} aria-label={t("loading")} />;
}

/** First-load skeleton: content-shaped `field` blocks with a shimmer (5.3); static under reduced motion. */
export function PageLoader() {
  const t = useTranslations("common");
  return (
    <div role="status" aria-label={t("loading")} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card flex gap-3 p-4">
          <span className="skeleton h-11 w-11 shrink-0 rounded-[14px]" />
          <div className="flex-1 space-y-2 pt-1">
            <span className="skeleton block h-3 w-1/3 rounded-full" />
            <span className="skeleton block h-3.5 w-4/5 rounded-full" />
            <span className="skeleton block h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Feature-coloured empty block with a floating bubble cluster (6.8). */
export function EmptyState({ icon, title, hint, hue = "grape" }: { icon?: ReactNode; title: string; hint?: string; hue?: Hue }) {
  return (
    <div
      className={cx(
        "anim-pop-soft flex flex-col items-center gap-1.5 rounded-card border-[1.5px] border-dashed px-6 py-7 text-center",
        hueClass(hue),
      )}
      style={{
        background: "color-mix(in srgb, var(--h-wash) 60%, transparent)",
        borderColor: "color-mix(in srgb, var(--h-ink) 25%, transparent)",
      }}
    >
      <div className="mb-2">
        <BubbleCluster hue={hue} size={84}>
          {icon}
        </BubbleCluster>
      </div>
      <p className="font-display text-[17px] font-extrabold">{title}</p>
      {hint && <p className="text-[15px] text-muted">{hint}</p>}
    </div>
  );
}

/** Small dashed note for an empty section. */
export function EmptyNote({ hue = "grape", children }: { hue?: Hue; children: ReactNode }) {
  return (
    <p
      className={cx("rounded-card border-[1.5px] border-dashed px-4 py-5 text-center text-[15px] text-muted", hueClass(hue))}
      style={{ background: "color-mix(in srgb, var(--h-wash) 60%, transparent)", borderColor: "color-mix(in srgb, var(--h-ink) 25%, transparent)" }}
    >
      {children}
    </p>
  );
}

/** Section header with an optional counter badge in the feature colour and a trailing action. */
export function SectionTitle({ children, action, count, hue = "grape" }: { children: ReactNode; action?: ReactNode; count?: number; hue?: Hue }) {
  return (
    <div className={cx("mb-3 mt-7 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 first:mt-0", hueClass(hue))}>
      <h2 className="flex items-center gap-2 text-[20px] font-extrabold">
        {children}
        {count !== undefined && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-hue-wash px-2 font-display text-xs font-extrabold tabular-nums text-hue-ink">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="anim-pop-soft rounded-field bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger-ink">
      {children}
    </p>
  );
}

/** Centered dialog on desktop, bottom sheet on mobile. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const t = useTranslations("common");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center" role="presentation">
      <div className="anim-fade absolute inset-0 bg-[#140c2e]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-route relative max-h-[92dvh] w-full overflow-y-auto rounded-t-hero bg-app p-5 pt-3 shadow-float sm:max-w-lg sm:rounded-hero sm:pt-5"
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted/40 sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="press-round flex h-9 w-9 items-center justify-center rounded-full bg-field text-muted hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Image chooser with preview. `value` is an existing URL, `file` a newly picked file. */
export function ImagePicker({
  value,
  file,
  onFile,
  label,
}: {
  value?: string | null;
  file: File | null;
  onFile: (f: File | null) => void;
  label?: string;
}) {
  const t = useTranslations("common");
  const fieldLabel = label ?? t("photo");
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const shown = preview ?? value ?? null;

  return (
    <div>
      <span className="label">{fieldLabel}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="press relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-card border-[1.5px] border-dashed border-grape-ink/40 bg-brand/10 text-brand-ink hover:bg-brand/15"
      >
        {shown ? (
          <img src={shown} alt={t("selectedPhoto")} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-sm font-medium">
            <ImagePlus size={28} />
            {t("choosePhoto")}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label={fieldLabel}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("market");
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className={cx(
        "inline-flex items-center gap-1 rounded-full bg-hue-grad px-2.5 py-1 font-display text-xs font-black uppercase tracking-wide text-onfill shadow-glow",
        status === "free" ? "hue-mint" : "hue-sunny",
        className,
      )}
    >
      {status === "free" ? <Gift size={13} strokeWidth={2.6} /> : <ArrowLeftRight size={13} strokeWidth={2.6} />}
      {status === "free" ? t("free") : t("trade")}
    </span>
  );
}
