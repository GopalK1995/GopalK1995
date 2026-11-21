// HubSpot webhook deliveries: a JSON array of subscription events. The edge receiver verified X-HubSpot-Signature-v3 with the app's
// client secret first. HubSpot apps have one subscription URL for every portal that installed them, so each event carries the
// portalId: the handler accepts it only when it is THIS connection's portal (tenant isolation).
export type HubspotKind = "contacts" | "companies" | "deals";
export interface HubspotEvent { kind: HubspotKind; operation: "upsert" | "delete"; objectId: string; portalId: string; eventId: string }

const KIND_OF: Record<string, HubspotKind> = { contact: "contacts", company: "companies", deal: "deals" };
const ID_RE = /^\d{1,25}$/;

export function parseHubspotWebhook(raw: string): HubspotEvent[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(j)) return [];
  const out: HubspotEvent[] = [];
  for (const it of j) {
    if (!it || typeof it !== "object") continue;
    const e = it as Record<string, unknown>;
    const [obj, what] = typeof e.subscriptionType === "string" ? e.subscriptionType.split(".") : [];
    const kind = KIND_OF[obj ?? ""];
    const objectId = e.objectId === undefined ? "" : String(e.objectId), portalId = e.portalId === undefined ? "" : String(e.portalId);
    if (!kind || !what || !ID_RE.test(objectId) || !ID_RE.test(portalId)) continue;
    const operation = what === "deletion" || what === "merge" ? "delete" : what === "creation" || what === "propertyChange" || what === "restore" ? "upsert" : null;
    if (operation) out.push({ kind, operation, objectId, portalId, eventId: String(e.eventId ?? "") });
  }
  return out;
}
