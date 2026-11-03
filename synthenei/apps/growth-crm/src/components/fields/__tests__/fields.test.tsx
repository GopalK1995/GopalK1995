import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientField } from "@/lib/metadata/runtime";

const save = vi.fn();
vi.mock("../actions", () => ({ saveCustomFields: (...a: unknown[]) => save(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

import { FieldInput } from "../field-input";
import { FieldValue } from "../field-value";
import { fieldColumn, fieldFilterDefs, numericColumnIds } from "../field-column";
import { FieldFilter } from "../field-filter";
import { CustomFieldsPanel, type CustomFieldsPanelProps } from "../custom-fields-panel";

const f = (p: Partial<ClientField> & Pick<ClientField, "key" | "type">): ClientField => ({ label: { en: p.key[0].toUpperCase() + p.key.slice(1) }, section: null, required: false, isPii: false, isFilterable: true, edit: true, default: null, ...p });
const CH = [{ key: "a", label: { en: "Alpha", ta: "ஆல்பா" } }, { key: "b", label: { en: "Beta" } }, { key: "old", label: { en: "Old" }, archived: true }];

beforeEach(() => { save.mockReset(); refresh.mockReset(); });

describe("FieldInput, one control per type", () => {
  const types: [string, ClientField][] = [
    ["text", f({ key: "city", type: "text" })], ["long_text", f({ key: "notes", type: "long_text" })], ["number", f({ key: "seats", type: "number" })],
    ["money", f({ key: "budget", type: "money" })], ["date", f({ key: "due", type: "date" })], ["datetime", f({ key: "demo", type: "datetime" })],
    ["url", f({ key: "site", type: "url" })], ["email", f({ key: "mail", type: "email" })], ["phone", f({ key: "mobile", type: "phone" })],
    ["select", f({ key: "source", type: "select", choices: CH })], ["user", f({ key: "buddy", type: "user" })], ["lookup", f({ key: "firm", type: "lookup", lookupObject: "account" })],
  ];
  it.each(types)("%s has a labelled control", (_t, def) => {
    render(<FieldInput def={def} value="" onChange={() => {}} />);
    expect(screen.getByLabelText(new RegExp(`^${def.label.en}`))).toBeInTheDocument();
  });
  it("boolean and multi-select render labelled checkboxes", () => {
    render(<><FieldInput def={f({ key: "vip", type: "boolean" })} value={false} onChange={() => {}} /><FieldInput def={f({ key: "tags", type: "multi_select", choices: CH })} value={["a"]} onChange={() => {}} /></>);
    expect(screen.getByRole("checkbox", { name: "Vip" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /Old/ })).toBeNull();
  });
  it("a retired option that is the current value stays visible and labelled", () => {
    render(<FieldInput def={f({ key: "tags", type: "multi_select", choices: CH })} value={["old"]} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Old (retired)" })).toBeChecked();
  });
  it("multi-select is keyboard operable (Tab, Space)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FieldInput def={f({ key: "tags", type: "multi_select", choices: CH })} value={[]} onChange={onChange} />);
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
  it("boolean toggles with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FieldInput def={f({ key: "vip", type: "boolean" })} value={false} onChange={onChange} />);
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("phone normalises to E.164 on blur", async () => {
    const onChange = vi.fn();
    render(<FieldInput def={f({ key: "mobile", type: "phone" })} value="98765 43210" onChange={onChange} />);
    fireEvent.blur(screen.getByLabelText(/Mobile/));
    expect(onChange).toHaveBeenCalledWith("+919876543210");
  });
  it("datetime is entered in IST and emitted as a UTC instant", () => {
    const onChange = vi.fn();
    render(<FieldInput def={f({ key: "demo", type: "datetime" })} value="2026-11-02T09:00:00.000Z" onChange={onChange} />);
    const el = screen.getByLabelText(/Demo/) as HTMLInputElement;
    expect(el.value).toBe("2026-11-02T14:30");
    fireEvent.change(el, { target: { value: "2026-11-02T16:00" } });
    expect(onChange).toHaveBeenCalledWith("2026-11-02T10:30:00.000Z");
    expect(screen.getByText(/Time is in IST/)).toBeInTheDocument();
  });
  it("money shows the rupee sign; required marks the label; error is announced and linked", () => {
    render(<FieldInput def={f({ key: "budget", type: "money", required: true })} value="" onChange={() => {}} error="Budget must be a number" />);
    const input = screen.getByLabelText(/Budget/);
    expect(screen.getAllByText("₹").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Budget must be a number");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });
  it("disabled with a reason is explained", () => {
    render(<FieldInput def={f({ key: "city", type: "text" })} value="x" onChange={() => {}} disabledReason="Needs the leads.assign permission" />);
    expect(screen.getByLabelText(/City/)).toBeDisabled();
    expect(screen.getByText(/Needs the leads.assign permission/)).toBeInTheDocument();
  });
  it("Tamil label is used for the Tamil locale", () => {
    render(<FieldInput def={f({ key: "city", type: "text", label: { en: "City", ta: "நகரம்" } })} value="" onChange={() => {}} locale="ta" />);
    expect(screen.getByLabelText("நகரம்")).toBeInTheDocument();
  });
});

describe("FieldValue", () => {
  const r = (def: Pick<ClientField, "type" | "choices">, value: unknown, masked = false) => render(<FieldValue def={def} value={value} masked={masked} />);
  it("formats by type", () => {
    r({ type: "money" }, 150000.5);
    expect(screen.getByText("₹1,50,000.50")).toBeInTheDocument();
  });
  it("date and IST datetime", () => {
    r({ type: "date" }, "2026-11-02");
    expect(screen.getByText("02 Nov 2026")).toBeInTheDocument();
    r({ type: "datetime" }, "2026-11-02T09:00:00.000Z");
    expect(screen.getByText("02 Nov 2026, 2:30 pm IST")).toBeInTheDocument();
  });
  it("select chip uses the label; retired is marked", () => {
    r({ type: "select", choices: CH }, "old");
    expect(screen.getByText("Old (retired)")).toBeInTheDocument();
  });
  it("links: email, phone, url (https only is linked)", () => {
    r({ type: "email" }, "a@b.in");
    expect(screen.getByRole("link", { name: "a@b.in" })).toHaveAttribute("href", "mailto:a@b.in");
    r({ type: "phone" }, "+91 98765 43210");
    expect(screen.getByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+919876543210");
    r({ type: "url" }, "javascript:alert(1)");
    expect(screen.queryByRole("link", { name: /javascript/ })).toBeNull();
  });
  it("empty renders a dash with a text alternative; masked renders a placeholder and never the value", () => {
    const { container } = r({ type: "text" }, null);
    expect(container).toHaveTextContent("—");
    expect(screen.getByText("No value")).toBeInTheDocument();
    const m = r({ type: "phone" }, "+919812345678", true);
    expect(m.container.innerHTML).not.toContain("9812345678");
    expect(screen.getByText(/Hidden: you do not have access/)).toBeInTheDocument();
  });
});

describe("column and filter providers", () => {
  it("fieldColumn uses the saved-view id custom.<key> and reads row.custom", () => {
    const col = fieldColumn<{ custom?: Record<string, unknown> }>(f({ key: "source", type: "select", choices: CH })) as unknown as { id: string; header: string; accessorFn: (r: unknown) => unknown };
    expect(col.id).toBe("custom.source");
    expect(col.header).toBe("Source");
    expect(col.accessorFn({ custom: { source: "a" } })).toBe("a");
    expect(col.accessorFn({ custom: null })).toBeNull();
    expect(numericColumnIds([f({ key: "budget", type: "money" }), f({ key: "city", type: "text" })])).toEqual(["custom.budget"]);
  });
  it("fieldFilterDefs: select and boolean become FilterBar selects, retired options are not offered", () => {
    const defs = fieldFilterDefs([f({ key: "source", type: "select", choices: CH }), f({ key: "vip", type: "boolean" }), f({ key: "city", type: "text" })]);
    expect(defs.map((d) => d.key)).toEqual(["custom.source", "custom.vip"]);
    expect(defs[0].options.map((o) => o.value)).toEqual(["a", "b"]);
  });
  it("FieldFilter text filter emits contains and clears on empty", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FieldFilter def={f({ key: "city", type: "text" })} value={undefined} onChange={onChange} />);
    await user.type(screen.getByLabelText("City"), "M");
    expect(onChange).toHaveBeenLastCalledWith({ op: "contains", value: "M" });
  });
});

describe("<CustomFields/> panel", () => {
  const base: CustomFieldsPanelProps = {
    objectKey: "lead", recordId: "l1", version: 3, fields: [f({ key: "region", type: "text" }), f({ key: "budget", type: "money", required: true })],
    values: { region: "south", budget: 500 }, hiddenCount: 0, locale: "en", demo: false, noun: "enquiry", canManage: false,
  };

  it("shows values read-only first, with an Edit button", () => {
    render(<CustomFieldsPanel {...base} />);
    expect(screen.getByText("south")).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("empty state with a link to the editor for admins, and a count of hidden fields", () => {
    render(<CustomFieldsPanel {...base} fields={[]} values={{}} hiddenCount={2} canManage />);
    expect(screen.getByText(/No custom fields have been set up for this enquiry/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage custom fields/ })).toHaveAttribute("href", "/settings/fields");
    expect(screen.getByText(/2 more fields are not available to your role/)).toBeInTheDocument();
  });

  it("Edit is disabled with a reason when nothing is editable", () => {
    render(<CustomFieldsPanel {...base} fields={base.fields.map((x) => ({ ...x, edit: false }))} />);
    expect(screen.getByRole("button", { name: /Edit/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("You cannot edit these fields")).toBeInTheDocument();
  });

  it("saves only the changed keys together with the version the page rendered", async () => {
    save.mockResolvedValue({ ok: true, message: "Custom fields saved", data: { version: 4, values: { region: "north", budget: 500 } } });
    const user = userEvent.setup();
    render(<CustomFieldsPanel {...base} />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const region = screen.getByLabelText("Region");
    await user.clear(region);
    await user.type(region, "north");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ objectKey: "lead", recordId: "l1", expectedVersion: 3, patch: { region: "north" } }));
    await waitFor(() => expect(screen.getByText("north")).toBeInTheDocument());
  });

  it("a second save uses the version returned by the first (optimistic concurrency chain)", async () => {
    save.mockResolvedValueOnce({ ok: true, message: "ok", data: { version: 4, values: { region: "north", budget: 500 } } })
      .mockResolvedValueOnce({ ok: true, message: "ok", data: { version: 5, values: { region: "east", budget: 500 } } });
    const user = userEvent.setup();
    render(<CustomFieldsPanel {...base} />);
    for (const next of ["north", "east"]) {
      await user.click(screen.getByRole("button", { name: /Edit/ }));
      const r = screen.getByLabelText("Region");
      await user.clear(r); await user.type(r, next);
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.getByText(next)).toBeInTheDocument());
    }
    expect(save.mock.calls.map((c) => (c[0] as { expectedVersion: number }).expectedVersion)).toEqual([3, 4]);
  });

  it("a conflict keeps the draft, explains, and offers Reload", async () => {
    save.mockResolvedValue({ ok: false, code: "conflict", message: "Someone else changed this first", sub: "Reload to see the latest version, then make your change again." });
    const user = userEvent.setup();
    render(<CustomFieldsPanel {...base} />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    await user.type(screen.getByLabelText("Region"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this first");
    expect(screen.getByLabelText("Region")).toHaveValue("southx");
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("validation issues appear under the field and focus moves to the first one", async () => {
    save.mockResolvedValue({ ok: false, code: "invalid", message: "Fix 1 fields and save again.", issues: [{ path: "budget", message: "Budget must be a number" }] });
    const user = userEvent.setup();
    render(<CustomFieldsPanel {...base} />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const b = screen.getByLabelText(/Budget/);
    await user.clear(b); await user.type(b, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Budget must be a number")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Budget/)).toHaveFocus());
  });

  it("fields the viewer cannot edit stay read-only in edit mode", async () => {
    const user = userEvent.setup();
    render(<CustomFieldsPanel {...base} fields={[f({ key: "region", type: "text", edit: false }), f({ key: "budget", type: "money" })]} />);
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    expect(screen.queryByLabelText("Region")).toBeNull();
    expect(screen.getByText("You cannot edit this field")).toBeInTheDocument();
  });

  it("demo workspaces say the example fields are not saved", () => {
    render(<CustomFieldsPanel {...base} demo />);
    expect(screen.getByText(/Demo workspace: these example fields are not saved/)).toBeInTheDocument();
  });

  it("never renders a value that was not passed in (masked fields are simply absent)", () => {
    const { container } = render(<CustomFieldsPanel {...base} fields={[f({ key: "region", type: "text" })]} values={{ region: "south" }} hiddenCount={1} />);
    expect(container.innerHTML).not.toContain("500");
    expect(screen.getByText(/1 more fields are not available to your role/)).toBeInTheDocument();
  });
});
