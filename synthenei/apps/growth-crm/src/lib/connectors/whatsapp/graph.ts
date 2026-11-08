// Real Cloud API gateway over fetch. Used only when a tenant has real credentials (see config.ts). Retries 429/5xx with the
// framework's backoff, honours Retry-After, keeps the vendor error code, never logs or echoes bodies, tokens or recipients.
import { backoffMs, parseRetryAfter } from "../core/http";
import { CredentialError, DEFAULT_RATE_POLICY, TransientError, type RateLimitPolicy } from "../core/types";
import { errorFromResponse, type MediaBytes, type MediaInfo, type PhoneInfo, type ProviderTemplate, type SendResult, type WhatsAppGateway } from "./gateway";

export interface GraphOpts {
  apiBase: string; version: string; accessToken: string; phoneNumberId: string; wabaId?: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; policy?: Partial<RateLimitPolicy>;
}
type R = Record<string, unknown>;

export function makeGraphGateway(o: GraphOpts): WhatsAppGateway {
  const p = { ...DEFAULT_RATE_POLICY, ...o.policy };
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `${o.apiBase.replace(/\/+$/, "")}/${o.version}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(path.startsWith("http") ? path : `${base}/${path.replace(/^\/+/, "")}`, {
          method, headers: { authorization: `Bearer ${o.accessToken}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (attempt >= p.maxRetries) throw new TransientError("WhatsApp API unreachable");
        await sleep(backoffMs(attempt, p, o.random));
        continue;
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      if (res.status === 429 || res.status >= 500) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt >= p.maxRetries) throw new TransientError(`WhatsApp API kept failing (HTTP ${res.status})`, ra);
        await sleep(Math.min(p.maxDelayMs, ra ?? backoffMs(attempt, p, o.random)));
        continue;
      }
      let errBody: unknown = null;
      try { errBody = await res.json(); } catch { /* no body */ }
      throw errorFromResponse(res.status, errBody);
    }
  }

  const wamidOf = (r: unknown): SendResult => {
    const id = (r as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
    if (typeof id !== "string" || !id) throw new TransientError("WhatsApp API answered without a message id");
    return { wamid: id };
  };
  const msgPath = `${o.phoneNumberId}/messages`;

  return {
    kind: "graph",
    async sendText(i) {
      return wamidOf(await call("POST", msgPath, {
        messaging_product: "whatsapp", recipient_type: "individual", to: i.to, type: "text", text: { body: i.body, preview_url: false },
        ...(i.replyToWamid ? { context: { message_id: i.replyToWamid } } : {}),
      }));
    },
    async sendTemplate(i) {
      return wamidOf(await call("POST", msgPath, {
        messaging_product: "whatsapp", recipient_type: "individual", to: i.to, type: "template",
        template: { name: i.name, language: { code: i.language }, ...(i.bodyParams.length ? { components: [{ type: "body", parameters: i.bodyParams.map((t) => ({ type: "text", text: t })) }] } : {}) },
      }));
    },
    async listTemplates() {
      if (!o.wabaId) throw new CredentialError("No WhatsApp Business Account id is stored for this connection");
      const out: ProviderTemplate[] = [];
      let url: string | null = `${o.wabaId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
      for (let page = 0; url && page < 20; page++) {
        const r: { data?: R[]; paging?: { next?: string } } = await call("GET", url);
        for (const t of r.data ?? []) {
          if (typeof t.id !== "string" || typeof t.name !== "string" || typeof t.language !== "string") continue;
          out.push({ id: t.id, name: t.name, language: t.language, status: String(t.status ?? ""), category: String(t.category ?? ""), components: Array.isArray(t.components) ? t.components : [], rejectedReason: typeof t.rejected_reason === "string" && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined });
        }
        url = r.paging?.next ?? null;
      }
      return out;
    },
    async getPhoneNumber(): Promise<PhoneInfo> {
      const r = await call<R>("GET", `${o.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
      const q = String(r.quality_rating ?? "").toLowerCase();
      return { displayNumber: String(r.display_phone_number ?? ""), verifiedName: typeof r.verified_name === "string" ? r.verified_name : undefined, quality: q === "green" || q === "yellow" || q === "red" ? q : "unknown", messagingLimitTier: typeof r.messaging_limit_tier === "string" ? r.messaging_limit_tier : undefined };
    },
    async getMediaInfo(mediaId): Promise<MediaInfo> {
      const r = await call<R>("GET", encodeURIComponent(mediaId));
      if (typeof r.url !== "string") throw new TransientError("WhatsApp media info had no url");
      return { url: r.url, mime: typeof r.mime_type === "string" ? r.mime_type : undefined, sha256: typeof r.sha256 === "string" ? r.sha256 : undefined, size: typeof r.file_size === "number" ? r.file_size : undefined };
    },
    async downloadMedia(url, maxBytes): Promise<MediaBytes> {
      const res = await doFetch(url, { headers: { authorization: `Bearer ${o.accessToken}` } });
      if (res.status === 401 || res.status === 403) throw new CredentialError("WhatsApp rejected the access token");
      if (!res.ok) throw new TransientError(`WhatsApp media download failed (HTTP ${res.status})`);
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > maxBytes) throw new Error("media_too_large");
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new Error("media_too_large");
      return { bytes: buf, mime: res.headers.get("content-type") ?? undefined };
    },
  };
}
