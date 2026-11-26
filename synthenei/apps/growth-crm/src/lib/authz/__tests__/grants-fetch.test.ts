import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: "ok" as "ok" | "none" | "throws", rpc: { data: null as unknown, error: null as null | { code?: string; message?: string } } }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (state.client === "none") return null;
    return { schema: () => ({ rpc: async () => { if (state.client === "throws") throw new Error("network down"); return state.rpc; } }) };
  },
}));
import { fetchMyGrants } from "../grants-fetch";

beforeEach(() => { state.client = "ok"; state.rpc = { data: null, error: null }; });

describe("fetchMyGrants (prefetched by requireActive, consumed by loadPrincipal)", () => {
  it("returns the rpc data", async () => {
    state.rpc = { data: { role: "owner" }, error: null };
    expect(await fetchMyGrants("W1")).toEqual({ client: true, data: { role: "owner" }, error: null });
  });
  it("never throws: a missing client, an rpc error and a thrown fetch all come back as values so a prefetch cannot reject unhandled", async () => {
    state.client = "none";
    expect(await fetchMyGrants("W1")).toEqual({ client: false });
    state.client = "ok"; state.rpc = { data: null, error: { code: "42883", message: "missing" } };
    expect(await fetchMyGrants("W1")).toMatchObject({ client: true, data: null, error: { code: "42883" } });
    state.client = "throws";
    expect(await fetchMyGrants("W1")).toMatchObject({ client: true, error: { message: "network down" } });
  });
});
