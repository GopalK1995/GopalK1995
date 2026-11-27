// Opt-out keyword detection for inbound text. A message is an opt-out only when the WHOLE message (trimmed, case and
// punctuation folded) is one of these keywords: "please don't stop the updates" is not a STOP. Native-script keywords included.
const KEYWORDS = new Set([
  "stop", "stop all", "stopall", "unsubscribe", "unsub", "opt out", "optout", "end", "quit",
  "stop messages", "stop messaging", "stop sending", "do not message", "dont message",
  "நிறுத்து", "நிறுத்துங்கள்", "நிறுத்தவும்", "வேண்டாம்", "நிறுத்திடு", "நிறுத்துக", "நிறுத்துங்க", "எனக்கு வேண்டாம்",
  "ஸ்டாப்", "ஸ்டாப் செய்", "அன்சப்ஸ்க்ரைப்", "அன்சப்ஸ்கிரைப்",
  "बंद", "बंद करो", "रोकें", "रुकें",
]);

export function normaliseKeyword(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}
export function isOptOut(text: string | null | undefined): boolean {
  if (!text || text.length > 60) return false;
  return KEYWORDS.has(normaliseKeyword(text));
}
