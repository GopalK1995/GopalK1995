// Single validated environment module (contract C17). Import `env` / `demoModeOn` from here.
// Validation is lazy (first property read), so importing never throws at build time.
// Messages name variables only, never values.
import { z } from "zod";

const opt = z.string().optional().transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

export const APP_ENVS = ["production", "staging", "demo", "test"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const schema = z.object({
  APP_ENV: opt,
  APP_BASE_URL: opt,
  NEXT_PUBLIC_APP_BASE_URL: opt,
  NEXT_PUBLIC_SUPABASE_URL: opt,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: opt,
  SUPABASE_SERVICE_ROLE_KEY: opt,
  SUPABASE_JWT_SECRET: opt,
  SESSION_SECRET: opt,
  DATA_SOURCE: opt,
  DEMO_MODE: opt,
  JOBS_TICK_SECRET: opt,
  CRON_SECRET: opt,
  SENTRY_DSN: opt,
  NEXT_PUBLIC_SENTRY_DSN: opt,
  RESEND_API_KEY: opt,
  EMAIL_FROM: opt,
  EMAIL_REPLY_TO: opt,
  ANTHROPIC_API_KEY: opt,
  AI_DEFAULT_MODEL: opt,
});

export interface Env {
  appEnv: AppEnv;
  /** True when Supabase URL and anon key are both present. */
  supabaseConfigured: boolean;
  /** Demo personas on /login and demo admin MFA. */
  demoMode: boolean;
  /** True only when real (non-demo) sessions may read Supabase. */
  dataSourceSupabase: boolean;
  appBaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  serviceRoleKey?: string;
  jwtSecret?: string;
  sessionSecret?: string;
  jobsTickSecret?: string;
  cronSecret?: string;
  sentryDsn?: string;
  resendApiKey?: string;
  emailFrom?: string;
  emailReplyTo?: string;
  anthropicApiKey?: string;
  aiDefaultModel?: string;
}

export class EnvError extends Error {
  readonly names: string[];
  constructor(names: string[], reason: string) {
    super(`Invalid environment: ${reason}: ${names.join(", ")}`);
    this.name = "EnvError";
    this.names = names;
  }
}

export type RawEnv = Record<string, string | undefined>;

/** Pure parser. Demo behaviour: no Supabase env means demo mode, exactly as before. */
export function parseEnv(raw: RawEnv): Env {
  const r = schema.parse(raw);
  const supabaseConfigured = Boolean(r.NEXT_PUBLIC_SUPABASE_URL && r.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabaseUrlSet = Boolean(r.NEXT_PUBLIC_SUPABASE_URL);

  if (r.APP_ENV !== undefined && !(APP_ENVS as readonly string[]).includes(r.APP_ENV)) {
    throw new EnvError(["APP_ENV"], `must be one of ${APP_ENVS.join("|")}`);
  }
  const appEnv: AppEnv = (r.APP_ENV as AppEnv | undefined) ?? (supabaseUrlSet ? "staging" : "demo");

  if (appEnv === "production") {
    if (r.DEMO_MODE === "1") throw new EnvError(["DEMO_MODE"], "must not be 1 in production");
    const required: Record<string, string | undefined> = {
      NEXT_PUBLIC_SUPABASE_URL: r.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: r.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: r.SUPABASE_SERVICE_ROLE_KEY,
      SESSION_SECRET: r.SESSION_SECRET,
      JOBS_TICK_SECRET: r.JOBS_TICK_SECRET,
    };
    const missing = Object.keys(required).filter((k) => !required[k]);
    if (missing.length) throw new EnvError(missing, "missing required in production");
  }
  if (supabaseUrlSet) {
    if (!r.SESSION_SECRET) throw new EnvError(["SESSION_SECRET"], "required when Supabase is configured");
    if ((appEnv === "production" || appEnv === "staging") && r.SESSION_SECRET.length < 32) {
      throw new EnvError(["SESSION_SECRET"], "must be at least 32 characters");
    }
  }

  const demoMode = appEnv === "demo" || !supabaseUrlSet || r.DEMO_MODE === "1";
  return {
    appEnv,
    supabaseConfigured,
    demoMode,
    dataSourceSupabase: r.DATA_SOURCE === "supabase" && supabaseConfigured,
    appBaseUrl: r.APP_BASE_URL ?? r.NEXT_PUBLIC_APP_BASE_URL,
    supabaseUrl: r.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: r.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: r.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: r.SUPABASE_JWT_SECRET,
    sessionSecret: r.SESSION_SECRET,
    jobsTickSecret: r.JOBS_TICK_SECRET,
    cronSecret: r.CRON_SECRET,
    sentryDsn: r.SENTRY_DSN,
    resendApiKey: r.RESEND_API_KEY,
    emailFrom: r.EMAIL_FROM,
    emailReplyTo: r.EMAIL_REPLY_TO,
    anthropicApiKey: r.ANTHROPIC_API_KEY,
    aiDefaultModel: r.AI_DEFAULT_MODEL,
  };
}

/** Reads process.env on every call (cheap) so tests and runtime changes are honoured. */
export function loadEnv(): Env {
  return parseEnv(process.env as RawEnv);
}

/** Lazy validated view: validation runs on first property access per read. */
export const env: Env = new Proxy({} as Env, {
  get: (_t, key: string) => (loadEnv() as unknown as Record<string, unknown>)[key],
});

/** Demo personas are a security switch: server-only, never NEXT_PUBLIC. */
export const demoModeOn = (): boolean => loadEnv().demoMode;
