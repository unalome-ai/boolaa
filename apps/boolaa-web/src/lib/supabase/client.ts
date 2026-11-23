import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { timedFetch } from "@/lib/connectivity";

export type BoolaaClient = SupabaseClient<Database>;

let client: BoolaaClient | undefined;

/**
 * Browser Supabase client (singleton). Session lives in cookies so the proxy can read it. Requests
 * go through timedFetch (lib/connectivity.ts): 15 s timeout (storage 60 s), reachability reports.
 */
export function getSupabase(): BoolaaClient {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      // Timeouts instead of endless spinners, and reachability for the offline banner.
      { global: { fetch: timedFetch } },
    );
  }
  return client;
}
