"use client";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Check, Languages } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, tamilUiEnabled, type Locale } from "@/i18n/config";
import { MenuItem, MenuLabel } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { fieldCls } from "@/components/ui/field-styles";

/** Language names are written in their own script and never translated, so a user who cannot read the current UI can still find theirs. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", ta: "தமிழ் (Tamil)" };

/** Shared by the user menu and the profile page: switch, store (cookie + profile), then re-render the server tree so lang, font and messages follow. */
function useChooseLanguage() {
  const t = useTranslations("shell");
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (next: Locale) => start(async () => {
    const r = await setLocale(next);
    if (!r.ok) { toast(r.reason === "unavailable" ? t("language.unavailable") : t("language.failed"), undefined, { variant: "error" }); return; }
    toast(t("language.saved"), r.saved ? undefined : t("language.savedDevice"), { variant: "success" });
    router.refresh();
  });
  return { choose, pending };
}
/** Tamil stays selectable only when the review gate is open (NEXT_PUBLIC_TAMIL_UI=1); otherwise it is listed but disabled, with the reason. */
const available = (l: Locale) => l !== "ta" || tamilUiEnabled();

export function LanguageMenuItems() {
  const t = useTranslations("shell");
  const current = useLocale() as Locale;
  const { choose, pending } = useChooseLanguage();
  return (
    <>
      <MenuLabel>{t("language.label")}</MenuLabel>
      {LOCALES.map((l) => (
        <MenuItem key={l} disabled={pending || !available(l)} onSelect={() => { if (l !== current) choose(l); }}>
          {l === current ? <Check /> : <Languages />}
          <span lang={l === "ta" ? "ta-IN" : "en-IN"}>{LANGUAGE_NAMES[l]}</span>
        </MenuItem>
      ))}
    </>
  );
}

export function LanguageSelect() {
  const t = useTranslations("shell");
  const current = useLocale() as Locale;
  const { choose, pending } = useChooseLanguage();
  return (
    <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("language.label")}</span>
      <select className={fieldCls} value={current} disabled={pending} onChange={(e) => choose(e.target.value as Locale)} aria-describedby={tamilUiEnabled() ? undefined : "lang-note"}>
        {LOCALES.map((l) => <option key={l} value={l} disabled={!available(l)} lang={l === "ta" ? "ta-IN" : "en-IN"}>{LANGUAGE_NAMES[l]}</option>)}
      </select>
      {!tamilUiEnabled() && <span id="lang-note" className="mt-1 block text-[12px] text-ink-3">{t("language.unavailable")}</span>}
    </label>
  );
}
