import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/legal/legal-page";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { statusView, type StatusView } from "@/lib/legal/status-view";
import type { DeletionRow } from "@/lib/legal/meta-deletion";

// Public status of a data-deletion request, found by confirmation code. Never indexed (the code is the only secret); no user id is shown.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data deletion status", robots: { index: false, follow: false }, referrer: "no-referrer" };

async function lookup(code: string): Promise<DeletionRow | null | "unavailable"> {
  try {
    const { deletionDeps } = await import("@/lib/legal/meta-deletion-store");
    return await deletionDeps().store.byCode(code);
  } catch { console.error("[meta-deletion] status_lookup_unavailable"); return "unavailable"; }
}

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams;
  const code = (Array.isArray(sp.code) ? sp.code[0] : sp.code)?.trim() || undefined;
  const view: StatusView = statusView(code ? await lookup(code) : null, code);
  return (
    <main className="mx-auto grid max-w-xl gap-6 px-4 py-10 sm:px-6" data-testid="deletion-status">
      <header className="grid gap-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Data deletion status</h1>
        <p className="text-[13px] text-ink-3">Check a deletion request with its confirmation code.</p>
      </header>
      {view.kind === "found" && (
        <section aria-labelledby="st-h" className="grid gap-2 rounded-card border border-line bg-surface p-4" data-testid="deletion-status-found" data-status={view.status}>
          <h2 id="st-h" className="text-[16px] font-semibold text-ink">{view.title}</h2>
          <p role="status" className="text-[14px] leading-6 text-ink-2">{view.body}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-3">Requested</dt><dd className="num text-ink">{view.requested}</dd>
            {view.completed && <><dt className="text-ink-3">Completed</dt><dd className="num text-ink">{view.completed}</dd></>}
          </dl>
        </section>
      )}
      {view.kind === "not_found" && <p role="status" className="rounded-card border border-line bg-surface p-4 text-[14px] text-ink-2" data-testid="deletion-status-notfound">No request matches that code. Check the code and try again.</p>}
      {view.kind === "missing_code" && <p role="status" className="rounded-card border border-line bg-surface p-4 text-[14px] text-ink-2" data-testid="deletion-status-missing">Open this page with a confirmation code, for example {LEGAL_PATHS.status}?code=your-code.</p>}
      {view.kind === "unavailable" && <p role="status" className="rounded-card border border-line bg-warn-soft p-4 text-[14px] text-ink" data-testid="deletion-status-unavailable">Status lookup is not available right now. Please try again later or contact the operator.</p>}
      <footer className="grid gap-3 border-t border-line pt-4">
        <p className="text-[13px]"><Link href={LEGAL_PATHS.dataDeletion} className="text-accent underline-offset-2 hover:underline">How to delete your data</Link></p>
        <LegalFooter />
      </footer>
    </main>
  );
}
