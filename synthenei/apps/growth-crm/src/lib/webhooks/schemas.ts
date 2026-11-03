// Input validation for the endpoint form. Pure: used by the server actions and unit-tested.
import { z } from "zod";
import { isKnownEventType, isWebhookEligible } from "@/lib/events/catalog";
import { assertPublicHttpsUrl, SsrfError, type Resolver } from "@/lib/security/ssrf";
import { validateFilters, type EndpointOptions } from "./options";

export const MAX_ENDPOINTS = 20;

const typePattern = z.string().min(1).max(80).refine((t) => t === "*" || /^[a-z_]+\.\*$/.test(t) || (isKnownEventType(t) && isWebhookEligible(t)), "unknown_event_type");

export const endpointInput = z.object({
  url: z.string().trim().min(8).max(2000),
  description: z.string().trim().max(200).optional().nullable(),
  eventTypes: z.array(typePattern).min(1).max(100),
  includePii: z.boolean().default(false),
  filters: z.array(z.object({ field: z.string().max(41), values: z.array(z.string().max(60)).min(1).max(10) })).max(5).default([]),
});
export type EndpointInput = z.infer<typeof endpointInput>;

export const endpointPatch = endpointInput.partial().extend({ id: z.string().uuid(), active: z.boolean().optional() });
export const idInput = z.object({ id: z.string().uuid() });
export const replayInput = z.object({ endpointId: z.string().uuid(), deliveryId: z.number().int().positive() });

export const optionsOf = (i: Pick<EndpointInput, "includePii" | "filters">): EndpointOptions => ({ pii: i.includePii, filters: i.filters });
export const filterError = (i: Pick<EndpointInput, "filters">): string | null => validateFilters(i.filters);

/** Returns an error key (see strings) or null. Runs the same SSRF guard as every send. */
export async function checkUrl(url: string, resolver?: Resolver): Promise<string | null> {
  try { await assertPublicHttpsUrl(url, resolver); return null; } catch (e) {
    if (e instanceof SsrfError) return e.reason === "https required" ? "urlHttps" : e.reason === "credentials in url" ? "urlCredentials" : "urlBlocked";
    return "urlBlocked";
  }
}
