// Demo personas (login page buttons carry data-persona) and the home route each role lands on.
// Keep home in sync with HOME_FOR in src/lib/auth/roles.ts (checked by src/test/__tests__/personas.test.ts).
export type Persona = "super" | "owner-lawsome" | "rep-lawsome" | "mkt-lawsome" | "viewer-lawsome" | "owner-kaveri";

export const PERSONAS: Record<Persona, { role: string | null; home: string }> = {
  super: { role: null, home: "/admin" },
  "owner-lawsome": { role: "owner", home: "/" },
  "rep-lawsome": { role: "sales_rep", home: "/sales" },
  "mkt-lawsome": { role: "marketing", home: "/campaigns" },
  "viewer-lawsome": { role: "viewer", home: "/" },
  "owner-kaveri": { role: "owner", home: "/" },
};

export const DEMO_SUPER_CODE = "482915";
