// Single place where every connector module is registered (CONTRACTS C9). Vendor tasks append an import + a line in
// ALL_CONNECTORS. The mock connector is built into registry.ts and is hidden in production by isUsableIn().
import { registerConnector } from "./registry";
import type { ConnectorDef } from "./core/types";
import { razorpayConnector } from "./razorpay/connector";
import { whatsappConnector } from "./whatsapp/connector";

/** Vendor connector defs go here (append only). */
export const ALL_CONNECTORS: ConnectorDef[] = [whatsappConnector, razorpayConnector];

let done = false;
export function registerAllConnectors(): void {
  if (done) return;
  done = true;
  for (const def of ALL_CONNECTORS) registerConnector(def);
}
registerAllConnectors();
