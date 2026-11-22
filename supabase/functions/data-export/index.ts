// Entry point of the data-export Edge Function (verify_jwt = false: like device-code, it validates
// the user JWT itself with auth.getUser, which also works with asymmetric signing keys).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (injected); optional
// AUTH_PUBLIC_URL (already set for the email functions): the public base URL put in photo links,
// because inside the local runtime SUPABASE_URL is the Docker-internal http://kong:8000.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PUBLIC_URL = (Deno.env.get("AUTH_PUBLIC_URL") || SUPABASE_URL).replace(/\/+$/, "");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, opts);

const toPublic = (url: string) => url.startsWith(SUPABASE_URL) ? PUBLIC_URL + url.slice(SUPABASE_URL.length) : url;

Deno.serve(createHandler({
  log: (m) => console.log(`[data-export] ${m}`),
  async getUser(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error || !data?.user ? null : { id: data.user.id };
  },
  async exportData(jwt) {
    const user = createClient(SUPABASE_URL, ANON_KEY, { ...opts, global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data, error } = await user.rpc("export_my_data");
    return { data, error };
  },
  async signUrls(bucket, paths, expiresIn) {
    const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, expiresIn);
    if (error) throw error;
    const out = new Map<string, string>();
    for (const r of data ?? []) if (!r.error && r.path && r.signedUrl) out.set(r.path, toPublic(r.signedUrl));
    return out;
  },
  publicUrl(bucket, path) {
    return toPublic(admin.storage.from(bucket).getPublicUrl(path).data.publicUrl);
  },
}));
