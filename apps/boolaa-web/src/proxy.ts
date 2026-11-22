import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets, image files, /.well-known (universal / App Links files:
  // fetched by Apple's CDN and Android, never redirected and never worth a session check) and the
  // push service worker /sw.js (the browser fetches it for updates, signed in or not; a redirect
  // to /login would break the registration).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js$|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
