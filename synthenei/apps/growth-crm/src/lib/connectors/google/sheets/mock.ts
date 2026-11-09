// Showcase gateway: one fictional spreadsheet, in memory, never touches the network. Selected for the sandbox token or APP_ENV=demo
// without credentials, refused in production. Names and emails are fictional (example.invalid); the sheet has a duplicate row and a
// bad email so the dedupe and validation steps have something to show.
import type { SheetsGateway } from "./gateway";

export const MOCK_SHEET_ID = "sample-spreadsheet-showcase";
const TAB = "Sample leads";
const VALUES: string[][] = [
  ["Name", "Mobile", "Email", "Company", "City", "Source"],
  ["Sample Person One", "+91 90000 10001", "person.one@example.invalid", "Sample Co One", "Sample City", "Website"],
  ["Sample Person Two", "+91 90000 10002", "person.two@example.invalid", "Sample Co Two", "Sample City", "Referral"],
  ["Sample Person Three", "", "person.three@example.invalid", "Sample Co Three", "Other City", "Event"],
  ["Sample Person One", "+91 90000 10001", "person.one@example.invalid", "Sample Co One", "Sample City", "Website"],
  ["Sample Person Four", "12345", "not-an-email", "Sample Co Four", "Other City", "Website"],
];

export function makeMockSheets(values: string[][] = VALUES): SheetsGateway & { kind: "mock" } {
  return {
    kind: "mock",
    async info() { return { title: "Sample spreadsheet", tabs: [{ title: TAB, rows: values.length, cols: values[0]?.length ?? 0 }] }; },
    async readRange() { return values.map((r) => [...r]); },
  };
}
