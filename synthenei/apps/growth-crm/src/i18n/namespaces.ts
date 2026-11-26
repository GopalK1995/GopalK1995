// Which message namespaces each part of the app ships to the browser (AUD-016 / PERF-007).
// Server components keep the whole catalogue (getT / getMessages); only the CLIENT provider is trimmed, because
// useTranslations() is called from a handful of client components. Tests (src/i18n/__tests__/namespaces.test.ts) scan the source so
// a new client useTranslations("x") that is not covered here fails CI instead of rendering key names.
import type { Messages } from "./registry";

// Public pages (login, auth/*, legal, docs, g/*, admin) get NO client provider at all: nothing there calls useTranslations, so they
// ship zero messages and do not pull next-intl's client runtime. The test below fails if that ever changes.
/** Signed-in shell: sidebar/topbar (shell), command palette (search), reviews panel, plus the basics. */
export const APP_NS = ["common", "errors", "shell", "search", "reviews"] as const;
/** Extra namespaces by first path segment under (app). Layouts persist across client navigations, so these live in section layouts. */
export const SECTION_NS: Record<string, readonly string[]> = {
  ai: ["ai"],
  leads: ["ai", "imports"],
  inbox: ["ai"],
  import: ["imports"],
  analytics: ["social"],
  integrations: ["social"],   // the Instagram and Facebook step list embeds the Page picker
};

export function pickNamespaces(messages: Messages, ns: readonly string[]): Messages {
  const out: Messages = {};
  for (const k of ns) if (messages[k] !== undefined) out[k] = messages[k];
  return out;
}
