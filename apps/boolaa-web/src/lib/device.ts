import { FunctionsHttpError } from "@supabase/supabase-js";
import type { BoolaaClient } from "@/lib/supabase/client";

/** Terms version the user accepts at sign-up and on the one-time 16+ screen (docs/auth-security.md §6). */
export const TERMS_VERSION = "2026-11-22";

/** Key of this browser profile's device secret in localStorage (docs/auth-security.md §2). */
export const DEVICE_KEY = "boolaa_device_id";

/** Seconds before "Resend code" is enabled again (GoTrue `max_frequency`, device-code limits). */
export const RESEND_COOLDOWN_S = 60;

function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url (43 chars), created once per browser profile and kept across sign-outs. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 16 && existing.length <= 512) return existing;
    const id = base64url(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode in some browsers): a per-tab id still works, it just counts
    // as a new device next time.
    const w = window as unknown as { __boolaaDeviceId?: string };
    w.__boolaaDeviceId ??= base64url(crypto.getRandomValues(new Uint8Array(32)));
    return w.__boolaaDeviceId;
  }
}

/** Lowercase hex sha256, as the server stores device ids. */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Safari on macOS": browser + OS only, no personal data (max 120 chars). */
export function deviceLabel(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /iPhone|iPod/.test(ua)
    ? "iOS"
    : /iPad/.test(ua)
      ? "iPadOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  return (os ? `${browser} on ${os}` : browser).slice(0, 120);
}

export type DeviceCheck = { status: "verified" | "code_required"; needs_age_confirmation: boolean };

/** `start_device_check`: run after every sign-in and session restore, before loading data. */
export async function startDeviceCheck(supabase: BoolaaClient): Promise<DeviceCheck> {
  const { data, error } = await supabase.rpc("start_device_check", { p_device_id: getDeviceId(), p_label: deviceLabel() });
  if (error) throw error;
  const d = (data ?? {}) as Partial<DeviceCheck>;
  return { status: d.status === "verified" ? "verified" : "code_required", needs_age_confirmation: d.needs_age_confirmation === true };
}

/**
 * What the device gate has to show for this session. A `code_required` device only blocks while
 * enforcement is on (`is_device_verified()` is true when it's off), so nobody gets a code before
 * the rollout switch; devices that pass meanwhile are trusted silently.
 */
export async function gateState(supabase: BoolaaClient): Promise<"ok" | "code" | "age"> {
  const check = await startDeviceCheck(supabase);
  if (check.status === "code_required") {
    const { data: deviceOk, error } = await supabase.rpc("is_device_verified");
    if (error) throw error;
    if (!deviceOk) return "code";
  }
  return check.needs_age_confirmation ? "age" : "ok";
}

/** Error from the `device-code` Edge Function (docs/auth-security.md §3), mapped by i18n/errors. */
export class DeviceCodeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly attemptsLeft?: number,
  ) {
    super(code);
    this.name = "DeviceCodeError";
  }
}

type DeviceCodeBody =
  | { action: "send"; purpose: "device"; device_id: string; label: string; locale?: string }
  | { action: "verify"; purpose: "device"; device_id: string; label: string; code: string }
  | { action: "send"; purpose: "sensitive_action"; sensitive_action: SensitiveAction; locale?: string }
  | { action: "verify"; purpose: "sensitive_action"; code: string };

async function invokeDeviceCode(supabase: BoolaaClient, body: DeviceCodeBody) {
  const { data, error } = await supabase.functions.invoke<{ status: string; expires_at?: string }>("device-code", { body });
  if (!error) return data;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    let payload: { error?: string; attempts_left?: number } = {};
    try {
      payload = await res.json();
    } catch {
      /* not JSON */
    }
    throw new DeviceCodeError(payload.error ?? "server_error", res.status, payload.attempts_left);
  }
  throw error;
}

/** Retries once after a token refresh on 401 (contract: "refresh and retry once, then sign out"). */
async function deviceCode(supabase: BoolaaClient, body: DeviceCodeBody) {
  try {
    return await invokeDeviceCode(supabase, body);
  } catch (e) {
    if (e instanceof DeviceCodeError && e.code === "unauthorized") {
      const { error } = await supabase.auth.refreshSession();
      if (!error) return invokeDeviceCode(supabase, body);
    }
    throw e;
  }
}

export const sendDeviceCode = (supabase: BoolaaClient, locale?: string) =>
  deviceCode(supabase, { action: "send", purpose: "device", device_id: getDeviceId(), label: deviceLabel(), locale });

export const verifyDeviceCode = (supabase: BoolaaClient, code: string) =>
  deviceCode(supabase, { action: "verify", purpose: "device", device_id: getDeviceId(), label: deviceLabel(), code });

export type SensitiveAction = "delete_account" | "change_password" | "change_email" | "generic";

export const sendSensitiveCode = (supabase: BoolaaClient, action: SensitiveAction, locale?: string) =>
  deviceCode(supabase, { action: "send", purpose: "sensitive_action", sensitive_action: action, locale });

export const verifySensitiveCode = (supabase: BoolaaClient, code: string) =>
  deviceCode(supabase, { action: "verify", purpose: "sensitive_action", code });

/** Remembers when a code was last sent (per purpose), so a reload doesn't send another within 60 s. */
export function lastSent(purpose: string): number {
  try {
    return Number(sessionStorage.getItem(`boolaa_code_sent:${purpose}`) ?? 0);
  } catch {
    return 0;
  }
}
export function markSent(purpose: string) {
  try {
    sessionStorage.setItem(`boolaa_code_sent:${purpose}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}
