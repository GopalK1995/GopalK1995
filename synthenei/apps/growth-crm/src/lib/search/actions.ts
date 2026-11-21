// Palette actions and their permission keys. The server filters them with the authz engine (`can`), so the palette never offers
// something the viewer may not do; the destination page still enforces the permission itself.
import { can, type Principal } from "@/lib/authz";
import type { SearchAction } from "./types";

type Def = SearchAction & { perm: string };
// "New lead" and "Log call" open the lead list with an intent the page can pick up; they do not write anything themselves.
const DEFS: Def[] = [
  { id: "new-lead", href: "/leads?new=1", perm: "leads.create" },
  { id: "log-call", href: "/leads?log=call", perm: "activities.write" },
  { id: "new-task", href: "/tasks?new=1", perm: "tasks.write" },
  { id: "import-leads", href: "/import", perm: "leads.import" },
];

export function allowedActions(p: Principal, workspaceId: string): SearchAction[] {
  return DEFS.filter((d) => can(p, d.perm, { type: d.perm.startsWith("tasks") ? "task" : d.perm.startsWith("activities") ? "activity" : "lead", workspaceId }))
    .map(({ id, href }) => ({ id, href }));
}
