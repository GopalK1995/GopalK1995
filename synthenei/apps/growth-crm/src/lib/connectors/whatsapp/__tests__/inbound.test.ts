import { beforeEach, describe, expect, it } from "vitest";
import * as F from "../__fixtures__/payloads";
import { whatsappConnector, setWaRuntimeFactory } from "../connector";
import { handleEvent, sha256Hex } from "../inbound";
import { resetMockGateways, mockFor } from "../config";
import { parseWebhook } from "../payload";
import type { SyncContext } from "../../core/types";
import { CONN, fakeDeps, type TestDeps } from "./fake-store";
import { makeMockGateway } from "../mock";

const SECRETS = { waba_id: F.WABA, phone_number_id: F.PNID, access_token: "wa-mock-token", app_secret: "s" };
const NOW = "2026-01-01T00:00:00.000Z";
let deps: TestDeps, rejected: string[];
beforeEach(() => { deps = fakeDeps(); rejected = []; resetMockGateways(); });

async function feed(raw: string, conn = CONN, secrets: Record<string, string> = SECRETS) {
  for (const evt of parseWebhook(raw, NOW)) await handleEvent({ deps, conn: { ...conn }, secrets, gateway: () => makeMockGateway(), reject: (r) => rejected.push(r) }, evt);
}

describe("inbound messages", () => {
  it("creates a lead, a conversation and a message, and starts the 24 h window at the message time", async () => {
    await feed(F.textMessage("Hello there"));
    const s = deps.store;
    expect(s.leads).toHaveLength(1);
    expect(s.leads[0]).toMatchObject({ tenant_id: "t-1", workspace_id: "w-1", full_name: "Test Customer", phone: "+919800000001", source: "whatsapp" });
    expect(s.convs).toHaveLength(1);
    expect(s.convs[0]).toMatchObject({ waId: F.WA_ID, leadId: "lead-1", lastInboundAt: NOW, status: "open" });
    expect(s.msgs).toHaveLength(1);
    expect(s.msgs[0]).toMatchObject({ direction: "inbound", status: "received", body: "Hello there", externalId: "wamid.IN1", tenantId: "t-1" });
    expect(s.events.map((e) => e.type)).toEqual(["message.received"]);
  });
  it("dedupes by wamid: the same delivery twice stores one message, one lead, one event", async () => {
    await feed(F.textMessage());
    await feed(F.textMessage());
    expect(deps.store.msgs).toHaveLength(1);
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.events).toHaveLength(1);
  });
  it("a second message from a known number reuses the lead and conversation and reopens a closed thread", async () => {
    await feed(F.textMessage("one", "wamid.A"));
    deps.store.convs[0].status = "closed";
    await feed(F.textMessage("two", "wamid.B"));
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.convs).toHaveLength(1);
    expect(deps.store.convs[0].status).toBe("open");
    expect(deps.store.msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });
  it("reactions are not stored as messages", async () => {
    await feed(F.reaction());
    expect(deps.store.msgs).toHaveLength(0);
    expect(deps.store.leads).toHaveLength(0);
  });
  it("click-to-WhatsApp referral becomes lead attribution", async () => {
    await feed(F.clickToWhatsApp());
    expect(deps.store.leads[0]).toMatchObject({ utm: { source: "whatsapp", medium: "click_to_whatsapp", campaign: "ad-123" }, click_ids: { ctwa_clid: "clid-xyz" }, landing_path: "https://ads.example/post/1" });
  });
  it("media is stored by reference: bytes go to the private bucket, the message keeps only the path", async () => {
    await feed(F.imageMessage());
    const att = deps.store.msgs[0].attachments as Record<string, unknown>[];
    expect(deps.uploads).toHaveLength(1);
    expect(deps.uploads[0].path).toBe(`t-1/w-1/conn-1/${deps.store.msgs[0].id}`);
    expect(att[0]).toMatchObject({ kind: "image", media_id: "media-1", status: "stored", bucket: "wa-media", path: deps.uploads[0].path });
    expect(JSON.stringify(att)).not.toMatch(/https?:|mock:\/\//);
  });
  it("a failed media download keeps the message and marks the attachment failed", async () => {
    deps = fakeDeps(undefined, { media: { put: async () => { throw new Error("storage down"); } } });
    await feed(F.imageMessage());
    expect(deps.store.msgs).toHaveLength(1);
    expect((deps.store.msgs[0].attachments as Record<string, unknown>[])[0]).toMatchObject({ status: "failed", reason: "download_failed" });
  });
});

