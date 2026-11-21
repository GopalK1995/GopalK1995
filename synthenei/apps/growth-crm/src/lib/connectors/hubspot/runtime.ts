// Service-role wiring for the HubSpot connector (jobs and the inbound consumer only). Server only.
import "server-only";
import { crmRuntime } from "../zoho/engine/runtime";
import type { HubspotRuntime } from "./connector";

export const hubspotRuntime = (): Promise<HubspotRuntime> => crmRuntime();
