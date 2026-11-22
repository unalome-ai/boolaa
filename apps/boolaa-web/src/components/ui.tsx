"use client";

/* eslint-disable @next/next/no-img-element -- images come from Supabase storage / Unsplash; plain <img> on purpose */
import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cx, initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name?: string | null;
  src?: string | null;
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
      className={cx("shrink-0 rounded-full border-2 border-brand bg-chip object-cover", className)}
    />
  ) : (
    <span
      role="img"
      aria-label={label}
      style={style}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full border-2 border-brand bg-brand/15 font-semibold text-brand",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  const t = useTranslations("common");
  return <Loader2 className={cx("animate-spin text-brand", className)} size={22} aria-label={t("loading")} />;
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-brand">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between first:mt-0">
      <h2 className="text-lg font-bold">{children}</h2>
      {action}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-app p-5 shadow-float sm:max-w-lg sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-chip text-muted hover:text-fg"
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
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-card border-2 border-dashed border-brand/40 bg-brand/5 text-brand hover:bg-brand/10"
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
        "rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide shadow-soft",
        status === "free" ? "bg-emerald-500 text-white" : "bg-accent text-white",
        className,
      )}
    >
      {status === "free" ? t("free") : t("trade")}
    </span>
  );
}
