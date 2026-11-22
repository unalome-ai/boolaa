/**
 * Search inside a bubble (docs/boolaa-spec.md, "Search"): the RPC row, diacritic-insensitive
 * highlighting, where each kind of hit opens, and the chat jump window.
 */
import type { Hue } from "@/lib/hue";

export const SEARCH_MIN = 2;
export const SEARCH_LIMIT = 30;
export const SEARCH_DEBOUNCE_MS = 300;
/** Messages older than the target that `chat_messages_around` returns (its default). */
export const AROUND_BEFORE = 25;

export const SEARCH_KINDS = ["chat_message", "event", "food_post", "market_item", "shared_link"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string | null;
  snippet: string | null;
  author_id: string;
  author_name: string | null;
  created_at: string;
  event_at: string | null;
  rank: number;
  matched_words: string[] | null;
};

/** Rows of `search_bubble`, minus kinds this client doesn't know (newer servers may add some). */
export function parseHits(rows: unknown): SearchHit[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is SearchHit =>
      !!r && typeof r === "object" && SEARCH_KINDS.includes((r as SearchHit).kind) && typeof (r as SearchHit).id === "string",
  );
}

/** Trimmed query length as people count it (code points), for the 2-character minimum. */
export const queryLength = (q: string) => [...q.trim()].length;

/** Route, deep-link parameter (src/components/deep-link.tsx) and feature hue per kind. */
export const KIND_TARGET: Record<SearchKind, { path: string; param: string; hue: Hue }> = {
  chat_message: { path: "/chat", param: "message", hue: "grape" },
  event: { path: "/events", param: "event", hue: "coral" },
  food_post: { path: "/food", param: "post", hue: "tangerine" },
  market_item: { path: "/marketplace", param: "item", hue: "mint" },
  shared_link: { path: "/links", param: "link", hue: "sky" },
};

export const hitHref = (hit: Pick<SearchHit, "kind" | "id">) => {
  const t = KIND_TARGET[hit.kind];
  return `${t.path}?${t.param}=${encodeURIComponent(hit.id)}`;
};

/** Event a mounted screen listens to when search opens an item on the route it already shows. */
export const HIGHLIGHT_EVENT = "boolaa:highlight";
export type HighlightDetail = { path: string; param: string; id: string };

// --- Folding and highlighting ----------------------------------------------------------------------

const SPECIAL: Record<string, string> = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "ı": "i", "ð": "d", "þ": "th" };

/** Lower-case, accent-free form of one character, like the server's lower(unaccent()). */
export function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  if (SPECIAL[lower]) return SPECIAL[lower];
  return lower.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** The folded text plus, for each folded UTF-16 unit, the [start, end) of its source character. */
export function foldWithMap(text: string): { folded: string; map: [number, number][] } {
  let folded = "";
  const map: [number, number][] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) map.push([i, i + ch.length]);
    folded += f;
    i += ch.length;
  }
  return { folded, map };
}

/**
 * Ranges [start, end) of `text` to highlight: every occurrence of every word (the server's
 * `matched_words`, already folded), compared folded, merged when they touch or overlap.
 */
export function highlightRanges(text: string, words: readonly string[] | null | undefined): [number, number][] {
  if (!text || !words?.length) return [];
  const { folded, map } = foldWithMap(text);
  const raw: [number, number][] = [];
  for (const w of words) {
    const word = [...w].map(foldChar).join("");
    if (!word) continue;
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) {
      raw.push([map[at][0], map[at + word.length - 1][1]]);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Text split into plain and highlighted parts (rendered as text nodes and <mark>, never as HTML). */
export function highlightParts(text: string, words: readonly string[] | null | undefined) {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of highlightRanges(text, words)) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

// --- Chat jump ---------------------------------------------------------------------------------------

/**
 * What `chat_messages_around` (newest first) means for the chat: whether the target is there, and
 * whether the start of the chat was reached (fewer than AROUND_BEFORE rows older than the target).
 */
export function aroundWindow(rows: readonly { id: string }[], targetId: string) {
  const at = rows.findIndex((r) => r.id === targetId);
  if (at < 0) return { found: false as const, startReached: false };
  return { found: true as const, startReached: rows.length - 1 - at < AROUND_BEFORE };
}
