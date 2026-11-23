"use client";

import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useBoolaa } from "@/components/boolaa-provider";
import { REACTION_EMOJI, REACTIONS, summarize, type ReactionKey, type Reactions as ReactionState } from "@/lib/reactions";
import { cx } from "@/lib/utils";
import { useMenuKeys } from "@/lib/a11y";

/**
 * "Add a reaction" button with a popover of the six reactions (docs/boolaa-spec.md, "Reactions").
 * Controlled from outside when `open` is given (the chat opens it from the context menu).
 */
export function ReactionPicker({
  onPick,
  open: openProp,
  onOpenChange,
  align = "left",
  compact,
  className,
}: {
  onPick: (r: ReactionKey) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("reactions");
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOwn(o));
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpenRef.current(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useMenuKeys(open, () => setOpenRef.current(false), menuRef, button, "horizontal");

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-label={t("addReaction")}
        title={t("addReaction")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="reaction-add"
        className={cx(
          "press-round flex items-center justify-center rounded-full text-muted hover:bg-field hover:text-fg",
          compact ? "h-6 w-6" : "h-8 w-8",
        )}
      >
        <SmilePlus size={compact ? 14 : 17} strokeWidth={2.2} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="horizontal"
          aria-label={t("react")}
          data-testid="reaction-picker"
          className={cx(
            "absolute bottom-full z-[250] mb-1 flex gap-0.5 rounded-full border border-line bg-card p-1 shadow-float",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {REACTIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitem"
              aria-label={t(r)}
              title={t(r)}
              data-testid={`react-${r}`}
              onClick={() => {
                setOpen(false);
                onPick(r);
                button.current?.focus();
              }}
              className="press-round flex h-9 w-9 items-center justify-center rounded-full text-[20px] hover:bg-field"
            >
              <span aria-hidden>{REACTION_EMOJI[r]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chips "👍 3" for one target; your own are filled. Tapping a chip toggles your reaction. */
export function ReactionChips({
  state,
  targetId,
  className,
  children,
}: {
  state: ReactionState;
  targetId: string;
  className?: string;
  /** Extra content at the end of the row (e.g. the picker). */
  children?: React.ReactNode;
}) {
  const { userId, blocked } = useBoolaa();
  const t = useTranslations("reactions");
  const summary = summarize(state.rows, targetId, userId, blocked);
  // Chips that appear after the first render pop in; a changed count pops softly (design-system 8.3).
  const [initial] = useState(() => new Set<string>(summary.map((s) => s.reaction)));
  if (summary.length === 0 && !children) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)} data-testid="reactions" data-target={targetId}>
      {summary.map(({ reaction, count, mine }) => {
        const label = t("chip", { reaction: t(reaction), count }) + (mine ? `, ${t("reactedByYou")}` : "");
        return (
          <button
            key={reaction}
            type="button"
            aria-pressed={mine}
            aria-label={label}
            title={label}
            data-testid={`reaction-${reaction}`}
            data-count={count}
            data-mine={mine}
            onClick={() => void state.toggle(targetId, reaction)}
            className={cx(
              "press inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-display text-[13px] font-bold transition-[background,color,box-shadow]",
              mine ? "fill-hue" : "bg-field text-fg hover:bg-chip",
              !initial.has(reaction) && "anim-pop",
            )}
          >
            <span aria-hidden>{REACTION_EMOJI[reaction]}</span>
            <span aria-hidden key={count} className="anim-pop-soft inline-block tabular-nums">
              {count}
            </span>
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** Chips plus the "Add a reaction" button: the row under a post, event, item or link. */
export function ReactionBar({ state, targetId, className }: { state: ReactionState; targetId: string; className?: string }) {
  return (
    <ReactionChips state={state} targetId={targetId} className={className}>
      <ReactionPicker onPick={(r) => void state.toggle(targetId, r)} />
    </ReactionChips>
  );
}
