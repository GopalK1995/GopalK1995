// Deterministic provider for staging and Cypress (AI_MOCK_PROVIDER=1, never in production). Answers by feature marker so specs can
// assert the whole path (policy, caps, redaction, audit) without a vendor key.
import type { ProviderAdapter } from "../types";

export const mockAdapter: ProviderAdapter = {
  id: "anthropic",
  async complete(req) {
    const last = req.messages[req.messages.length - 1]?.content ?? "";
    const ta = /Tamil/i.test(req.system);
    let text: string;
    if (req.json && /"bullets"/.test(req.system)) text = JSON.stringify({ bullets: ["Mock summary line one.", "Mock summary line two."] });
    else if (req.json && /"action"/.test(req.system)) text = JSON.stringify({ action: "Mock: call the lead", reason: "Mock reason", due_in_days: 1, factors: ["mock"] });
    else if (/ANSWER FROM THE DATA ONLY/.test(req.system)) text = "Mock answer from the approved views.";
    else text = ta ? "வணக்கம், உங்கள் செய்திக்கு நன்றி. [mock-ta]" : "Hello, thanks for your message. [mock-en]";
    return { text, inputTokens: Math.ceil((req.system.length + last.length) / 4), outputTokens: Math.ceil(text.length / 4), model: req.model, stopReason: "end_turn" };
  },
};
