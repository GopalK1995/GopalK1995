// Shared types for the webhooks screen ("use server" files may export only async functions, so types live here).
export interface IssuedSecret { id: string; secret: string; graceUntil?: string | null }
export interface EventOption { type: string; description: string; domain: string }
export interface TestOutcome { ok: boolean; status: number | null; ms: number; why: string | null; simulated: boolean }
