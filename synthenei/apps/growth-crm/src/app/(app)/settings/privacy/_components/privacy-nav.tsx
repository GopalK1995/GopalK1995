import Link from "next/link";
import type { PrT } from "@/lib/privacy/strings";

/** Section links shared by the privacy pages. The current page is marked with aria-current. */
export function PrivacyNav({ t, current }: { t: PrT; current: "requests" | "retention" | "breaches" }) {
  const items = [
    { id: "requests", href: "/settings/privacy", label: t("owner.nav.requests") },
    { id: "retention", href: "/settings/privacy/retention", label: t("owner.nav.retention") },
    { id: "breaches", href: "/settings/privacy/breaches", label: t("owner.nav.breaches") },
  ] as const;
  return (
    <nav aria-label="Privacy" className="mb-4 flex gap-4 border-b border-line text-13">
      {items.map((i) => (
        <Link key={i.id} href={i.href} aria-current={i.id === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-1 pb-2 ${i.id === current ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{i.label}</Link>
      ))}
    </nav>
  );
}
