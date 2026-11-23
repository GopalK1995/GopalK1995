// Emits supabase/tests/authz_matrix.test.sql from the TS engine. Imported by scripts/gen-authz-matrix.mjs.
//
// For every cell of buildMatrix() (the same sweep that produces matrix.json) this maps the symbolic
// (role, support, tenant, modulesOff, record) tuple onto literal seeded UUIDs, then asserts the SQL evaluator
// authz.check() returns the decision the SQL twin is expected to make. "Expected" is computed by running the REAL
// TS engine (decide()) fed the SQL side's own grant table (SYSTEM_ROLES -> role_permissions) instead of the demo
// engine's systemGrants() -- so the assertion checks that authz.check agrees with the shared engine *logic* on the
// grants the SQL side actually holds. Where that prediction differs from the committed matrix.json fixture (which is
// built from systemGrants()), the cell is flagged in its description as a KNOWN TS-demo / SQL divergence -- never
// silently reconciled. See the file header the generator emits for the full list of divergence sources.

const ROLES = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
const ROLE_IX = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));
const SUPPORT = ["none", "read_only", "read_write"];
const DEEP_PERMS = ["leads.read", "leads.write", "deals.move", "tasks.write", "accounts.read", "inbox.reply", "campaigns.write", "pii.read"];
const MODULE_SWEEP = [["inbox.read", "inbox"], ["campaigns.write", "campaigns"], ["ai.use", "ai"]];

// ---------------------------------------------------------------- literal UUIDs (deterministic, v4 shape)
const U = (p8, suf) => `${p8}-0000-4000-8000-${String(suf).padStart(12, "0")}`;
const T_A = U("90000000", "a1"), T_B = U("90000000", "b1"), T_SUS = U("90000000", "c1"), T_TRIAL = U("90000000", "d1");
const WS_A = U("91000000", "a1"), WS_B = U("91000000", "b1"), WS_SUS = U("91000000", "c1"), WS_TRIAL = U("91000000", "d1");
const AU = (role) => U("92000000", "a" + ROLE_IX[role]);     // active members
const SU = (role) => U("92000000", "c" + ROLE_IX[role]);     // suspended-tenant members
const TU = (role) => U("92000000", "d" + ROLE_IX[role]);     // trial/archived-tenant members
const U_OTHER = U("92000000", "0e"), SUP_RO = U("92000000", "0f"), SUP_RW = U("92000000", "1f");
const CUSTOM_USER = U("92000000", "0c"), TEAM_MGR = U("92000000", "0b"), TEAM_MEMBER = U("92000000", "0a");
const L_OTHER = U("93000000", "00"), L_TEAM = U("93000000", "01"), L_UNOWNED_DIST = U("93000000", "02"),
  L_UNOWNED_FAR = U("93000000", "03"), L_SHARED_VIEWER = U("93000000", "04"), L_SHARED_EDITOR = U("93000000", "05");
const L_OWN_A = (role) => U("93000000", "a" + ROLE_IX[role]);
const L_ASSIGNED_A = (role) => U("93000000", "b" + ROLE_IX[role]);
const L_OWN_SUS = (role) => U("93000000", "c" + ROLE_IX[role]);
const L_OWN_TRIAL = (role) => U("93000000", "d" + ROLE_IX[role]);
const L_FOREIGN = U("93000000", "bf");
const L_CUSTOM = U("93000000", "0c"), L_TEAMMEMBER = U("93000000", "0b");
const ROLE_DISTRICT_WRITER = U("94000000", "01"), ROLE_TEAM_READER = U("94000000", "02");
const TEAM_PARENT = U("95000000", "01");

