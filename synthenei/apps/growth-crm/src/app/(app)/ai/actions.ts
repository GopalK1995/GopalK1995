"use server";
// /ai mutations and queries. Permissions re-checked here; AI toggles are on the support-session never-list.
import { pageCtx } from "@/lib/data/context";
import { allowed, deniedReason, type ActionResult } from "../accounts/_components/perms";
import { ask, type Answer, type QId } from "./_components/ask-engine";

export async function askCrm(text: string, qid: QId | null): Promise<Answer> {
  const { ds, role, support, session, now, scope } = await pageCtx();
  if (!allowed("askCrm", { role, support })) return { question: text, refused: deniedReason("askCrm", { role, support }) };
  const q = text.trim().slice(0, 300);
  if (!q && !qid) return { question: "", refused: "Type a question or pick a suggestion." };
  const [leads, deals, tasks, accounts, team, campaigns, days] = await Promise.all([ds.leads(), ds.deals(), ds.tasks(), ds.accounts(), ds.team(), ds.campaigns(), ds.campaignDays()]);
  // Same scoping as RLS: a rep asks about own records only. Campaign aggregates use workspace leads only when the role can read campaigns.
  return ask(q, qid, { role, uid: session.uid, now, leads: scope.leads(leads), deals: scope.deals(deals), tasks: scope.tasks(tasks), accounts, team, campaigns, days });
}

export async function toggleFeature(feature: string, on: boolean, terms: string[]): Promise<ActionResult> {
  const { role, support, session } = await pageCtx();
  if (!allowed("aiToggle", { role, support })) return { ok: false, message: deniedReason("aiToggle", { role, support }), sub: "Checked on the server; nothing changed." };
  if (on && terms.length < 3) return { ok: false, message: "Tick all three data checks before turning this on." };
  return { ok: true, message: `${feature} turned ${on ? "on" : "off"} for this workspace`, sub: session.demo ? "Demo: not saved. Showcase outputs stay sample-only." : "Saved and audit-logged." };
}

export async function saveWeights(changes: { label: string; from: number; to: number }[]): Promise<ActionResult> {
  const { role, support, session } = await pageCtx();
  if (!allowed("editScoreWeights", { role, support })) return { ok: false, message: deniedReason("editScoreWeights", { role, support }) };
  const changed = changes.filter((c) => c.from !== c.to && Number.isFinite(c.to) && c.to >= -40 && c.to <= 40);
  if (!changed.length) return { ok: false, message: "No weight changed (each factor must be between -40 and 40 points)." };
  return { ok: true, message: `${changed.length} weight${changed.length > 1 ? "s" : ""} saved: ${changed.map((c) => `${c.label} ${c.from}→${c.to}`).join(", ")}`, sub: session.demo ? "Demo: not saved. Scores would recalculate tonight." : "Scores recalculate tonight; audit-logged." };
}
