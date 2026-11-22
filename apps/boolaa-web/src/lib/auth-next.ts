/** Where /auth/callback continues after the device gate (set just before leaving for a provider / email link). */
export const AUTH_NEXT_COOKIE = "boolaa_auth_next";

/** Only same-site paths ("/x", never "//host" or "https://…"); anything else goes to /home. */
export function safeNext(value: string | null | undefined, fallback = "/home"): string {
  if (!value) return fallback;
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}
