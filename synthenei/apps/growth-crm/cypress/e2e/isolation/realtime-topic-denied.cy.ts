// T058 · A tenant-A principal cannot subscribe to a realtime topic belonging to tenant B. realtime.messages (migration
// 0018) authorises a topic join against authz.ws_with_member; the membership proof is in
// supabase/tests/isolation_all_tables.test.sql section 3b.2. This spec drives the actual realtime-js join via the
// cy.task "realtimeJoin" ({ token, topic } -> status), the same task cypress/e2e/realtime/foreign-topic-denied.cy.ts uses
// (owned by T026, see docs/tasks/T026.md "Needs from integrator"). Skipped unless CYPRESS_QA_HAS_REALTIME_JOIN_TASK=1
// and a foreign workspace uuid is provided. Written, NOT run in light mode.
import { peerToken, requireMode } from "./_helpers";

const foreignWs = () => (Cypress.expose("QA_FOREIGN_WS") as string | undefined) ?? "00000000-0000-4000-8000-00000000dead";

describe("isolation: realtime topic subscribe is membership-scoped", () => {
  beforeEach(function () {
    requireMode(this, "real");
    if (!Cypress.expose("QA_HAS_REALTIME_JOIN_TASK")) this.skip();
  });

  it("tenant A's token cannot join tenant B's table or record topics", () => {
    peerToken("OWNER").then((token) => {
      cy.task("realtimeJoin", { token, topic: `ws:${foreignWs()}:tbl:leads` }).should("not.equal", "SUBSCRIBED");
      cy.task("realtimeJoin", { token, topic: `ws:${foreignWs()}:tbl:deals` }).should("not.equal", "SUBSCRIBED");
      cy.task("realtimeJoin", { token, topic: `ws:${foreignWs()}:rec:lead:x` }).should("not.equal", "SUBSCRIBED");
    });
  });

  it("a topic without the ws: prefix is not joinable", () => {
    peerToken("OWNER").then((token) => {
      cy.task("realtimeJoin", { token, topic: "public:anything" }).should("not.equal", "SUBSCRIBED");
    });
  });
});
