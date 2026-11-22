// Shared helpers for the local auth/security test suite (supabase/tests).
// Local stack only: never point these at production.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

export const API = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:55321";
export const MAILPIT = Deno.env.get("MAILPIT_URL") ?? "http://127.0.0.1:55324";
export const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
export const PASSWORD = "password123";
export const TEST_DEVICE = "boolaa-test-device"; // pre-trusted for alice, bob, carol (seed.sql)

if (!/127\.0\.0\.1|localhost/.test(API)) throw new Error("supabase/tests only run against the local stack");

async function statusEnv(): Promise<Record<string, string>> {
  const out = await new Deno.Command("supabase", { args: ["status", "-o", "env"], stdout: "piped", stderr: "null" }).output();
  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(out.stdout).split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = await statusEnv();
export const ANON_KEY = Deno.env.get("ANON_KEY") ?? env.ANON_KEY;
export const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? env.SERVICE_ROLE_KEY;
if (!ANON_KEY || !SERVICE_KEY) throw new Error("could not read keys from `supabase status -o env`");

export const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
export const admin = createClient(API, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const client = () =>
  createClient(API, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function claims(token: string): Record<string, any> {
  const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.padEnd(Math.ceil(p.length / 4) * 4, "=")), (c) => c.charCodeAt(0))));
}

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const uniqueEmail = (tag: string) => `t-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@boolaa.test`;
export const randomDevice = () => `dev-${crypto.randomUUID()}-${crypto.randomUUID()}`;

export async function setFlags(f: { device?: boolean; age?: boolean }) {
  if (f.device !== undefined) await sql`update public.app_settings set device_verification_enforced = ${f.device}, updated_at = now()`;
  if (f.age !== undefined) await sql`update public.app_settings set age_confirmation_required = ${f.age}, updated_at = now()`;
}

const created: string[] = [];
export async function createUser(opts: { locale?: string; name?: string; confirmed?: boolean; meta?: Record<string, unknown> } = {}) {
  const email = uniqueEmail(opts.locale ?? "x");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: opts.confirmed ?? true,
    user_metadata: { name: opts.name ?? "Tess", locale: opts.locale ?? "en", age_confirmed: true, ...opts.meta },
  });
  if (error) throw error;
  created.push(data.user.id);
  return { email, id: data.user.id };
}
export const trackUser = (id: string) => created.push(id);

export async function cleanupUsers() {
  for (const id of created.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {});
}

export async function signIn(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

export async function token(c: SupabaseClient) {
  return (await c.auth.getSession()).data.session!.access_token;
}

export async function deviceCode(c: SupabaseClient, body: Record<string, unknown>) {
  const res = await fetch(`${API}/functions/v1/device-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(c)}`, apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- Mailpit -----------------------------------------------------------------
export interface Mail { id: string; subject: string; text: string; html: string; from: string }
const seen = new Set<string>();

export async function waitMail(to: string, opts: { subject?: RegExp; timeoutMs?: number } = {}): Promise<Mail> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10000);
  while (Date.now() < deadline) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`)).json();
    for (const m of list.messages ?? []) {
      if (seen.has(m.ID) || !m.To?.some((t: { Address: string }) => t.Address.toLowerCase() === to.toLowerCase())) continue;
      if (opts.subject && !opts.subject.test(m.Subject)) continue;
      seen.add(m.ID);
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      return { id: m.ID, subject: m.Subject, text: full.Text, html: full.HTML, from: `${full.From.Name} <${full.From.Address}>` };
    }
    await sleep(250);
  }
  throw new Error(`no email to ${to}${opts.subject ? ` matching ${opts.subject}` : ""}`);
}

export async function countMail(to: string, subject?: RegExp) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=200`)).json();
  return (list.messages ?? []).filter((m: { To: { Address: string }[]; Subject: string }) =>
    m.To.some((t) => t.Address === to) && (!subject || subject.test(m.Subject))).length;
}

export const codeOf = (m: Mail) => {
  const c = m.text.match(/: (\d{6})\b/)?.[1];
  if (!c) throw new Error(`no code in email "${m.subject}"`);
  return c;
};

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
export function assertEq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
