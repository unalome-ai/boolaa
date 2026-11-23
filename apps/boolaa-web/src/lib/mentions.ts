/**
 * Chat @mentions (docs/boolaa-spec.md, "Mentions"): spans in Unicode code points ↔ UTF-16 indices,
 * candidate matching, the composer's trigger and token editing, trimming before send, and how a stored
 * span renders for a reader. Pure; the composer is components/mention-composer.tsx.
 */
import { foldChar } from "@/lib/search";

/** As stored in `chat_messages.mentions`: code-point offsets. */
export type MentionSpan = { start: number; length: number; user_id: string };
/** A token in the composer: UTF-16 [start, end) into the draft text. */
export type MentionToken = { start: number; end: number; userId: string };
export type Candidate = { user_id: string; name: string; avatar: string | null };

export const MENTION_CAP = 10;
export const QUERY_MAX = 30;
/** Characters after which `@` opens the list (besides the start of the text and whitespace). */
const OPENERS = new Set(["(", "[", '"', "'", "“", "„", "«", "‘"]);

// ---- code points ↔ UTF-16 -----------------------------------------------------------------------

/** Code-point index of the UTF-16 index `i` (i is clamped to the text). */
export function cpIndex(text: string, i: number): number {
  let cp = 0;
  for (let u = 0; u < Math.min(i, text.length); ) {
    const c = text.codePointAt(u)!;
    u += c > 0xffff ? 2 : 1;
    cp++;
  }
  return cp;
}

/** UTF-16 index of code-point index `cp`; null when it is past the end. */
export function utf16Index(text: string, cp: number): number | null {
  if (cp < 0) return null;
  let u = 0;
  for (let n = 0; n < cp; n++) {
    if (u >= text.length) return null;
    u += text.codePointAt(u)! > 0xffff ? 2 : 1;
  }
  return u <= text.length ? u : null;
}

/** Composer tokens → stored spans (sorted by start). */
export function tokensToSpans(text: string, tokens: MentionToken[]): MentionSpan[] {
  return [...tokens]
    .sort((a, b) => a.start - b.start)
    .map((t) => {
      const start = cpIndex(text, t.start);
      return { start, length: cpIndex(text, t.end) - start, user_id: t.userId };
    });
}

/** A stored span as a UTF-16 range, or null when it doesn't fit the text (never crash on it). */
export function spanRange(text: string, s: MentionSpan): { start: number; end: number } | null {
  const start = utf16Index(text, s.start);
  const end = utf16Index(text, s.start + s.length);
  if (start === null || end === null || end <= start || text[start] !== "@") return null;
  return { start, end };
}

