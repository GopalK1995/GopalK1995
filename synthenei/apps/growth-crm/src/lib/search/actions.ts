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

// List-level check (no record): "may this person do this at all". The destination re-checks against the actual record.
export function allowedActions(p: Principal): SearchAction[] {
  return DEFS.filter((d) => can(p, d.perm))
    .map(({ id, href }) => ({ id, href }));
}
