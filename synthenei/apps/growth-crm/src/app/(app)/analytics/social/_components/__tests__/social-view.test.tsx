// AUD-100: with several accounts the social page shows each account's own status and can filter the ledger to one account.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/social.json";

vi.mock("../../actions", () => ({ refreshSocialNow: vi.fn() }));
vi.mock("@/components/charts/line-trend", () => ({ LineTrend: ({ data }: { data: unknown[] }) => <div data-testid="trend" data-points={data.length} /> }));

import { SocialBody } from "../social-view";
import { assembleView } from "@/lib/connectors/meta/organic/view";

const acc = (id: string, platform: string, name: string, status = "ok", err: string | null = null) => ({ id, platform, external_id: `x-${id}`, display_name: name, username: null, followers: 10, last_synced_at: "2026-11-20T09:00:00Z", last_sync_status: status, last_error: err, integration_id: "c1" });
const post = (id: string, account: string) => ({ id, account_id: account, kind: "feed", caption: `cap-${id}`, permalink: null, posted_at: "2026-11-10T00:00:00Z", status: "live" });
const view = () => assembleView({
  accounts: [acc("a1", "instagram", "Krishna IG"), acc("a2", "facebook", "Studio Two", "needs_attention", "Meta rejected the saved credentials")],
  posts: [post("p1", "a1"), post("p2", "a1"), post("p3", "a2")], postMetrics: [],
  accountMetrics: [{ account_id: "a1", day: "2026-11-19", followers: 10, reach: 1 }, { account_id: "a1", day: "2026-11-20", followers: 11, reach: 2 }, { account_id: "a2", day: "2026-11-19", followers: 5, reach: 1 }],
  connections: [{ id: "c1", status: "connected", scopes: [] }],
});
const ui = (v = view()) => <NextIntlClientProvider locale="en" messages={{ social: messages } as never}><SocialBody view={v} canManage /></NextIntlClientProvider>;

describe("SocialBody with several accounts", () => {
  it("shows every account with its own status; a failed account says so while the other does not", () => {
    render(ui());
    const list = screen.getByTestId("social-accounts");
    expect(within(list).getByText(/Studio Two/).closest("li")).toHaveAttribute("data-status", "needs_attention");
    expect(within(list).getByText(/Last sync failed: Meta rejected the saved credentials/)).toBeInTheDocument();
    expect(within(list).getByText(/Synced/)).toBeInTheDocument();
  });
  it("filters the ledger and the trend to the chosen account and back to all", () => {
    render(ui());
    expect(screen.getAllByTestId("trend")[0]).toHaveAttribute("data-points", "2");
    expect(screen.getAllByRole("button", { name: /cap-/ })).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "a2" } });
    expect(screen.getAllByRole("button", { name: /cap-/ })).toHaveLength(1);
    expect(screen.queryByTestId("trend")).toBeNull();   // one day of data for this account: no line to draw
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "all" } });
    expect(screen.getAllByRole("button", { name: /cap-/ })).toHaveLength(3);
  });
  it("a single account shows no filter", () => {
    render(ui(assembleView({ accounts: [acc("a1", "instagram", "Krishna IG")], posts: [post("p1", "a1")], postMetrics: [], accountMetrics: [], connections: [{ id: "c1", status: "connected", scopes: [] }] })));
    expect(screen.queryByLabelText("Account")).toBeNull();
  });
});
