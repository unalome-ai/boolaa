import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { AUTH_NEXT_COOKIE, safeNext } from "@/lib/auth-next";

/**
 * Return URL for Sign in with Google / Apple and for the links in auth emails (password reset,
 * email change): exchanges the PKCE `code` for a session (cookies), then hands over to the device
 * gate (/verify), which runs start_device_check, the 16+ screen if needed and the routing.
 * The redirect allow-list holds this exact URL, so the destination after the gate travels in a
 * short-lived cookie set before leaving (see lib/auth-next), not in the query string.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(request.cookies.get(AUTH_NEXT_COOKIE)?.value);
  const failTo = next.startsWith("/forgot-password") ? "/forgot-password?error=link" : "/login?error=oauth";

  const to = (path: string) => {
    const res = NextResponse.redirect(new URL(path, url.origin));
    res.cookies.delete(AUTH_NEXT_COOKIE);
    return res;
  };

  // A suspended or banned account (docs/moderation.md): GoTrue answers `user_banned`, either in the
  // redirect (error_code) or from the code exchange.
  const banned = (v: string | null | undefined) => v === "user_banned" || /user is banned/i.test(v ?? "");
  if (banned(url.searchParams.get("error_code")) || banned(url.searchParams.get("error_description"))) return to("/suspended");
  if (!code || url.searchParams.has("error")) return to(failTo);

  let response = to(`/verify?next=${encodeURIComponent(next)}`);
  const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    response = to(banned(error.code) || banned(error.message) ? "/suspended" : failTo);
  }
  return response;
}
