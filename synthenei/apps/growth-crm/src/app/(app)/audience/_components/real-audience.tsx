// Real-session audience screen: saved segments (saved queries with live counts from the real leads query, RLS applied) and the
// persisted rule builder. Demo sessions keep the showcase screen in ../page.tsx.
import type { pageCtx } from "@/lib/data/context";
import { dbForRequest } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { StatusChip } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { AuthzError } from "@/lib/authz";
import { SYSTEM_FIELDS } from "@/lib/segments/fields";
import { compileRules, parseStoredRules } from "@/lib/segments/compile";
import { countSegment } from "@/lib/segments/query";
import { segmentsRepo } from "@/lib/segments/repo";
import { loadCampaigns } from "../../campaigns/_lib/load";
import { tc } from "../../campaigns/_lib/strings";
import { RealBuilder, type SavedSeg } from "./real-builder";

type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const OPTION_COLS = SYSTEM_FIELDS.filter((f) => f.kind === "text" || f.key === "status" || f.key === "source" || f.key === "channel");

export async function RealAudience({ ctx }: { ctx: Ctx }) {
  const v = vocabFor(ctx.active.tenant), t = tc(v), ws = ctx.active.ws.uuid;
  try {
    await assertCan("segments.read", { type: "segment", workspaceId: ctx.active.ws.id });
  } catch (e) {
    if (e instanceof AuthzError) return (<><PageHeader eyebrow={v.au.eyebrow} title="Audience" sub={v.au.sub} /><EmptyState title="No access" body={t("noAccess")} /></>);
    throw e;
  }
  const db = await dbForRequest();
  const [{ rows }, campaigns, sample] = await Promise.all([
    segmentsRepo.list(ws, { limit: 100 }),
    loadCampaigns(ctx),
    from(db, "leads").select(OPTION_COLS.map((f) => f.column).join(",")).eq("workspace_id", ws).is("deleted_at", null).limit(2000),
  ]);
  const data = (sample.data as Record<string, string | null>[] | null) ?? [];
  const options: Record<string, string[]> = {};
  for (const f of OPTION_COLS) options[f.key] = [...new Set(data.map((r) => r[f.column]).filter((x): x is string => !!x))].sort();

  const saved: SavedSeg[] = await Promise.all(rows.map(async (r) => {
    const rules = parseStoredRules(r.rules), k = compileRules(rules);
    let total: number | null = null;
    if (k.ok) { try { total = await countSegment(db, ws, k.filters); } catch { total = null; } }
    return { id: r.id, name: r.name, version: r.version, rules, total };
  }));

  const cols: Column<SavedSeg>[] = [
    { key: "name", header: "Segment", mobile: "title", cell: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: "rules", header: "Rules", cell: (s) => <span className="text-ink-3">{s.rules.filter((r) => r.values.length).map((r) => `${r.field}: ${r.values.join(" or ")}`).join("; ") || "All contacts"}</span> },
    { key: "total", header: t("totalLabel", {}), align: "right", mobile: "fact", cell: (s) => (s.total === null ? <span className="text-ink-3" title="Could not count">unavailable</span> : <span className="num">{s.total}</span>) },
  ];

  return (
    <>
      <PageHeader eyebrow={v.au.eyebrow} title="Audience" sub={v.au.sub} />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader title="Saved segments" sub="A segment is a saved query. Counts are live and never a copy of people." />
          {saved.length === 0 ? <CardBody><EmptyState title="No segments yet" body={t("emptySegments")} /></CardBody>
            : <DataTable rows={saved} columns={cols} rowKey={(s) => s.id} minWidth={640} caption="Saved audience segments" />}
        </Card>
        <Card>
          <CardHeader title="Build a segment" sub="Rules combine with AND; values inside a rule combine with OR" action={<StatusChip status="showcase" label="Push needs a connected ad account" />} />
          <CardBody>
            <RealBuilder saved={saved} options={options} fields={OPTION_COLS.map((f) => f.key)} campaigns={campaigns.filter((c) => c.status !== "ended").map((c) => ({ id: c.id, name: c.name, channel: c.channel, version: c.version }))} labels={{ consented: t("consentedLabel"), total: t("totalLabel"), push: t("pushDisabled") }} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
