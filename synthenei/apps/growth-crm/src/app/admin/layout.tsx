import type { Metadata } from "next";
import type { ReactNode } from "react";

// Platform admin area. /admin/login renders bare; every console page sits in the (console) group, whose layout
// re-checks requirePlatformAdmin() and draws the navy "Platform admin · Synthan" strip.
export const metadata: Metadata = { title: { default: "Platform admin", template: "%s · Platform admin · Synthan" }, robots: { index: false } };
export default function AdminRoot({ children }: { children: ReactNode }) {
  return children;
}
