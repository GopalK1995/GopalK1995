// F29 (AUD-006): the shared route boundary shows a heading, a human message, Retry and an error id, and never the raw error text.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RouteError } from "../route-error";
import { errorCopy } from "@/lib/error-message";
import en from "../../../../messages/en/errors.json";
import ta from "../../../../messages/ta/errors.json";

const RAW = "duplicate key value violates unique constraint leads_pkey at /srv/app/secret.ts:42";

describe("RouteError", () => {
  it("renders one h1, a human message, the digest and a working Retry; no raw text or stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const err = Object.assign(new Error(RAW), { digest: "4252757374", stack: "Error: x\n    at secret (/srv/app/secret.ts:42)" });
    const { container } = render(<RouteError error={err} reset={reset} />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/could not load/i);
    expect(container.textContent).toContain("4252757374");
    expect(container.textContent).not.toMatch(/duplicate key|secret\.ts|leads_pkey|at secret/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
  it("names the area for a route boundary and shows an id even without a digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<RouteError error={new Error(RAW)} reset={() => {}} source="Pipeline" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pipeline could not load");
    expect(container.textContent).toMatch(/Error id c-[a-z0-9]+/);
    expect(container.textContent).not.toContain("leads_pkey");
  });
  it("offers the Tamil copy when the document language is Tamil, and every boundary key exists in both languages", () => {
    expect(errorCopy("ta-IN").boundaryRetry).toBe(ta.boundaryRetry);
    expect(errorCopy("en-IN").boundaryRetry).toBe("Retry");
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect((ta as Record<string, string>)[k].trim().length, k).toBeGreaterThan(0);
  });
});
