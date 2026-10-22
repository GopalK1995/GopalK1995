"use server";
// Marketing mutations. Every action re-checks the permission on the server (role of the ACTIVE workspace plus
// support-session restrictions). Demo: nothing persists; the returned message tells the user what would happen.
import { requireActive } from "@/lib/auth/server";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { canMkt, type MktAction } from "./_lib/perm";
import { getDataSource } from "@/lib/data/source";
import { vocabFor } from "@/lib/vertical";

export type ActionResult = { ok: boolean; message: string; detail?: string };

async function guard(action: MktAction): Promise<{ ok: true; ws: string; demo: boolean; ds: ReturnType<typeof getDataSource>; v: ReturnType<typeof vocabFor> } | { ok: false; res: ActionResult }> {
  const { session, active } = await requireActive();
  const support = active.support ? { mode: active.support.mode } : null;
  if (!canMkt(action, { role: active.role, support })) {
    const why = support ? "Not available in a support session." : `Your role (${ROLE_LABEL[active.role]}) cannot do this.`;
    return { ok: false, res: { ok: false, message: "Not allowed", detail: why } };
  }
  return { ok: true, ws: active.ws.name, demo: session.demo, ds: getDataSource(active.ws, { demo: session.demo }), v: vocabFor(active.tenant) };
}
const demoNote = "Demo: nothing was saved, sent or audit-logged.";

export async function importCampaignCsv(platform: string, campaignId?: string): Promise<ActionResult> {
  const g = await guard("importCsv");
  if (!g.ok) return g.res;
  const camps = await g.ds.campaigns();
  const target = campaignId ? camps.find((c) => c.id === campaignId) : null;
  if (campaignId && !target) return { ok: false, message: "Unknown campaign", detail: "Rows for unknown campaigns are rejected." };
  return { ok: true, message: `${platform} export would be mapped and previewed${target ? ` for "${target.name}"` : ""}`, detail: `Rows with an unknown utm_campaign are rejected. ${demoNote}` };
}

export async function createCampaign(input: { name: string; channel: string; district: string; theme: string; budget: number }): Promise<ActionResult> {
  const g = await guard("editCampaigns");
  if (!g.ok) return g.res;
  const name = input.name.trim();
  if (name.length < 4) return { ok: false, message: "Name is too short", detail: "Use at least 4 characters." };
  if (!Number.isFinite(input.budget) || input.budget <= 0) return { ok: false, message: "Budget must be a positive INR amount" };
  return { ok: true, message: `"${name}" would be created in ${g.ws}`, detail: demoNote };
}

export async function setCampaignStatus(campaignId: string, status: "paused" | "live" | "archived"): Promise<ActionResult> {
  const g = await guard("editCampaigns");
  if (!g.ok) return g.res;
  const c = await g.ds.campaign(campaignId);
  if (!c) return { ok: false, message: "Campaign not found in this workspace" };
  const verb = status === "paused" ? "paused (status only; the ad platform is not touched)" : status === "archived" ? "archived" : "resumed";
  return { ok: true, message: `"${c.name}" would be ${verb}`, detail: demoNote };
}

export async function editCampaign(campaignId: string): Promise<ActionResult> {
  const g = await guard("editCampaigns");
  if (!g.ok) return g.res;
  const c = await g.ds.campaign(campaignId);
  if (!c) return { ok: false, message: "Campaign not found in this workspace" };
  return { ok: true, message: `Edit form for "${c.name}" would open`, detail: `Name, dates, budget and owner are editable; the UTM stays fixed so attribution holds. ${demoNote}` };
}

export async function addCampaignNote(campaignId: string, note: string): Promise<ActionResult> {
  const g = await guard("editCampaigns");
  if (!g.ok) return g.res;
  const c = await g.ds.campaign(campaignId);
  if (!c) return { ok: false, message: "Campaign not found in this workspace" };
  if (note.trim().length < 3) return { ok: false, message: "Note is empty" };
  return { ok: true, message: `Note would be added to "${c.name}"`, detail: demoNote };
}

export async function exportCampaignLeads(campaignId: string): Promise<ActionResult> {
  const g = await guard("exportCsv");
  if (!g.ok) return g.res;
  const leads = (await g.ds.leads()).filter((l) => l.campaignId === campaignId);
  const ok = leads.filter((l) => l.consent.marketing).length;
  return { ok: true, message: g.v.cd.exportMsg(leads.length), detail: `${g.v.cd.exportDetail(leads.length - ok)} Export is audit-logged. ${demoNote}` };
}

export async function sendSegmentToCampaign(segment: string, size: number, campaignId: string): Promise<ActionResult> {
  const g = await guard("editCampaigns");
  if (!g.ok) return g.res;
  const c = await g.ds.campaign(campaignId);
  if (!c) return { ok: false, message: "Campaign not found in this workspace" };
  return { ok: true, message: g.v.cd.segMsg(segment, size, c.name), detail: `Showcase: no audience is pushed to the ad platform until its source is connected. ${demoNote}` };
}

export async function saveSegment(segment: string, rules: number): Promise<ActionResult> {
  const g = await guard("editSegments");
  if (!g.ok) return g.res;
  if (segment.trim().length < 3) return { ok: false, message: "Give the segment a name" };
  return { ok: true, message: `Segment "${segment.trim()}" with ${rules} rule${rules === 1 ? "" : "s"} would be saved`, detail: demoNote };
}

export async function exportSegment(segment: string, size: number): Promise<ActionResult> {
  const g = await guard("exportCsv");
  if (!g.ok) return g.res;
  return { ok: true, message: `CSV of "${segment}" (${size} consented contacts) would download`, detail: `Audit-logged. ${demoNote}` };
}
