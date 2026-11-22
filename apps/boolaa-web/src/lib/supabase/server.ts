import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Server Component Supabase client (reads the auth cookies; RLS applies as the signed-in user).
 * Cookie writes are ignored here: the proxy already refreshed the session for this request.
 */
export async function getServerSupabase() {
  const store = await cookies();
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: () => {},
    },
  });
}