/** `mentions` from a row (jsonb): keys read by name; anything malformed is skipped. */
export function parseMentions(raw: unknown): MentionSpan[] {
  if (!Array.isArray(raw)) return [];
  const out: MentionSpan[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { start, length, user_id } = m as Record<string, unknown>;
    if (Number.isInteger(start) && Number.isInteger(length) && typeof user_id === "string")
      out.push({ start: start as number, length: length as number, user_id: user_id.toLowerCase() });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- rendering -----------------------------------------------------------------------------------

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "me" | "member"; text: string; userId: string }
  | { kind: "plain-mention"; text: string; userId: string };

/**
 * Splits a message into text and mentions for a reader: the reader → "me" (`@` + current name), a
 * candidate → "member" (`@` + current name), anyone else → the span's own text, plain. Spans that
 * don't fit or overlap an earlier one are ignored.
 */
export function messageParts(text: string, spans: MentionSpan[], reader: { id: string; name: string | null }, candidates: Map<string, Candidate>): MessagePart[] {
  const out: MessagePart[] = [];
  let at = 0;
  for (const s of spans) {
    const r = spanRange(text, s);
    if (!r || r.start < at) continue;
    if (r.start > at) out.push({ kind: "text", text: text.slice(at, r.start) });
    const own = text.slice(r.start, r.end);
    if (s.user_id === reader.id) out.push({ kind: "me", text: reader.name ? `@${reader.name}` : own, userId: s.user_id });
    else {
      const c = candidates.get(s.user_id);
      out.push(c ? { kind: "member", text: `@${c.name}`, userId: s.user_id } : { kind: "plain-mention", text: own, userId: s.user_id });
    }
    at = r.end;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export const mentionsReader = (spans: MentionSpan[], readerId: string) => spans.some((s) => s.user_id === readerId);

// ---- candidates ----------------------------------------------------------------------------------

export const foldName = (s: string) => Array.from(s, foldChar).join("");

/**
 * Candidates for a query: names whose folded form starts with the folded query, then names with a word
 * that does; each group in locale collation order. An empty query lists everyone.
 */
export function matchCandidates(cands: Candidate[], query: string, locale: string): Candidate[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const q = foldName(query);
  const starts: Candidate[] = [];
  const words: Candidate[] = [];
  for (const c of cands) {
    const name = foldName(c.name);
    if (name.startsWith(q)) starts.push(c);
    else if (name.split(/\s+/).some((w, i) => i > 0 && w.startsWith(q))) words.push(c);
  }
  const by = (a: Candidate, b: Candidate) => collator.compare(a.name, b.name);
  return [...starts.sort(by), ...words.sort(by)];
}

// ---- composer: trigger -----------------------------------------------------------------------------

export type Trigger = { at: number; query: string };

/**
 * The open `@query` run ending at the caret, or null: `@` at the start, after whitespace or an opening
 * bracket / quote; query without line breaks, at most 30 code points, no two spaces in a row; never inside
 * a token.
 */
export function findTrigger(text: string, caret: number, tokens: MentionToken[]): Trigger | null {
  if (caret < 1 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (tokens.some((t) => at >= t.start && at < t.end)) return null;
  const prev = at > 0 ? text[at - 1] : "";
  if (prev && !/\s/.test(prev) && !OPENERS.has(prev)) return null;
  const query = before.slice(at + 1);
  if (/[\r\n]/.test(query) || query.includes("  ") || Array.from(query).length > QUERY_MAX) return null;
  return { at, query };
}

// ---- composer: editing -----------------------------------------------------------------------------

export type DraftState = { text: string; tokens: MentionToken[] };

function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
function commonSuffix(a: string, b: string, max: number) {
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Applies a textarea change to the draft. `caret` is the selection end after the change (where the
 * typed/pasted text ends, or where a deletion happened).
 * - A deletion or replacement touching any part of a token removes the whole token (Backspace right after
 *   it, Delete right before it, typing over a selection that includes part of it, cut).
 * - Pure insertion strictly inside a token turns it into plain text (range dropped, characters kept).
 * - Everything after the edit shifts.
 * Returns the new state and the caret to restore (the text may differ from the textarea's value).
 */
export function applyEdit(prev: DraftState, next: string, caret: number): DraftState & { caret: number } {
  const old = prev.text;
  if (old === next) return { ...prev, caret };
  let p = commonPrefix(old, next);
  const delta = next.length - old.length;
  // The edit ends at the caret: never let the common prefix run past where the inserted text starts.
  p = Math.min(p, Math.max(0, caret - Math.max(0, delta)), caret);
  const s = commonSuffix(old, next, Math.min(old.length, next.length) - p);
  const removedEnd = old.length - s; // [p, removedEnd) in old
  const inserted = next.slice(p, next.length - s);
  let from = p;
  let to = removedEnd;
  const touched = new Set<MentionToken>();
  if (to > from) {
    // Grow the removal over every token it touches (repeat: a grown range may reach the next token).
    let grown = true;
    while (grown) {
      grown = false;
      for (const t of prev.tokens) {
        if (touched.has(t) || !(from < t.end && to > t.start)) continue;
        touched.add(t);
        if (t.start < from) {
          from = t.start;
          grown = true;
        }
        if (t.end > to) {
          to = t.end;
          grown = true;
        }
      }
    }
  }
  const text = old.slice(0, from) + inserted + old.slice(to);
  const shift = inserted.length - (to - from);
  const tokens: MentionToken[] = [];
  for (const t of prev.tokens) {
    if (touched.has(t)) continue;
    if (to === from && from > t.start && from < t.end) continue; // typed/pasted inside: plain text now
    if (t.end <= from) tokens.push(t);
    else tokens.push({ ...t, start: t.start + shift, end: t.end + shift });
  }
  return { text, tokens, caret: touched.size > 0 ? from + inserted.length : caret };
}

/** Picking a candidate: `@query` → `@Name` + one space (none if whitespace follows); caret after it. */
export function insertMention(state: DraftState, trigger: Trigger, caret: number, c: Candidate): DraftState & { caret: number } {
  const token = `@${c.name}`;
  const after = state.text.slice(caret);
  const space = /^\s/.test(after) ? "" : " ";
  const text = state.text.slice(0, trigger.at) + token + space + after;
  const shift = token.length + space.length - (caret - trigger.at);
  const tokens = state.tokens.map((t) => (t.start >= caret ? { ...t, start: t.start + shift, end: t.end + shift } : t));
  tokens.push({ start: trigger.at, end: trigger.at + token.length, userId: c.user_id });
  tokens.sort((a, b) => a.start - b.start);
  return { text, tokens, caret: trigger.at + token.length + space.length };
}

/** What is sent: the trimmed text and its spans (shifted by the trimmed prefix; spans cut off are dropped). */
export function draftToMessage(state: DraftState): { content: string; mentions: MentionSpan[] } {
  const lead = state.text.length - state.text.trimStart().length;
  const content = state.text.trim();
  const tokens = state.tokens
    .map((t) => ({ ...t, start: t.start - lead, end: t.end - lead }))
    .filter((t) => t.start >= 0 && t.end <= content.length && content[t.start] === "@");
  return { content, mentions: tokensToSpans(content, tokens) };
}
