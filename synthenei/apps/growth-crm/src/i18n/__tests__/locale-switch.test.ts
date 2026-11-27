// AUD-043: the language switcher's server action and the cookie > profile > Accept-Language resolution used by every server component.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const store = new Map<string, string>();
const hdrs = { "accept-language": undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (store.has(k) ? { value: store.get(k)! } : undefined), set: (k: string, v: string) => { store.set(k, v); } }),
  headers: async () => ({ get: (k: string) => (k === "accept-language" ? hdrs["accept-language"] ?? null : null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = { current: null as null | { uid: string; demo: boolean } };
vi.mock("@/lib/auth/server", () => ({ getSession: async () => session.current }));
const db = { language: "en" as string | null, updates: [] as unknown[], fail: false };
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.language ? { language: db.language } : null }) }) }),
      update: (patch: unknown) => ({ eq: () => ({ select: async () => { if (db.fail) return { data: null, error: { message: "x" } }; db.updates.push(patch); return { data: [{ id: "u1" }], error: null }; } }) }),
    }),
  }),
}));

async function load(tamil: boolean) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_TAMIL_UI = tamil ? "1" : "0";
  return { actions: await import("../actions"), server: await import("../server") };
}

beforeEach(() => { store.clear(); hdrs["accept-language"] = undefined; session.current = null; db.language = "en"; db.updates = []; db.fail = false; });

describe("setLocale", () => {
  it("writes the gcrm_lang cookie and profiles.language for a real signed-in user", async () => {
    const { actions } = await load(true);
    session.current = { uid: "u1", demo: false };
    expect(await actions.setLocale("ta")).toEqual({ ok: true, saved: true });
    expect(store.get("gcrm_lang")).toBe("ta");
    expect(db.updates).toEqual([{ language: "ta" }]);
  });
  it("still sets the cookie for demo sessions and visitors (no database needed)", async () => {
    const { actions } = await load(true);
    session.current = { uid: "d1", demo: true };
    expect(await actions.setLocale("ta")).toEqual({ ok: true, saved: false });
    expect(store.get("gcrm_lang")).toBe("ta");
    expect(db.updates).toEqual([]);
  });
  it("keeps the cookie when the profile write fails", async () => {
    const { actions } = await load(true);
    session.current = { uid: "u1", demo: false }; db.fail = true;
    expect(await actions.setLocale("en")).toEqual({ ok: true, saved: false });
    expect(store.get("gcrm_lang")).toBe("en");
  });
  it("rejects unknown locales and refuses Tamil while the review gate is closed", async () => {
    const { actions } = await load(false);
    expect(await actions.setLocale("fr")).toEqual({ ok: false, reason: "invalid" });
    expect(await actions.setLocale("ta")).toEqual({ ok: false, reason: "unavailable" });
    expect(store.has("gcrm_lang")).toBe(false);
  });
});

describe("getLocale order", () => {
  it("cookie beats profile and header", async () => {
    const { server } = await load(true);
    store.set("gcrm_lang", "en"); db.language = "ta"; hdrs["accept-language"] = "ta";
    session.current = { uid: "u1", demo: false };
    expect(await server.getLocale()).toBe("en");
  });
  it("profile beats Accept-Language when there is no cookie", async () => {
    const { server } = await load(true);
    db.language = "ta"; hdrs["accept-language"] = "en";
    session.current = { uid: "u1", demo: false };
    expect(await server.getLocale()).toBe("ta");
  });
  it("Accept-Language applies to visitors and demo sessions; default is en", async () => {
    const { server } = await load(true);
    hdrs["accept-language"] = "ta-IN,ta;q=0.9";
    expect(await server.getLocale()).toBe("ta");
    const again = await load(true);
    hdrs["accept-language"] = undefined;
    expect(await again.server.getLocale()).toBe("en");
  });
  it("a stored ta falls back to en while the gate is closed", async () => {
    const { server } = await load(false);
    store.set("gcrm_lang", "ta");
    expect(await server.getLocale()).toBe("en");
  });
});
