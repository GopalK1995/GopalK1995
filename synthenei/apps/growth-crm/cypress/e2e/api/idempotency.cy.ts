// Idempotency-Key on writes: replay, mismatch, and a single row. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: idempotency", () => {
  it("real: the same key and body create one lead and replay the response", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "sales manager", scopes: ["leads:write"] }).then((key) => {
      const idem = `idem-${stamp()}`;
      const full_name = `Idem ${stamp()}`;
      const req = (body: object) => cy.request({ method: "POST", url: api("/leads"), headers: { ...bearer(key), "idempotency-key": idem }, body, failOnStatusCode: false });
      req({ full_name }).then((first) => {
        expect(first.status).to.eq(201);
        req({ full_name }).then((second) => {
          expect(second.status).to.eq(201);
          expect(second.headers["idempotent-replayed"]).to.eq("true");
          expect(second.body.data.id).to.eq(first.body.data.id);
        });
        req({ full_name: "Different body" }).then((clash) => {
          expect(clash.status).to.eq(409);
          expect(clash.body.code).to.eq("conflict");
        });
        cy.request({ url: api(`/leads?filter[full_name]=${encodeURIComponent(full_name)}`), headers: bearer(key) }).its("body.data").should("have.length", 1);
      });
    });
  });
});
