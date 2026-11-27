import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("notFound");

/** Unknown URLs: a plain 404 with a way back. Not a role 403 and not the framework default. Copy comes from messages/{en,ta}/errors.json. */
export default async function NotFound() {
  const t = await getT("errors");
  return (
    <main className="mx-auto mt-24 max-w-md rounded-control border border-line bg-surface p-6">
      <Compass className="size-5 text-ink-3" aria-hidden />
      <h1 className="mt-3 text-[19px] font-bold">{t("notFoundTitle")}</h1>
      <p className="mt-1 text-[13px] text-ink-2">{t("notFoundBody")}</p>
      <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-5" })}>{t("notFoundHome")}</Link>
    </main>
  );
}
