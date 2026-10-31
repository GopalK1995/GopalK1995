// Client-safe template placeholder filling ({{1}}, {{2}}). The server re-reads the stored template body and fills it again.
export const fillTemplate = (body: string, vars: string[]) => body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => vars[Number(n) - 1] ?? m);
