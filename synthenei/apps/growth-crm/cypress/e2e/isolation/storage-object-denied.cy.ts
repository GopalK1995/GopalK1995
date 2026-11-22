// T058 · A storage object that belongs to tenant B cannot be read or listed by a tenant-A principal. The imports/wa-media
// buckets scope every object by the workspace uuid in its path (foldername[2] in authz.ws_with — migration 0021e); the
// authoritative RLS proof is supabase/tests/isolation_all_tables.test.sql section 3b.1. This spec exercises the storage
// HTTP API with tenant A's own access token. Real mode; needs CYPRESS_QA_FOREIGN_STORAGE_OBJECT (a path under tenant B's
// workspace, e.g. "iso/<wsB-uuid>/x.csv"). Written, NOT run in light mode.
import { anonKey, peerToken, requireMode, supaUrl } from "./_helpers";

const foreignObject = () => Cypress.expose("QA_FOREIGN_STORAGE_OBJECT") as string | undefined;

describe("isolation: storage objects are scoped to a workspace", () => {
  beforeEach(function () {
    requireMode(this, "real");
    if (!foreignObject()) this.skip();
  });

  it("downloading tenant B's object with tenant A's token is denied", () => {
    peerToken("OWNER").then((token) => {
      cy.request({
        url: `${supaUrl()}/storage/v1/object/imports/${foreignObject()}`,
        headers: { authorization: `Bearer ${token}`, apikey: anonKey() },
        failOnStatusCode: false,
      }).then((r) => { expect(r.status, "foreign object download").to.be.oneOf([400, 403, 404]); });
    });
  });

  it("listing tenant B's workspace folder with tenant A's token returns nothing", () => {
    const wsB = String(foreignObject()).split("/")[1]; // iso/<wsB-uuid>/x.csv -> wsB uuid
    peerToken("OWNER").then((token) => {
      cy.request({
        method: "POST", url: `${supaUrl()}/storage/v1/object/list/imports`,
        headers: { authorization: `Bearer ${token}`, apikey: anonKey() },
        body: { prefix: `iso/${wsB}/`, limit: 100 }, failOnStatusCode: false,
      }).then((r) => {
        expect(r.status).to.be.oneOf([200, 400, 403]);
        if (r.status === 200) expect(r.body, "no foreign objects listed").to.have.length(0);
      });
    });
  });
});
