import { describe, expect, it } from "vitest";
import { fieldInputSchema } from "../defs";

describe("fieldInputSchema: the blank editor draft", () => {
  it("accepts empty optional help text (the editor submits help.en and help.ta as empty strings)", () => {
    const r = fieldInputSchema.safeParse({
      objectKey: "lead", key: "where_we_met", label: { en: "Where we met", ta: "" }, type: "text", section: "", required: false, uniqueInWorkspace: false,
      isPii: false, isSearchable: false, isFilterable: true, choices: [], help: { en: "", ta: "" }, validation: {}, viewRoles: [], editRoles: [], editablePerm: null,
    });
    expect(r.success).toBe(true);
  });
  it("still requires a label", () => {
    const r = fieldInputSchema.safeParse({ objectKey: "lead", key: "x_y", label: { en: "" }, type: "text", help: { en: "" } });
    expect(r.success).toBe(false);
  });
});
