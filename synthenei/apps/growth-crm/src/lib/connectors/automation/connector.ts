// ConnectorDefs for Zapier and Make. Neither has a vendor-side OAuth or stored credential: the tenant creates a scoped API key (T025,
// /settings/api-keys) and types it into the Zapier / Make connection screen; triggers are REST hooks the apps subscribe through
// /api/v1/webhooks (delivered, signed and retried by T024). These defs only make the two show up in the integrations list with their
// true state (no streams, no pushes, nothing stored here) and the how-to text. The app definitions live in integrations/*-app.
import type { ConnectorDef } from "../core/types";

const common = (): Pick<ConnectorDef, "category" | "auth" | "gate" | "capabilities" | "streams" | "pushes" | "defaultFieldMap"> => ({
  category: "automation", auth: "none", gate: "none", capabilities: { inbound: true, outbound: true, webhooks: false }, streams: [], pushes: [], defaultFieldMap: [],
});

export const zapierConnector: ConnectorDef = { ...common(), id: "zapier", name: "Zapier", sandbox: { supported: false, howTo: "zapier.sandbox" } };
export const makeConnector: ConnectorDef = { ...common(), id: "make", name: "Make", sandbox: { supported: false, howTo: "make.sandbox" } };
