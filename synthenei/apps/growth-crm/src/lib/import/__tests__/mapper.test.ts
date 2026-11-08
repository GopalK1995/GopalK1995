// @vitest-environment node
import { describe, expect, it } from "vitest";
import { autoMap, checkMapping, cleanValue, mapRow } from "../mapper";
import { SYSTEM_TARGETS, targetsFor } from "../targets";
import type { TargetField } from "../types";

const labels: Record<string, string> = { fullName: "Full name", phone: "Phone", email: "Email", organisation: "Organisation", roleTitle: "Role or title", city: "City", district: "District", source: "Source", category: "Category", consentMarketing: "Marketing consent", consentWhatsapp: "WhatsApp consent" };
const leadTargets = targetsFor("lead", (k) => labels[k] ?? k);
const custom: TargetField = { key: "custom.budget", label: "Budget", kind: "number" };
const pick = (k: string) => leadTargets.find((t) => t.key === k) as TargetField;

describe("autoMap", () => {
  it("matches labels and aliases, one target per column", () => {
    const m = autoMap(["Name", "Mobile", "E-mail", "Company", "Town", "Notes"], leadTargets);
    expect(m).toEqual({ Name: "full_name", Mobile: "phone", "E-mail": "email", Company: "firm_name", Town: "city", Notes: "" });
  });
  it("does not reuse a target", () => {
    const m = autoMap(["Phone", "Mobile"], leadTargets);
    expect(Object.values(m).filter((v) => v === "phone")).toHaveLength(1);
  });
  it("saved mappings win and unknown saved targets are ignored", () => {
    const m = autoMap(["Ref", "Ghost"], leadTargets, { Ref: "source", Ghost: "no_such_field" });
    expect(m).toEqual({ Ref: "source", Ghost: "" });
  });
  it("maps custom fields by key or label", () => {
    expect(autoMap(["budget"], [...leadTargets, custom])).toEqual({ budget: "custom.budget" });
  });
});

describe("checkMapping", () => {
  it("needs a name and a way to reach a lead", () => {
    expect(checkMapping({ A: "full_name" }, leadTargets, "lead")).toMatchObject({ ok: false, missingRequired: ["email|phone"] });
    expect(checkMapping({ A: "full_name", B: "phone" }, leadTargets, "lead").ok).toBe(true);
    expect(checkMapping({ B: "phone" }, leadTargets, "lead").missingRequired).toContain("full_name");
  });
  it("flags a field mapped twice", () => {
    expect(checkMapping({ A: "full_name", B: "email", C: "email" }, leadTargets, "lead")).toMatchObject({ ok: false, duplicates: ["email"] });
  });
  it("accounts need only a name", () => {
    const acc = targetsFor("account", (k) => k);
    expect(checkMapping({ A: "name" }, acc, "account").ok).toBe(true);
  });
});

describe("cleanValue", () => {
  it("phones and emails", () => {
    expect(cleanValue("98765 43210", pick("phone"))).toEqual({ ok: true, value: "+919876543210" });
    expect(cleanValue("12", pick("phone"))).toEqual({ ok: false, reason: "phone_invalid" });
    expect(cleanValue("A@B.com", pick("email"))).toEqual({ ok: true, value: "a@b.com" });
  });
  it("numbers, booleans, dates", () => {
    expect(cleanValue("1,20,000", custom)).toEqual({ ok: true, value: 120000 });
    expect(cleanValue("abc", custom)).toEqual({ ok: false, reason: "number_invalid" });
    expect(cleanValue("Yes", pick("consent_marketing"))).toEqual({ ok: true, value: true });
    expect(cleanValue("maybe", pick("consent_marketing"))).toEqual({ ok: false, reason: "boolean_invalid" });
    const d: TargetField = { key: "custom.d", label: "d", kind: "date" };
    expect(cleanValue("05/11/2026", d)).toEqual({ ok: true, value: "2026-11-05" });
    expect(cleanValue("2026-02-30", d)).toEqual({ ok: false, reason: "date_invalid" });
  });
  it("select by key or label, urls", () => {
    const s: TargetField = { key: "custom.s", label: "s", kind: "select", choices: ["gold", "Gold tier"] };
    expect(cleanValue("GOLD", s)).toEqual({ ok: true, value: "gold" });
    expect(cleanValue("bronze", s)).toEqual({ ok: false, reason: "choice_invalid" });
    const u: TargetField = { key: "website", label: "w", kind: "url" };
    expect(cleanValue("example.com", u)).toEqual({ ok: true, value: "https://example.com/" });
    expect(cleanValue("javascript:alert(1)", u).ok).toBe(false);
  });
});

describe("mapRow", () => {
  it("separates system and custom values, skips blanks, reports issues", () => {
    const t = [...leadTargets, custom];
    const r = mapRow({ N: "Asha", P: "bad", B: "5000", E: "" }, { N: "full_name", P: "phone", B: "custom.budget", E: "email" }, t);
    expect(r.record).toEqual({ full_name: "Asha" });
    expect(r.custom).toEqual({ budget: 5000 });
    expect(r.issues).toEqual([{ field: "phone", reason: "phone_invalid", value: "bad" }]);
  });
  it("system target list exposes only real columns", () => {
    for (const k of Object.keys(SYSTEM_TARGETS)) expect(SYSTEM_TARGETS[k as "lead"].every((x) => /^[a-z_]+$/.test(x.key))).toBe(true);
  });
});
