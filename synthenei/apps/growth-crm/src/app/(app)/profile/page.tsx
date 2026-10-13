import { LogOut, ShieldCheck } from "lucide-react";
import { requireActive } from "@/lib/auth/server";
import { logout } from "@/lib/auth/actions";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { TENANTS, workspaceById } from "@/lib/tenancy";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { Prefs } from "./prefs";

export const metadata = { title: "Profile" };
export default async function Profile() {
  const { session, active } = await requireActive();
  const rows = session.memberships.map((m) => { const w = workspaceById(m.ws)!; return { ...m, w, t: TENANTS.find((t) => t.id === w.tenantId)! }; });
  return (
    <>
      <PageHeader eyebrow="Your account" title="Profile" sub="Name, language and notifications. Roles are set per workspace by each workspace's Owner." />
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader title="Details and notifications" />
          <CardBody><Prefs name={session.name} email={session.email} /></CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader title="My workspaces" sub={`${rows.length} membership${rows.length === 1 ? "" : "s"} across ${new Set(rows.map((r) => r.t.id)).size} tenant${new Set(rows.map((r) => r.t.id)).size === 1 ? "" : "s"}`} />
            <ul className="divide-y divide-line border-t border-line">
              {rows.map((r) => (
                <li key={r.ws} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar name={r.t.name} size={28} />
                  <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{r.t.name} · {r.w.name}</div><div className="truncate text-[12px] text-ink-3">{r.w.region}</div></div>
                  <Badge tone={r.ws === active.ws.id ? "accent" : "neutral"}>{ROLE_LABEL[r.role]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Sessions" sub={session.demo ? "Demo session: signed in with a persona, sample data only" : "Signed in with email and password"} />
            <CardBody className="flex flex-wrap gap-2">
              <form action={logout}><Button><LogOut />Log out</Button></form>
              <Button variant="danger" disabled title="Uses Supabase global sign-out; not available in demo sessions"><ShieldCheck />Log out of all devices</Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
