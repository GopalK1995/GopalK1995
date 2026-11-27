// AUD-100: the picker adds several Pages at once, shows which are connected, removes one on its own and reports a failed Page by name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/social.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const list = vi.fn(), select = vi.fn(), remove = vi.fn();
vi.mock("../../actions", () => ({ listSocialAssets: (...a: unknown[]) => list(...a), selectSocialAssets: (...a: unknown[]) => select(...a), removeSocialAccount: (...a: unknown[]) => remove(...a) }));

import { AssetPicker } from "../asset-picker";

const PAGES = [{ id: "p1", name: "Krishna", igUsername: "kriszseeker" }, { id: "p2", name: "Studio Two", igUsername: "studio.two" }, { id: "p3", name: "Cafe Three" }];
const ui = () => <NextIntlClientProvider locale="en" messages={{ social: messages } as never}><AssetPicker connectionId="c1" embedded /></NextIntlClientProvider>;
beforeEach(() => { vi.clearAllMocks(); });

describe("AssetPicker with several Pages", () => {
  it("lists connected Pages with a Remove control and the others as tick boxes", async () => {
    list.mockResolvedValue({ ok: true, message: "", data: { pages: PAGES, adAccounts: [], connected: ["p1"] } });
    render(ui());
    expect(await screen.findByText("Connected Pages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Krishna" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Add 0 Pages|Add Pages/ })).toBeDisabled();
  });
  it("adds the ticked Pages in one save", async () => {
    list.mockResolvedValue({ ok: true, message: "", data: { pages: PAGES, adAccounts: [], connected: ["p1"] } });
    select.mockResolvedValue({ ok: true, message: "Now tracking 2 more Pages", data: { pageName: "Studio Two", results: [{ id: "p2", name: "Studio Two", ok: true, message: "" }, { id: "p3", name: "Cafe Three", ok: true, message: "" }] } });
    render(ui());
    await screen.findByText("Connected Pages");
    fireEvent.click(screen.getByLabelText(/Studio Two/)); fireEvent.click(screen.getByLabelText(/Cafe Three/));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 Pages" }));
    await waitFor(() => expect(select).toHaveBeenCalledWith("c1", ["p2", "p3"], undefined));
    expect(await screen.findByText("Now tracking 2 more Pages")).toBeInTheDocument();
  });
  it("names a Page that could not be added while the others went through", async () => {
    list.mockResolvedValue({ ok: true, message: "", data: { pages: PAGES, adAccounts: [], connected: [] } });
    select.mockResolvedValue({ ok: true, message: "Now tracking Krishna 1 Page could not be added.", data: { pageName: "Krishna", results: [{ id: "p1", name: "Krishna", ok: true, message: "" }, { id: "p2", name: "Studio Two", ok: false, message: "That account is already connected to another workspace." }] } });
    render(ui());
    await screen.findByText("Facebook Page");
    fireEvent.click(screen.getByLabelText(/Studio Two/));
    fireEvent.click(screen.getByRole("button", { name: "Use this Page" }));
    expect(await screen.findByText("Studio Two: That account is already connected to another workspace.")).toBeInTheDocument();
  });
  it("removes one Page only after a second click", async () => {
    list.mockResolvedValue({ ok: true, message: "", data: { pages: PAGES, adAccounts: [], connected: ["p1", "p2"] } });
    remove.mockResolvedValue({ ok: true, message: "Page removed. Your other Pages keep syncing.", data: { remaining: 1 } });
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Remove Studio Two" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("c1", "p2"));
    expect(await screen.findByText(/other Pages keep syncing/)).toBeInTheDocument();
  });
});
