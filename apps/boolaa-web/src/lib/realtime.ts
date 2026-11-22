import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BoolaaClient } from "@/lib/supabase/client";

/**
 * A channel for postgres_changes that reports when it is *really* live.
 *
 * `SUBSCRIBED` only means the channel was joined; the Postgres change subscription behind it is
 * registered a moment later, and changes committed in that gap are never delivered (seen in tests
 * as missed join requests). The server emits a `system` event once changes flow, so callers
 * reload their data at that point (catching anything that happened in between) and only then
 * consider themselves live.
 */
export function liveChannel(
  supabase: BoolaaClient,
  name: string,
  bind: (channel: RealtimeChannel) => RealtimeChannel,
  onLive: (live: boolean) => void,
) {
  const channel = bind(supabase.channel(name, { config: { broadcast: { replication_ready: true } } }));
  channel
    .on("system", {}, (p: { extension?: string; status?: string; message?: string }) => {
      if (process.env.NEXT_PUBLIC_RT_DEBUG) console.debug(`[rt] ${name} system`, JSON.stringify(p));
      // Newer Realtime servers send extension "system" ("Replication connection established");
      // older ones (incl. the local CLI stack) send "postgres_changes" ("Subscribed to PostgreSQL")
      // once the change subscription is registered. Either means changes are now delivered.
      if (p.extension === "system" || p.extension === "postgres_changes") onLive(p.status === "ok");
    })
    .subscribe((status) => {
      if (process.env.NEXT_PUBLIC_RT_DEBUG) console.debug(`[rt] ${name} status`, status);
      if (status !== "SUBSCRIBED") onLive(false);
    });
  return () => void supabase.removeChannel(channel);
}
