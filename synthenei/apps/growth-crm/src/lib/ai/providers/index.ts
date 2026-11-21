import { AiError, type ProviderAdapter, type ProviderId } from "../types";
import { anthropicAdapter } from "./anthropic";
import { googleAdapter } from "./google";
import { mockAdapter } from "./mock";
import { openaiAdapter } from "./openai";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = { anthropic: anthropicAdapter, openai: openaiAdapter, google: googleAdapter };
export const ENV_KEY: Record<ProviderId, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_AI_API_KEY" };
export const ENV_BASE: Record<ProviderId, string> = { anthropic: "ANTHROPIC_API_BASE", openai: "OPENAI_API_BASE", google: "GOOGLE_AI_API_BASE" };

/** The mock provider answers only outside production, and only when the deployment sets AI_MOCK_PROVIDER=1. */
export const mockEnabled = (env: Record<string, string | undefined>) => env.AI_MOCK_PROVIDER === "1" && env.VERCEL_ENV !== "production" && env.NODE_ENV !== "production";

export function adapterFor(p: ProviderId, env: Record<string, string | undefined>): ProviderAdapter {
  if (mockEnabled(env)) return mockAdapter;
  const a = ADAPTERS[p];
  if (!a) throw new AiError("no_provider", "Unknown provider");
  return a;
}
