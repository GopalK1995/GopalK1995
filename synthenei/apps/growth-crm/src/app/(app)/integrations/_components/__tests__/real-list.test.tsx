import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RealList } from "../real-list";
import { makeT } from "../../_lib/strings";
import type { ConnectorRowView } from "../../_lib/types";

const t = makeT("en");
const NOW = "2026-11-26T06:00:00.000Z";
const row = (o: Partial<ConnectorRowView>): ConnectorRowView => ({ id: "x", name: "X", category: "ads", chip: "available", blockKey: null, mode: null, connectionId: null, lastSyncAt: null, lastError: null, registered: true, ...o });

describe("integrations list", () => {
  it("has an obvious Instagram and Facebook entry with a plain description, status and Connect button", () => {
    render(<RealList rows={[row({ id: "meta-ads", name: "Meta Ads", chip: "available" }), row({ id: "gmail", name: "Gmail", category: "email" })]} now={NOW} t={t} />);
    const f = screen.getByTestId("meta-featured");
    expect(within(f).getByRole("heading", { name: "Instagram and Facebook" })).toBeInTheDocument();
    expect(f).toHaveTextContent(/followers, posts and reach/);
    expect(f).toHaveTextContent("Not connected");
    const btn = within(f).getByRole("link", { name: "Connect" });
    expect(btn).toHaveAttribute("href", "/integrations/meta-ads");
    expect(btn.className).toMatch(/h-11/);
    expect(screen.getByTestId("meta-need")).toHaveTextContent(/Start with Connect Facebook/);
  });

  it("an attention state asks to reconnect; a healthy one says connected and offers Manage", () => {
    const { rerender } = render(<RealList rows={[row({ id: "meta-ads", chip: "needs_attention", connectionId: "c1", lastSyncAt: "2026-11-26T05:00:00.000Z" })]} now={NOW} t={t} />);
    expect(screen.getByTestId("meta-need")).toHaveTextContent(/Reconnect/);
    rerender(<RealList rows={[row({ id: "meta-ads", chip: "connected", connectionId: "c1", lastSyncAt: "2026-11-26T05:00:00.000Z" })]} now={NOW} t={t} />);
    expect(within(screen.getByTestId("meta-featured")).getByRole("link", { name: "Manage" })).toBeInTheDocument();
    expect(screen.getByTestId("meta-need")).toHaveTextContent(/Connected/);
  });

  it("does not repeat Instagram and Facebook inside the table", () => {
    render(<RealList rows={[row({ id: "meta-ads" }), row({ id: "gmail", name: "Gmail" })]} now={NOW} t={t} />);
    expect(document.querySelectorAll('[data-connector="meta-ads"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-connector="gmail"]')).toHaveLength(2);   // card (phone) + table row (md up)
  });

  it("a never-connected or disconnected connector is never called stale", () => {
    render(<RealList rows={[row({ id: "calendly", name: "Calendly", chip: "available", connectionId: "c9", lastSyncAt: "2026-10-10T00:00:00.000Z" }), row({ id: "hubspot", name: "HubSpot", chip: "disconnected", connectionId: "c8", lastSyncAt: "2026-10-01T00:00:00.000Z" })]} now={NOW} t={t} />);
    expect(screen.queryByText(/Stale/)).toBeNull();
  });

  it("a connected connector with an old sync is stale", () => {
    render(<RealList rows={[row({ id: "ga4", name: "GA4", chip: "connected", connectionId: "c7", lastSyncAt: "2026-10-10T00:00:00.000Z" })]} now={NOW} t={t} />);
    expect(screen.getAllByText(/Stale/).length).toBeGreaterThan(0);
  });

  it("phone cards: one per connector, a 44 px open button named after the connector", () => {
    render(<RealList rows={[row({ id: "gmail", name: "Gmail", category: "email" })]} now={NOW} t={t} />);
    const cards = screen.getByTestId("list-cards");
    expect(cards.className).toMatch(/md:hidden/);
    expect(screen.getByTestId("list-table").className).toMatch(/hidden md:block/);
    const open = within(cards).getByRole("link", { name: "Open Gmail" });
    expect(open.className).toMatch(/h-11/);
  });
});
