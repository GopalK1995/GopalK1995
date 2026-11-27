// AUD-115: table-driven decision test. Every system role x every catalogue permission x every record relationship (own /
// team / workspace boundary / unowned-territory / shared), then every permission x every grant scope, then the tenant states.
// The oracle below is written independently of engine.ts (it reads SYSTEM_ROLES, not systemGrants) so drift in either the
// seed or the engine fails loudly with the exact cell named.
import { describe, expect, it } from "vitest";
import { decide } from "../engine";
import { PERMISSIONS } from "../catalog";
import { SYSTEM_ROLES } from "../catalog/system-roles";
import { systemPrincipal } from "../principal";
import type { Grant, Principal, RecordRef, Scope } from "../types";
import type { Role } from "../../data/types";

const NOW = new Date("2026-11-27T06:00:00.000Z");
const WS = "ws1";
const TEAM = ["u-me", "u-mate"];
const ME = "u-me";
const DISTRICTS = ["Madurai"];
const R = (o: Partial<RecordRef>): RecordRef => ({ type: "lead", workspaceId: WS, ownerId: "u-stranger", ...o });
const RECORDS: Record<string, RecordRef | undefined> = {
  list_level: undefined,
  mine: R({ ownerId: ME }),
  assigned_to_me: R({ ownerId: "u-stranger", assigneeId: ME }),
  teammates: R({ ownerId: "u-mate" }),
  stranger: R({ ownerId: "u-stranger" }),
  unowned_in_territory: R({ ownerId: null, attrs: { district: "Madurai" } }),
  unowned_out_of_territory: R({ ownerId: null, attrs: { district: "Chennai" } }),
  shared_view: R({ sharedWith: [{ relation: "viewer", subjectType: "user", subjectId: ME }] }),
  shared_edit: R({ sharedWith: [{ relation: "editor", subjectType: "user", subjectId: ME }] }),
  other_workspace: R({ workspaceId: "ws2", ownerId: ME }),
};

const principal = (role: Role, grants?: Record<string, Grant>, tenant?: Principal["tenant"]): Principal => {
  const p = systemPrincipal({ uid: ME, workspaceId: WS, role, tenantId: "t1", tenant: tenant ?? { status: "active" }, attrs: { districts: DISTRICTS }, teamUserIds: TEAM });
  return grants ? { ...p, grants } : p;
};

const isRead = (perm: string) => perm.endsWith(".read");
/** Oracle: scope semantics of the authorization model (own, team, workspace = all, plus shares), stated once, in plain code. */
function oracleScope(scope: Scope, territory: boolean, key: string, rec: RecordRef | undefined, perm: string): boolean {
  if (scope === "none") return false;
  if (!rec) return true; // list-level checks apply no record scope
  const mine = rec.ownerId === ME || rec.assigneeId === ME;
  const shared = (rec.sharedWith ?? []).some((s) => s.subjectId === ME && (isRead(perm) || s.relation !== "viewer"));
  let inScope: boolean;
  if (rec.workspaceId !== WS) inScope = false; // workspace boundary: no scope crosses it
  else if (scope === "all") inScope = true; // "all" is workspace-wide, not tenant-wide
  else if (scope === "team") inScope = rec.ownerId == null || TEAM.includes(rec.ownerId) || mine;
  else inScope = mine || (territory && key === "leads.read" && rec.ownerId == null && rec.assigneeId == null && DISTRICTS.includes(String(rec.attrs?.district)));
  return inScope || shared;
}

const KEYS = PERMISSIONS.map((p) => p.key);
const NON_PLATFORM = KEYS.filter((k) => !k.startsWith("platform."));

describe("decision table: system roles x permissions x record relationships", () => {
  it("covers all six roles and every catalogue permission", () => {
    expect(SYSTEM_ROLES.length).toBe(6);
    expect(KEYS.length).toBeGreaterThan(70);
  });
  it("engine == oracle for every cell (grant from SYSTEM_ROLES)", () => {
    const bad: string[] = [];
    let cells = 0;
    for (const role of SYSTEM_ROLES) {
      const p = principal(role.key);
      for (const perm of KEYS) {
        const scope = (role.grants[perm] ?? "none") as Scope;
        for (const [shape, rec] of Object.entries(RECORDS)) {
          cells++;
          const want = oracleScope(scope, scope === "own", perm, rec, perm);
          const got = decide(p, perm, rec, NOW);
          if (got.allow !== want) bad.push(`${role.key} ${perm}(${scope}) ${shape}: engine=${got.allow}/${got.reason} oracle=${want}`);
          if (got.allow) expect(got.reason).toBeNull();
        }
      }
    }
    expect(cells).toBe(6 * KEYS.length * Object.keys(RECORDS).length);
    expect(bad.slice(0, 10), `${bad.length} divergent cell(s)`).toEqual([]);
  });
  it("platform permissions are never held by a system role", () => {
    for (const role of SYSTEM_ROLES) for (const perm of KEYS.filter((k) => k.startsWith("platform."))) {
      expect(decide(principal(role.key), perm, undefined, NOW).allow, `${role.key} ${perm}`).toBe(false);
    }
  });
});

