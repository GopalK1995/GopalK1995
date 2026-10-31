import { beforeEach, describe, expect, it, vi } from "vitest";

const U_ME = "11111111-1111-4111-8111-111111111111";
const U_OK = "22222222-2222-4222-8222-222222222222";
const U_NO = "33333333-3333-4333-8333-333333333333";
const REC = "44444444-4444-4444-8444-444444444444";
const WS = "55555555-5555-4555-8555-555555555555";

const { state, create, edit, remove, follow, serviceDbSpy } = vi.hoisted(() => ({
  state: { demo: false, moderate: false, readers: new Set<string>(), comment: null as null | Record<string, unknown> },
  create: vi.fn(async (_ws: string, c: Record<string, unknown>) => ({ id: "c1", ...c })),
  edit: vi.fn(async () => ({ id: "c1" })),
  remove: vi.fn(async () => undefined),
  follow: vi.fn(async () => undefined),
  serviceDbSpy: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notify/session", () => ({
  collabCtx: async () => ({ uid: U_ME, name: "Me", demo: state.demo, ws: WS, wsKey: "ws-key", readOnlySupport: false }),
  canDo: async (p: string) => (p === "comments.moderate" ? state.moderate : true),
}));
vi.mock("@/lib/authz/load", () => ({ assertCan: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/service", () => ({ serviceDb: () => serviceDbSpy() }));
vi.mock("@/lib/db/query", () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [{ id: U_NO, full_name: "Nobody Access" }], error: null }) }) }) }));
vi.mock("@/lib/notify/repo", () => ({
  canUserRead: async (_db: unknown, user: string) => state.readers.has(user),
  listMentionable: async () => [],
  notifyRepos: {
    comments: { create, edit, remove, get: async () => state.comment },
    follows: { follow, unfollow: vi.fn() },
  },
}));

import { deleteComment, editComment, postComment, setFollow } from "@/components/collab/actions";

beforeEach(() => {
  vi.clearAllMocks();
  state.demo = false; state.moderate = false; state.readers = new Set([U_ME, U_OK]); state.comment = null;
});
const mention = (id: string, n: string) => `@[${n}](user:${id})`;

describe("postComment", () => {
  it("saves a comment whose mentions can all read the record", async () => {
    const r = await postComment({ objectType: "lead", objectId: REC, body: `hi ${mention(U_OK, "Ok")}` });
    expect(r.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(WS, expect.objectContaining({ mentions: [U_OK], objectType: "lead", parentId: null }));
  });
  it("rejects a mention of someone without read access, naming them, and writes nothing", async () => {
    const r = await postComment({ objectType: "lead", objectId: REC, body: `hi ${mention(U_NO, "Nobody Access")}` });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("invalid");
      expect(r.message).toContain("Nobody Access");
      expect(r.issues?.[0]).toMatchObject({ path: "mentions" });
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("denies commenting on a record the author cannot read", async () => {
    state.readers.delete(U_ME);
    const r = await postComment({ objectType: "lead", objectId: REC, body: "hello" });
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(create).not.toHaveBeenCalled();
  });
  it("validates input before touching anything", async () => {
    expect(await postComment({ objectType: "lead", objectId: "nope", body: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await postComment({ objectType: "lead", objectId: REC, body: "   " })).toMatchObject({ ok: false, code: "invalid" });
    expect(await postComment({ objectType: "lead", objectId: REC, body: "x".repeat(10001) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await postComment({ objectType: "../etc", objectId: REC, body: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(create).not.toHaveBeenCalled();
  });
  it("demo sessions never reach Supabase", async () => {
    state.demo = true;
    const r = await postComment({ objectType: "lead", objectId: REC, body: "demo" });
    expect(r.ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(serviceDbSpy).not.toHaveBeenCalled();
  });
});

describe("edit and delete", () => {
  const fresh = () => ({ id: "c1", authorId: U_ME, createdAt: new Date(Date.now() - 60_000).toISOString(), objectType: "lead", objectId: REC, mentions: [], deletedAt: null });
  const stale = () => ({ ...fresh(), createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  const body = "x";
  const id = "66666666-6666-4666-8666-666666666666";

  it("author edits and deletes within the window", async () => {
    state.comment = fresh();
    expect((await editComment({ id, body })).ok).toBe(true);
    expect((await deleteComment({ id })).ok).toBe(true);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("author is locked out after 15 minutes with the window reason", async () => {
    state.comment = stale();
    const r = await editComment({ id, body });
    expect(r).toMatchObject({ ok: false, code: "denied" });
    if (!r.ok) expect(r.message).toMatch(/15 minutes/);
    expect(await deleteComment({ id })).toMatchObject({ ok: false, code: "denied" });
    expect(edit).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("another user cannot edit or delete; a moderator can, at any age", async () => {
    state.comment = { ...fresh(), authorId: U_OK };
    expect(await editComment({ id, body })).toMatchObject({ ok: false, code: "denied" });
    expect(await deleteComment({ id })).toMatchObject({ ok: false, code: "denied" });
    state.moderate = true;
    state.comment = { ...stale(), authorId: U_OK };
    expect((await deleteComment({ id })).ok).toBe(true);
  });
  it("a missing or already-deleted comment is not_found", async () => {
    state.comment = null;
    expect(await editComment({ id, body })).toMatchObject({ ok: false, code: "not_found" });
    state.comment = { ...fresh(), deletedAt: new Date().toISOString() };
    expect(await deleteComment({ id })).toMatchObject({ ok: false, code: "not_found" });
  });
  it("editing only re-checks newly added mentions", async () => {
    state.comment = { ...fresh(), mentions: [U_NO] }; // accepted earlier, access since revoked
    const kept = await editComment({ id, body: `still ${mention(U_NO, "Nobody Access")}` });
    expect(kept.ok).toBe(true);
    const added = await editComment({ id, body: `${mention(U_NO, "Nobody Access")} ${mention("77777777-7777-4777-8777-777777777777", "Stranger")}` });
    expect(added).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("setFollow", () => {
  it("follows a readable record and refuses an unreadable one", async () => {
    expect((await setFollow({ objectType: "deal", objectId: REC, follow: true })).ok).toBe(true);
    expect(follow).toHaveBeenCalledWith(U_ME, "deal", REC);
    state.readers.delete(U_ME);
    expect(await setFollow({ objectType: "deal", objectId: REC, follow: true })).toMatchObject({ ok: false, code: "denied" });
  });
});
