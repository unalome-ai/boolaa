import { createServerClient } from "@supabase/ssr";
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

const PUBLIC_PATHS = ["/login", "/register"];
/** Open to everyone, signed in or not (no redirects). */
const OPEN_PATHS = ["/privacy", "/terms", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon", "/apple-icon", "/manifest.webmanifest"];
const MAIN_PATHS = ["/home", "/events", "/food", "/marketplace", "/settings", "/chat", "/links"];

function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session (writing rotated auth cookies onto the response)
 * and gates routes:
 *   signed out            -> /login
 *   signed in, 0 bubbles  -> /onboarding (main routes only)
 *   signed in on /login   -> /home
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
  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return withLang(res);
  };

  if (matches(pathname, OPEN_PATHS)) return withLang(response);

  if (!userId) {
    // Signed-out visitors get the landing page at "/".
    if (pathname === "/" || matches(pathname, PUBLIC_PATHS)) return withLang(response);
    if (error && process.env.NODE_ENV !== "production") {
      console.warn(`[proxy] signed out on ${pathname}: ${error.name} ${error.message}`);
    }
    return redirect("/login");
  }

  if (pathname === "/" || matches(pathname, PUBLIC_PATHS) || matches(pathname, MAIN_PATHS)) {
    const { count } = await supabase
      .from("bubble_members")
      .select("bubble_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("approved", true);
    const hasBubble = (count ?? 0) > 0;
    if (!hasBubble) return redirect("/onboarding");
    if (pathname === "/" || matches(pathname, PUBLIC_PATHS)) return redirect("/home");
  }

  return withLang(response);
}
