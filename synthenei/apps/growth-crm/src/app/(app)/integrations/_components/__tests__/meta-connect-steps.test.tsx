import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../../analytics/social/_components/asset-picker", () => ({ AssetPicker: ({ connectionId, embedded }: { connectionId: string; embedded?: boolean }) => <div data-testid="picker-stub" data-conn={connectionId} data-embedded={String(!!embedded)} /> }));

import { MetaConnectSteps, type MetaConnectStepsProps } from "../meta-connect-steps";
import { buildMetaConnectModel } from "../../_lib/meta-steps";
import { makeT } from "../../_lib/strings";
import type { MetaConnectView, MetaHealthView } from "../../_lib/types";

const t = makeT("en");
const REQ = ["pages_show_list", "leads_retrieval"];
const labels = { title: t("metaSteps.title"), sub: t("metaSteps.sub"), nextLabel: t("metaSteps.nextLabel"), btnConnect: t("metaSteps.btnConnect"), btnReconnect: t("metaSteps.btnReconnect"), btnChooseAnother: t("metaSteps.btnChooseAnother"), btnHidePicker: t("metaSteps.btnHidePicker"), scopesHeading: t("metaSteps.scopesHeading") };
const conn = (o: Partial<MetaConnectView> = {}): MetaConnectView => ({ connected: true, needsReconnect: false, connectionId: "c1", pageName: "Sea View Resort", igUsername: "seaview", accounts: 2, posts: 14, lastOkRows: 31, ...o });
const health = (o: Partial<MetaHealthView> = {}): MetaHealthView => ({ scopesGranted: 1, scopesRequested: 2, scopesMissing: ["leads_retrieval"], scopesGrantedList: ["pages_show_list"], scopesRequestedList: REQ, expiresAt: "2027-01-10T00:00:00.000Z", neverExpires: false, daysLeft: 40, webhook: "unknown", lastOkAt: "2026-11-25T10:00:00.000Z", attention: true, ...o });

function setup(c: MetaConnectView, h: MetaHealthView | null, over: Partial<MetaConnectStepsProps> = {}) {
  const model = buildMetaConnectModel({ c, h, t, connectBlocked: over.blockedReason ?? null });
  return render(<MetaConnectSteps model={model} labels={labels} connected={c.connected} needsReconnect={c.needsReconnect} connectionId={c.connectionId} hasPage={!!c.pageName}
    pageKey={c.pageName} connectHref="/api/oauth/meta-ads/start?ws=w1&conn=c1" blockedReason={null} {...over} />);
}

describe("MetaConnectSteps", () => {
  it("renders four steps with a real status each", () => {
    setup(conn(), health());
    const items = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"));
    expect(items.map((li) => [li.getAttribute("data-step"), li.getAttribute("data-status")])).toEqual([["connect", "attention"], ["assets", "done"], ["webhooks", "pending"], ["sync", "done"]]);
    expect(screen.getByText("Pending platform setup")).toBeInTheDocument();
  });

  it("shows the next-step line and the chosen Page and Instagram names", () => {
    setup(conn(), health());
    expect(screen.getByTestId("meta-next")).toHaveTextContent(/What to do next/);
    expect(screen.getByTestId("meta-next")).toHaveTextContent(/leads_retrieval/);
    expect(screen.getByText("Facebook Page: Sea View Resort")).toBeInTheDocument();
    expect(screen.getByText("Instagram: @seaview")).toBeInTheDocument();
  });

  it("lists scopes granted vs missing with a word, not only a colour", () => {
    setup(conn(), health());
    const list = screen.getByTestId("meta-scopes");
    expect(within(list).getByText("leads_retrieval").closest("li")).toHaveTextContent("missing");
    expect(within(list).getByText("pages_show_list").closest("li")).toHaveTextContent("granted");
  });

  it("Reconnect is a link to the OAuth start for the same connection", () => {
    setup(conn(), health());
    const a = screen.getByRole("link", { name: "Reconnect" });
    expect(a).toHaveAttribute("href", "/api/oauth/meta-ads/start?ws=w1&conn=c1");
    expect(a.className).toMatch(/h-11/);   // 44 px on a phone
  });

  it("not connected: Connect Facebook link, no picker, steps 2 and 4 waiting", () => {
    setup(conn({ connected: false, pageName: null, igUsername: null, connectionId: null }), null, { connectHref: "/api/oauth/meta-ads/start?ws=w1" });
    expect(screen.getByRole("link", { name: "Connect Facebook" })).toHaveAttribute("href", "/api/oauth/meta-ads/start?ws=w1");
    expect(screen.queryByTestId("picker-stub")).toBeNull();
    expect(screen.getAllByText("Waiting for the step before")).toHaveLength(2);
  });

  it("connected without a Page: the picker is embedded right in step 2", () => {
    setup(conn({ pageName: null, igUsername: null }), health({ scopesMissing: [], scopesGranted: 2, scopesGrantedList: REQ, lastOkAt: null }));
    const p = screen.getByTestId("picker-stub");
    expect(p).toHaveAttribute("data-conn", "c1");
    expect(p).toHaveAttribute("data-embedded", "true");
  });

  it("with a Page chosen the picker is hidden until 'Add or remove Pages' is pressed", () => {
    setup(conn(), health());
    expect(screen.queryByTestId("picker-stub")).toBeNull();
    const btn = screen.getByRole("button", { name: "Add or remove Pages" });
    expect(btn.className).toMatch(/h-11/);
    fireEvent.click(btn);
    expect(screen.getByTestId("picker-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("picker-stub")).toBeNull();
  });

  it("a viewer who may not manage gets a disabled Connect (with the reason) and no picker", () => {
    setup(conn({ connected: false, pageName: null, connectionId: null }), null, { blockedReason: "Only the workspace Owner can change integrations." });
    expect(screen.queryByRole("link", { name: "Connect Facebook" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect Facebook" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("meta-next")).toHaveTextContent(/Only the workspace Owner/);
  });

  it("never says to add more accounts by connecting again", () => {
    const { container } = setup(conn(), health());
    expect(container.textContent).not.toMatch(/connecting again/i);
    expect(container.textContent).toMatch(/Each Page belongs to one workspace/);
  });

  it("names every tracked Page and Instagram account when there are several, and no longer claims one Page only", () => {
    setup(conn({ pageNames: ["Sea View Resort", "Studio Two"], igNames: ["seaview", "studio.two"] }), health());
    expect(screen.getByText("Facebook Pages (2): Sea View Resort, Studio Two")).toBeInTheDocument();
    expect(screen.getByText("Instagram accounts (2): @seaview, @studio.two")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/one page per workspace|replaces this one/i);
  });
});
