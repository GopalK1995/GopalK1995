import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn with the custom type scale", () => {
  it("keeps a custom text size next to a text colour", () => {
    expect(cn("text-12", "text-ink-2")).toBe("text-12 text-ink-2");
    expect(cn("text-ink-2", "text-13")).toBe("text-ink-2 text-13");
  });
  it("lets a later size replace an earlier size", () => {
    expect(cn("text-12", "text-14")).toBe("text-14");
  });
  it("still merges ordinary conflicting utilities", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
