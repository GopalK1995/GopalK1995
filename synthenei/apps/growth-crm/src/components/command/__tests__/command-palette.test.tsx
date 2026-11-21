import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE } from "@/i18n/registry";
import { vocabFor } from "@/lib/vertical";
import type { SearchResponse } from "@/lib/search/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));
vi.mock("@/components/shell/providers", () => ({
  useSession: () => ({ uid: "u1", ws: { id: "w1", name: "WS", region: "in" }, role: "owner", tenant: { id: "t", vertical: "legal" }, objects: [{ key: "x_assets", label: "Assets", icon: "box" }] }),
  useVocab: () => vocabFor({ id: "t", vertical: "legal" } as never),
}));
import { CommandPalette, openCommandPalette, type Fetcher } from "../command-palette";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => { push.mockReset(); localStorage.clear(); });
afterEach(cleanup);

const boot: SearchResponse = { hits: [], actions: [{ id: "new-lead", href: "/leads?new=1" }, { id: "log-call", href: "/leads?log=call" }], types: ["lead", "account", "record"], objects: ["x_assets"] };
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const ui = (fetcher: Fetcher, locale: "en" | "ta" = "en") => (
  <NextIntlClientProvider locale={locale} messages={BASE[locale] as never}><CommandPalette fetcher={fetcher} debounceMs={0} /></NextIntlClientProvider>
);
const open = () => act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });

describe("CommandPalette", () => {
  it("opens with Ctrl+K and Cmd+K, closes with Escape, and is a labelled dialog with a combobox input", async () => {
    render(ui(vi.fn(() => reply(boot))));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => { fireEvent.keyDown(window, { key: "K", metaKey: true }); });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens from the custom event used by the top-bar chip", async () => {
    render(ui(vi.fn(() => reply(boot))));
    act(() => openCommandPalette());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows only the actions the server allowed, plus permitted pages", async () => {
    render(ui(vi.fn(() => reply(boot))));
    open();
    expect(await screen.findByText("New lead")).toBeInTheDocument();
    expect(screen.getByText("Log call")).toBeInTheDocument();
    expect(screen.queryByText("New task")).toBeNull();
    expect(screen.queryByText("Roles & access")).toBeNull(); // owner holds members.manage, but only the first pages are listed while empty
  });

  it("searches after typing, shows records and navigates on Enter, saving a recent item", async () => {
    const f = vi.fn((url: string) => reply(url.includes("q=") ? { hits: [{ key: "lead:1", type: "lead", title: "Karthik Raja", subtitle: "Partner", href: "/leads/1" }] } : boot));
    render(ui(f as Fetcher));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kart" } });
    const row = await screen.findByText("Karthik Raja");
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("q=kart"))).toBe(true);
    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith("/leads/1");
    expect(JSON.parse(localStorage.getItem("gcrm-recent:w1:u1")!)[0].key).toBe("lead:1");
  });

  it("sends the sanitised query only", async () => {
    const f = vi.fn((url: string) => reply(url.includes("q=") ? { hits: [] } : boot));
    render(ui(f as Fetcher));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a,b)or(x" } });
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]) === "/api/search?q=a%20b%20or%20x")).toBe(true));
  });

  it("a one-letter query does not call the server and explains why", async () => {
    const f = vi.fn(() => reply(boot));
    render(ui(f));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
    expect(await screen.findByText(/at least 2 characters/)).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state", async () => {
    const f = vi.fn((url: string) => reply(url.includes("q=") ? { hits: [] } : boot));
    render(ui(f as Fetcher));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzzqq" } });
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });

  it("shows a loading status while a search is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    const f = vi.fn((url: string) => (url.includes("q=") ? new Promise((r) => { release = r; }) : reply(boot)));
    render(ui(f as unknown as Fetcher));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kart" } });
    expect(await screen.findByRole("status")).toHaveTextContent("Searching");
    release({ ok: true, status: 200, json: async () => ({ hits: [] }) });
  });

  it("shows an error with a working retry", async () => {
    let fail = true;
    const f = vi.fn(() => (fail ? reply({}, 500) : reply(boot)));
    render(ui(f));
    open();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search is not available");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("New lead")).toBeInTheDocument();
  });

  it("tells the user when they are rate limited", async () => {
    render(ui(vi.fn(() => reply({}, 429))));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many searches");
  });

  it("lists recent items only for types the server still allows", async () => {
    localStorage.setItem("gcrm-recent:w1:u1", JSON.stringify([
      { key: "lead:1", type: "lead", title: "Recent Lead", href: "/leads/1" },
      { key: "contact:9", type: "contact", title: "Old Contact", href: "/contacts" },
      { key: "obj:gone:3", type: "record", objectKey: "gone", title: "Gone Record", href: "/o/gone/3" },
    ]));
    render(ui(vi.fn(() => reply(boot))));
    open();
    expect(await screen.findByText("Recent Lead")).toBeInTheDocument();
    expect(screen.queryByText("Old Contact")).toBeNull();
    expect(screen.queryByText("Gone Record")).toBeNull();
  });

  it("renders Tamil strings", async () => {
    render(ui(vi.fn(() => reply(boot)), "ta"));
    open();
    expect(await screen.findByPlaceholderText(BASE.ta.search && (BASE.ta.search as { placeholder: string }).placeholder)).toBeInTheDocument();
  });

  it("does not render a name for masked hits beyond what the server sent, and labels them", async () => {
    const f = vi.fn((url: string) => reply(url.includes("q=") ? { hits: [{ key: "lead:2", type: "lead", title: "K. R.", href: "/leads/2", masked: true }] } : boot));
    render(ui(f as Fetcher));
    open();
    await screen.findByText("New lead");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "k. r" } });
    expect(await screen.findByText("K. R.")).toBeInTheDocument();
    expect(screen.getByText("Name masked")).toBeInTheDocument();
  });
});