describe("decision table: every permission x every grant scope (own / team / workspace / tenant)", () => {
  it("engine == oracle for synthetic grants at each scope on every record shape", () => {
    const bad: string[] = [];
    for (const scope of ["own", "team", "all", "none"] as Scope[]) {
      for (const perm of NON_PLATFORM) {
        const p = principal("viewer", { [perm]: { scope } });
        for (const [shape, rec] of Object.entries(RECORDS)) {
          const want = oracleScope(scope, false, perm, rec, perm);
          if (decide(p, perm, rec, NOW).allow !== want) bad.push(`${perm}(${scope}) ${shape}`);
        }
      }
    }
    expect(bad.slice(0, 10), `${bad.length} divergent cell(s)`).toEqual([]);
  });
  it("the territory arm applies to leads.read at own only, never to a write, never to a team or all grant", () => {
    const unowned = RECORDS.unowned_in_territory;
    expect(decide(principal("sales_rep"), "leads.read", unowned, NOW).allow).toBe(true);
    expect(decide(principal("sales_rep"), "leads.write", unowned, NOW).allow).toBe(false);
    expect(decide(principal("sales_rep"), "leads.claim", unowned, NOW).allow).toBe(false); // claim is its own action, enforced by the claim RPC (AUD-148)
    expect(decide(principal("sales_rep"), "leads.read", RECORDS.unowned_out_of_territory, NOW).allow).toBe(false);
  });
  it("tenant scope: a suspended or expired-trial organisation denies every write and allows reads", () => {
    const states: Principal["tenant"][] = [{ status: "suspended" }, { status: "trial", trialEndsAt: "2026-10-01T00:00:00.000Z" }];
    for (const tenant of states) for (const role of SYSTEM_ROLES) {
      const p = principal(role.key, undefined, tenant);
      for (const perm of NON_PLATFORM) {
        const d = decide(p, perm, undefined, NOW);
        if (!isRead(perm)) expect(d.allow, `${role.key} ${perm} ${tenant?.status}`).toBe(false);
        else expect(d.allow, `${role.key} ${perm} ${tenant?.status}`).toBe(role.grants[perm] !== undefined && !(d.reason === "module_off"));
      }
    }
  });
  it("a record of another workspace is denied for every role and permission, even at scope all", () => {
    for (const role of SYSTEM_ROLES) for (const perm of NON_PLATFORM) {
      expect(decide(principal(role.key), perm, RECORDS.other_workspace, NOW).allow, `${role.key} ${perm}`).toBe(false);
    }
  });
});

describe("decision table: spot checks that name the product rules", () => {
  const cases: [Role, string, keyof typeof RECORDS, boolean][] = [
    ["sales_rep", "leads.write", "mine", true],
    ["sales_rep", "leads.write", "stranger", false],
    ["sales_rep", "contacts.read", "stranger", false], // 0006: reps see own contacts only
    ["sales_rep", "leads.assign", "mine", false], // assignment stays manager/owner; reps claim through leads.claim
    ["sales_manager", "leads.write", "teammates", true],
    ["sales_manager", "audit.read", "list_level", true], // seeded grant the UI matrix used to miss
    ["sales_manager", "events.read", "list_level", true],
    ["sales_manager", "comments.moderate", "list_level", true],
    ["marketing", "comments.write", "list_level", true],
    ["marketing", "audit.read", "list_level", false],
    ["data", "audience.export", "list_level", true],
    ["data", "leads.write", "stranger", false],
    ["viewer", "leads.read", "stranger", true],
    ["viewer", "contacts.read", "list_level", false],
    ["viewer", "comments.write", "list_level", false],
    ["owner", "audit.export", "list_level", true],
    ["sales_manager", "audit.export", "list_level", false],
  ];
  it.each(cases)("%s %s on %s -> %s", (role, perm, shape, allow) => {
    expect(decide(principal(role), perm, RECORDS[shape], NOW).allow).toBe(allow);
  });
});
