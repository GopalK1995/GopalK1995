// Sample files for the demo workspace: the import dialog runs end to end against these and saves nothing.
// Generic fictional names only. The "existing" rows give the dedupe step something to find.
import { indexRow } from "./dedupe";
import { emptyIndex, type ExistingIndex, type ImportObject } from "./types";

export const SAMPLE_CSV: Record<ImportObject, string> = {
  lead: [
    "Name,Mobile,Email,Company,City,Source",
    "Asha Menon,+91 98765 43210,asha.menon@example.com,Menon Traders,Coimbatore,Referral",
    "Ravi Kumar,98450 11223,ravi.kumar@example.com,Kumar Supplies,Madurai,Website",
    "Latha Iyer,,latha.iyer@example.com,Iyer Associates,Chennai,Event",
    "Vikram Das,12345,not-an-email,Das Stores,Salem,Website",
    "Asha Menon,+91 98765 43210,asha.menon@example.com,Menon Traders,Coimbatore,Referral",
    ",,,Unknown Co,Trichy,Website",
  ].join("\n"),
  contact: [
    "Name,Role,Email,Phone",
    "Meera Nair,Office manager,meera.nair@example.com,+91 90000 11111",
    "Karthik S,Partner,karthik.s@example.com,+91 90000 22222",
    "Karthik S,Partner,karthik.s@example.com,+91 90000 22222",
  ].join("\n"),
  account: [
    "Company,City,Website",
    "Menon Traders,Coimbatore,menon.example.com",
    "Kumar Supplies,Madurai,kumar.example.com",
    "Iyer Associates,Chennai,iyer.example.com",
    "menon traders,coimbatore,menon.example.com",
  ].join("\n"),
};

/** Records the demo workspace "already has", so one or two sample rows come out as duplicates. */
export function demoExisting(object: ImportObject): ExistingIndex {
  const idx = emptyIndex();
  if (object === "lead") indexRow("lead", { id: "demo-1", email: "ravi.kumar@example.com", phone: "+919845011223" }, idx);
  if (object === "contact") indexRow("contact", { id: "demo-2", email: "meera.nair@example.com", phone: "+919000011111" }, idx);
  if (object === "account") indexRow("account", { id: "demo-3", name: "Kumar Supplies", city: "Madurai" }, idx);
  return idx;
}
