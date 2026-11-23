import type { BoolaaClient } from "@/lib/supabase/client";

/**
 * "Download my data" (docs/boolaa-spec.md "Data export"). Call right after a `sensitive_action`
 * code ("export_data") was verified in this session: the Edge Function `data-export` checks that
 * proof and the 1-per-hour limit, and answers with the JSON file itself.
 */
export class DataExportError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "DataExportError";
  }
}

/**
 * When the next export is allowed (the limit is 1 per hour), or null when it is allowed now. Asked
 * BEFORE the code is emailed, so nobody gets a code they can't use.
 */
export async function exportAvailableAt(supabase: BoolaaClient): Promise<Date | null> {
  const { data, error } = await supabase.rpc("data_export_available_at");
  if (error) throw error;
  if (!data) return null;
  const at = new Date(data);
  return at.getTime() > Date.now() ? at : null;
}

/** The "try again after" time carried by a rate-limit error (send step or export), else null. */
export function rateLimitedUntil(e: unknown, now = Date.now()): Date | null {
  if (!e || typeof e !== "object") return null;
  const err = e as { name?: string; code?: string; retryAfter?: number };
  if ((err.name !== "DataExportError" && err.name !== "DeviceCodeError") || err.code !== "export_rate_limited") return null;
  return typeof err.retryAfter === "number" && err.retryAfter > 0 ? new Date(now + err.retryAfter * 1000) : null;
}

/** File name from `Content-Disposition`, else `boolaa-data-<UTC date>.json`. */
export function exportFileName(disposition: string | null, now = new Date()): string {
  const m = disposition?.match(/filename="?([^";]+)"?/i);
  const name = m?.[1]?.trim();
  return name && /^[\w.-]+\.json$/.test(name) ? name : `boolaa-data-${now.toISOString().slice(0, 10)}.json`;
}

async function request(supabase: BoolaaClient): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new DataExportError("unauthorized", 401);
  return fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/data-export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

/** Fetches the export (refresh + one retry on 401) and returns it as a Blob with its file name. */
export async function fetchMyData(supabase: BoolaaClient): Promise<{ blob: Blob; fileName: string }> {
  let res = await request(supabase);
  if (res.status === 401) {
    const { error } = await supabase.auth.refreshSession();
    if (!error) res = await request(supabase);
  }
  if (!res.ok) {
    let body: { error?: string; retry_after?: number } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new DataExportError(body.error ?? "server_error", res.status, body.retry_after);
  }
  const blob = await res.blob();
  return { blob: new Blob([blob], { type: "application/json" }), fileName: exportFileName(res.headers.get("content-disposition")) };
}

/** Saves a Blob through a temporary download link. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
