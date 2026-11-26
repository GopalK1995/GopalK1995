import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readLegalConfig, REQUIRED_KEYS, LEGAL_ENV } from "../config";
import { deletionDoc, privacyDoc, termsDoc } from "../content";
import { LegalPage, legalMetadata, LegalFooter } from "@/components/legal/legal-page";
import { statusView } from "../status-view";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const FULL = {
  PLATFORM_LEGAL_NAME: "Acme Test Pvt Ltd", PLATFORM_REGISTERED_ADDRESS: "1 Test Road", PLATFORM_CONTACT_EMAIL: "legal@acme.example",
  PLATFORM_GRIEVANCE_OFFICER_NAME: "G. Officer", PLATFORM_GRIEVANCE_OFFICER_EMAIL: "grievance@acme.example", PLATFORM_JURISDICTION_CITY: "Testville",
  PLATFORM_LEGAL_EFFECTIVE_DATE: "1 Jan 2027", PLATFORM_DATA_REGION: "Test Region (xx-test-1)",
};

describe("readLegalConfig", () => {
  it("is published only when all eight required values are set", () => {
    const c = readLegalConfig(FULL);
    expect(c.published).toBe(true);
    expect(c.missing).toEqual([]);
    expect(REQUIRED_KEYS).toHaveLength(8);
  });
  it("lists every missing name; blank and whitespace count as missing", () => {
    const c = readLegalConfig({ ...FULL, PLATFORM_LEGAL_NAME: "   ", PLATFORM_DATA_REGION: "" });
    expect(c.published).toBe(false);
    expect(c.missing).toEqual(["PLATFORM_LEGAL_NAME", "PLATFORM_DATA_REGION"]);
    expect(readLegalConfig({}).missing).toHaveLength(8);
  });
  it("reads optional numbers only when they are sane positive integers", () => {
    expect(readLegalConfig({ ...FULL, PLATFORM_DELETION_RESPONSE_DAYS: "30" }).deletionDays).toBe(30);
    for (const bad of ["abc", "0", "-5", "1e3", ""]) expect(readLegalConfig({ ...FULL, PLATFORM_DELETION_RESPONSE_DAYS: bad }).deletionDays).toBeNull();
  });
});

describe("legal content", () => {
  it("never hardcodes company values and never promises an automatic schedule", () => {
    const c = readLegalConfig({});
    const text = JSON.stringify([privacyDoc(c), termsDoc(c), deletionDoc(c)]);
    expect(text).not.toMatch(/Synthan|Singapore|ap-southeast/i);
    expect(text).not.toMatch(/within \[?\d+\]? days|\b(30|90) days\b/);
    expect(text).toContain("ask us to delete");
  });
  it("uses a neutral timing when no number is configured and the configured number when it is", () => {
    expect(JSON.stringify(deletionDoc(readLegalConfig(FULL)))).toContain("without undue delay");
    expect(JSON.stringify(deletionDoc(readLegalConfig({ ...FULL, PLATFORM_DELETION_RESPONSE_DAYS: "21" })))).toContain("within 21 days");
  });
});

describe("LegalPage", () => {
  it("shows a DRAFT banner, visible not-set markers and noindex when env is missing", () => {
    const c = readLegalConfig({});
    render(<LegalPage doc={privacyDoc(c)} cfg={c} />);
    expect(screen.getByTestId("legal-draft-banner")).toHaveTextContent("DRAFT: this page is not yet published by the operator");
    expect(screen.getByTestId("legal-draft-banner")).toHaveTextContent("PLATFORM_LEGAL_NAME");
    expect(screen.getAllByText(/\[not set: PLATFORM_LEGAL_NAME\]/).length).toBeGreaterThan(0);
    expect(legalMetadata({ title: "t" }, c, "/legal/privacy").robots).toEqual({ index: false, follow: false });
  });
  it("renders final text with no banner and indexable robots when everything is set", () => {
    const c = readLegalConfig(FULL);
    render(<LegalPage doc={termsDoc(c)} cfg={c} />);
    expect(screen.queryByTestId("legal-draft-banner")).toBeNull();
    expect(screen.getAllByText(/Acme Test Pvt Ltd/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Courts at Testville/)).toBeInTheDocument();
    expect(legalMetadata({ title: "t" }, c, "/legal/terms").robots).toEqual({ index: true, follow: true });
  });
  it("has one h1, a table of contents whose anchors all exist, and a legal footer", () => {
    const c = readLegalConfig(FULL);
    const { container } = render(<LegalPage doc={privacyDoc(c)} cfg={c} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const toc = screen.getByRole("navigation", { name: "Contents" });
    const links = toc.querySelectorAll("a");
    expect(links.length).toBe(privacyDoc(c).sections.length);
    links.forEach((a) => expect(container.querySelector(a.getAttribute("href")!)).not.toBeNull());
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });
  it("uses eight distinct PLATFORM_ env names", () => {
    expect(new Set(Object.values(LEGAL_ENV)).size).toBe(8);
  });
});

describe("LegalFooter", () => {
  it("links Privacy, Terms and Data deletion", () => {
    render(<LegalFooter />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Data deletion" })).toHaveAttribute("href", "/legal/data-deletion");
  });
});

describe("statusView and the status page", () => {
  const row = { id: "1", confirmationCode: "abc12345", metaUserId: "777", status: "disconnected" as const, requestedAt: "2026-11-26T10:00:00Z", completedAt: null };
  it("maps each state and never exposes the Meta user id", () => {
    const v = statusView(row, "abc12345");
    expect(v).toMatchObject({ kind: "found", status: "disconnected", requested: "2026-11-26" });
    expect(JSON.stringify(v)).not.toContain("777");
    expect(statusView({ ...row, status: "completed", completedAt: "2026-11-28T00:00:00Z" }, "abc12345")).toMatchObject({ kind: "found", completed: "2026-11-28" });
    expect(statusView(null, "nope")).toEqual({ kind: "not_found" });
    expect(statusView(null, undefined)).toEqual({ kind: "missing_code" });
    expect(statusView("unavailable", "x")).toEqual({ kind: "unavailable" });
  });
  async function page(code: string | undefined, lookup: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("@/lib/legal/meta-deletion-store", () => ({ deletionDeps: () => ({ store: { byCode: lookup } }) }));
    const mod = await import("@/app/(public)/legal/data-deletion/status/page");
    return { mod, el: await mod.default({ searchParams: Promise.resolve({ code }) }) };
  }
  it("renders a found request, a not-found code, a missing code, and unavailable when the table is missing", async () => {
    const a = await page("abc12345", async () => row);
    const r1 = render(a.el); expect(screen.getByTestId("deletion-status-found")).toHaveAttribute("data-status", "disconnected"); r1.unmount();
    const b = await page("zzzzzzzz", async () => null);
    const r2 = render(b.el); expect(screen.getByTestId("deletion-status-notfound")).toBeInTheDocument(); r2.unmount();
    const c = await page("abc12345", async () => { throw new Error("not configured"); });
    const r3 = render(c.el); expect(screen.getByTestId("deletion-status-unavailable")).toBeInTheDocument(); r3.unmount();
    const d = await page(undefined, async () => row);
    render(d.el); expect(screen.getByTestId("deletion-status-missing")).toBeInTheDocument();
    expect(a.mod.metadata.robots).toEqual({ index: false, follow: false });
  });
});
