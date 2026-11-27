/** "Tenant · Workspace", but the name once when the two are the same (UXA-064: "LAWSOME · LAWSOME · Tamil Nadu"). */
export const scopeName = (tenant: string, ws: string): string => (!ws || tenant.trim().toLowerCase() === ws.trim().toLowerCase() ? tenant : !tenant ? ws : `${tenant} · ${ws}`);
