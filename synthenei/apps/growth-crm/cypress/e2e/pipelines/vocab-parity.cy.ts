// T032 (written, NOT run): stages are data now, but the seeded legacy stages must read exactly as before in each vertical:
// legal words for the legal workspace, hospitality words for the guesthouse, in the board and in the editor.
import { boardHeadings, openEditor } from "./_helpers";

const LEGAL = ["Discovery", "Demo scheduled", "Demo done", "Proposal sent", "Negotiation", "Won", "Lost"];
const HOSPITALITY = ["Dates confirmed", "Quote sent", "Rooms on hold", "Advance pending", "Final confirmation", "Booked", "Lost"];
const texts = ($h: JQuery<HTMLElement>) => [...$h].map((h) => h.textContent?.trim());
const values = ($i: JQuery<HTMLElement>) => [...$i].map((i) => (i as HTMLInputElement).value);

describe("pipelines: vocabulary parity", () => {
  it("legal workspace: board columns and editor rows use the legal words in the legal order", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/pipeline");
    boardHeadings().should("have.length", 7).then(($h) => expect(texts($h)).to.deep.eq(LEGAL));
    openEditor();
    cy.get("[data-testid=stage-row] input[aria-label$=' name']").should(($i) => expect(values($i)).to.deep.eq(LEGAL));
  });

  it("hospitality workspace: the same stage ids read as the guesthouse words", () => {
    cy.loginAs("owner-shola");
    cy.visit("/pipeline");
    boardHeadings().should("have.length", 7).then(($h) => expect(texts($h)).to.deep.eq(HOSPITALITY));
    cy.get("[data-stage='discovery'] h2").should("have.text", "Dates confirmed"); // same internal id as the legal "Discovery"
    openEditor();
    cy.get("[data-testid=stage-row] input[aria-label$=' name']").should(($i) => expect(values($i)).to.deep.eq(HOSPITALITY));
  });

  it("no pipeline switcher is shown until a second pipeline exists", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/pipeline");
    cy.get("[data-stage]", { timeout: 30000 }).should("exist");
    cy.get("[data-testid=pipeline-switcher]").should("not.exist");
  });
});
