export const REQUEST_ID_HEADER = "x-request-id";
const SAFE = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuse a well-formed inbound request id, otherwise mint one. */
export function requestIdFrom(h: { get(name: string): string | null }): string {
  const inbound = h.get(REQUEST_ID_HEADER);
  return inbound && SAFE.test(inbound) ? inbound : crypto.randomUUID();
}
