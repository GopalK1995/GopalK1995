import { AiError, type ProviderAdapter } from "../types";
import { num, obj, postJson } from "./http";

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  async complete(req, ctx) {
    const raw = obj(await postJson(`${ctx.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`,
      { authorization: `Bearer ${ctx.apiKey}` },
      { model: req.model, max_completion_tokens: req.maxTokens, messages: [{ role: "system", content: req.system }, ...req.messages],
        ...(req.temperature != null ? { temperature: req.temperature } : {}), ...(req.json ? { response_format: { type: "json_object" } } : {}) }, ctx));
    const choice = obj(Array.isArray(raw.choices) ? raw.choices[0] : null);
    const text = String(obj(choice.message).content ?? "");
    if (!text) throw new AiError("bad_output", "The model returned no text");
    const u = obj(raw.usage);
    return { text, inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens), model: String(raw.model ?? req.model), stopReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null };
  },
};
