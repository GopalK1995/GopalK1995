"use client";
// Browser Supabase client wrapped as a RealtimeTransport. One client per tab. The user's JWT is pushed to the socket before
// every join and again on token refresh, so private-channel authorization (realtime.messages policies) always sees a live token.
import { createBrowserClient } from "@supabase/ssr";
import { RealtimeManager, type ManagerOptions } from "./manager";
import type { ChannelLike, RealtimeTransport } from "./types";

type Browser = ReturnType<typeof createBrowserClient>;
let singleton: Browser | null | undefined;

/** Browser client (anon key, user session). null when Supabase is not configured (demo and local-without-env). */
export function getRealtime(): Browser | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  singleton = url && key ? createBrowserClient(url, key) : null;
  return singleton;
}

export function supabaseTransport(sb: Browser): RealtimeTransport {
  return {
    channel: (topic, opts) => sb.channel(topic, { config: { private: opts.private, presence: { key: opts.presenceKey }, broadcast: { self: false } } }) as unknown as ChannelLike,
    removeChannel: (ch) => sb.removeChannel(ch as unknown as Parameters<Browser["removeChannel"]>[0]),
    async setAuth() {
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) await sb.realtime.setAuth(data.session.access_token);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event: string) => { if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") cb(); });
      return () => data.subscription.unsubscribe();
    },
  };
}

/** Real hub for a signed-in session, or null when the browser client is unavailable. */
export function createRealtimeHub(o: Omit<ManagerOptions, "transport">): RealtimeManager | null {
  const sb = getRealtime();
  return sb ? new RealtimeManager({ listen: true, ...o, transport: supabaseTransport(sb) }) : null;
}
