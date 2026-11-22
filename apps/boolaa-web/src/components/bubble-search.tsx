"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Link2, MessagesSquare, Search, Tags, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useBoolaa } from "@/components/boolaa-provider";
import { EmptyState, Modal, Spinner } from "@/components/ui";
import { useFormat } from "@/i18n/format";
import { hueClass } from "@/lib/hue";
import {
  HIGHLIGHT_EVENT,
  KIND_TARGET,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  SEARCH_MIN,
  hitHref,
  highlightParts,
  parseHits,
  queryLength,
  type HighlightDetail,
  type SearchHit,
  type SearchKind,
} from "@/lib/search";
import { cx } from "@/lib/utils";

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  chat_message: MessagesSquare,
  event: CalendarDays,
  food_post: UtensilsCrossed,
  market_item: Tags,
  shared_link: Link2,
};
const KIND_LABEL = {
  chat_message: "kindMessage",
  event: "kindEvent",
  food_post: "kindFood",
  market_item: "kindItem",
  shared_link: "kindLink",
} as const satisfies Record<SearchKind, string>;

/** User text with the matched words wrapped in <mark>: plain text nodes only, never HTML. */
function Highlighted({ text, words }: { text: string; words: string[] | null }) {
  return (
    <>
      {highlightParts(text, words).map((p, i) =>
        p.hit ? (
          <mark key={i} data-testid="search-mark" className="rounded-[4px] bg-hue-wash px-0.5 font-bold text-hue-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; query: string; hits: SearchHit[] };

/** The header button that opens search for the current bubble. */
export function SearchButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("search");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("open")}
      title={t("open")}
      aria-haspopup="dialog"
      data-testid="search-button"
      className="press-round flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-brand-ink shadow-soft"
    >
      <Search size={21} strokeWidth={2.6} />
    </button>
  );
}

/**
 * Search inside the current bubble (docs/boolaa-spec.md, "Search"): debounced `search_bubble`, only
 * the latest query's answer is shown; a hit opens its screen and highlights it (chat: jumps to it).
 */
export function BubbleSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("search");
  const tc = useTranslations("common");
  const { supabase, bubble } = useBoolaa();
  const router = useRouter();
  const fmt = useFormat();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const bubbleId = bubble?.id;

  useEffect(() => {
    if (!open || !bubbleId) return;
    const q = query.trim();
    const mine = ++seq.current;
    if (queryLength(q) < SEARCH_MIN) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the query gets too short
      setState({ status: "idle" });
      return;
    }
    setState((s) => (s.status === "done" ? s : { status: "loading" }));
    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      const { data, error } = await supabase.rpc("search_bubble", { p_bubble_id: bubbleId, p_query: q, p_limit: SEARCH_LIMIT });
      if (mine !== seq.current) return; // a newer query (or bubble) took over
      setState(error ? { status: "error" } : { status: "done", query: q, hits: parseHits(data) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, bubbleId, supabase, attempt]);

  // Search is per bubble: switching bubbles starts over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
  }, [bubbleId]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  function openHit(hit: SearchHit) {
    const target = KIND_TARGET[hit.kind];
    onClose();
    router.push(hitHref(hit));
    // Same route already shown (or the chat mounted in the background): tell it directly.
    const detail: HighlightDetail = { path: target.path, param: target.param, id: hit.id };
    window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail }));
  }

  const len = queryLength(query);
  let body: ReactNode;
  if (len === 0) body = <p className="px-1 py-6 text-center text-muted" data-testid="search-hint">{t("hint")}</p>;
  else if (len < SEARCH_MIN) body = <p className="px-1 py-6 text-center text-muted" data-testid="search-min">{t("minLength")}</p>;
  else if (state.status === "error")
    body = (
      <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="search-error">
        <p role="alert" className="font-medium text-danger-ink">{t("error")}</p>
        <button type="button" className="btn-ghost" onClick={() => setAttempt((a) => a + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  else if (state.status !== "done")
    body = (
      <div className="flex justify-center py-8" data-testid="search-loading">
        <Spinner className="h-6 w-6" />
      </div>
    );
  else if (state.hits.length === 0)
    body = (
      <div data-testid="search-empty">
        <EmptyState icon={<Search size={30} strokeWidth={2.4} />} title={t("noResults", { query: state.query })} hint={t("noResultsHint")} />
      </div>
    );
  else
    body = (
      <ul id={listId} className="space-y-2" data-testid="search-results" aria-label={t("results", { count: state.hits.length })}>
        {state.hits.map((hit) => {
          const Icon = KIND_ICON[hit.kind];
          const author = hit.author_name ?? tc("someone");
          const headline = hit.title ?? author;
          const meta = [t(KIND_LABEL[hit.kind]), hit.title ? author : null, hit.event_at ? fmt.dateTime(hit.event_at) : fmt.relative(hit.created_at)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={`${hit.kind}:${hit.id}`}>
              <button
                type="button"
                onClick={() => openHit(hit)}
                data-testid="search-hit"
                data-kind={hit.kind}
                data-id={hit.id}
                className={cx("press flex w-full items-start gap-3 rounded-card bg-card p-3 text-left shadow-soft hover:bg-hue-wash", hueClass(KIND_TARGET[hit.kind].hue))}
              >
                <span aria-hidden className="fill-hue flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Icon size={19} strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display font-bold">
                    <Highlighted text={headline} words={hit.matched_words} />
                  </span>
                  {hit.snippet && (
                    <span className="line-clamp-2 block break-words text-[15px] text-fg/85" data-testid="search-snippet">
                      <Highlighted text={hit.snippet} words={hit.matched_words} />
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-xs font-semibold text-muted">{meta}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <div role="search" className="relative">
        <Search aria-hidden size={19} strokeWidth={2.6} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && state.status === "done" && state.hits[0]) openHit(state.hits[0]);
          }}
          placeholder={t("placeholder", { bubble: bubble?.name ?? "" })}
          aria-label={t("open")}
          aria-controls={listId}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          data-testid="search-input"
          className="min-h-12 w-full rounded-[24px] border-2 border-transparent bg-card pl-11 pr-12 text-[16px] text-fg shadow-soft outline-none transition-[border-color] duration-200 placeholder:text-muted focus:border-grape [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("clear")}
            data-testid="search-clear"
            className="press-round absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-field hover:text-fg"
          >
            <X size={17} strokeWidth={2.6} />
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only" data-testid="search-status">
        {state.status === "done" && len >= SEARCH_MIN
          ? state.hits.length === 0
            ? t("noResults", { query: state.query })
            : t("results", { count: state.hits.length })
          : ""}
      </p>
      <div className="mt-4 min-h-40">{body}</div>
    </Modal>
  );
}