// The broad sweep needs the permission catalogue; matrix-cases doesn't export it, so the generator passes it in.
export function renderSql(eng, { diffs } = {}) {
  const { cases, roles, engine, catalog } = eng;
  const seed = Object.fromEntries(roles.SYSTEM_ROLES.map((r) => [r.key, r.grants]));
  const sqlGrants = (role) => Object.fromEntries(Object.entries(seed[role] ?? {}).map(([k, scope]) =>
    [k, { scope, ...(k === "leads.read" && scope === "own" ? { territory: true } : {}) }]));
  const TEN = cases.TENANTS;
  function sqlRecord(rec, uid, support) {
    if (rec === "none") return undefined;
    if (support !== "none") return { type: "lead", workspaceId: rec === "foreign_ws" ? "ws2" : "ws1" };
    const r = cases.recordFor(rec, uid);
    if (!r) return undefined;
    return { ...r, assigneeId: undefined };
  }
  function predict(role, support, tenant, off, perm, rec) {
    const effective = support === "read_only" ? "viewer" : support === "read_write" ? "owner" : role;
    const p = {
      kind: "user", uid: `u-${role}`, workspaceId: "ws1", tenantId: "t1", roleKey: effective,
      grants: sqlGrants(effective), teamIds: [],
      teamUserIds: role === "sales_manager" ? ["u-sales_manager", "u-sales_rep"] : [`u-${role}`],
      attrs: role === "sales_rep" ? { districts: ["Madurai"] } : {},
      tenant: TEN[tenant], modulesOff: off, support: support === "none" ? null : { mode: support },
      piiFields: ["email", "phone"],
    };
    return engine.decide(p, perm, sqlRecord(rec, p.uid, support), new Date(cases.NOW)).allow;
  }
  const wsOf = (support, tenant) => support !== "none" ? WS_A : tenant === "suspended" ? WS_SUS : tenant === "trial_expired" ? WS_TRIAL : WS_A;
  const actorOf = (role, support, tenant) =>
    support === "read_only" ? SUP_RO : support === "read_write" ? SUP_RW
      : tenant === "suspended" ? SU(role) : tenant === "trial_expired" ? TU(role) : AU(role);
  function objOf(role, support, tenant, rec) {
    if (rec === "none") return [null, null];
    if (rec === "foreign_ws") return ["lead", L_FOREIGN];
    if (support !== "none") return ["lead", L_OTHER];
    switch (rec) {
      case "own": return ["lead", tenant === "suspended" ? L_OWN_SUS(role) : tenant === "trial_expired" ? L_OWN_TRIAL(role) : L_OWN_A(role)];
      case "assigned": return ["lead", L_ASSIGNED_A(role)];
      case "team": return ["lead", L_TEAM];
      case "other": return ["lead", L_OTHER];
      case "unowned_in_district": return ["lead", L_UNOWNED_DIST];
      case "unowned_far": return ["lead", L_UNOWNED_FAR];
      case "shared_viewer": return ["lead", L_SHARED_VIEWER];
      case "shared_editor": return ["lead", L_SHARED_EDITOR];
      default: throw new Error("unmapped record " + rec);
    }
  }

  const tsRows = cases.buildMatrix();
  const cells = [];
  const push = (role, support, tenant, off, perm, rec) => {
    const i = cells.length;
    const ts = tsRows[i];
    if (ts[0] !== role || ts[4] !== perm || ts[5] !== rec) throw new Error(`sweep misalignment at ${i}: ${ts} vs ${role}/${perm}/${rec}`);
    const [otype, oid] = objOf(role, support, tenant, rec);
    cells.push({
      n: i, role, support, tenant, off: off.join(","), perm, rec,
      actor: actorOf(role, support, tenant), ws: wsOf(support, tenant), otype, oid,
      tsAllow: ts[6], sqlAllow: predict(role, support, tenant, off, perm, rec),
    });
  };
  for (const role of ROLES) for (const s of SUPPORT) for (const { key } of catalog.PERMISSIONS) for (const rec of ["none", "own", "other"]) push(role, s, "active", [], key, rec);
  for (const role of ROLES) for (const s of SUPPORT) for (const perm of DEEP_PERMS) for (const rec of Object.keys(cases.RECORDS)) push(role, s, "active", [], perm, rec);
  for (const role of ROLES) for (const t of ["suspended", "trial_expired"]) for (const perm of ["leads.read", "leads.write", "settings.read"]) push(role, "none", t, [], perm, "own");
  for (const role of ROLES) for (const [perm, mod] of MODULE_SWEEP) push(role, "none", "active", [mod], perm, "none");
  if (cells.length !== tsRows.length) throw new Error(`cell count ${cells.length} != matrix ${tsRows.length}`);

  const diverged = cells.filter((c) => c.tsAllow !== c.sqlAllow);
  return render({ cells, diverged, diffs: diffs ?? [] });
}

