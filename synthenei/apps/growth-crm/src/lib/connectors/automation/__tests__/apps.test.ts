// The Zapier and Make app definitions: structurally valid, in line with the shared catalogue, the event catalogue and the REST schemas,
// and the Zapier functions behave (run against a fake `z`). Nothing here talks to Zapier or Make.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isWebhookEligible } from "@/lib/events/catalog";
import { dealMove, dealUpdate, leadCreate, webhookCreate } from "@/lib/api/schemas";
import { ACTIONS, TRIGGERS, bodyFields } from "../catalog";
import { makeConnector, zapierConnector } from "../connector";

const ROOT = path.resolve(__dirname, "../../../../..");
const ZAP = path.join(ROOT, "integrations/zapier-app");
const MAKE = path.join(ROOT, "integrations/make-app");
const req = createRequire(path.join(ZAP, "index.js"));
const app = req("./index.js") as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const SCHEMAS = { leadCreate, dealUpdate, dealMove } as const;
const shapeKeys = (n: keyof typeof SCHEMAS) => Object.keys((SCHEMAS[n] as unknown as { shape: Record<string, unknown> }).shape);

function walk(dir: string): string[] { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])); }
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as any;   // eslint-disable-line @typescript-eslint/no-explicit-any

describe("shared catalogue", () => {
  it("every trigger event exists in the event catalogue and can be subscribed to through a webhook", () => {
    for (const t of TRIGGERS) for (const e of t.events) expect(isWebhookEligible(e), e).toBe(true);
  });
  it("every action field exists in the REST schema it is sent to", () => {
    for (const a of ACTIONS) for (const f of bodyFields(a)) expect(shapeKeys(a.schema), `${a.key}.${f.key}`).toContain(f.key);
  });
  it("the subscribe body the apps send passes the API's own schema", () => {
    for (const t of TRIGGERS) expect(webhookCreate.safeParse({ url: "https://hooks.zapier.example/abc", event_types: t.events, description: "Zapier" }).success).toBe(true);
  });
  it("Zapier and Make show up as connectors with no stored credentials, streams or pushes", () => {
    for (const c of [zapierConnector, makeConnector]) { expect(c.streams).toEqual([]); expect(c.pushes).toEqual([]); expect(c.auth).toBe("none"); expect(c.category).toBe("automation"); }
  });
});