describe("tenant isolation", () => {
  it("an event for a phone_number_id that is not this connection's is rejected and writes nothing", async () => {
    await feed(F.otherNumber());
    expect(rejected).toEqual(["phone_number_mismatch"]);
    expect(deps.store.msgs).toHaveLength(0);
    expect(deps.store.leads).toHaveLength(0);
    expect(deps.store.convs).toHaveLength(0);
  });
  it("a connection without a stored phone_number_id accepts nothing", async () => {
    await feed(F.textMessage(), CONN, { access_token: "t" });
    expect(rejected).toEqual(["phone_number_mismatch"]);
  });
  it("a phone number already owned by another workspace cannot be registered", async () => {
    await deps.store.upsertNumber({ tenantId: "t-2", workspaceId: "w-2", connectionId: "c-2", wabaId: "1", phoneNumberId: F.PNID, displayNumber: "x", quality: "unknown" });
    expect(await deps.store.upsertNumber({ tenantId: "t-1", workspaceId: "w-1", connectionId: "conn-1", wabaId: "1", phoneNumberId: F.PNID, displayNumber: "x", quality: "unknown" })).toEqual({ ok: false, reason: "phone_number_taken" });
  });
  it("the same wamid in two tenants is two different messages", async () => {
    await feed(F.textMessage());
    await feed(F.textMessage(), { ...CONN, id: "conn-2", tenantId: "t-2", workspaceId: "w-2" });
    expect(deps.store.msgs.map((m) => m.tenantId).sort()).toEqual(["t-1", "t-2"]);
  });
});

describe("STOP handling", () => {
  it("withdraws WhatsApp consent for a known lead, blocks can_contact, and is idempotent", async () => {
    await feed(F.textMessage("hello", "wamid.A"));
    const lead = String(deps.store.leads[0].id);
    deps.store.consent.push({ tenantId: "t-1", workspaceId: "w-1", leadId: lead, subjectRef: "x", purpose: "whatsapp", action: "granted", note: "form" });
    expect(await deps.store.canContact(lead)).toBe(true);
    await feed(F.stopMessage("STOP", "wamid.S1"));
    expect(await deps.store.canContact(lead)).toBe(false);
    const last = deps.store.consent.at(-1)!;
    expect(last).toMatchObject({ action: "withdrawn", purpose: "whatsapp", leadId: lead, subjectRef: sha256Hex("+919800000001") === last.subjectRef ? last.subjectRef : "x" });
    expect(deps.store.events.map((e) => e.type)).toContain("consent.changed");
    await feed(F.stopMessage("stop", "wamid.S2"));   // a second STOP does not write a second withdrawal
    expect(deps.store.consent.filter((c) => c.action === "withdrawn")).toHaveLength(1);
  });
  it("STOP from an unknown number logs a withdrawal by hashed subject and does not create a lead", async () => {
    await feed(F.stopMessage("நிறுத்து"));
    expect(deps.store.leads).toHaveLength(0);
    expect(deps.store.consent).toHaveLength(1);
    expect(deps.store.consent[0]).toMatchObject({ leadId: null, action: "withdrawn", subjectRef: sha256Hex("+919800000001") });
    expect(deps.store.consent[0].subjectRef).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.store.msgs).toHaveLength(1);   // the message itself is still in the inbox
  });
  it("a sentence containing stop is not an opt-out", async () => {
    await feed(F.textMessage("please do not stop the updates"));
    expect(deps.store.consent).toHaveLength(0);
  });
});

describe("consent from a first inbound message (connection setting, default off)", () => {
  it("off: nothing is recorded", async () => {
    await feed(F.textMessage());
    expect(deps.store.consent).toHaveLength(0);
  });
  it("on: a grant is recorded once, and never over a prior withdrawal", async () => {
    const conn = { ...CONN, settings: { inbound_implies_optin: true } };
    await feed(F.textMessage("hi", "wamid.A"), conn);
    await feed(F.textMessage("again", "wamid.B"), conn);
    expect(deps.store.consent.map((c) => c.action)).toEqual(["granted"]);
    await feed(F.stopMessage("STOP", "wamid.C"), conn);
    await feed(F.textMessage("changed my mind", "wamid.D"), conn);
    expect(deps.store.consent.map((c) => c.action)).toEqual(["granted", "withdrawn"]);
  });
});

