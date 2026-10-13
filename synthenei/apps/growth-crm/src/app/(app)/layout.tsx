import { requireActive } from "@/lib/auth/server";
import { Providers, type ShellCtx } from "@/components/shell/providers";
import { AppShell } from "@/components/shell/shell";
import { TENANTS, WORKSPACES } from "@/lib/tenancy";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, active } = await requireActive();
  const workspaces = session.platformAdmin ? [{ ws: active.ws.id, role: active.role }] : session.memberships;
  const ctx: ShellCtx = {
    uid: session.uid, name: session.name, email: session.email, demo: session.demo, platformAdmin: session.platformAdmin, role: active.role,
    ws: { id: active.ws.id, name: active.ws.name, region: active.ws.region },
    tenant: { id: active.tenant.id, name: active.tenant.name, product: active.tenant.product, hue: active.tenant.hue, monogram: active.tenant.monogram, workspaceCount: WORKSPACES.filter((w) => w.tenantId === active.tenant.id).length, isPrimaryOwner: active.tenant.primaryOwnerId === session.uid },
    workspaces: workspaces.map((m) => {
      const w = WORKSPACES.find((x) => x.id === m.ws)!; const t = TENANTS.find((x) => x.id === w.tenantId)!;
      return { id: w.id, name: w.name, tenantId: t.id, tenantName: t.name, monogram: t.monogram, role: m.role };
    }),
    support: active.support ? { mode: active.support.mode, reason: active.support.reason, admin: active.support.admin, endsAt: active.support.endsAt } : null,
  };
  return (
    <>
      <style>{`:root{--brand-h:${active.tenant.hue}}`}</style>
      <Providers session={ctx}><AppShell>{children}</AppShell></Providers>
    </>
  );
}
