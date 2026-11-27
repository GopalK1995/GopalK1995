import { describe, expect, it } from "vitest";
import { classifyError } from "../cause";
import { GrantsUnavailableError } from "@/lib/authz/errors";

describe("classifyError", () => {
  it("a permission lookup outage is transient (retryable), not an unknown failure", () => {
    expect(classifyError(new GrantsUnavailableError("rpc_error"))).toBe("database");
  });
  it("keeps the existing classes", () => {
    expect(classifyError(new Error("billing not configured"))).toBe("unconfigured");
    expect(classifyError(new Error("permission denied for table x"))).toBe("database");
    expect(classifyError(new Error("boom"))).toBe("unknown");
  });
});
