// HubSpot CRM v3 response and webhook fixtures. They follow HubSpot's published shapes with synthetic ids and people (example.com);
// none is a capture from a live portal. Verify against a developer test account before relying on field-level details.
export const contact = (id: string, props: Record<string, unknown>, updatedAt = "2026-11-02T04:30:00.000Z") => ({ id, updatedAt, properties: { hs_object_id: id, ...props } });

export const SEARCH_CONTACTS = {
  results: [
    contact("501", { firstname: "Asha", lastname: "Rao", email: "Asha@Example.com", phone: "+91 98765 43210", company: "Rao & Co", jobtitle: "Partner", city: "Chennai", lastmodifieddate: "2026-11-02T04:30:00.000Z" }),
    contact("502", { firstname: null, lastname: "Iyer", email: "iyer@example.com", phone: null, company: "", jobtitle: null, city: null, lastmodifieddate: "2026-11-02T04:35:00.000Z" }, "2026-11-02T04:35:00.000Z"),
  ],
};
export const SEARCH_DEALS = { results: [{ id: "701", updatedAt: "2026-11-03T03:30:00.000Z", properties: { dealname: "Plan, 12 seats", dealstage: "contractsent", amount: "12000.00", closedate: "2026-12-30T18:30:00Z" } }] };
export const SEARCH_MORE = { ...SEARCH_CONTACTS, paging: { next: { after: "200" } } };
export const SEARCH_CAP = { ...SEARCH_CONTACTS, paging: { next: { after: "9100" } } };
export const CREATED = { id: "909", updatedAt: "2026-11-04T04:30:00.000Z", properties: {} };
export const TOKEN_INFO = { hub_id: 4200001, hub_domain: "example-portal.test", scopes: ["crm.objects.contacts.read"] };

export const event = (over: Record<string, unknown> = {}) => ({ eventId: 1, subscriptionId: 77, portalId: 4200001, occurredAt: 1_700_000_000_000, subscriptionType: "contact.propertyChange", attemptNumber: 0, objectId: 501, propertyName: "city", propertyValue: "Madurai", ...over });
export const webhookBody = (...events: Record<string, unknown>[]) => JSON.stringify(events.length ? events : [event()]);
