import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../actions", () => ({ connectConnector: vi.fn(), disconnectConnector: vi.fn(), runSyncConnector: vi.fn(), testConnector: vi.fn(), saveFieldMap: vi.fn(), previewFieldMap: vi.fn() }));
vi.mock("../../../analytics/social/actions", () => ({ retryMetaWebhook: vi.fn(), listSocialAssets: vi.fn(), selectSocialAssets: vi.fn() }));
vi.mock("../../../analytics/social/_components/asset-picker", () => ({ AssetPicker: () => <div data-testid="picker-stub" /> }));

import { RealDetail } from "../real-detail";
import { makeT } from "../../_lib/strings";
import type { DetailView, MapRowView } from "../../_lib/types";

const t = makeT("en");
const NOW = "2026-11-26T06:00:00.000Z";
const map: MapRowView[] = [
  { externalObject: "Lead", externalField: "full_name", localTable: "leads", localColumn: "full_name", direction: "in", transform: "trim", transformArg: "", sample: "", custom: false },
  { externalObject: "Lead", externalField: "email", localTable: "leads", localColumn: "email", direction: "in", transform: "lower_email", transformArg: "", sample: "", custom: false },
];
function view(o: Partial<DetailView> & { mode?: "live" | "sandbox" | null; chip?: DetailView["row"]["chip"]; connected?: boolean } = {}): DetailView {
  const connected = o.connected ?? true;
  return {
    row: { id: "meta-ads", name: "Meta Ads", category: "ads", chip: o.chip ?? (connected ? "connected" : "available"), blockKey: null, mode: o.mode === undefined ? "live" : o.mode, connectionId: connected ? "c1" : null, lastSyncAt: connected ? "2026-11-26T05:00:00.000Z" : null, lastError: null, registered: true },
    auth: "oauth2", authKind: "oauth2", fields: [], sandboxSupported: true, sandboxHowTo: "meta-ads.sandbox",
    steps: [], flows: [{ object: "metaFlow.leads", dir: "in" }, { object: "metaFlow.replies", dir: "out" }], runs: [], map, editable: connected, accountLabel: null, oauthReady: true,
    metaHealth: connected ? { scopesGranted: 2, scopesRequested: 2, scopesMissing: [], scopesGrantedList: ["a", "b"], scopesRequestedList: ["a", "b"], expiresAt: "2027-01-10T00:00:00.000Z", neverExpires: false, daysLeft: 40, webhook: "unknown", lastOkAt: "2026-11-25T10:00:00.000Z", attention: false } : null,
    metaConnect: { connected, needsReconnect: false, connectionId: connected ? "c1" : null, pageName: connected ? "Sea View Resort" : null, igUsername: connected ? "seaview" : null, accounts: 2, posts: 14, lastOkRows: 31 },
    ...o,
  } as DetailView;
}
const ui = (v: DetailView, manageBlocked: string | null = null) => <RealDetail v={v} t={t} now={NOW} ws="w1" failed={[]} manageBlocked={manageBlocked} />;

describe("Instagram and Facebook detail page", () => {
  it("is named Instagram and Facebook and shows the step list with real state", () => {
    render(ui(view()));
    expect(screen.getByRole("heading", { level: 1, name: "Instagram and Facebook" })).toBeInTheDocument();
    expect(screen.getByTestId("meta-connect")).toBeInTheDocument();
    expect(screen.getByText("Facebook Page: Sea View Resort")).toBeInTheDocument();
    expect(screen.getByText("Pending platform setup")).toBeInTheDocument();
  });

  it("drops the mock-only copy: no offline conversions, no sample steps", () => {
    const { container } = render(ui(view()));
    expect(container.textContent).not.toMatch(/offline conversion/i);
    expect(container.textContent).not.toMatch(/Connect the ad account as an admin/);
    expect(container.textContent).toMatch(/Replies to Instagram messages/);
  });

  it("a live connection does not show the sandbox Lead Ads Testing Tool blurb", () => {
    const { container } = render(ui(view({ mode: "live" })));
    expect(container.textContent).not.toMatch(/Lead Ads Testing Tool/);
  });

  it("a sandbox connection still explains how to test", () => {
    const { container } = render(ui(view({ mode: "sandbox", chip: "sandbox" })));
    expect(container.textContent).toMatch(/Lead Ads Testing Tool/);
  });

  it("field mapping is plain text, not rows of empty-looking inputs, when it cannot be edited", () => {
    render(ui(view({ connected: false, editable: false, metaConnect: view({ connected: false }).metaConnect, metaHealth: null })));
    expect(screen.getByTestId("map-readonly")).toBeInTheDocument();
    expect(screen.getByText("Lead.full_name")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox", { name: "Their field" })).toHaveLength(0);
  });

  it("when it can be edited the editor is shown", () => {
    render(ui(view()));
    expect(screen.queryByTestId("map-readonly")).toBeNull();
    expect(screen.getAllByRole("textbox", { name: "Their field" }).length).toBe(2);
  });

  it("not connected: no empty Connection card, Connect Facebook is the one connect action", () => {
    render(ui(view({ connected: false, editable: false, metaHealth: null, metaConnect: view({ connected: false }).metaConnect })));
    expect(screen.queryByRole("heading", { name: "Connection" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Connect Facebook" })).toHaveLength(1);
    expect(screen.queryByText("Authorise on the vendor site")).toBeNull();
  });
});
