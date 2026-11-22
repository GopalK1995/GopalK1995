// T058 · Every /api/v1 object route returns 404 (never 403) for another tenant's record ids when called with this
// tenant's key — a 403 would confirm the id exists. Broadens cypress/e2e/api/cross-tenant-404.cy.ts (leads only) to
// the full set of CRUD objects plus the generic /records/<object>/<id> route. Real mode only. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, requireMode, stamp } from "./_helpers";

// Objects whose create body is a single known field, so one foreign row can be made per object.
const OBJECTS: { object: string; create: Record<string, unknown> }[] = [
  { object: "leads", create: { full_name: "Foreign Lead" } },
  { object: "contacts", create: { full_name: "Foreign Contact" } },
  { object: "accounts", create: { name: "Foreign Account" } },
];

describe("isolation: /api/v1 object routes are 404 across tenants", () => {
  it("real: another tenant's ids are 404 on the typed route, the generic route, read, update and delete", function () {
    requireMode(this, "real");
    // 1. As tenant B (Shola Mist), create one row of each object and remember its id.
    loginOrSkip(this, "SHOLA");
    const foreign: Record<string, string> = {};
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["leads:write", "contacts:write", "accounts:write"] }).then((bKey) => {
      const bh = bearer(bKey);
      cy.wrap(OBJECTS).each((o: (typeof OBJECTS)[number]) => {
        cy.request({ method: "POST", url: api(`/${o.object}`), headers: bh, body: o.create }).then((c) => {
          foreign[o.object] = c.body.data.id as string;
        });
      });
    });
    // 2. As tenant A (owner), every one of B's ids must look like it does not exist.
    cy.then(() => loginOrSkip(this, "OWNER"));
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["leads:write", "contacts:write", "accounts:write"] }).then((aKey) => {
      const ah = bearer(aKey);
      cy.wrap(OBJECTS).each((o: (typeof OBJECTS)[number]) => {
        const id = foreign[o.object];
        const routes = [api(`/${o.object}/${id}`), api(`/records/${o.object}/${id}`)];
        for (const base of routes) {
          for (const method of ["GET", "PATCH", "DELETE"] as const) {
            cy.request({
              method, url: base, headers: ah,
              body: method === "PATCH" ? { } : undefined, failOnStatusCode: false,
            }).then((r) => {
              expect(r.status, `${method} ${base}`).to.eq(404);
              expect(r.body.code, `${method} ${base}`).to.eq("not_found");
            });
          }
        }
        // the collection filter must also never surface the foreign row.
        cy.request({ url: api(`/${o.object}?filter[id]=${id}`), headers: ah, failOnStatusCode: false })
          .its("body.data").should("have.length", 0);
      });
    });
  });

  it("real: an unknown object name is a clean 404, not a 500", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["leads:write"] }).then((aKey) => {
      cy.request({ url: api("/records/not_a_real_object/00000000-0000-4000-8000-000000000000"), headers: bearer(aKey), failOnStatusCode: false })
        .then((r) => { expect(r.status).to.be.oneOf([404]); });
    });
  });
});
