export function buildCsp(opts?: { nonce?: string; env?: Record<string, string | undefined> }): string;
export function buildSecurityHeaders(env?: Record<string, string | undefined>): { key: string; value: string }[];
