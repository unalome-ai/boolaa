// Entry point of the link-preview Edge Function (verify_jwt = false: called by pg_net from the
// shared_links trigger). Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injected), optional
// LINK_PREVIEW_SECRET (must equal the Vault secret link_preview_secret when set).
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createHandler({
  secret: Deno.env.get("LINK_PREVIEW_SECRET") || undefined,
  log: (m) => console.log(`[link-preview] ${m}`),
  async claim(linkId) {
    const { data, error } = await admin.rpc("claim_link_preview", { p_link_id: linkId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.url ? { url: row.url } : null;
  },
  async store(linkId, url, status, p) {
    const { data, error } = await admin.rpc("store_link_preview", {
      p_link_id: linkId,
      p_url: url,
      p_status: status,
      p_title: p?.title ?? null,
      p_description: p?.description ?? null,
      p_site_name: p?.siteName ?? null,
      p_image_path: p?.imagePath ?? null,
    });
    if (error) throw error;
    return data === true;
  },
  async upload(path, jpeg) {
    const { error } = await admin.storage.from("link.previews").upload(path, jpeg, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw error;
  },
  async remove(path) {
    await admin.storage.from("link.previews").remove([path]);
  },
}));
