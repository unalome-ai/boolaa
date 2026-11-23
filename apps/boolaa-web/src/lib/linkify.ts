/**
 * Tappable links in chat text (docs/boolaa-spec.md "Chat"): http(s) URLs and bare `www.` hosts
 * become links that open outside Boolaa. No previews in chat. iOS (`Linkify.swift`) and Android
 * (`Linkify.kt`) use the same rules:
 *   - a link starts at `http://`, `https://` or `www.` on a word boundary and runs to whitespace;
 *   - trailing punctuation (. , ! ? ; : ' " and unbalanced closing brackets) stays text;
 *   - `www.` links get `https://`; only http(s) URLs with a host are linked.
 */
export type LinkPart = { text: string; href?: string };

const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING = new Set([".", ",", "!", "?", ";", ":", "'", "’", "”", "*", "_"]);
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

function count(s: string, ch: string) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Drops trailing punctuation that is almost always sentence text, not part of the URL. */
export function trimLink(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.at(-1);
    if (!last) return s;
    if (TRAILING.has(last)) s = s.slice(0, -1);
    else if (PAIRS[last] && count(s, PAIRS[last]) < count(s, last)) s = s.slice(0, -1);
    else return s;
  }
}

/** The URL a matched link opens, or null when it isn't a usable http(s) URL. */
export function linkHref(match: string): string | null {
  const href = /^www\./i.test(match) ? `https://${match}` : match;
  try {
    const u = new URL(href);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost")) return null;
    return href;
  } catch {
    return null;
  }
}

/** Splits text into plain parts and link parts, in order; joining every `text` gives the input back. */
export function splitLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index!;
    const raw = trimLink(m[0]);
    const href = raw.length > 0 ? linkHref(raw) : null;
    if (!href) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
