import { describe, expect, it } from "vitest";
import { formatRequestError } from "../request-error";

describe("formatRequestError", () => {
  it("quotes digest, class, route and a truncated message", () => {
    const line = formatRequestError({ name: "RangeError", message: "Invalid time value\n  at x", digest: "2100523607" }, { path: "/ai", method: "GET" }, { routePath: "/ai", routeType: "render" });
    expect(line).toContain("digest=2100523607");
    expect(line).toContain("class=RangeError");
    expect(line).toContain("route=/ai");
    expect(line).toContain('message="Invalid time value at x"');
  });
  it("tolerates a bare error", () => {
    expect(formatRequestError({}, {}, {})).toContain("digest=none");
    expect(formatRequestError({ message: "x".repeat(900) }, {}, {}).length).toBeLessThan(500);
  });
});