// ---------------------------------------------------------------- SQL text
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const b = (v) => (v ? "true" : "false");
const arr = (a) => (a && a.length ? `'{${a.join(",")}}'` : "'{}'");

function render({ cells, diverged, diffs }) {
  const SUPP = 6; // supplementary custom-role + team-scope assertions below
  const plan = cells.length + SUPP;
  const users = usersSeed();
  const divByReason = summariseDivergence(diverged);

  // cases insert, chunked
  const insertChunks = [];
  for (let i = 0; i < cells.length; i += 400) {
    const vals = cells.slice(i, i + 400).map((c) => {
      const descr = `[sql] row ${c.n} ${c.role}/${c.support}/${c.tenant}/mod=${c.off || "-"}/${c.perm}/${c.rec}`
        + (c.tsAllow !== c.sqlAllow ? ` [KNOWN TS-demo vs SQL divergence: fixture=${b(c.tsAllow)} sql=${b(c.sqlAllow)}]` : "");
      return `  (${c.n}, ${q(c.actor)}, ${q(c.ws)}, ${q(c.perm)}, ${c.otype ? q(c.otype) : "null"}, ${c.oid ? q(c.oid) : "null"}, ${arr(c.off ? c.off.split(",") : [])}, ${b(c.sqlAllow)}, ${b(c.tsAllow)}, ${q(descr)})`;
    }).join(",\n");
    insertChunks.push(`insert into pg_temp.cases (n, actor, ws, perm, otype, oid, modoff, expected, fixture, descr) values\n${vals};`);
  }

  // distinct actors in first-seen order
  const actors = [...new Set(cells.map((c) => c.actor))];
  const assertBlocks = actors.map((a) =>
    `select pg_temp.act(${q(a)});\n`
    + `select ok(pg_temp.eff(ws, perm, otype, oid, modoff) is not distinct from expected, descr)\n`
    + `  from pg_temp.cases where actor = ${q(a)} order by n;`).join("\n\n");

  return `${HEADER(cells.length, diverged.length, divByReason, diffs)}
begin;
select plan(${plan});

${SEED(users)}

-- ---------- impersonation + evaluators ----------
-- authz.check / authz.explain are SECURITY DEFINER: they resolve identity through (select auth.uid()) and bypass RLS,
-- so the DECISION depends only on the JWT sub, not on the caller's DB role. We therefore impersonate by setting the
-- request JWT alone (no 'set local role authenticated'), which keeps the generated 'select ok(...) from pg_temp.cases'
-- running as the table owner so it can read the case rows while authz.check still sees the impersonated user.
create function pg_temp.act(u uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
end $f$;

-- Tenant module gate (config MODULE_IDS -> resource). authz.check does NOT enforce tenant module toggles -- in
-- production the TS principal loader applies my_grants.policy.modules_off. We replicate that gate here so the module
-- sweep matches the TS engine; see the header's divergence notes.
create function pg_temp.module_of(p_perm text) returns text language sql immutable as $f$
  select case split_part(p_perm, '.', 1)
    when 'inbox' then 'inbox' when 'messages' then 'inbox' when 'ai' then 'ai'
    when 'integrations' then 'integrations' when 'webhooks' then 'integrations' when 'api_keys' then 'integrations'
    when 'segments' then 'audience' when 'audience' then 'audience' when 'analytics' then 'analytics'
    when 'tasks' then 'tasks' when 'accounts' then 'accounts' when 'contacts' then 'accounts'
    when 'campaigns' then 'campaigns' when 'data_health' then 'data-health' end
$f$;

create function pg_temp.eff(p_ws uuid, p_perm text, p_otype text, p_oid uuid, p_modoff text[]) returns boolean
language sql stable as $f$
  select authz.check(p_ws, p_perm, p_otype, p_oid)
     and not (coalesce(array_length(p_modoff, 1), 0) > 0 and pg_temp.module_of(p_perm) = any (p_modoff))
$f$;

create temporary table cases (
  n int, actor uuid, ws uuid, perm text, otype text, oid uuid, modoff text[],
  expected boolean, fixture boolean, descr text
) on commit drop;

${insertChunks.join("\n")}

-- ---------- generated parity assertions (one per matrix.json cell, grouped by acting user) ----------
${assertBlocks}

-- ---------- supplementary: a custom role (RBAC + ABAC conditions) and team / managed-team scope (ReBAC) ----------
-- The generated matrix above covers the six SYSTEM roles only; these ${SUPP} cells exercise the custom-role, conditions
-- and team-scope dimensions the acceptance criteria require but the system-role sweep does not reach.
select pg_temp.act(${q(CUSTOM_USER)});
select ok(authz.check(${q(WS_A)}, 'leads.read', 'lead', ${q(L_CUSTOM)}), 'custom role district_writer: reads leads at scope all');
select ok(authz.check(${q(WS_A)}, 'leads.write', 'lead', ${q(L_CUSTOM)}), 'custom role district_writer: writes a lead in its own district (condition passes)');
select ok(not authz.check(${q(WS_A)}, 'leads.write', 'lead', ${q(L_UNOWNED_FAR)}), 'custom role district_writer: cannot write a lead in another district (condition fails)');
select is(authz.explain(${q(WS_A)}, 'leads.write', 'lead', ${q(L_UNOWNED_FAR)})->>'reason', 'condition_failed', 'custom role district_writer: explain reports condition_failed');
select pg_temp.act(${q(TEAM_MGR)});
select ok(authz.check(${q(WS_A)}, 'leads.read', 'lead', ${q(L_TEAMMEMBER)}), 'custom role team_reader: reads a managed-team member lead (scope team)');
select ok(not authz.check(${q(WS_A)}, 'leads.read', 'lead', ${q(L_OTHER)}), 'custom role team_reader: cannot read a lead outside its team');

select * from finish();
rollback;
`;
}

