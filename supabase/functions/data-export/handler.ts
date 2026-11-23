// data-export: "Download my data" (GDPR right of access). Called by clients with their user JWT
// right after they verified a `sensitive_action` code (sensitive_action "export_data"):
//
//   POST /functions/v1/data-export   (body ignored)
//
// It calls the RPC export_my_data() AS THE USER (so auth.uid(), the session's code proof and the
// rate limit are checked in SQL), then adds 7-day signed links for the user's photos (every photo
// bucket is private, 20261123210000_private_photos.sql), and returns one JSON file
// (Content-Disposition: attachment). docs/boolaa-spec.md "Data export"; errors in
// docs/auth-security.md "Flow: download my data".
//
// Why JSON + signed URLs and not a ZIP with the photos: hosted Edge Functions get ~2 s of CPU and
// 256 MB per request; a heavy user's photos (up to 5 MB each, hundreds of them) would not fit in
// one invocation, and a background job would have to keep a second full copy of the user's data
// in Storage (another thing to secure, expire and delete). The JSON is small, readable and
// machine-readable (Art. 20), and the links cover the photos.

export const SIGNED_URL_TTL_S = 7 * 24 * 3600;
export const PER_USER_BUCKETS = ["avatars", "food.images", "market.images", "chat.images"] as const;

export interface RpcError {
  message?: string;
  details?: string | null;
  code?: string;
  hint?: string | null;
}

export interface Deps {
  /** Validates the JWT with Auth (signature, expiry, session alive). Null when invalid. */
  getUser(jwt: string): Promise<{ id: string } | null>;
  /** rpc("export_my_data") with the user's JWT. */
  exportData(jwt: string): Promise<{ data: unknown; error: RpcError | null }>;
  /** Signed URLs for paths in a private bucket (service role). Missing / failed paths are left out. */
  signUrls(bucket: string, paths: string[], expiresIn: number): Promise<Map<string, string>>;
  now?: () => Date;
  log?: (msg: string) => void;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Retry-After",
};

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

/** Maps an export_my_data() / PostgREST error to the function's HTTP contract. */
export function mapRpcError(e: RpcError): Response {
  const msg = (e.message ?? "").toLowerCase();
  if (msg.includes("reauthentication required")) return json(403, { error: "reauthentication_required" });
  if (msg.includes("session not verified")) return json(403, { error: "session_not_verified" });
  if (msg.includes("export rate limited")) {
    const s = Number.parseInt(String(e.details ?? ""), 10);
    const retry = Number.isFinite(s) && s > 0 ? Math.min(s, 3600) : 3600;
    return json(429, { error: "export_rate_limited", retry_after: retry }, { "Retry-After": String(retry) });
  }
  if (msg.includes("not authenticated") || msg.includes("jwt") || e.code === "PGRST301" || e.code === "PGRST303") {
    return json(401, { error: "unauthorized" });
  }
  return json(500, { error: "server_error" });
}

/** Top-level order of the file (jsonb sorts keys by length; people read this file). */
const ORDER = [
  "format", "version", "generated_at", "user_id", "about", "profile", "account", "consent",
  "sign_in_identities", "sessions", "sign_in_history", "devices", "security_codes", "password_reset_grants",
  "bubble_memberships", "join_requests", "join_request_approvals", "chat_messages", "chat_read_markers",
  "events", "rsvps", "food_posts", "market_items", "item_requests", "requests_on_my_items", "shared_links",
  "reactions", "reports_filed", "blocks",
  "notification_preferences", "muted_bubbles", "notifications", "push_tokens", "invite_code_failures",
  "moderator", "previous_exports", "files", "not_included",
];

type Doc = Record<string, unknown> & {
  user_id?: string;
  files?: { bucket: string; path: string; [k: string]: unknown }[];
  chat_messages?: { photo_path?: string | null; [k: string]: unknown }[];
};

export const fileName = (d: Date) => `boolaa-data-${d.toISOString().slice(0, 10)}.json`;

