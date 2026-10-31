import { describe, expect, it } from "vitest";
import { canDeleteComment, canEditComment, commentLockReason } from "../comment-policy";
import { bodyParts, checkMentions, extractMentionIds, mentionToken, plainBody } from "../mentions";
import { decideDelivery, prefFor, quietFromPrefs, quietKind } from "../prefs";
import { formatQuiet, inQuietHours, istMinutes, parseQuiet, quietEndsAt } from "../quiet";
import { badgeLabel } from "../repo";
import { objectUrl } from "../urls";
import type { PrefRow } from "../types";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const pref = (kind: string, channels: PrefRow["channels"], digest: PrefRow["digest"] = "instant"): PrefRow =>
  ({ userId: U1, workspaceId: "w", kind, channels, digest });

describe("quiet hours (IST)", () => {
  const q = parseQuiet("22:00-07:00");
  it("parses and rejects bad input", () => {
    expect(q).toEqual({ start: 1320, end: 420 });
    expect(parseQuiet("22:00-22:00")).toBeNull();
    expect(parseQuiet("25:00-07:00")).toBeNull();
    expect(parseQuiet("garbage")).toBeNull();
    expect(formatQuiet(q)).toBe("22:00-07:00");
  });
  it("converts UTC to IST regardless of server zone", () => {
    expect(istMinutes(new Date("2026-10-31T17:00:00Z"))).toBe(22 * 60 + 30);
    expect(istMinutes(new Date("2026-10-31T20:00:00Z"))).toBe(60 + 30); // 01:30 IST next day
  });
  it("wraps midnight", () => {
    expect(inQuietHours(new Date("2026-10-31T17:00:00Z"), q)).toBe(true); // 22:30 IST
    expect(inQuietHours(new Date("2026-10-31T20:00:00Z"), q)).toBe(true); // 01:30 IST
    expect(inQuietHours(new Date("2026-10-31T02:00:00Z"), q)).toBe(false); // 07:30 IST
    expect(inQuietHours(new Date("2026-10-31T06:00:00Z"), q)).toBe(false); // 11:30 IST
    expect(inQuietHours(new Date("2026-10-31T17:00:00Z"), null)).toBe(false);
  });
  it("quiet period ends at the next 07:00 IST", () => {
    expect(quietEndsAt(new Date("2026-10-31T17:00:00Z"), q).toISOString()).toBe("2026-11-01T01:30:00.000Z");
    const day = new Date("2026-10-31T06:00:00Z");
    expect(quietEndsAt(day, q)).toBe(day);
  });
  it("same-day window", () => {
    const w = parseQuiet("13:00-14:00");
    expect(inQuietHours(new Date("2026-10-31T08:00:00Z"), w)).toBe(true); // 13:30 IST
    expect(inQuietHours(new Date("2026-10-31T09:00:00Z"), w)).toBe(false); // 14:30 IST
  });
});

describe("preferences -> delivery", () => {
  const day = new Date("2026-10-31T06:00:00Z");
  const night = new Date("2026-10-31T17:00:00Z");
  it("most specific preference wins", () => {
    const ps = [pref("*", ["in_app"]), pref("lead.*", ["in_app", "email"]), pref("lead.assigned", ["in_app"], "off")];
    expect(prefFor(ps, "lead.assigned")?.kind).toBe("lead.assigned");
    expect(prefFor(ps, "lead.created")?.kind).toBe("lead.*");
    expect(prefFor(ps, "deal.won")?.kind).toBe("*");
    expect(prefFor([], "deal.won")).toBeNull();
  });
  it("in-app is always on for a rule match; muted kinds create nothing", () => {
    expect(decideDelivery({ ruleChannels: ["in_app"], prefs: [], eventType: "lead.assigned", now: day })).toMatchObject({ inApp: true, email: "none" });
    expect(decideDelivery({ ruleChannels: ["in_app", "email"], prefs: [pref("lead.assigned", [], "off")], eventType: "lead.assigned", now: day }))
      .toMatchObject({ muted: true, inApp: false, email: "none" });
  });
  it("email needs both the rule and the user's channel", () => {
    expect(decideDelivery({ ruleChannels: ["in_app", "email"], prefs: [], eventType: "x.y", now: day }).email).toBe("queued");
    expect(decideDelivery({ ruleChannels: ["in_app", "email"], prefs: [pref("x.y", ["in_app"])], eventType: "x.y", now: day }).email).toBe("none");
    expect(decideDelivery({ ruleChannels: ["in_app"], prefs: [pref("x.y", ["in_app", "email"])], eventType: "x.y", now: day }).email).toBe("none");
  });
  it("quiet hours defer email only, until they end", () => {
    const ps = [pref(quietKind("22:00-07:00"), ["in_app"])];
    expect(quietFromPrefs(ps)).toEqual({ start: 1320, end: 420 });
    const d = decideDelivery({ ruleChannels: ["in_app", "email"], prefs: ps, eventType: "x.y", now: night });
    expect(d).toMatchObject({ inApp: true, email: "queued", deliverAfter: "2026-11-01T01:30:00.000Z" });
    expect(decideDelivery({ ruleChannels: ["in_app", "email"], prefs: ps, eventType: "x.y", now: day }).deliverAfter).toBeUndefined();
  });
  it("the reserved quiet row never acts as an event preference", () => {
    expect(prefFor([pref(quietKind("22:00-07:00"), ["in_app"])], "x.y")).toBeNull();
  });
});