function summariseDivergence(diverged) {
  const by = {};
  for (const c of diverged) {
    const k = `${c.role} ${c.perm} (${b(c.tsAllow)}->${b(c.sqlAllow)})`;
    by[k] = (by[k] ?? 0) + 1;
  }
  return Object.entries(by).sort().map(([k, n]) => `--     ${k}: ${n} cell(s)`).join("\n");
}

function HEADER(total, nDiverged, divByReason, diffs) {
  const diffLines = diffs.map((d) => `--     ${d.role} ${d.perm}: TS systemGrants=${d.ts}  SQL SYSTEM_ROLES=${d.sql}`).join("\n");
  return `-- pgTAP parity suite for the authorization matrix (task T057, BUILD-PLAN T057).
-- Run on the Supabase BRANCH database: node scripts/run-pgtap.mjs supabase/tests/authz_matrix.test.sql
-- (or \`supabase test db\`). Everything runs inside one transaction and is rolled back; nothing persists.
--
-- GENERATED by scripts/gen-authz-matrix.mjs from the TypeScript engine -- DO NOT EDIT BY HAND. Re-run the generator
-- (node scripts/gen-authz-matrix.mjs) after any change to the authz catalogue, system roles or engine. CI runs
-- \`node scripts/gen-authz-matrix.mjs --check\` to prove this file and matrix.json are not stale.
--
-- WHAT THIS GUARANTEES: for every one of the ${total} cells of src/lib/authz/__fixtures__/matrix.json, the SQL
-- evaluator authz.check() makes the SAME allow/deny decision as the shared engine logic evaluated over the grants the
-- SQL side actually holds (role_permissions, seeded from SYSTEM_ROLES). A failing cell prints its row number, role,
-- support state, tenant, module and record relationship, so the exact disagreeing combination is named.
--
-- KNOWN TS-demo vs SQL DIVERGENCES (${nDiverged} of ${total} cells): the committed matrix.json fixture is built from the
-- DEMO engine's systemGrants() (src/lib/authz/system-grants.ts), while the SQL side reads role_permissions seeded from
-- SYSTEM_ROLES (src/lib/authz/catalog/system-roles.ts). These two grant tables were never reconciled -- system-grants.ts
-- still carries the note "TEMPORARY HOME ... when [system-roles.ts] lands, swap systemGrants to read it", a swap that
-- has not happened. So the demo app under-grants relative to the real/SQL authorization. Cells where the two disagree
-- are asserted against the SQL prediction and tagged "[KNOWN TS-demo vs SQL divergence: fixture=.. sql=..]" in their
-- description. Grant-table differences that drive them (${diffs.length}):
${diffLines || "--     (none)"}
-- Resulting cell divergences, grouped:
${divByReason || "--     (none)"}
--
-- Three further gaps are handled in the harness, not by authz.check, and are documented so a reviewer is not surprised:
--   1. Tenant module toggles: authz.check does not read org_admin_policies.allowed_modules / modules_off; the TS
--      principal loader applies them. pg_temp.eff() re-applies the module gate so the module sweep matches the fixture.
--   2. Trial / read-only org state: authz has no 'trial' tenant status (public.tenants.status is active|suspended|
--      archived). The trial_expired sweep is seeded as an 'archived' tenant, which authz.check treats identically to
--      the TS org_readonly state (writes denied, reads allowed) -- the same allow/deny the fixture records.
--   3. The leads table has no assignee_id column and a support session is not a workspace member, so the 'assigned'
--      relationship and relationship-tuple shares do not apply to lead objects under those actors; the SQL prediction
--      strips them, and any resulting difference from the fixture is counted among the divergences above.
--
-- WRITTEN, NOT RUN: this environment has no SUPABASE_DB_URL / branch database, so the suite has not been executed here
-- (the same gap every pgTAP task in this repo has hit). It is release-blocking that it be run on a real branch DB
-- before T057 is considered done.
`;
}

