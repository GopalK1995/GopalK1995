// One my_grants round trip (public wrapper of authz.my_grants) per workspace per request. requireActive() starts it as soon as the active workspace is known
// (in parallel with the tenant-config read) and loadPrincipal() awaits the same promise, so the grants no longer queue behind config.
// Never throws: callers decide what a failure means (loadPrincipal fails CLOSED, AUD-003).
import { cache } from "react";
import { createSupabaseServerClient } from "../supabase/server";

export type GrantsResult = { client: false } | { client: true; data: unknown; error: { code?: string; message?: string } | null };

export const fetchMyGrants = cache(async (wsUuid: string): Promise<GrantsResult> => {
  try {
    const sb = await createSupabaseServerClient();
    if (!sb) return { client: false };
    // public.my_grants is the PostgREST-exposed wrapper (migration 0013); the authz schema itself is not exposed and answers 406.
    const { data, error } = await sb.rpc("my_grants", { p_ws: wsUuid });
    return { client: true, data, error: error ? { code: error.code, message: error.message } : null };
  } catch (e) {
    return { client: true, data: null, error: { message: e instanceof Error ? e.message : "rpc threw" } };
  }
});
