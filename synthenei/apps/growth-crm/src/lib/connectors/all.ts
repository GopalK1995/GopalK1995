// Single place where every connector module is registered (CONTRACTS C9). Vendor tasks append an import + a line in
// ALL_CONNECTORS. The mock connector is built into registry.ts and is hidden in production by isUsableIn().
import { registerConnector } from "./registry";
import type { ConnectorDef } from "./core/types";
import { razorpayConnector } from "./razorpay/connector";
import { resendConnector, smtpConnector } from "./email";
import { mailchimpConnector } from "./mailchimp";
import { whatsappConnector } from "./whatsapp/connector";
import { metaAdsConnector } from "./meta-ads/connector";
import { ga4Connector } from "./google/ga4/connector";
import { googleAdsConnector } from "./google/ads/connector";
import { googleSheetsConnector } from "./google/sheets/connector";
import { googleCalendarConnector } from "./google/calendar/connector";
import { gmailConnector } from "./google/gmail/connector";
import { linkedinConnector } from "./linkedin/connector";
import { calendlyConnector } from "./calendly/connector";
import { calcomConnector } from "./calcom/connector";
import { googleBusinessConnector } from "./google/business-profile/connector";
import { outlookConnector } from "./microsoft/connector";

import { slackConnector } from "./slack/connector";
import { zapierConnector, makeConnector } from "./automation/connector";

/** Vendor connector defs go here (append only). */
export const ALL_CONNECTORS: ConnectorDef[] = [whatsappConnector, razorpayConnector, metaAdsConnector, resendConnector, smtpConnector, mailchimpConnector, ga4Connector, googleAdsConnector, googleSheetsConnector, linkedinConnector, calendlyConnector, calcomConnector, googleBusinessConnector, slackConnector, zapierConnector, makeConnector, googleCalendarConnector, gmailConnector, outlookConnector];

let done = false;
export function registerAllConnectors(): void {
  if (done) return;
  done = true;
  for (const def of ALL_CONNECTORS) registerConnector(def);
}
registerAllConnectors();
