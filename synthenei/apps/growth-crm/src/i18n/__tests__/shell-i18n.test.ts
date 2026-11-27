// AUD-044: shell, navigation, titles and auth copy come from messages; Tamil is complete for them and always falls back to English.
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { BASE } from "../registry";
import { messagesFor } from "../layering";
import { NAV, NAV_GROUP_KEYS, NAV_ITEM_KEYS, navGroup, navLabel, OBJECTS_GROUP } from "@/components/shell/nav";
import { vocabFor } from "@/lib/vertical";
import { TENANTS } from "@/lib/tenancy";

const leaves = (o: unknown, path = ""): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k)) : [path]);
const tr = (locale: "en" | "ta", ns: string) => createTranslator({ locale, messages: messagesFor(locale), namespace: ns } as never) as (k: string, v?: Record<string, string | number>) => string;

describe("Tamil drafts cover the shell, auth and titles namespaces", () => {
  for (const ns of ["shell", "auth", "titles"]) {
    it(`${ns}: every English key has a Tamil draft`, () => {
      const ta = new Set(leaves(BASE.ta[ns]));
      expect(leaves(BASE.en[ns]).filter((k) => !ta.has(k))).toEqual([]);
    });
  }
});

describe("navigation labels", () => {
  const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
  it("every nav item and group has a message key present in en and ta", () => {
    for (const h of hrefs) {
      expect(NAV_ITEM_KEYS[h], h).toBeTruthy();
      expect(BASE.en.shell, h).toHaveProperty(["nav", "item", NAV_ITEM_KEYS[h]]);
      expect(BASE.ta.shell, h).toHaveProperty(["nav", "item", NAV_ITEM_KEYS[h]]);
    }
    for (const g of [...NAV.map((x) => x.group), OBJECTS_GROUP]) expect(NAV_GROUP_KEYS[g], g).toBeTruthy();
  });
  const v = vocabFor(TENANTS[0]);
  it("English output is unchanged and Tamil output is translated", () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.href === "/tasks")!;
    expect(navLabel(v, item, tr("en", "shell"))).toBe("Tasks");
    expect(navLabel(v, item, tr("ta", "shell"))).toBe(BASE.ta.shell && (BASE.ta.shell as never as { nav: { item: { tasks: string } } }).nav.item.tasks);
    expect(navLabel(v, item)).toBe("Tasks");
    expect(navGroup(v, "Admin", tr("ta", "shell"))).not.toBe("Admin");
  });
  it("a tenant vocabulary rename still wins in every language", () => {
    const custom = { ...v, nav: { ...v.nav, leads: "Enquiries" } };
    const leads = NAV.flatMap((g) => g.items).find((i) => i.href === "/leads")!;
    expect(navLabel(custom, leads, tr("ta", "shell"))).toBe("Enquiries");
  });
});

describe("fallback", () => {
  it("a Tamil locale with a missing key renders the English string, not a key name", () => {
    const m = messagesFor("ta", undefined, undefined, { en: { shell: { a: "A", b: "B" } }, ta: { shell: { a: "அ" } } });
    const t = createTranslator({ locale: "ta", messages: m, namespace: "shell" } as never) as (k: string) => string;
    expect([t("a"), t("b")]).toEqual(["அ", "B"]);
  });
});
