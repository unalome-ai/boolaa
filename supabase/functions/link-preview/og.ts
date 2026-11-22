// Open Graph / Twitter card / <title> extraction from untrusted HTML. Pure functions, no DOM:
// we only look at <meta> and <title> in the head, then decode entities, strip tags and control
// characters and cut to length. Output is plain text; clients render it as text, never as HTML.

export const LIMITS = { title: 200, description: 300, siteName: 80 } as const;

export interface OpenGraph {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°", times: "×",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û",
  icirc: "î", iuml: "ï", euml: "ë", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", ntilde: "ñ",
  aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", Eacute: "É", Agrave: "À", Ccedil: "Ç",
  iexcl: "¡", iquest: "¿", ograve: "ò", ugrave: "ù", igrave: "ì",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});?/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
      return String.fromCodePoint(cp);
    }
    return NAMED[e] ?? m;
  });
}

/** Plain, single-line text of at most `max` characters (code points), or null when empty. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  let s = raw.replace(/<[^>]*>/g, " "); // tags in the raw attribute/title
  s = decodeEntities(s);
  s = s.replace(/<[^>]*>/g, " "); // tags that were entity-encoded
  // Control characters, bidi overrides/isolates (spoofing), zero-width and BOM.
  s = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿￹-￻]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const cps = Array.from(s);
  if (cps.length > max) s = cps.slice(0, max - 1).join("").trimEnd() + "…";
  return s;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/** Charset from a Content-Type header or the first <meta charset>, else utf-8. */
export function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  const m = ascii.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i);
  return (m?.[1] ?? "utf-8").toLowerCase();
}

export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const cs = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function parseOpenGraph(html: string, pageUrl: string): OpenGraph {
  // Only the head matters; scripts and styles may contain fake tags.
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  let head = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
  head = head.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");

  const meta: Record<string, string> = {};
  // Quoted attribute values may contain ">" (valid HTML), so a tag ends at the first unquoted ">".
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase().trim();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];

  const pick = (...keys: string[]) => keys.map((k) => meta[k]).find((v) => v && v.trim()) ?? null;
  const title = cleanText(pick("og:title", "twitter:title") ?? titleTag, LIMITS.title);
  const description = cleanText(pick("og:description", "twitter:description", "description"), LIMITS.description);
  const siteName = cleanText(pick("og:site_name", "application-name"), LIMITS.siteName);

  let imageUrl: string | null = null;
  const img = pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src");
  if (img) {
    try {
      const u = new URL(decodeEntities(img.trim()), pageUrl);
      if (u.protocol === "https:" || u.protocol === "http:") imageUrl = u.href;
    } catch {
      imageUrl = null;
    }
  }
  return { title, description, siteName, imageUrl };
}

export function isHtml(contentType: string | null): boolean {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return t === "text/html" || t === "application/xhtml+xml";
}
