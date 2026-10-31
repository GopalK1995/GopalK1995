// A member subscribing to another workspace's topic must be refused by the realtime.messages policy (0018). Uses the cy.task
// "realtimeJoin" ({ token, topic } -> status string from a realtime-js private channel). NOT part of this change
// (docs/tasks/T026.md, Needs from integrator); skipped unless CYPRESS_QA_HAS_REALTIME_JOIN_TASK=1. Written, NOT run.
import { cred, peerToken } from "./_helpers";

const FOREIGN_WS = "00000000-0000-4000-8000-00000000dead";

describe("realtime: foreign topic denied", () => {
  beforeEach(function () {
    if (!Cypress.expose("QA_HAS_REALTIME_JOIN_TASK") || !cred("REP").email) this.skip();
  });

  it("subscribing to a workspace I am not a member of fails", () => {
    peerToken("REP").then((token) => {
      cy.task("realtimeJoin", { token, topic: `ws:${FOREIGN_WS}:tbl:deals` }).should("not.equal", "SUBSCRIBED");
      cy.task("realtimeJoin", { token, topic: `ws:${FOREIGN_WS}:rec:lead:x` }).should("not.equal", "SUBSCRIBED");
    });
  });

  it("a topic without the ws: prefix is not joinable either", () => {
    peerToken("REP").then((token) => {
      cy.task("realtimeJoin", { token, topic: "public:anything" }).should("not.equal", "SUBSCRIBED");
    });
  });
});
