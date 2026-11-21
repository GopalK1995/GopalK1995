import { describe, expect, it } from "vitest";
import { MAX_QUERY, likePattern, sanitizeQuery } from "../sanitize";

describe("sanitizeQuery", () => {
  it("trims, collapses whitespace and keeps ordinary names", () => {
    expect(sanitizeQuery("  Vaigai   Advocates ").q).toBe("Vaigai Advocates");
    expect(sanitizeQuery("Adv. K.K. Nagar").q).toBe("Adv. K.K. Nagar");
    expect(sanitizeQuery("வைகை").q).toBe("வைகை");
  });
  it("removes everything that can change a PostgREST filter or a LIKE pattern", () => {
    const { q } = sanitizeQuery("a,b)or(id.neq.0 \"x\" 100%_ \\ * ; <script>");
    expect(q).not.toMatch(/[,()"%_\\*;<>]/);
    expect(q).toBe("a b or id.neq.0 x 100 script");
  });
  it("strips control and zero-width characters", () => {
    expect(sanitizeQuery("ab\u0000c​d\n e").q).toBe("ab c d e");
  });
  it("caps the length", () => { expect(sanitizeQuery("x".repeat(500)).q).toHaveLength(MAX_QUERY); });
  it("flags one-character queries and ignores non-strings", () => {
    expect(sanitizeQuery("a")).toEqual({ q: "a", tooShort: true });
    expect(sanitizeQuery("ab").tooShort).toBe(false);
    expect(sanitizeQuery(null)).toEqual({ q: "", tooShort: false });
    expect(sanitizeQuery(["a", "b"]).q).toBe("");
  });
  it("a query of only punctuation becomes empty", () => { expect(sanitizeQuery(",,()").q).toBe(""); });
  it("builds an ilike pattern", () => { expect(likePattern("abc")).toBe("*abc*"); });
});
