// Shared by the pipelines (T032) specs. Demo sessions: edits are kept in this browser (tenant config cookie), nothing reaches Supabase.
// Written, NOT run in light mode.
import { clickUntil } from "../../support/retry-click";

export const stageRows = () => cy.get("[data-testid=stage-row]");
/** Opens the pipelines editor and waits until it is hydrated (the first stage input exists and is enabled). */
export function openEditor(query = "") {
  cy.visit(`/settings/pipelines${query}`);
  cy.get("input[aria-label='Stage 1 name']", { timeout: 30000 }).should("be.enabled");
}
/** Add stage button, retried until a row appears (a click before hydration is a silent no-op). */
export function addStage(rowsBefore: number) {
  clickUntil(() => cy.contains("button", "Add stage"), ($b) => $b.find("[data-testid=stage-row]").length > rowsBefore);
  stageRows().should("have.length", rowsBefore + 1);
}
/** Save and wait for the confirmation toast; retried because the first click may land before hydration. */
export function saveStages() {
  clickUntil(() => cy.contains("button", "Save stages"), ($b) => /Stages saved/.test($b.text()));
  cy.contains(/Stages saved/).should("exist");
}
export const boardHeadings = () => cy.get("[data-stage] h2");
