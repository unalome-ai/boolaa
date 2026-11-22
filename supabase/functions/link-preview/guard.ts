// SSRF guard for the link-preview function: which URLs and which IP addresses may be fetched.
// Pure functions plus a fetch wrapper with injectable DNS and transport, so supabase/tests can
// check every rule without the network. docs/boolaa-spec.md, "Link previews".

export class GuardError extends Error {
  constructor(public code: string, message = code) {
    super(message);
  }
}

export const MAX_URL_LENGTH = 2048;

// Names that never point at the public internet, whatever DNS says.
const BLOCKED_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".corp",
  ".home.arpa", ".in-addr.arpa", ".ip6.arpa", ".onion", ".test", ".invalid", ".example"];
const BLOCKED_NAMES = new Set(["localhost", "metadata", "metadata.google.internal", "kong", "db", "host.docker.internal"]);

// --- IPv4 ------------------------------------------------------------------
/** Dotted-quad only (the URL parser has already normalised hex/octal/short forms). */
export function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

// [network, prefix length] of every IPv4 range that is not public unicast (RFC 6890 and friends).
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata (169.254.169.254)
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 31, 196, 0], 24], // AS112
  [[192, 52, 193, 0], 24], // AMT
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[192, 175, 48, 0], 24], // AS112
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

function inV4(ip: number[], net: number[], bits: number) {
  const a = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
  const b = ((net[0] << 24) | (net[1] << 16) | (net[2] << 8) | net[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function isPublicIPv4(ip: number[]): boolean {
  return !V4_BLOCKED.some(([net, bits]) => inV4(ip, net, bits));
}

// --- IPv6 ------------------------------------------------------------------
/** 16 bytes, or null. Accepts "::", embedded dotted quads and zone ids (rejected later). */
export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "");
  if (s.includes("%")) return null; // zone ids only exist for link-local
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(":")) return null;
  // Embedded IPv4 in the last 32 bits.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  let v4: number[] | null = null;
  if (tail.includes(".")) {
    v4 = parseIPv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const rest = dbl.length === 2 && dbl[1] ? dbl[1].split(":") : [];
  const groups = dbl.length === 2 ? 8 - head.length - rest.length : 0;
  if (dbl.length === 1 && head.length !== 8) return null;
  if (dbl.length === 2 && groups < 1) return null;
  const all = [...head, ...Array(groups).fill("0"), ...rest];
  if (all.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (v4) bytes.splice(12, 4, ...v4);
  return bytes;
}

function hasPrefix(b: number[], prefix: number[], bits: number) {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3, bit = 7 - (i & 7);
    if (((b[byte] >> bit) & 1) !== ((prefix[byte] ?? 0) >> bit & 1)) return false;
  }
  return true;
}

const V6_BLOCKED: [number[], number][] = [
  [[0x00, 0x64, 0xff, 0x9b], 96], // NAT64 64:ff9b::/96 (embeds IPv4; refuse rather than translate)
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48], // local-use NAT64
  [[0x01, 0x00], 64], // discard-only 100::/64
  [[0x20, 0x01, 0x00, 0x00], 23], // IETF special 2001::/23 (Teredo 2001::/32, ORCHID, benchmarking...)
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0x20, 0x02], 16], // 6to4 (embeds IPv4)
  [[0x3f, 0xff], 20], // documentation (RFC 9637)
  [[0x5f, 0x00], 16], // SRv6 SIDs
];

/** Only global unicast 2000::/3, minus the special ranges above. Mapped IPv4 is checked as IPv4. */
export function isPublicIPv6(b: number[]): boolean {
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated compatible): judge the IPv4.
  const zero10 = b.slice(0, 10).every((x) => x === 0);
  if (zero10 && b[10] === 0xff && b[11] === 0xff) return isPublicIPv4(b.slice(12));
  if (!hasPrefix(b, [0x20], 3)) return false; // ::, ::1, fc00::/7, fe80::/10, ff00::/8, ... all outside 2000::/3
  return !V6_BLOCKED.some(([p, bits]) => hasPrefix(b, p, bits));
}