describe("Zapier app", () => {
  it("has the platform shape: version, platformVersion, custom auth, hook triggers, creates", () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.platformVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.authentication.type).toBe("custom");
    expect(app.authentication.fields.map((f: { key: string }) => f.key)).toEqual(["base_url", "api_key"]);
    expect(typeof app.authentication.test).toBe("function");
    expect(Object.keys(app.triggers).sort()).toEqual(TRIGGERS.map((t) => t.key).sort());
    expect(Object.keys(app.creates).sort()).toEqual(ACTIONS.map((a) => a.key).sort());
  });
  it("every key is unique and every display/operation block is complete", () => {
    for (const [k, t] of Object.entries<any>(app.triggers)) {   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(t.key).toBe(k);
      expect(t.display.label && t.display.description && t.noun).toBeTruthy();
      expect(t.operation.type).toBe("hook");
      for (const fn of ["performSubscribe", "performUnsubscribe", "perform", "performList"]) expect(typeof t.operation[fn], `${k}.${fn}`).toBe("function");
      expect(t.operation.sample.id).toBeTruthy();
    }
    for (const [k, c] of Object.entries<any>(app.creates)) {   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(c.key).toBe(k);
      expect(typeof c.operation.perform).toBe("function");
      expect(c.operation.sample).toBeTruthy();
    }
  });
  it("triggers subscribe to exactly the catalogue's events", async () => {
    for (const t of TRIGGERS) {
      const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
      const z = fakeZ(calls, { data: { data: { id: "wh-1", secret: "whsec_x" } } });
      const sub = await app.triggers[t.key].operation.performSubscribe(z, { authData: AUTH, targetUrl: "https://hooks.zapier.example/hook/1/abc/" });
      expect(sub).toEqual({ id: "wh-1", secret: "whsec_x" });
      expect(calls[0]).toMatchObject({ method: "POST", url: "https://crm.example.test/api/v1/webhooks", body: { url: "https://hooks.zapier.example/hook/1/abc/", event_types: [...t.events] } });
      expect(calls[0].headers["Idempotency-Key"]).toMatch(/^hash:sha256:/);
    }
  });
  it("unsubscribe deletes the stored subscription; an already-gone one is fine", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = app.triggers.new_lead.operation;
    await t.performUnsubscribe(fakeZ(calls, { status: 204 }), { authData: AUTH, subscribeData: { id: "wh-1" } });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://crm.example.test/api/v1/webhooks/wh-1" });
    await expect(t.performUnsubscribe(fakeZ([], { status: 404 }), { authData: AUTH, subscribeData: { id: "wh-1" } })).resolves.toEqual({});
    await expect(t.performUnsubscribe(fakeZ([], { status: 500, throwForStatus() { throw new Error("500"); } }), { authData: AUTH, subscribeData: { id: "wh-1" } })).rejects.toThrow("500");
    expect(await t.performUnsubscribe(fakeZ([], {}), { authData: AUTH, subscribeData: null })).toEqual({});
  });
  it("a delivery becomes one flat item keyed by the event id; the test ping produces nothing", () => {
    const t = app.triggers.deal_won.operation;
    const body = { id: "evt_1", type: "deal.won", created_at: "2026-02-01T00:00:00Z", org_id: "o", workspace_id: "w", object_type: "deal", object_id: "D1", actor: { kind: "user", id: "U" }, version: 1, data: { changed_fields: ["stage_id", "status"] } };
    expect(t.perform(null, { cleanedRequest: body })).toEqual([{ id: "evt_1", type: "deal.won", created_at: "2026-02-01T00:00:00Z", workspace_id: "w", object_type: "deal", object_id: "D1", actor_kind: "user", changed_fields: "stage_id, status", data: body.data }]);
    expect(t.perform(null, { cleanedRequest: { ...body, type: "webhook.test" } })).toEqual([]);
    expect(t.perform(null, { cleanedRequest: undefined })).toEqual([]);
  });
  it("sample lists read the object's own list endpoint with the user's key, falling back to the static sample", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    const out = await app.triggers.new_lead.operation.performList(fakeZ(calls, { data: { data: [{ id: "L1" }, { id: "L2" }] } }), { authData: AUTH });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://crm.example.test/api/v1/leads?limit=3" });
    expect(out.map((o: { object_id: string }) => o.object_id)).toEqual(["L1", "L2"]);
    expect(await app.triggers.new_lead.operation.performList(fakeZ([], { data: { data: [] } }), { authData: AUTH })).toHaveLength(1);
    expect(await app.triggers.payment_received.operation.performList(fakeZ(calls, {}), { authData: AUTH })).toHaveLength(1);
  });
  it("Create Lead sends only filled fields, passes the API schema, and uses a stable idempotency key", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    const create = app.creates.create_lead.operation;
    const bundle = { authData: AUTH, meta: { zap: { id: "zap-1" } }, inputData: { full_name: "Asha Rao", email: "", phone: "+919999999999", source: "zapier", city: undefined } };
    const r = await create.perform(fakeZ(calls, { data: { data: { id: "L1", full_name: "Asha Rao" } } }), bundle);
    expect(r).toEqual({ id: "L1", full_name: "Asha Rao" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://crm.example.test/api/v1/leads", body: { full_name: "Asha Rao", phone: "+919999999999", source: "zapier" } });
    expect(Object.keys(calls[0].body)).not.toContain("email");
    expect(leadCreate.safeParse(calls[0].body).success).toBe(true);
    await create.perform(fakeZ(calls, { data: { data: {} } }), bundle);
    expect(calls[1].headers["Idempotency-Key"]).toBe(calls[0].headers["Idempotency-Key"]);
    await create.perform(fakeZ(calls, { data: { data: {} } }), { ...bundle, inputData: { ...bundle.inputData, full_name: "Someone Else" } });
    expect(calls[2].headers["Idempotency-Key"]).not.toBe(calls[0].headers["Idempotency-Key"]);
  });
  it("Update Deal patches the one deal with only the filled, schema-valid fields (id is a path part, not a body field)", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    await app.creates.update_deal.operation.perform(fakeZ(calls, { data: { data: { id: "D 1" } } }), { authData: AUTH, inputData: { id: "D 1", value_inr: 75000, next_step: "Call", plan: "" } });
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "https://crm.example.test/api/v1/deals/D%201", body: { value_inr: 75000, next_step: "Call" } });
    expect(calls[0].body).not.toHaveProperty("id");
    expect(dealUpdate.safeParse(calls[0].body).success).toBe(true);
  });
  it("Move Deal reads the version first and sends it with the move", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    let n = 0;
    const z = { request: async (r: unknown) => { calls.push(r); return ++n === 1 ? { data: { data: { version: 7 } } } : { data: { data: { id: "D1" } } }; } };
    await app.creates.move_deal.operation.perform(z, { authData: AUTH, inputData: { id: "D1", stage_key: "won", lost_reason: "" } });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1]).toMatchObject({ url: "https://crm.example.test/api/v1/deals/D1/move", body: { stage_key: "won", expected_version: 7 } });
    expect(dealMove.safeParse(calls[1].body).success).toBe(true);
  });
  it("every request carries the key as a Bearer token; the CRM URL is user input, never in code", () => {
    const r = app.beforeRequest[0]({ headers: {} }, null, { authData: AUTH });
    expect(r.headers.Authorization).toBe("Bearer sk_test_key");
    expect(app.beforeRequest[0]({ headers: {} }, null, { authData: {} }).headers.Authorization).toBeUndefined();
    const sources = walk(ZAP).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const urls = [...sources.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).filter((u) => !/example/.test(u));
    expect(urls).toEqual([]);
    expect(sources).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{8}/);
  });
  it("the connection test calls /api/v1/me and tolerates a trailing slash in the CRM URL", async () => {
    const calls: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
    await app.authentication.test(fakeZ(calls, { data: { data: {} } }), { authData: { base_url: "https://crm.example.test//", api_key: "k" } });
    expect(calls[0].url).toBe("https://crm.example.test/api/v1/me");
  });
});

