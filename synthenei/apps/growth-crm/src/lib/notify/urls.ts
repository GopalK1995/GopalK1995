// Where a notification or feed row links to. Always an in-app path (DB check: url ~ '^/[^/\\]').
export function objectUrl(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type.startsWith("obj:")) return `/records/${encodeURIComponent(type.slice(4))}/${id}`;
  switch (type) {
    case "lead": return `/leads/${id}`;
    case "account": return `/accounts/${id}`;
    case "deal": return `/pipeline?deal=${id}`;
    case "contact": return `/accounts?contact=${id}`;
    case "task": return `/tasks?task=${id}`;
    case "campaign": return `/campaigns?campaign=${id}`;
    case "conversation": return `/inbox?c=${id}`;
    default: return null;
  }
}
/** Tables behind each object type, for owner lookups. */
export const OBJECT_TABLE: Record<string, string> = {
  lead: "leads", deal: "deals", account: "accounts", contact: "contacts", task: "tasks", campaign: "campaigns", conversation: "conversations",
};
export const isObjectType = (t: string) => t in OBJECT_TABLE || /^obj:[a-z][a-z0-9_]{1,40}$/.test(t);