/** Adds photo links. Only paths in the user's own folder of a per-user bucket are ever signed. */
export async function addLinks(doc: Doc, userId: string, deps: Pick<Deps, "signUrls">, now: Date) {
  const own = (bucket: string, path: unknown): path is string =>
    (PER_USER_BUCKETS as readonly string[]).includes(bucket) && typeof path === "string" &&
    path.startsWith(`${userId}/`) && !path.includes("..");
  const files = (doc.files ?? []).filter((f) => own(f.bucket, f.path));

  const privatePaths = new Map<string, Set<string>>();
  const wantPrivate = (bucket: string, path: string) => {
    if (!privatePaths.has(bucket)) privatePaths.set(bucket, new Set());
    privatePaths.get(bucket)!.add(path);
  };
  for (const f of files) wantPrivate(f.bucket, f.path);
  for (const m of doc.chat_messages ?? []) if (own("chat.images", m.photo_path)) wantPrivate("chat.images", m.photo_path!);

  const signed = new Map<string, Map<string, string>>();
  for (const [bucket, set] of privatePaths) {
    const all = [...set];
    const urls = new Map<string, string>();
    for (let i = 0; i < all.length; i += 100) {
      for (const [p, u] of await deps.signUrls(bucket, all.slice(i, i + 100), SIGNED_URL_TTL_S)) urls.set(p, u);
    }
    signed.set(bucket, urls);
  }
  const expires = new Date(now.getTime() + SIGNED_URL_TTL_S * 1000).toISOString();

  doc.files = files.map((f) => {
    const url = signed.get(f.bucket)?.get(f.path) ?? null;
    return { ...f, url, url_expires_at: url ? expires : null };
  });
  if (doc.chat_messages) {
    doc.chat_messages = doc.chat_messages.map((m) => {
      if (!m.photo_path) return m;
      const url = own("chat.images", m.photo_path) ? signed.get("chat.images")?.get(m.photo_path) ?? null : null;
      return { ...m, photo_url: url };
    });
  }
  return expires;
}

export function orderKeys(doc: Doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ORDER) if (k in doc) out[k] = doc[k];
  for (const k of Object.keys(doc)) if (!(k in out)) out[k] = doc[k];
  return out;
}

export function createHandler(deps: Deps) {
  const log = deps.log ?? (() => {});
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json(401, { error: "unauthorized" });
    let user: { id: string } | null;
    try {
      user = await deps.getUser(jwt);
    } catch {
      user = null;
    }
    if (!user) return json(401, { error: "unauthorized" });

    let res: { data: unknown; error: RpcError | null };
    try {
      res = await deps.exportData(jwt);
    } catch (e) {
      log(`rpc failed: ${(e as Error).message}`);
      return json(500, { error: "server_error" });
    }
    if (res.error) {
      const r = mapRpcError(res.error);
      if (r.status === 500) log(`rpc error: ${res.error.code ?? ""} ${res.error.message ?? ""}`);
      return r;
    }
    const doc = res.data as Doc | null;
    // The RPC only ever answers for auth.uid(); a mismatch means something is badly wrong.
    if (!doc || typeof doc !== "object" || doc.user_id !== user.id) {
      log("export user mismatch");
      return json(500, { error: "server_error" });
    }

    const now = deps.now?.() ?? new Date();
    let linksExpire: string;
    try {
      linksExpire = await addLinks(doc, user.id, deps, now);
    } catch (e) {
      log(`signing failed: ${(e as Error).message}`);
      return json(500, { error: "server_error" });
    }
    doc.about = {
      description: "Everything Boolaa stores about you, from https://boolaa.ro. Times are UTC (ISO 8601).",
      photo_links: "files[].url and chat_messages[].photo_url. Photo links stop working at " +
        `${linksExpire}; download the photos before then. Photo URLs elsewhere in this file (profile avatar, ` +
        "food and marketplace posts) only name the stored file: photos are private, use files[].url to download them.",
      not_included: "See not_included at the end of this file.",
      privacy_policy: "https://boolaa.ro/privacy",
      contact: "privacy@boolaa.ro",
    };

    return new Response(JSON.stringify(orderKeys(doc), null, 2), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName(now)}"`,
        "Cache-Control": "no-store",
      },
    });
  };
}
