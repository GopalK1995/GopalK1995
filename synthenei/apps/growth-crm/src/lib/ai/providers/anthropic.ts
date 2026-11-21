import { AiError, type ProviderAdapter } from "../types";
import { num, obj, postJson } from "./http";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  async complete(req, ctx) {
    const raw = obj(await postJson(`${ctx.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      { "x-api-key": ctx.apiKey, "anthropic-version": "2023-06-01" },
      { model: req.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages, ...(req.temperature != null ? { temperature: req.temperature } : {}) }, ctx));
    const content = Array.isArray(raw.content) ? raw.content : [];
    const text = content.map((b) => obj(b)).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
    if (!text) throw new AiError("bad_output", "The model returned no text");
    const u = obj(raw.usage);
    return { text, inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens), model: String(raw.model ?? req.model), stopReason: typeof raw.stop_reason === "string" ? raw.stop_reason : null };
  },
};
