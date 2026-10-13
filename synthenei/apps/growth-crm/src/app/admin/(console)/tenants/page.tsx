import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { fmtDateY, num, relTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { allTenants, adminNow, type TenantSummary } from "../../_components/data";
import { TenantMark, TenantStatus } from "../../_components/bits";
import { ActionDialog } from "../../_components/action-dialog";
import { createTenant } from "../../_components/actions";

export const metadata = { title: "Tenants" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const { q } = await searchParams;
  const now = adminNow();
  const rows = allTenants().filter((t) => !q || `${t.tenant.name} ${t.tenant.id}`.toLowerCase().includes(q.toLowerCase()));
  const cols: Column<TenantSummary>[] = [
    { key: "name", header: "Tenant", mobile: "title", cell: (t) => (
      <Link href={`/admin/tenants/${t.tenant.id}`} className="inline-flex items-center gap-2 font-medium text-ink hover:underline"><TenantMark tenant={t.tenant} size={22} />{t.tenant.name}</Link>
    ) },
    { key: "slug", header: "Slug", cell: (t) => <span className="font-mono text-[12px] text-ink-2">{t.tenant.id}</span> },
    { key: "plan", header: "Plan", mobile: "fact", cell: (t) => t.tenant.plan },
    { key: "status", header: "Status", mobile: "fact", cell: (t) => <TenantStatus status={t.tenant.status} /> },
    { key: "seats", header: "Seats", align: "right", cell: (t) => `${t.seatsUsed} of ${t.tenant.seats}` },
    { key: "ws", header: "Workspaces", align: "right", cell: (t) => num(t.workspaces.length) },
    { key: "owner", header: "Primary owner", cell: (t) => <span className="text-ink-2">{t.owner}</span> },
    { key: "created", header: "Created", cell: (t) => <span className="num text-ink-2">{fmtDateY(t.tenant.createdAt)}</span> },
    { key: "last", header: "Last activity", align: "right", cell: (t) => <span className="text-ink-2">{t.lastActivityAt ? relTime(t.lastActivityAt, now) : "—"}</span> },
    { key: "open", header: <span className="sr-only">Open</span>, mobile: "action", align: "right", cell: (t) => <Link href={`/admin/tenants/${t.tenant.id}`} className="text-[12px] font-medium text-accent hover:underline">Open</Link> },
  ];
  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Tenants" sub="White-label client organisations. Each tenant owns its branding and one or more isolated workspaces."
        actions={
          <ActionDialog trigger="Create tenant" triggerVariant="primary" icon={<Plus />} title="Create tenant" submit="Create tenant"
            description="Creates the tenant, its first workspace and an Owner invitation in one step (admin_create_tenant)." action={createTenant}
            fields={[
              { name: "name", label: "Tenant name", placeholder: "Nilgiri Law Associates" },
              { name: "slug", label: "Slug", placeholder: "nilgiri-law", mono: true, hint: "Lowercase, used in URLs and storage paths. Cannot be changed later." },
              { name: "brand", label: "Brand name shown in the app", placeholder: "NILGIRI" },
              { name: "hue", label: "Primary hue (0-359)", type: "number", defaultValue: "200", hint: "245 is harbour cobalt. Adjust later in the tenant's Branding tab." },
              { name: "workspace", label: "First workspace", placeholder: "Coimbatore" },
              { name: "owner", label: "Owner email", type: "email", placeholder: "owner@firm.example" },
            ]} />
        } />
      <form className="mb-3" role="search">
        <label htmlFor="tq" className="sr-only">Search tenants</label>
        <input id="tq" name="q" defaultValue={q} placeholder="Search by name or slug" className="h-8 w-full rounded-sm border border-line-strong bg-surface px-3 text-[13px] outline-none placeholder:text-ink-3 focus:border-ring sm:w-72" />
      </form>
      <Card>
        <DataTable rows={rows} columns={cols} rowKey={(t) => t.tenant.id} minWidth={960} caption="Tenants" empty={`No tenant matches "${q}".`} />
      </Card>
      <p className="mt-3 text-[12px] text-ink-3">Seats count distinct people with any membership in the tenant. Suspend or reactivate from the tenant page.</p>
    </>
  );
}
