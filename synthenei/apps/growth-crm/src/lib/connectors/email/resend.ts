// Resend API client (https://resend.com/docs/api-reference). Credentials come from the tenant's Vault bundle; the base URL from
// RESEND_API_BASE (a stub in tests) or the vendor default. Error text from the vendor is never echoed (it can quote addresses).
import { CredentialError, TransientError } from "../core/types";
import { parseRetryAfter } from "../core/http";
import type { Address } from "./mime";
import { EmailApiError, type DomainRecord, type DomainRecordKind, type DomainRecordStatus, type DomainState, type EmailTransport, type OutboundEmail } from "./transport";

export interface ResendOpts { apiBase: string; apiKey: string; fetch?: typeof fetch; now?: () => Date }

const fmt = (a: Address) => (a.name ? `${a.name.replace(/[<>"\r\n]/g, "")} <${a.email}>` : a.email);

export function makeResendTransport(o: ResendOpts): EmailTransport {
  const doFetch = o.fetch ?? fetch;
  const now = () => (o.now ? o.now() : new Date()).toISOString();
  async function call<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${o.apiBase.replace(/\/+$/, "")}${path}`, {
        method, headers: { authorization: `Bearer ${o.apiKey}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new TransientError("Email provider unreachable"); }
    if (res.ok) return (await res.json().catch(() => ({}))) as T;
    if (res.status === 401 || res.status === 403) {
      // A restricted (send-only) key gets 403 on the domains endpoints: that is not a broken connection.
      if (res.status === 403 && path.startsWith("/domains")) throw new EmailApiError("The API key may not manage domains", 403, "rejected");
      throw new CredentialError(`Email provider rejected the credentials (HTTP ${res.status})`);
    }
    if (res.status === 429 || res.status >= 500) throw new TransientError(`Email provider busy (HTTP ${res.status})`, parseRetryAfter(res.headers.get("retry-after")));
    let name = ""; try { name = String(((await res.json()) as { name?: unknown }).name ?? ""); } catch { /* no body */ }
    if (res.status === 422 && /invalid_to|invalid_email/i.test(name)) throw new EmailApiError("Recipient refused", 422, "invalid_recipient");
    throw new EmailApiError(`Email provider refused the request (HTTP ${res.status})`, res.status, res.status === 413 ? "message_too_large" : "invalid_request");
  }

  const transport: EmailTransport = {
    kind: "resend",
    async ping() {
      // A restricted (send-only) key is refused on /domains with 403: the key is valid, it just cannot manage domains.
      try { await call("GET", "/domains"); } catch (e) { if (!(e instanceof EmailApiError)) throw e; }
    },
    async send(m: OutboundEmail) {
      const r = await call<{ id?: string }>("POST", "/emails", {
        from: fmt(m.from), to: [m.to.email], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}),
        ...(m.replyTo ? { reply_to: m.replyTo.email } : {}), headers: m.headers, tags: Object.entries(m.tags).map(([name, value]) => ({ name, value })),
      }, { "idempotency-key": m.idempotencyKey });
      if (!r.id) throw new TransientError("Email provider returned no message id");
      return { providerId: r.id };
    },
    domain: {
      async ensure(domain) {
        const list = await call<{ data?: { id: string; name: string }[] }>("GET", "/domains");
        const found = (list.data ?? []).find((d) => d.name.toLowerCase() === domain.toLowerCase());
        const id = found?.id ?? (await call<{ id: string }>("POST", "/domains", { name: domain })).id;
        return transport.domain!.refresh(id, domain);
      },
      async refresh(id, domain) {
        // Asking the provider to re-check is best effort: the state we show is always what a GET returns afterwards.
        await call("POST", `/domains/${encodeURIComponent(id)}/verify`, {}).catch(() => undefined);
        return mapResendDomain(await call("GET", `/domains/${encodeURIComponent(id)}`), domain, now());
      },
    },
  };
  return transport;
}

/** Resend domain statuses: not_started | pending | verified | failed | temporary_failure. Anything else maps to "unknown", never to verified. */
export function mapResendDomain(raw: unknown, domain: string, checkedAt: string): DomainState {
  const d = (raw ?? {}) as { id?: unknown; status?: unknown; records?: unknown };
  const status = (s: unknown): DomainRecordStatus => (s === "verified" || s === "pending" || s === "failed" || s === "not_started" ? s : s === "temporary_failure" ? "pending" : "unknown");
  const kindOf = (r: Record<string, unknown>): DomainRecordKind => {
    const k = String(r.record ?? "").toUpperCase(), v = String(r.value ?? "");
    return k === "DKIM" ? "dkim" : k === "SPF" ? "spf" : k === "DMARC" ? "dmarc" : /v=spf1/i.test(v) ? "spf" : "other";
  };
  const records: DomainRecord[] = (Array.isArray(d.records) ? d.records : []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ kind: kindOf(r), type: String(r.type ?? ""), host: String(r.name ?? ""), value: String(r.value ?? ""), status: status(r.status) }));
  return { status: status(d.status), domain, domainId: typeof d.id === "string" ? d.id : undefined, records, checkedAt };
}
