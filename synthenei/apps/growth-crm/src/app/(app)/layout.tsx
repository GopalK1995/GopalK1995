import { requireActive } from "@/lib/auth/server";
import { Providers, type ShellCtx } from "@/components/shell/providers";
import { AppShell } from "@/components/shell/shell";
import { FONT_STACKS, fontsFor, verticalOf } from "@/lib/vertical";
import { TENANTS, WORKSPACES } from "@/lib/tenancy";
import { getEffectiveConfig } from "@/lib/config/resolve";
import { stageList } from "@/lib/config/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, active } = await requireActive();
  const cfg = await getEffectiveConfig(active.tenant.id);
  const workspaces = session.platformAdmin ? [{ ws: active.ws.id, role: active.role }] : session.memberships;
  const ctx: ShellCtx = {
    uid: session.uid, name: session.name, email: session.email, demo: session.demo, platformAdmin: session.platformAdmin, role: active.role,
    ws: { id: active.ws.id, name: active.ws.name, region: active.ws.region },
    tenant: { id: active.tenant.id, name: active.tenant.name, product: active.tenant.product, hue: active.tenant.hue, monogram: active.tenant.monogram, vertical: verticalOf(active.tenant), workspaceCount: active.options ? active.options.filter((o) => o.tenant.id === active.tenant.id).length : WORKSPACES.filter((w) => w.tenantId === active.tenant.id).length, isPrimaryOwner: active.tenant.primaryOwnerId === session.uid, config: active.tenant.config, stageOrder: { lead: stageList(cfg.stages.lead), deal: stageList(cfg.stages.deal) } },
    workspaces: active.options ? active.options.map((o) => ({ id: o.ws.id, name: o.ws.name, tenantId: o.tenant.id, tenantName: o.tenant.name, monogram: o.tenant.monogram, role: o.role })) : workspaces.map((m) => {
      const w = WORKSPACES.find((x) => x.id === m.ws)!; const t = TENANTS.find((x) => x.id === w.tenantId)!;
      return { id: w.id, name: w.name, tenantId: t.id, tenantName: t.name, monogram: t.monogram, role: m.role };
    }),
    support: active.support ? { mode: active.support.mode, reason: active.support.reason, admin: active.support.admin, endsAt: active.support.endsAt } : null,
  };
  const f = fontsFor(active.tenant); // keys from the allow-list only; stacks are constants
  const fonts = `${FONT_STACKS[f.body] ? `--font-ui:${FONT_STACKS[f.body]};` : ""}${FONT_STACKS[f.heading] ? `--font-heading:${FONT_STACKS[f.heading]};` : ""}`;
  return (
    <>
      <style>{`:root{--brand-h:${active.tenant.hue};${fonts}}`}</style>
      <Providers session={ctx}><AppShell>{children}</AppShell></Providers>
    </>
  );
}
