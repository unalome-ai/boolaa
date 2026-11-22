// push-dispatch: sends the pending rows of public.notification_outbox.
// Woken by pg_net from the enqueue triggers and by pg_cron (deferred chat, retries), with
// the header x-push-dispatch-secret (Vault push_dispatch_secret = env PUSH_DISPATCH_SECRET).
// Contract and setup: docs/push-notifications.md.
//
// Env:
//   PUSH_DISPATCH_SECRET                       shared secret (required)
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8     APNs token auth (.p8 contents); APNS_TOPIC (default ro.boolaa.app)
//   FCM_SERVICE_ACCOUNT_JSON                   Firebase service account (the whole JSON)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY        base64url; VAPID_SUBJECT (default mailto:hello@boolaa.ro)
//   PUSH_DRY_RUN=1                             local only: record would-be requests in push_debug_log
//
// POST {}                       dispatch everything due (the normal call)
// POST {"action":"probe_apns"}  checks that this runtime reaches APNs over HTTP/2 (no credentials used)
import { createClient } from "npm:@supabase/supabase-js@2";
import { type ApnsConfig, APNS_HOSTS } from "./apns.ts";
import { type ItemResult, pool, type Providers, sendItem, simulatedResponse } from "./dispatch.ts";
import { parseServiceAccount, type ServiceAccount } from "./fcm.ts";
import type { ClaimedItem } from "./render.ts";
import type { FetchFn } from "./types.ts";
import { type VapidKeys, webPayload } from "./webpush.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const enc = new TextEncoder();
function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const env = (k: string) => Deno.env.get(k)?.trim() || undefined;
const SUPABASE_URL = env("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Dry run only on a local stack (kong / localhost), unless explicitly allowed.
const DRY_RUN = env("PUSH_DRY_RUN") === "1" &&
  (/^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?/.test(SUPABASE_URL) ||
    env("PUSH_DRY_RUN_ALLOW_REMOTE") === "1");

function apnsConfig(): ApnsConfig | null {
  const keyId = env("APNS_KEY_ID"), teamId = env("APNS_TEAM_ID"), keyP8 = env("APNS_KEY_P8");
  return keyId && teamId && keyP8 ? { keyId, teamId, keyP8, topic: env("APNS_TOPIC") ?? "ro.boolaa.app" } : null;
}

function fcmConfig(): ServiceAccount | null {
  const raw = env("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    return parseServiceAccount(raw);
  } catch (e) {
    console.error("push-dispatch: bad FCM_SERVICE_ACCOUNT_JSON", (e as Error).message);
    return null;
  }
}

function vapidConfig(): VapidKeys | null {
  const publicKey = env("VAPID_PUBLIC_KEY"), privateKey = env("VAPID_PRIVATE_KEY");
  return publicKey && privateKey ? { publicKey, privateKey, subject: env("VAPID_SUBJECT") ?? "mailto:hello@boolaa.ro" } : null;
}

// deno-lint-ignore no-explicit-any
type DebugRow = Record<string, any>;

function providers(debug: DebugRow[]): Providers {
  if (!DRY_RUN) {
    return { apns: apnsConfig(), fcm: fcmConfig(), vapid: vapidConfig(), fetchFor: () => fetch as FetchFn };
  }
  // Dry run: no provider credentials are used; VAPID signing and encryption still run.
  return {
    apns: null,
    fcm: null,
    vapid: vapidConfig(),
    fetchFor: (item, token, m) => (url, init) => {
      const provider = token.platform === "ios" ? "apns" : token.platform === "android" ? "fcm" : "web";
      const sim = simulatedResponse(provider, token.token);
      const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>)
        .filter(([k]) => k.toLowerCase() !== "authorization"));
      debug.push({
        outbox_id: item.id,
        provider,
        token: token.token,
        title: m.title,
        body: m.body,
        collapse_key: m.collapseKey,
        simulated: sim.label,
        request: {
          url,
          headers,
          locale: (m as { locale?: string }).locale,
          authorization: provider === "web" ? "vapid (signed)" : undefined,
          payload: provider === "web" ? webPayload(m) : JSON.parse(String(init.body)),
          encrypted_bytes: provider === "web" ? (init.body as Uint8Array).length : undefined,
        },
      });
      return Promise.resolve(new Response(sim.body === null ? null : JSON.stringify(sim.body), { status: sim.status }));
    },
  };
}

async function dispatch(deadlineMs: number) {
  const totals = { claimed: 0, sent: 0, retry: 0, failed: 0, invalid_tokens: 0, dry_run: DRY_RUN };
  while (Date.now() < deadlineMs) {
    const { data, error } = await admin.rpc("claim_push_batch", { p_limit: 100 });
    if (error) throw new Error(`claim: ${error.message}`);
    const items = (data ?? []) as ClaimedItem[];
    if (!items.length) break;
    totals.claimed += items.length;

    const debug: DebugRow[] = [];
    const p = providers(debug);
    const done = await pool(items, 10, (it) => sendItem(it, p));
    const results: ItemResult[] = done.map((d) => d.result);
    const invalid = [...new Set(done.flatMap((d) => d.invalid))];

    if (debug.length) {
      const { error: e } = await admin.from("push_debug_log").insert(debug);
      if (e) console.error("push-dispatch: debug log", e.message);
    }
    const { error: e2 } = await admin.rpc("complete_push_batch", { p_results: results, p_invalid_token_ids: invalid });
    if (e2) throw new Error(`complete: ${e2.message}`); // rows come back after their 2-minute lease

    for (const r of results) totals[r.status === "sent" ? "sent" : r.status === "retry" ? "retry" : "failed"]++;
    totals.invalid_tokens += invalid.length;
  }
  return totals;
}

async function probeApns() {
  const out: Record<string, unknown> = {};
  for (const [env, host] of Object.entries(APNS_HOSTS)) {
    try {
      const r = await fetch(`${host}/3/device/${"0".repeat(64)}`, {
        method: "POST",
        headers: { "apns-topic": "ro.boolaa.app", "apns-push-type": "alert" },
        body: "{}",
      });
      // Over HTTP/2 APNs answers 403 {"reason":"MissingProviderToken"} with an apns-id header.
      out[env] = { status: r.status, apns_id: r.headers.get("apns-id"), body: await r.text() };
    } catch (e) {
      out[env] = { error: String(e) };
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = env("PUSH_DISPATCH_SECRET") ?? "";
  if (!secret || !timingSafeEqual(req.headers.get("x-push-dispatch-secret") ?? "", secret)) {
    return json(401, { error: "unauthorized" });
  }
  const body = await req.json().catch(() => ({}));
  if (body?.action === "probe_apns") return json(200, await probeApns());

  try {
    return json(200, await dispatch(Date.now() + 25_000));
  } catch (e) {
    console.error("push-dispatch", (e as Error).message);
    return json(500, { error: "server_error" });
  }
});
