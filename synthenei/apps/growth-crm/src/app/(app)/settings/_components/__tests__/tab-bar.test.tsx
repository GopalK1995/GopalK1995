import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams("tab=users") }));
import { TabBar } from "../tab-bar";

const tabs = [{ value: "users", label: "Users" }, { value: "roles", label: "Roles" }, { value: "audit", label: "Audit" }];

describe("settings TabBar (A11Y-007)", () => {
  it("only the selected tab has aria-controls, because only its panel is rendered", () => {
    render(<><TabBar tabs={tabs} current="users" /><div role="tabpanel" id="panel-users" aria-labelledby="tab-users" /></>);
    const t = screen.getAllByRole("tab");
    expect(t[0]).toHaveAttribute("aria-controls", "panel-users");
    expect(t[1]).not.toHaveAttribute("aria-controls");
    expect(t[2]).not.toHaveAttribute("aria-controls");
    for (const el of document.querySelectorAll("[aria-controls]")) expect(document.getElementById(el.getAttribute("aria-controls")!)).not.toBeNull();
  });
  it("keeps roving tabindex and arrow-key activation", () => {
    render(<TabBar tabs={tabs} current="users" />);
    const t = screen.getAllByRole("tab");
    expect(t.map((x) => x.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    fireEvent.keyDown(t[0], { key: "ArrowRight" });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("tab=roles"), { scroll: false });
  });
});
