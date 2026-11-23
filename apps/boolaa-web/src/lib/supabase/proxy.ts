import { createServerClient } from "@supabase/ssr";
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

const PUBLIC_PATHS = ["/login", "/register"];
/**
 * Open to everyone, signed in or not (no redirects). `/auth/callback` exchanges OAuth / email-link
 * codes; `/forgot-password` keeps its fresh recovery session on the page until the new password is set.
 * `/join/CODE` (invite links) works signed out (sign-in prompt) and signed in with or without bubbles.
 * `/android` is the APK download page; `/android/latest.json` (the app's update manifest) is also
 * skipped by the matcher in src/proxy.ts. `/.well-known` is also skipped by the matcher; both are
 * listed here in case that changes.
 */
const OPEN_PATHS = ["/privacy", "/terms", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon", "/apple-icon", "/manifest.webmanifest", "/auth", "/forgot-password", "/join", "/android", "/.well-known"];
/** Device / age gate (docs/auth-security.md §8): signed-in only, never bounced elsewhere. */
const GATE_PATH = "/verify";
/**
 * Moderation (docs/moderation.md): /admin answers 404 by itself to anyone who isn't an admin (a
 * redirect would reveal it); /suspended is the screen for suspended or banned accounts.
 */
const MODERATION_PATHS = ["/admin", "/suspended"];
const MAIN_PATHS = ["/home", "/events", "/food", "/marketplace", "/settings", "/chat", "/links"];

function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session (writing rotated auth cookies onto the response)
 * and gates routes:
 *   signed out            -> /login
 *   signed in, unverified -> /verify (device code or 16+ screen; RLS would show nothing anyway)
 *   signed in, 0 bubbles  -> /onboarding (main routes only)
 *   signed in on /login   -> /home
 * The device id lives only in the browser, so the proxy can't run start_device_check itself; it
 * asks is_session_verified() (device check + age) and leaves the rest to the /verify page.
 */
export async function updateSession(request: NextRequest) {
  // `?lang=xx` (used by the mobile apps for /privacy and /terms) overrides the locale for this
  // render and is remembered in the locale cookie.
  const lang = request.nextUrl.searchParams.get("lang");
  const langOverride = lang && isLocale(lang) ? lang : null;
  if (langOverride) request.cookies.set(LOCALE_COOKIE, langOverride);
  const withLang = (res: NextResponse) => {
    if (langOverride) res.cookies.set(LOCALE_COOKIE, langOverride, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  };

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Mirror refreshed cookies onto the request (for this render) and the response (for the browser).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // Do not put code between client creation and getClaims(): it triggers the refresh.
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const { pathname } = request.nextUrl;

  // Only a definite "no / invalid session" counts as signed out. A transient failure talking to
  // the auth server (network, 5xx, rate limit) must not bounce a signed-in user to /login.
  const transient =
    isAuthRetryableFetchError(error) ||
    (isAuthApiError(error) && (error.status === 429 || (error.status ?? 0) >= 500));
  if (error && transient) {
    console.warn(`[proxy] auth check failed for ${pathname}: ${error.name} ${error.message}`);
    return withLang(response);
  }

  // Redirects must carry any refreshed cookies, otherwise the browser loses the new session.
  const redirect = (to: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = search;
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return withLang(res);
  };

  if (matches(pathname, OPEN_PATHS) || matches(pathname, MODERATION_PATHS)) return withLang(response);

  if (!userId) {
    // Signed-out visitors get the landing page at "/".
    if (pathname === "/" || matches(pathname, PUBLIC_PATHS)) return withLang(response);
    if (error && process.env.NODE_ENV !== "production") {
      console.warn(`[proxy] signed out on ${pathname}: ${error.name} ${error.message}`);
    }
    return redirect("/login");
  }

  if (matches(pathname, [GATE_PATH])) return withLang(response);

  // An unverified session reads nothing (RLS), so it looks like "no bubbles": check the gate
  // only then (with enforcement off, or once verified, this costs nothing extra).
  const verified = async () => {
    const { data, error } = await supabase.rpc("is_session_verified");
    return error ? true : data !== false; // a failed check falls back to the client-side gate
  };
  // A suspended or banned account also fails is_session_verified() (but may read its own row):
  // it goes to /suspended instead of the device gate.
  const suspended = async () => {
    const { data } = await supabase.from("users").select("status, status_until").eq("id", userId).maybeSingle();
    if (!data || data.status === "active") return false;
    return data.status === "banned" || !data.status_until || new Date(data.status_until).getTime() > Date.now();
  };
  const toGate = async () =>
    (await suspended())
      ? redirect("/suspended")
      : redirect(GATE_PATH, `?next=${encodeURIComponent(pathname === "/" || matches(pathname, PUBLIC_PATHS) ? "/home" : pathname)}`);

  if (matches(pathname, ["/onboarding"]) && !(await verified())) return toGate();

  if (pathname === "/" || matches(pathname, PUBLIC_PATHS) || matches(pathname, MAIN_PATHS)) {
    const { count } = await supabase
      .from("bubble_members")
      .select("bubble_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("approved", true);
    const hasBubble = (count ?? 0) > 0;
    if (!hasBubble && !(await verified())) return toGate();
    if (!hasBubble) return redirect("/onboarding");
    if (pathname === "/" || matches(pathname, PUBLIC_PATHS)) return redirect("/home");
  }

  return withLang(response);
}
