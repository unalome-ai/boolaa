"use client";

/** Food "Good until" control and card label (docs/boolaa-spec.md, "Food expiry"). */
import { useId, useState } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cx } from "@/lib/utils";
import {
  EXPIRY_PRESETS,
  customBounds,
  customDefault,
  customValid,
  expiryLabel,
  fromLocalInput,
  presetFor,
  presetValue,
  toLocalInput,
  todayDisabled,
  type ExpiryPreset,
} from "@/lib/food-expiry";

const PRESET_LABEL = { today: "expiryToday", tomorrow: "expiryTomorrow", in3days: "expiryIn3Days", custom: "expiryCustom" } as const;

/**
 * Today · Tomorrow · In 3 days · Custom (radio group styled as segments), default Tomorrow. Custom shows a
 * `datetime-local` limited to now + 15 min … now + 14 days − 5 min. `onChange(date, ok)` fires only when the
 * user changes something, so editing a post leaves `expires_at` alone unless touched.
 */
export function GoodUntilField({ initial, onChange }: { initial: Date | null; onChange: (value: Date | null, ok: boolean) => void }) {
  const t = useTranslations("food");
  const name = useId();
  const [now] = useState(() => new Date());
  const [preset, setPreset] = useState<ExpiryPreset>(() => (initial ? presetFor(initial, now) : "tomorrow"));
  const [custom, setCustom] = useState(() => toLocalInput(initial && presetFor(initial, now) === "custom" ? initial : customDefault(now)));
  const bounds = customBounds(now);

  function choose(p: ExpiryPreset) {
    setPreset(p);
    if (p === "custom") {
      const d = fromLocalInput(custom);
      onChange(d, customValid(d, new Date()));
    } else onChange(presetValue(p, new Date()), true);
  }

  return (
    <fieldset data-testid="good-until">
      <legend className="label">{t("goodUntil")}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-[22px] bg-field p-1 sm:grid-cols-4">
        {EXPIRY_PRESETS.map((p) => {
          const disabled = p === "today" && todayDisabled(now);
          return (
            <label
              key={p}
              className={cx(
                "hue-tangerine relative flex min-h-11 cursor-pointer items-center justify-center rounded-full px-2 text-center text-[15px] font-bold transition-[background,color,box-shadow] duration-300 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                preset === p ? "fill-hue" : "text-muted hover:text-fg",
                disabled && "cursor-not-allowed opacity-40 hover:text-muted",
              )}
            >
              <input
                type="radio"
                name={name}
                value={p}
                checked={preset === p}
                disabled={disabled}
                onChange={() => choose(p)}
                className="sr-only"
                data-testid={`expiry-${p}`}
              />
              {t(PRESET_LABEL[p])}
            </label>
          );
        })}
      </div>
      {preset === "custom" && (
        <input
          type="datetime-local"
          className="input mt-2"
          aria-label={t("expiryCustom")}
          data-testid="expiry-custom-input"
          value={custom}
          min={toLocalInput(bounds.min)}
          max={toLocalInput(bounds.max)}
          onChange={(e) => {
            setCustom(e.target.value);
            const d = fromLocalInput(e.target.value);
            onChange(d, customValid(d, new Date()));
          }}
        />
      )}
      <p className="mt-1.5 text-xs text-muted">{t("expiryHint")}</p>
    </fieldset>
  );
}

/** "Expires in 40 minutes" (warning colour + icon under 1 h) … "Good until 3 Dec, 18:00". */
export function FoodExpiryLabel({ expiresAt, now }: { expiresAt: string; now: number }) {
  const t = useTranslations("food");
  const format = useFormatter();
  const label = expiryLabel(new Date(expiresAt), new Date(now));
  if (!label) return null;
  const urgent = label.kind === "minutes";
  let text: string;
  if (label.kind === "minutes") text = t("expiresInMinutes", { count: label.count });
  else if (label.kind === "hours") text = t("expiresInHours", { count: label.count });
  else {
    const time = format.dateTime(label.at, { hour: "numeric", minute: "2-digit" });
    if (label.kind === "today") text = t("goodUntilToday", { time });
    else if (label.kind === "tomorrow") text = t("goodUntilTomorrow", { time });
    else if (label.kind === "day") text = t("goodUntilDay", { day: format.dateTime(label.at, { weekday: "long" }), time });
    else text = t("goodUntilDate", { date: format.dateTime(label.at, { day: "numeric", month: "short" }), time });
  }
  return (
    <p
      className={cx("flex items-center gap-1.5 text-sm font-bold", urgent ? "text-danger-ink" : "hue-tangerine text-hue-ink")}
      data-testid="food-expiry"
      data-kind={label.kind}
    >
      {urgent ? <TriangleAlert size={14} strokeWidth={2.6} aria-hidden /> : <Clock size={14} strokeWidth={2.6} aria-hidden />}
      {text}
    </p>
  );
}
