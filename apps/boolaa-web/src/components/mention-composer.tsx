"use client";

/**
 * Chat composer with @mentions (docs/boolaa-spec.md, "Mentions" → Composer). A plain `<textarea>` (IME,
 * spellcheck, a11y) over a mirror layer that paints the mention tokens; a combobox listbox of members
 * above it. Token rules (one unit to delete, plain text once typed into) live in lib/mentions.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui";
import { cx } from "@/lib/utils";
import {
  MENTION_CAP,
  applyEdit,
  findTrigger,
  insertMention,
  matchCandidates,
  type Candidate,
  type DraftState,
  type Trigger,
} from "@/lib/mentions";

const VISIBLE_ROWS = 5;
const ANNOUNCE_MS = 300;

export function MentionComposer({
  value,
  onChange,
  candidates,
  onSubmit,
  placeholder,
  label,
  inputRef,
  testId,
}: {
  value: DraftState;
  onChange: (next: DraftState) => void;
  candidates: Candidate[];
  onSubmit: () => void;
  placeholder: string;
  label: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  testId?: string;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const listId = useId();
  const own = inputRef;
  const mirror = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(value.text.length);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  // Escape closes the list for this `@` only; a new `@` opens it again.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const restoreCaret = useRef<number | null>(null);

  const trigger: Trigger | null = useMemo(() => {
    if (!focused || composing || candidates.length === 0) return null;
    const tr = findTrigger(value.text, caret, value.tokens);
    if (!tr || tr.at === dismissedAt) return null;
    return tr;
  }, [focused, composing, candidates.length, value, caret, dismissedAt]);
  const atCap = value.tokens.length >= MENTION_CAP;
  const matches = useMemo(() => (trigger && !atCap ? matchCandidates(candidates, trigger.query, locale) : []), [trigger, atCap, candidates, locale]);
  // A query with a space that matches nobody closes the list ("ana is" is just text).
  const open = !!trigger && (atCap || matches.length > 0 || !trigger.query.includes(" "));
  const activeIndex = matches.length ? Math.min(active, matches.length - 1) : 0;

  // Keep the caret where an edit that rewrote the text (a whole token removed, a pick) wants it.
  useLayoutEffect(() => {
    const el = own.current;
    if (el && restoreCaret.current !== null) {
      el.setSelectionRange(restoreCaret.current, restoreCaret.current);
      restoreCaret.current = null;
    }
    // Auto-grow up to ~5 lines; the mirror follows the textarea's scroll.
    if (el) {
      el.style.setProperty("height", "auto");
      el.style.setProperty("height", `${Math.min(el.scrollHeight, 160)}px`);
      if (mirror.current) mirror.current.scrollTop = el.scrollTop;
    }
  });

  // "3 members" / "No members match", politely and debounced.
  const [announcement, setAnnouncement] = useState("");
  const summary = !open ? "" : atCap ? t("mentionLimit") : matches.length ? t("mentionCount", { count: matches.length }) : t("mentionNoMatch");
  useEffect(() => {
    const id = window.setTimeout(() => setAnnouncement(summary), ANNOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [summary]);

  function commit(next: DraftState & { caret: number }) {
    restoreCaret.current = next.caret;
    setCaret(next.caret);
    onChange({ text: next.text, tokens: next.tokens });
  }

  function pick(c: Candidate) {
    if (!trigger) return;
    commit(insertMention(value, trigger, caret, c));
    setActive(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(trigger!.at);
        return;
      }
      if (!atCap && matches.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const n = matches.length;
          setActive((activeIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          pick(matches[activeIndex]);
          return;
        }
      } else if (e.key === "Enter" || e.key === "Tab") {
        // The limit / "No members match" row: nothing to pick; Enter never sends while the list is open.
        if (e.key === "Enter") e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const rowHeight = 48;

  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("mentionListLabel")}
          data-testid="mention-list"
          className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-y-auto rounded-[20px] bg-card p-1 shadow-float ring-1 ring-line"
          style={{ maxHeight: rowHeight * VISIBLE_ROWS + 8 }}
          // Keep focus in the textarea when a row is clicked.
          onMouseDown={(e) => e.preventDefault()}
        >
          {atCap ? (
            <div role="option" aria-selected={false} aria-disabled id={optionId(0)} className="px-4 py-3 text-sm text-muted" data-testid="mention-limit">
              {t("mentionLimit")}
            </div>
          ) : matches.length === 0 ? (
            <div role="option" aria-selected={false} aria-disabled id={optionId(0)} className="px-4 py-3 text-sm text-muted" data-testid="mention-none">
              {t("mentionNoMatch")}
            </div>
          ) : (
            matches.map((c, i) => (
              <div
                key={c.user_id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                aria-label={t("mentionA11y", { name: c.name })}
                data-testid="mention-option"
                data-user-id={c.user_id}
                onClick={() => pick(c)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[16px] px-3 py-1.5",
                  i === activeIndex ? "hue-grape bg-hue-wash text-hue-ink" : "text-fg",
                )}
              >
                <Avatar name={c.name} id={c.user_id} src={c.avatar} size={30} decorative />
                <span className="truncate font-display font-bold">{c.name}</span>
              </div>
            ))
          )}
        </div>
      )}
      <div className="relative min-h-12 rounded-[24px] border border-field-border bg-card shadow-soft transition-[border-color,box-shadow] duration-200 focus-within:border-focus focus-within:shadow-[inset_0_0_0_1px_var(--focus-ring)]">
        {/* Mirror: same text and wrapping as the textarea, transparent; only the token backgrounds show. */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap wrap-anywhere px-5 py-3 text-base leading-6 text-transparent"
        >
          <MirrorText state={value} />
          {"​"}
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? optionId(activeIndex) : undefined}
          aria-label={label}
          placeholder={placeholder}
          data-testid={testId}
          maxLength={4000}
          value={value.text}
          className="relative block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-5 py-3 text-base leading-6 text-fg outline-none placeholder:text-muted"
          onChange={(e) => {
            const el = e.target;
            const next = applyEdit(value, el.value, el.selectionEnd);
            if (next.text !== el.value || next.caret !== el.selectionEnd) restoreCaret.current = next.caret;
            // A new `@` (typed, or the dismissed one gone) opens the list again.
            if (el.value.length > value.text.length && el.value.slice(0, el.selectionEnd).endsWith("@")) setDismissedAt(null);
            else if (dismissedAt !== null && next.text[dismissedAt] !== "@") setDismissedAt(null);
            setCaret(next.caret);
            onChange({ text: next.text, tokens: next.tokens });
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionEnd)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            setCaret(e.currentTarget.selectionEnd);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
        />
      </div>
      <span className="sr-only" aria-live="polite" data-testid="mention-announcer">
        {announcement}
      </span>
    </div>
  );
}

/** The draft with tokens wrapped, for the mirror layer behind the textarea. */
function MirrorText({ state }: { state: DraftState }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const tk of [...state.tokens].sort((a, b) => a.start - b.start)) {
    if (tk.start < at) continue;
    if (tk.start > at) parts.push(state.text.slice(at, tk.start));
    parts.push(
      <span key={tk.start} data-testid="mention-token" data-user-id={tk.userId} className="hue-grape rounded-[6px] bg-hue-wash shadow-[0_0_0_2px_var(--h-wash)]">
        {state.text.slice(tk.start, tk.end)}
      </span>,
    );
    at = tk.end;
  }
  parts.push(state.text.slice(at));
  return <>{parts}</>;
}
