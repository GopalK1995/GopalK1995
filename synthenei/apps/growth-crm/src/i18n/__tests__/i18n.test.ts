import { describe, it, expect } from "vitest";
import { messagesFor, mergeMessages } from "../layering";
import { resolveLocale } from "../config";
import { BASE } from "../registry";
import { formatters } from "@/lib/format";
import review from "../../../messages/ta/_review.json";

const get = (m: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], m);

describe("messagesFor layering precedence", () => {
  it("base < preset < tenant locale override < metadata labels", () => {
    const m = messagesFor("ta", {
      presetVocabulary: { common: { save: "PRESET", edit: "PRESET-EDIT" } },
      vocabulary: { i18n: { ta: { common: { save: "TENANT-TA" } }, en: { common: { save: "TENANT-EN" } } } },
    }, { stage_won: { en: "Won", ta: "வென்றது" }, only_en: { en: "Only" } });
    expect(get(m, "common.save")).toBe("TENANT-TA");
    expect(get(m, "common.edit")).toBe("PRESET-EDIT");
    expect(get(m, "common.cancel")).toBe(get(BASE.ta, "common.cancel"));
    expect(get(m, "labels.stage_won")).toBe("வென்றது");
    expect(get(m, "labels.only_en")).toBe("Only");
  });
  it("English is the default and untouched without config", () => {
    expect(messagesFor("en")).toEqual(BASE.en);
  });
  it("missing Tamil key falls back to English", () => {
    const m = messagesFor("ta", undefined, undefined, { en: { x: { a: "A", b: "B" } }, ta: { x: { a: "அ" } } });
    expect(get(m, "x.a")).toBe("அ");
    expect(get(m, "x.b")).toBe("B");
  });
  it("mergeMessages does not mutate inputs", () => {
    const a = { n: { k: "1" } }; mergeMessages(a, { n: { k: "2" } });
    expect(a.n.k).toBe("1");
  });
});

describe("locale resolution", () => {
  it("profile, then cookie, then en", () => {
    expect(resolveLocale("ta", "en", true)).toBe("ta");
    expect(resolveLocale(null, "ta", true)).toBe("ta");
    expect(resolveLocale("fr", undefined, true)).toBe("en");
  });
  it("Tamil stays off while the review gate is closed", () => {
    expect(resolveLocale("ta", "ta", false)).toBe("en");
  });
});

describe("Tamil drafts", () => {
  it("every ta key is flagged _review and has an en counterpart", () => {
    expect(review._review).toBe(true);
    for (const ns of Object.keys(BASE.ta)) {
      for (const k of Object.keys(BASE.ta[ns] as object)) {
        expect(get(review.keys, `${ns}.${k}`)).toBe(true);
        expect(get(BASE.en, `${ns}.${k}`)).toBeTypeOf("string");
      }
    }
  });
});

describe("formatters", () => {
  const norm = (s: string) => s.replace(/ /g, " ");
  it("INR lakh/crore grouping in en-IN and ta-IN", () => {
    expect(norm(formatters("en").inr(1234567))).toBe("₹12,34,567");
    expect(norm(formatters("ta").inr(1234567))).toBe("₹12,34,567");
    expect(formatters("en").number(10000000)).toBe("1,00,00,000");
  });
  it("dates render in IST", () => {
    expect(formatters("en").time("2026-01-01T00:00:00Z")).toMatch(/5:30/);
  });
});