/** True only for a public unicast IPv4 or IPv6 address literal. Anything unparsable is false. */
export function isPublicIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isPublicIPv6(v6);
  return false;
}

// --- URLs ------------------------------------------------------------------
/** Parses and checks a URL to fetch: http(s), default port, no credentials, a public-looking host. */
export function checkUrl(raw: string, base?: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) throw new GuardError("bad_url");
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new GuardError("bad_url");
  }
  if (u.href.length > MAX_URL_LENGTH) throw new GuardError("bad_url");
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GuardError("bad_scheme");
  if (u.username || u.password) throw new GuardError("credentials");
  if (u.port !== "") throw new GuardError("bad_port"); // only 80 for http and 443 for https
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new GuardError("bad_host");
  if (host.startsWith("[") || parseIPv4(host)) {
    if (!isPublicIp(host.replace(/^\[|\]$/g, ""))) throw new GuardError("private_address");
    return u;
  }
  if (!host.includes(".") || BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new GuardError("bad_host");
  }
  return u;
}

export type Resolver = (host: string) => Promise<string[]>;

export const denoResolver: Resolver = async (host) => {
  const settle = async (t: "A" | "AAAA") => {
    try {
      return await Deno.resolveDns(host, t);
    } catch {
      return [] as string[];
    }
  };
  const [a, aaaa] = await Promise.all([settle("A"), settle("AAAA")]);
  return [...a, ...aaaa];
};

/** Every address the host resolves to must be public, and there must be at least one. */
export async function resolvePublic(u: URL, resolve: Resolver): Promise<string[]> {
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (parseIPv4(host) || parseIPv6(host)) {
    if (!isPublicIp(host)) throw new GuardError("private_address");
    return [host];
  }
  const ips = await resolve(host);
  if (ips.length === 0) throw new GuardError("dns_failed");
  for (const ip of ips) if (!isPublicIp(ip)) throw new GuardError("private_address", `${host} resolves to a non-public address`);
  return ips;
}

// --- Fetching --------------------------------------------------------------
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchOptions {
  resolve?: Resolver;
  fetchImpl?: FetchImpl;
  maxRedirects?: number;
  signal?: AbortSignal;
  accept?: string;
}

export const USER_AGENT = "Mozilla/5.0 (compatible; BoolaaLinkPreview/1.0; +https://boolaa.ro)";

/**
 * GET with the guard applied to the first URL and to every redirect hop (at most maxRedirects).
 * Never sends cookies or credentials. The caller reads the body through readCapped().
 *
 * Residual risk (documented): fetch resolves DNS again, so a hostile DNS server could answer
 * differently between our check and the connection (DNS rebinding). Deno's fetch can't pin an
 * address while keeping TLS name checks. Mitigations: hosted Edge Functions can't reach the
 * project's private network or metadata, nothing fetched is ever returned raw (only cleaned OG
 * text and a re-encoded image), only GET on ports 80/443.
 */
export async function safeFetch(raw: string, opts: FetchOptions = {}): Promise<{ res: Response; url: URL }> {
  const resolve = opts.resolve ?? denoResolver;
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = checkUrl(raw);
  for (let hop = 0; ; hop++) {
    await resolvePublic(url, resolve);
    const res = await fetchImpl(url.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      signal: opts.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "en,ro;q=0.8,fr;q=0.6,es;q=0.6,it;q=0.6",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new GuardError("too_many_redirects");
      url = checkUrl(res.headers.get("location")!, url.href);
      continue;
    }
    return { res, url };
  }
}

/** Reads at most `max` bytes. With truncate=false, a longer body is an error. */
export async function readCapped(res: Response, max: number, truncate: boolean): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (!truncate && Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new GuardError("too_large");
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > max) {
        if (!truncate) throw new GuardError("too_large");
        chunks.push(value.subarray(0, max - size));
        size = max;
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