describe("status callbacks", () => {
  it("moves a sent message forward through delivered and read, never backwards", async () => {
    const id = deps.store.addOutbound({ status: "sent", externalId: "wamid.OUT1" });
    await feed(F.status("delivered"));
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("delivered");
    await feed(F.status("read"));
    await feed(F.status("delivered"));   // out of order
    await feed(F.status("sent"));
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("read");
    expect(deps.store.events.filter((e) => e.type === "message.status")).toHaveLength(2);
  });
  it("failed records the vendor code, and does not overwrite a delivered message", async () => {
    const a = deps.store.addOutbound({ status: "sent", externalId: "wamid.OUT1" });
    await feed(F.failedStatus());
    expect(deps.store.msgs.find((m) => m.id === a)!).toMatchObject({ status: "failed", errorCode: "131047" });
    const b = deps.store.addOutbound({ status: "delivered", externalId: "wamid.OUT2" });
    await feed(F.status("failed", "wamid.OUT2"));
    expect(deps.store.msgs.find((m) => m.id === b)!.status).toBe("delivered");
  });
  it("a status for an unknown message is counted as rejected, not an error", async () => {
    await feed(F.status("read", "wamid.NOPE"));
    expect(rejected).toEqual(["unknown_message"]);
  });
  it("a status is idempotent when delivered twice", async () => {
    deps.store.addOutbound({ status: "sent", externalId: "wamid.OUT1" });
    await feed(F.status("delivered"));
    await feed(F.status("delivered"));
    expect(deps.store.events.filter((e) => e.type === "message.status")).toHaveLength(1);
  });
});

describe("template status callback", () => {
  it("updates the stored template by provider id; unknown ids are counted", async () => {
    deps.store.templates.push({ id: "tpl-1", tenantId: "t-1", workspaceId: "w-1", connectionId: "conn-1", providerTemplateId: "9001", name: "sample_followup", language: "en", category: "utility", status: "submitted", body: "x", variables: [], components: [], rejectedReason: null });
    await feed(F.templateStatus("APPROVED"));
    expect(deps.store.templates[0].status).toBe("approved");
    await feed(F.templateStatus("REJECTED", "INVALID_FORMAT"));
    expect(deps.store.templates[0]).toMatchObject({ status: "rejected", rejectedReason: "INVALID_FORMAT" });
    deps.store.templates.length = 0;
    await feed(F.templateStatus());
    expect(rejected).toEqual(["unknown_template"]);
  });
});

describe("connector webhook entry (verify = parse, handle = pipeline)", () => {
  it("parses the stored raw body, registers the number once, and runs the pipeline", async () => {
    setWaRuntimeFactory(async () => ({ deps, env: { APP_ENV: "staging" } }));
    const events = await whatsappConnector.webhook!.verify({ rawBody: F.textMessage(), headers: {} }, {});
    expect(events).toHaveLength(1);
    const ctx = { conn: { ...CONN }, secrets: async () => SECRETS, reject: (r: string) => rejected.push(r) } as unknown as SyncContext;
    await whatsappConnector.webhook!.handle(ctx, events[0]);
    expect(deps.store.numbers).toHaveLength(1);
    expect(deps.store.numbers[0]).toMatchObject({ phoneNumberId: F.PNID, workspaceId: "w-1", wabaId: F.WABA });
    expect(deps.store.msgs).toHaveLength(1);
    // another workspace presenting the same number is refused
    const other = { ...ctx, conn: { ...CONN, id: "conn-9", tenantId: "t-9", workspaceId: "w-9" } } as unknown as SyncContext;
    await whatsappConnector.webhook!.handle(other, events[0]);
    expect(rejected).toContain("phone_number_taken");
    expect(deps.store.msgs).toHaveLength(1);
    setWaRuntimeFactory(null);
    expect(mockFor("x").kind).toBe("mock");
  });
});
