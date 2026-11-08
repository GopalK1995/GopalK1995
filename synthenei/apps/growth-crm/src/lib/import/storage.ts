// Storage paths for uploads and error reports. Pure. Layout: <tenant uuid>/<workspace uuid>/<job uuid>/<file>.
// The `imports` bucket is private; storage.objects RLS (docs/migrations-backlog.md, "T034 needs") only lets a member of the workspace
// in the second path segment read or write, and only with `leads.import`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** File name safe for an object key: no path separators or control characters, bounded length, original extension kept. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, 100);
  return cleaned || "file";
}

export function importPath(tenantId: string, workspaceId: string, jobId: string, fileName: string): string {
  if (![tenantId, workspaceId, jobId].every((x) => UUID.test(x))) throw new Error("import path: ids must be uuids");
  return `${tenantId}/${workspaceId}/${jobId}/${safeFileName(fileName)}`;
}
export function reportPath(tenantId: string, workspaceId: string, jobId: string): string {
  return importPath(tenantId, workspaceId, jobId, "errors.csv");
}
/** True only when `path` lies inside this tenant and workspace folder (the job re-checks before it downloads). */
export function pathBelongsTo(path: string | null | undefined, tenantId: string, workspaceId: string): boolean {
  if (!path || path.includes("..")) return false;
  const [t, w, j, f, ...rest] = path.split("/");
  return t === tenantId && w === workspaceId && UUID.test(j ?? "") && !!f && rest.length === 0;
}
