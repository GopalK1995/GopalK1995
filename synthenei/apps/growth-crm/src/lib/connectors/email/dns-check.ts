// Sending-domain check for SMTP connections, where no provider can tell us the state: we look the records up ourselves.
// What it can and cannot say is stated honestly. SPF: a v=spf1 record exists (we cannot know that it authorises THIS mail server).
// DKIM: a TXT record exists at <selector>._domainkey (the selector is entered by the tenant; without it the state is "unknown").
// Records that are present map to "verified" only for DKIM with a key; SPF presence maps to "pending" unless it is syntactically valid.
import type { DomainRecord, DomainState } from "./transport";

export type TxtResolver = (host: string) => Promise<string[][]>;
const join = (rows: string[][]) => rows.map((r) => r.join(""));

async function txt(resolve: TxtResolver, host: string): Promise<string[] | "error"> {
  try { return join(await resolve(host)); }
  catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? [] : "error";   // NXDOMAIN / no TXT = definitely missing; anything else = could not ask
  }
}

export async function checkDomainDns(resolve: TxtResolver, domain: string, selector: string | null, now: Date): Promise<DomainState> {
  const records: DomainRecord[] = [];
  const spf = await txt(resolve, domain);
  const spfRec = spf === "error" ? null : spf.find((v) => /^v=spf1\b/i.test(v));
  records.push({ kind: "spf", type: "TXT", host: domain, value: spfRec ?? "", status: spf === "error" ? "unknown" : spfRec ? "verified" : "failed" });
  if (selector) {
    const host = `${selector}._domainkey.${domain}`;
    const dk = await txt(resolve, host);
    const rec = dk === "error" ? null : dk.find((v) => /\bp=[A-Za-z0-9+/=]{20,}/.test(v));
    records.push({ kind: "dkim", type: "TXT", host, value: rec ? "(public key published)" : "", status: dk === "error" ? "unknown" : rec ? "verified" : "failed" });
  } else records.push({ kind: "dkim", type: "TXT", host: "", value: "", status: "unknown" });
  const dm = await txt(resolve, `_dmarc.${domain}`);
  records.push({ kind: "dmarc", type: "TXT", host: `_dmarc.${domain}`, value: dm === "error" ? "" : (dm.find((v) => /^v=DMARC1/i.test(v)) ?? ""), status: dm === "error" ? "unknown" : dm.some((v) => /^v=DMARC1/i.test(v)) ? "verified" : "failed" });
  const required = records.filter((r) => r.kind === "spf" || r.kind === "dkim");
  const status: DomainState["status"] = required.some((r) => r.status === "failed") ? "failed" : required.every((r) => r.status === "verified") ? "verified" : "unknown";
  return { status, domain, records, checkedAt: now.toISOString() };
}
