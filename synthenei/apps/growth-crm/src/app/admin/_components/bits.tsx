// Small server-compatible pieces shared by admin pages.
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/data/types";
import type { Tenant } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

/** Tenant monogram in the tenant's own hue (the console itself stays on the platform hue). */
export function TenantMark({ tenant, size = 28, className }: { tenant: Pick<Tenant, "hue" | "monogram" | "name">; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-[6px] font-semibold", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), background: `oklch(0.52 0.15 ${tenant.hue})`, color: `oklch(0.99 0.005 ${tenant.hue})` }}>
      {tenant.monogram}
    </span>
  );
}
export function TenantStatus({ status }: { status: Tenant["status"] }) {
  return status === "active" ? <Badge tone="success">Active</Badge> : status === "trial" ? <Badge tone="accent">Trial</Badge> : <Badge tone="danger">Suspended</Badge>;
}
export function SessionState({ state }: { state: "active" | "ended" | "expired" }) {
  return state === "active" ? <Badge tone="warn">Open</Badge> : state === "ended" ? <Badge tone="neutral">Ended</Badge> : <Badge tone="outline">Expired</Badge>;
}
export function UserStatus({ status }: { status: string }) {
  return status === "active" ? <Badge tone="success">Active</Badge> : status === "invited" ? <Badge tone="accent">Invited</Badge> : <Badge tone="neutral">{status === "revoked" ? "Revoked" : "Deactivated"}</Badge>;
}
/** "Tamil Nadu · Owner" chip; owner gets the navy tone so it is findable at a glance. */
export function RoleChip({ ws, role }: { ws: string; role: Role }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium ring-1 ring-inset", role === "owner" ? "bg-navy-900 text-navy-ink ring-navy-900" : "bg-paper-2 text-ink-2 ring-line")}>
      <span className={role === "owner" ? "text-navy-ink-2" : "text-ink-3"}>{ws}</span>{ROLE_LABEL[role]}
    </span>
  );
}
