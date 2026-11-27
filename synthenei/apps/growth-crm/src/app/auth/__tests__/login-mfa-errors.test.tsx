import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/actions", () => ({ demoLogin: vi.fn(), passwordLogin: vi.fn(), verifyMfa: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseConfigured: () => true,
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), mfa: { listFactors: async () => ({ data: { totp: [{ id: "f1", status: "verified" }], all: [] } }) } },
  }),
}));
vi.mock("@/lib/auth/cookies", () => ({ demoModeOn: () => false, safeNext: (n?: string) => n ?? null }));
vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ children }: { children: React.ReactNode }) => <button type="submit">{children}</button>,
  PendingButton: ({ children }: { children: React.ReactNode }) => <button type="submit">{children}</button>,
}));
vi.mock("@/components/legal/legal-page", () => ({ LegalFooter: () => null }));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { BASE } = await import("@/i18n/registry");
  return { getT: async (namespace: string) => createTranslator({ locale: "en", messages: BASE.en, namespace } as never), pageTitle: () => async () => ({}) };
});

import Login from "../../login/page";
import Mfa from "../mfa/page";

describe("login errors are tied to the fields (A11Y-021)", () => {
  it("marks email and password invalid and describes them by the alert on a credentials error", async () => {
    render(await Login({ searchParams: Promise.resolve({ error: "credentials" }) }));
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("login-error");
    for (const name of [/Work email/, /Password/]) {
      const f = screen.getByLabelText(name);
      expect(f).toHaveAttribute("aria-invalid", "true");
      expect(f).toHaveAttribute("aria-describedby", alert.id);
    }
  });
  it("leaves the fields untouched when there is no error", async () => {
    render(await Login({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText(/Work email/)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText(/Work email/)).not.toHaveAttribute("aria-describedby");
  });
});

describe("MFA error is tied to the code field (A11Y-021)", () => {
  it("marks the code invalid and describes it by the alert", async () => {
    render(await Mfa({ searchParams: Promise.resolve({ error: "1" }) }));
    const alert = screen.getByRole("alert");
    const code = screen.getByLabelText(/6-digit code/);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", alert.id);
    expect(alert.id).toBe("mfa-error");
  });
  it("has no invalid state before an error", async () => {
    render(await Mfa({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText(/6-digit code/)).not.toHaveAttribute("aria-invalid");
  });
});
