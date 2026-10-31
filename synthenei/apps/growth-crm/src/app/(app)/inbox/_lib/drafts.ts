// Draft sources for the composer.
// The Tamil sample drafts are LAWSOME demo copy keyed by sample conversation ids (CV-71...). They may only ever be shown
// in a demo session of a legal-vertical tenant. Real sessions and other verticals get null, so the past leak (sample drafts
// surfacing under other tenants' conversations) cannot recur: the gate is the (demo, vertical) pair, not the id alone.
import { TAMIL_DRAFTS } from "../_components/drafts-ta";

export function tamilDraft(scope: { demo: boolean; legal: boolean }, convId: string, first: string): string | null {
  if (!scope.demo || !scope.legal) return null;
  const t = TAMIL_DRAFTS[convId];
  return t ? t.replaceAll("{first}", first) : null;
}
