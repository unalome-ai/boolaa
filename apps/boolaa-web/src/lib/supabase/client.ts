import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type BoolaaClient = SupabaseClient<Database>;

let client: BoolaaClient | undefined;

/** Browser Supabase client (singleton). Session lives in cookies so the proxy can read it. */
export function getSupabase(): BoolaaClient {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
