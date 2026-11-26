import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

/** Unknown URLs: a plain 404 with a way back. Not a role 403 and not the framework default. */
export default function NotFound() {
  return (
    <main className="mx-auto mt-24 max-w-md rounded-control border border-line bg-surface p-6">
      <Compass className="size-5 text-ink-3" aria-hidden />
      <h1 className="mt-3 text-[19px] font-bold">We could not find that page</h1>
      <p className="mt-1 text-[13px] text-ink-2">The address may be mistyped or the page may have moved. Go back to your home screen and use the menu from there.</p>
      <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-5" })}>Back to home</Link>
    </main>
  );
}
