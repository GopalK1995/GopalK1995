// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normaliseEmail, normalisePhone } from "../phone";

describe("normalisePhone", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["(+91) 98765.43210", "+919876543210"],
    ["00919876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["9876543210.0", "+919876543210"],
    ["9.876543210E9", "+919876543210"],
    ["'9876543210", "+919876543210"],
  ])("%s -> %s", (raw, out) => expect(normalisePhone(raw)).toBe(out));

  it("accepts numbers typed as numbers (spreadsheet cells)", () => expect(normalisePhone(9876543210)).toBe("+919876543210"));
  it("keeps other countries when a prefix is given", () => expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958"));
  it("uses the region for numbers without a prefix", () => expect(normalisePhone("2079460958", "GB")).toBe("+442079460958"));
  it.each(["", "   ", null, undefined, "12345", "abcdefghij", "1234567890123456789", "98765"])("rejects %s", (raw) => expect(normalisePhone(raw as never)).toBeNull());
  it("rejects a number that is the wrong length for its country", () => expect(normalisePhone("+91 12345")).toBeNull());
});

describe("normaliseEmail", () => {
  it("lower-cases and trims", () => expect(normaliseEmail("  Asha.Menon@Example.COM ")).toBe("asha.menon@example.com"));
  it.each(["", "nope", "a@b", "a b@c.com", "a@b.c", "x@y.com, z@y.com"])("rejects %s", (v) => expect(normaliseEmail(v)).toBeNull());
});