describe("Make app", () => {
  const files = walk(MAKE).filter((f) => f.endsWith(".iml.json") || f.endsWith("makecomapp.json"));
  const rel = (f: string) => path.relative(MAKE, f).replace(/\\/g, "/");
  it("every definition file is valid JSON", () => {
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect(() => readJson(f), rel(f)).not.toThrow();
  });
  it("the manifest lists exactly the connection, webhook and module folders on disk", () => {
    const m = readJson(path.join(MAKE, "makecomapp.json"));
    const dirs = (d: string) => fs.readdirSync(path.join(MAKE, d)).sort();
    expect([...m.components.connections].sort()).toEqual(dirs("connections"));
    expect([...m.components.webhooks].sort()).toEqual(dirs("webhooks"));
    expect([...m.components.modules].sort()).toEqual(dirs("modules"));
    expect(m.audience).toBe("private");
  });
  it("base: bearer key and CRM URL come from the connection, never from the file", () => {
    const base = readJson(path.join(MAKE, "general/base.iml.json"));
    expect(base.baseUrl).toBe("{{connection.base_url}}/api/v1");
    expect(base.headers.Authorization).toBe("Bearer {{connection.api_key}}");
    expect(base.log.sanitize).toContain("request.headers.authorization");
    const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect([...all.matchAll(/https?:\/\/[^\s"]+/g)].map((x) => x[0]).filter((u) => !/example/.test(u))).toEqual([]);
  });
  it("one instant trigger per catalogue trigger, each with its own webhook that subscribes to the catalogue events and detaches by stored id", () => {
    const slug = (k: string) => k.replace(/_/g, "-");
    for (const t of TRIGGERS) {
      const mod = readJson(path.join(MAKE, `modules/watch-${slug(t.key)}/api.iml.json`));
      expect(mod).toMatchObject({ type: "instant_trigger", label: t.label, webhook: `hook-${slug(t.key)}` });
      const attach = readJson(path.join(MAKE, `webhooks/hook-${slug(t.key)}/attach.iml.json`));
      expect(attach).toMatchObject({ url: "/webhooks", method: "POST", body: { url: "{{webhook.url}}", event_types: [...t.events] } });
      expect(attach.response.data.id).toBe("{{body.data.id}}");
      const detach = readJson(path.join(MAKE, `webhooks/hook-${slug(t.key)}/detach.iml.json`));
      expect(detach).toMatchObject({ method: "DELETE", url: "/webhooks/{{webhook.data.id}}" });
      expect(webhookCreate.safeParse({ url: "https://hook.example.test/x", event_types: attach.body.event_types, description: attach.body.description }).success).toBe(true);
    }
  });
  it("actions: same endpoints and fields as the catalogue", () => {
    const folder: Record<string, string> = { create_lead: "create-lead", update_deal: "update-deal", move_deal: "move-deal" };
    for (const a of ACTIONS) {
      const api = readJson(path.join(MAKE, `modules/${folder[a.key]}/api.iml.json`));
      expect(api).toMatchObject({ type: "action", label: a.label, method: a.method });
      const url = a.path.replace("/api/v1", "").replace("{id}", "{{encodeURL(parameters.id)}}");
      expect(api.url).toBe(url);
      const expectFields = readJson(path.join(MAKE, `modules/${folder[a.key]}/expect.iml.json`)).map((f: { name: string }) => f.name);
      expect(expectFields.sort()).toEqual(a.fields.map((f) => f.key).sort());
      for (const f of expectFields.filter((k: string) => k !== "id")) expect(shapeKeys(a.schema)).toContain(f);
    }
    expect(readJson(path.join(MAKE, "modules/move-deal/api.iml.json")).pre).toMatchObject({ method: "GET", url: "/deals/{{encodeURL(parameters.id)}}" });
  });
  it("the connection is checked against /me", () => {
    expect(readJson(path.join(MAKE, "connections/crm-api-key/api.iml.json")).communication).toMatchObject({ url: "/me", method: "GET" });
    expect(readJson(path.join(MAKE, "connections/crm-api-key/parameters.iml.json")).map((p: { name: string; required: boolean }) => [p.name, p.required])).toEqual([["base_url", true], ["api_key", true]]);
  });
});

const AUTH = { base_url: "https://crm.example.test", api_key: "sk_test_key" };
/** A fake `z`: records each request and answers with a canned response. */
function fakeZ(calls: unknown[], res: Record<string, unknown>) {
  return { request: async (r: unknown) => { calls.push(r); return { status: 200, data: {}, throwForStatus() {}, ...res }; }, hash: (algo: string, s: string) => `hash:${algo}:${s}` };
}