describe("mentions", () => {
  it("round-trips tokens", () => {
    const body = `Ask ${mentionToken({ id: U1, name: "Priya S" })} and ${mentionToken({ id: U2, name: "Arun" })} to call`;
    expect(extractMentionIds(body)).toEqual([U1, U2]);
    expect(plainBody(body)).toBe("Ask @Priya S and @Arun to call");
    expect(bodyParts(body).map((p) => p.t)).toEqual(["text", "mention", "text", "mention", "text"]);
  });
  it("de-duplicates and ignores malformed ids", () => {
    const t = mentionToken({ id: U1, name: "P" });
    expect(extractMentionIds(`${t} ${t} @[X](user:not-a-uuid)`)).toEqual([U1]);
  });
  it("strips bracket characters from names so tokens cannot be forged", () => {
    expect(mentionToken({ id: U1, name: "A](user:x) [B" })).toBe(`@[Auser:x B](user:${U1})`);
  });
  it("rejects mentions of users who cannot read the record; the author is exempt", () => {
    const readable = new Set([U1]);
    expect(checkMentions([U1], readable, "author")).toEqual({ ok: true, rejected: [], tooMany: false });
    expect(checkMentions([U1, U2], readable, "author")).toMatchObject({ ok: false, rejected: [U2] });
    expect(checkMentions([U2], readable, U2).ok).toBe(true);
    expect(checkMentions(Array.from({ length: 21 }, (_, i) => `id${i}`), new Set(Array.from({ length: 21 }, (_, i) => `id${i}`)), "a").tooMany).toBe(true);
  });
});

describe("comment edit/delete permissions", () => {
  const now = new Date("2026-10-31T10:00:00Z");
  const base = { authorId: U1, viewerId: U1, now, canModerate: false };
  it("author within 15 minutes", () => {
    expect(canEditComment({ ...base, createdAt: "2026-10-31T09:50:00Z" })).toBe(true);
    expect(canDeleteComment({ ...base, createdAt: "2026-10-31T09:50:00Z" })).toBe(true);
  });
  it("author after 15 minutes is locked with a reason", () => {
    const i = { ...base, createdAt: "2026-10-31T09:40:00Z" };
    expect(canEditComment(i)).toBe(false);
    expect(commentLockReason(i)).toBe("windowClosed");
  });
  it("other users are denied; moderators are not", () => {
    const i = { ...base, viewerId: U2, createdAt: "2026-10-31T09:59:00Z" };
    expect(canEditComment(i)).toBe(false);
    expect(commentLockReason(i)).toBe("notAuthor");
    expect(canDeleteComment({ ...i, canModerate: true, createdAt: "2026-10-30T09:59:00Z" })).toBe(true);
  });
  it("an unparseable timestamp fails closed", () => {
    expect(canEditComment({ ...base, createdAt: "nope" })).toBe(false);
  });
});

describe("unread badge and urls", () => {
  it("formats the count", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(100)).toBe("99+");
  });
  it("links are always in-app paths", () => {
    expect(objectUrl("lead", "abc")).toBe("/leads/abc");
    expect(objectUrl("obj:booking", "abc")).toBe("/records/booking/abc");
    expect(objectUrl("weird", "abc")).toBeNull();
    expect(objectUrl(null, null)).toBeNull();
  });
});