// ---------------------------------------------------------------- seed
function usersSeed() {
  const list = [];
  for (const r of ROLES) { list.push([AU(r), r + "-active"]); list.push([SU(r), r + "-suspended"]); list.push([TU(r), r + "-trial"]); }
  list.push([U_OTHER, "other"], [SUP_RO, "support-ro"], [SUP_RW, "support-rw"], [CUSTOM_USER, "custom"], [TEAM_MGR, "team-mgr"], [TEAM_MEMBER, "team-member"]);
  return list;
}

function SEED(users) {
  const userVals = users.map(([id, tag]) => `  (${q(id)}, ${q("authzm-" + tag + "@verify.example")}, now(), 'authenticated', 'authenticated')`).join(",\n");
  const memberVals = [
    ...ROLES.map((r) => `  (${q(AU(r))}, ${q(WS_A)}, ${q(r)})`),
    ...ROLES.map((r) => `  (${q(SU(r))}, ${q(WS_SUS)}, ${q(r)})`),
    ...ROLES.map((r) => `  (${q(TU(r))}, ${q(WS_TRIAL)}, ${q(r)})`),
    `  (${q(U_OTHER)}, ${q(WS_A)}, 'viewer')`,
    `  (${q(TEAM_MEMBER)}, ${q(WS_A)}, 'sales_rep')`,
  ].join(",\n");

  // WS_A leads: fixed relationship rows + per-active-role own/assigned + custom/team leads.
  const leadRows = [
    `  (${q(L_OTHER)}, ${q(WS_A)}, 'Lead Other', null)`,
    `  (${q(L_TEAM)}, ${q(WS_A)}, 'Lead Team', null)`,
    `  (${q(L_UNOWNED_DIST)}, ${q(WS_A)}, 'Lead Unowned Madurai', 'Madurai')`,
    `  (${q(L_UNOWNED_FAR)}, ${q(WS_A)}, 'Lead Unowned Chennai', 'Chennai')`,
    `  (${q(L_SHARED_VIEWER)}, ${q(WS_A)}, 'Lead Shared Viewer', null)`,
    `  (${q(L_SHARED_EDITOR)}, ${q(WS_A)}, 'Lead Shared Editor', null)`,
    `  (${q(L_CUSTOM)}, ${q(WS_A)}, 'Lead Custom Madurai', 'Madurai')`,
    `  (${q(L_TEAMMEMBER)}, ${q(WS_A)}, 'Lead Team Member', null)`,
    ...ROLES.map((r) => `  (${q(L_OWN_A(r))}, ${q(WS_A)}, 'Own ${r}', null)`),
    ...ROLES.map((r) => `  (${q(L_ASSIGNED_A(r))}, ${q(WS_A)}, 'Assigned ${r}', null)`),
    `  (${q(L_FOREIGN)}, ${q(WS_B)}, 'Lead Foreign', null)`,
    ...ROLES.map((r) => `  (${q(L_OWN_SUS(r))}, ${q(WS_SUS)}, 'Own sus ${r}', null)`),
    ...ROLES.map((r) => `  (${q(L_OWN_TRIAL(r))}, ${q(WS_TRIAL)}, 'Own trial ${r}', null)`),
  ].join(",\n");

  const ownerUpdates = [
    `update public.leads set owner_id = ${q(U_OTHER)} where id in (${q(L_OTHER)}, ${q(L_SHARED_VIEWER)}, ${q(L_SHARED_EDITOR)}, ${q(L_CUSTOM)});`,
    `update public.leads set owner_id = ${q(AU("sales_rep"))} where id = ${q(L_TEAM)};`,
    `update public.leads set owner_id = ${q(TEAM_MEMBER)} where id = ${q(L_TEAMMEMBER)};`,
    `update public.leads set owner_id = null where id in (${q(L_UNOWNED_DIST)}, ${q(L_UNOWNED_FAR)}, ${q(L_FOREIGN)});`,
    ...ROLES.map((r) => `update public.leads set owner_id = ${q(AU(r))} where id = ${q(L_OWN_A(r))};`),
    ...ROLES.map((r) => `update public.leads set owner_id = ${q(SU(r))} where id = ${q(L_OWN_SUS(r))};`),
    ...ROLES.map((r) => `update public.leads set owner_id = ${q(TU(r))} where id = ${q(L_OWN_TRIAL(r))};`),
  ].join("\n");

  const shareTuples = ROLES.map((r) =>
    `  (${q(WS_A)}, 'lead', ${q(L_SHARED_VIEWER)}, 'viewer', 'user', ${q(AU(r))}),\n`
    + `  (${q(WS_A)}, 'lead', ${q(L_SHARED_EDITOR)}, 'editor', 'user', ${q(AU(r))})`).join(",\n");

  return `-- ---------- fixture (seeded as the migration owner; auth.uid() is null here so membership guards pass) ----------
insert into public.tenants (id, slug, name, brand_name, status) values
  (${q(T_A)}, 'authzm-a', 'Authz Matrix A', 'A', 'active'),
  (${q(T_B)}, 'authzm-b', 'Authz Matrix B', 'B', 'active'),
  (${q(T_SUS)}, 'authzm-sus', 'Authz Matrix Suspended', 'S', 'suspended'),
  (${q(T_TRIAL)}, 'authzm-trial', 'Authz Matrix Trial', 'T', 'archived');  -- 'archived' stands in for the trial-expired / read-only org state (authz has no 'trial' status)
insert into public.workspaces (id, tenant_id, name, slug) values
  (${q(WS_A)}, ${q(T_A)}, 'WS A', 'authzm-ws-a'),
  (${q(WS_B)}, ${q(T_B)}, 'WS B', 'authzm-ws-b'),
  (${q(WS_SUS)}, ${q(T_SUS)}, 'WS Suspended', 'authzm-ws-sus'),
  (${q(WS_TRIAL)}, ${q(T_TRIAL)}, 'WS Trial', 'authzm-ws-trial');
insert into auth.users (id, email, email_confirmed_at, aud, role) values
${userVals};
insert into public.profiles (id, full_name, email)
select id, 'Authz ' || right(id::text, 4), email from auth.users where email like 'authzm-%@verify.example'
on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
${memberVals};
insert into public.platform_admins (user_id, platform_role) values
  (${q(SUP_RO)}, 'super_admin'), (${q(SUP_RW)}, 'super_admin');
insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at) values
  (${q(SUP_RO)}, ${q(WS_A)}, 'T057 authz matrix read-only support session fixture row', 'read_only', now() + interval '30 minutes'),
  (${q(SUP_RW)}, ${q(WS_A)}, 'T057 authz matrix read-write support session fixture row', 'read_write', now() + interval '30 minutes');
insert into public.territories (workspace_id, district, rep_id) values
  (${q(WS_A)}, 'Madurai', ${q(AU("sales_rep"))});
insert into public.leads (id, workspace_id, full_name, district) values
${leadRows};
${ownerUpdates}
insert into public.relationship_tuples (workspace_id, object_type, object_id, relation, subject_type, subject_id) values
${shareTuples};

-- custom role: district_writer (leads.read all, leads.write all but only in the member's own districts) for CUSTOM_USER.
insert into public.roles (id, tenant_id, key, name, base_role) values
  (${q(ROLE_DISTRICT_WRITER)}, ${q(T_A)}, 'district_writer', 'District writer', 'sales_rep');
insert into public.role_permissions (role_id, permission_key, scope, conditions) values
  (${q(ROLE_DISTRICT_WRITER)}, 'leads.read', 'all', '{}'),
  (${q(ROLE_DISTRICT_WRITER)}, 'leads.write', 'all', '{"all":[{"field":"record.district","op":"in","value":"@principal.attrs.districts"}]}');
insert into public.memberships (user_id, workspace_id, role) values (${q(CUSTOM_USER)}, ${q(WS_A)}, 'sales_rep');
update public.memberships set role_id = ${q(ROLE_DISTRICT_WRITER)}, attributes = '{"districts":["Madurai"]}' where user_id = ${q(CUSTOM_USER)};

-- custom role: team_reader (leads.read at scope team) + a team the member manages, holding TEAM_MEMBER.
insert into public.roles (id, tenant_id, key, name, base_role) values
  (${q(ROLE_TEAM_READER)}, ${q(T_A)}, 'team_reader', 'Team reader', 'sales_manager');
insert into public.role_permissions (role_id, permission_key, scope) values (${q(ROLE_TEAM_READER)}, 'leads.read', 'team');
insert into public.memberships (user_id, workspace_id, role) values (${q(TEAM_MGR)}, ${q(WS_A)}, 'sales_manager');
update public.memberships set role_id = ${q(ROLE_TEAM_READER)} where user_id = ${q(TEAM_MGR)};
insert into public.teams (id, workspace_id, name, parent_team_id) values (${q(TEAM_PARENT)}, ${q(WS_A)}, 'Authz Team', null);
insert into public.team_members (team_id, user_id, is_manager) values
  (${q(TEAM_PARENT)}, ${q(TEAM_MGR)}, true),
  (${q(TEAM_PARENT)}, ${q(TEAM_MEMBER)}, false);`;
}
