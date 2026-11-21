import { AiError, type ProviderAdapter } from "../types";
import { num, obj, postJson } from "./http";

export const googleAdapter: ProviderAdapter = {
  id: "google",
  async complete(req, ctx) {
    const raw = obj(await postJson(`${ctx.baseUrl ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": ctx.apiKey },
      { systemInstruction: { parts: [{ text: req.system }] }, contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: req.maxTokens, ...(req.temperature != null ? { temperature: req.temperature } : {}), ...(req.json ? { responseMimeType: "application/json" } : {}) } }, ctx));
    const cand = obj(Array.isArray(raw.candidates) ? raw.candidates[0] : null);
    const parts = Array.isArray(obj(cand.content).parts) ? (obj(cand.content).parts as unknown[]) : [];
    const text = parts.map((p) => String(obj(p).text ?? "")).join("");
    if (!text) throw new AiError("bad_output", "The model returned no text");
    const u = obj(raw.usageMetadata);
    return { text, inputTokens: num(u.promptTokenCount), outputTokens: num(u.candidatesTokenCount), model: String(raw.modelVersion ?? req.model), stopReason: typeof cand.finishReason === "string" ? cand.finishReason : null };
  },
};
