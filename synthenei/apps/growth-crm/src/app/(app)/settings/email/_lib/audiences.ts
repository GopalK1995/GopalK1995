// Reads the tenant's Mailchimp audiences for the picker. Server only (it needs the Vault token). A failure returns null: the page says
// so and the previously chosen audience keeps working.
import "server-only";
import { makeVendorHttp } from "@/lib/connectors/core/http";
import { loadSecrets } from "@/lib/connectors/core/secrets";
import { emailRuntime } from "@/lib/connectors/email";
import { mailchimpApi, resolveBase, type McAudience } from "@/lib/connectors/mailchimp/api";

export async function loadAudiences(connectionId: string, workspaceId: string): Promise<McAudience[] | null> {
  try {
    const rt = await emailRuntime();
    const conn = await rt.core.store.getConnection(connectionId);
    if (!conn || conn.workspaceId !== workspaceId || conn.connectorId !== "mailchimp") return null;
    const token = (await loadSecrets(rt.core.vault, conn)).access_token;
    if (!token) return null;
    const http = makeVendorHttp({ maxRetries: 1 }, { fetch: rt.fetchImpl });
    return await mailchimpApi(http, await resolveBase(http, token, (rt.env.MAILCHIMP_API_BASE ?? "").trim()), token).audiences();
  } catch { return null; }
}
