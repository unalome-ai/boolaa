"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { cx } from "@/lib/utils";

const LENGTH = 6;

/**
 * Six boxes that behave as one field: typing moves forward, Backspace moves back, arrows move,
 * pasting (anywhere) or one-time-code autofill fills every box. Calls `onComplete` once all six
 * digits are in. The first box carries `autocomplete="one-time-code"` so browsers offer the code.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus = true,
  label,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
  id?: string;
}) {
  const t = useTranslations("auth");
  const groupId = useId();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (autoFocus && !disabled) refs.current[Math.min(value.length, LENGTH - 1)]?.focus();
    // Focus once on mount (and again when re-enabled), not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, disabled]);

  const commit = (next: string, focusAt?: number) => {
    const clean = next.replace(/\D/g, "").slice(0, LENGTH);
    onChange(clean);
    if (focusAt !== undefined) refs.current[Math.max(0, Math.min(focusAt, LENGTH - 1))]?.focus();
    if (clean.length === LENGTH) onComplete?.(clean);
  };

  const onInput = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    if (typed.length > 1) {
      // Autofill / paste into one box: spread from this box on.
      const next = (value.slice(0, i) + typed).slice(0, LENGTH);
      return commit(next, next.length);
    }
    const arr = [...digits];
    arr[i] = typed;
    const next = arr.join("").slice(0, LENGTH);
    // Only keep a contiguous prefix (a gap would make the value ambiguous).
    const contiguous = arr.findIndex((d) => !d) === -1 ? next : arr.slice(0, arr.findIndex((d) => !d)).join("");
    commit(contiguous, i + 1);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) commit(value.slice(0, i) + value.slice(i + 1), i);
      else if (i > 0) commit(value.slice(0, i - 1) + value.slice(i), i - 1);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < LENGTH - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    const next = text.slice(0, LENGTH);
    commit(next, next.length);
  };

  return (
    <div role="group" aria-labelledby={groupId} data-testid="code-input">
      <span id={groupId} className="label">
        {label ?? t("codeLabel")}
      </span>
      <div className="flex justify-between gap-2 sm:gap-2.5">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={i === 0 ? id : undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={i === 0 ? LENGTH : 1}
            aria-label={t("codeDigit", { n: i + 1 })}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            value={d}
            onChange={(e) => onInput(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            data-testid="code-digit"
            className={cx(
              "h-14 w-full min-w-0 rounded-field border bg-field text-center font-display text-[26px] font-extrabold tabular-nums text-fg outline-none transition-[border-color,box-shadow,background-color]",
              "focus:border-focus focus:bg-card focus:shadow-[inset_0_0_0_1px_var(--focus-ring)]",
              invalid ? "border-danger-ink shadow-[inset_0_0_0_1px_var(--danger-ink)]" : "border-field-border",
              disabled && "opacity-60",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Seconds left before "Resend code" is allowed again; `start()` restarts the countdown. */
export function useCooldown(initialUntil = 0) {
  const [until, setUntil] = useState(initialUntil);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [until]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return {
    left,
    start: (seconds: number, from = Date.now()) => {
      setNow(Date.now());
      setUntil(from + seconds * 1000);
    },
  };
}

/** "Resend code" text button with its countdown. */
export function ResendButton({ left, busy, onClick }: { left: number; busy?: boolean; onClick: () => void }) {
  const t = useTranslations("auth");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={left > 0 || busy}
      className="font-semibold text-brand-ink hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
      data-testid="resend-code"
    >
      {left > 0 ? t("resendIn", { seconds: left }) : t("resendCode")}
    </button>
  );
}
