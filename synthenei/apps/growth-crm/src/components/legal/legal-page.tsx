import Link from "next/link";
import type { Metadata } from "next";
import { LEGAL_PATHS, val, type LegalDoc } from "@/lib/legal/content";
import type { LegalConfig } from "@/lib/legal/config";

/** Footer link set for the public and auth pages. */
export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`text-[12px] text-ink-3 ${className}`}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li><Link href={LEGAL_PATHS.privacy} className="underline-offset-2 hover:underline hover:text-ink-2">Privacy</Link></li>
        <li><Link href={LEGAL_PATHS.terms} className="underline-offset-2 hover:underline hover:text-ink-2">Terms</Link></li>
        <li><Link href={LEGAL_PATHS.dataDeletion} className="underline-offset-2 hover:underline hover:text-ink-2">Data deletion</Link></li>
      </ul>
    </nav>
  );
}

/** Honest banner for an unpublished page. Rendered whenever any required PLATFORM_* value is missing. */
export function DraftBanner({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div role="note" data-testid="legal-draft-banner" className="rounded-card border border-line-strong bg-warn-soft px-4 py-3 text-[13px] text-ink">
      <p className="font-semibold">DRAFT: this page is not yet published by the operator.</p>
      <p className="mt-1 text-ink-2">The operator has not filled in the legal details below, so this text is incomplete and is not final legal text. Do not rely on it. Missing: {missing.join(", ")}.</p>
    </div>
  );
}

/** robots: indexable only when every required value is set. */
export function legalMetadata(doc: Pick<LegalDoc, "title">, cfg: LegalConfig, path: string): Metadata {
  return {
    title: doc.title, alternates: { canonical: path },
    robots: cfg.published ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export function LegalPage({ doc, cfg }: { doc: LegalDoc; cfg: LegalConfig }) {
  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-4 py-10 sm:px-6" data-testid={`legal-${doc.slug}`}>
      <header className="grid gap-2">
        <p className="label-caps">{cfg.productName}</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{doc.title}</h1>
        <p className="text-[13px] text-ink-3">Effective {val(cfg, "effectiveDate")}</p>
        {doc.intro && <p className="text-[14px] text-ink-2">{doc.intro}</p>}
      </header>
      <DraftBanner missing={cfg.missing} />
      <nav aria-labelledby="toc-h" className="rounded-card border border-line bg-surface p-4">
        <h2 id="toc-h" className="text-[13px] font-semibold text-ink">Contents</h2>
        <ol className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {doc.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-accent underline-offset-2 hover:underline">{s.heading}</a></li>)}
        </ol>
      </nav>
      <article className="grid gap-6">
        {doc.sections.map((s) => (
          <section key={s.id} aria-labelledby={`h-${s.id}`} className="grid scroll-mt-6 gap-2" id={s.id}>
            <h2 id={`h-${s.id}`} className="text-[16px] font-semibold text-ink">{s.heading}</h2>
            {s.blocks.map((b, i) => Array.isArray(b)
              ? <ul key={i} className="grid list-disc gap-1 pl-5 text-[14px] leading-6 text-ink-2">{b.map((li, j) => <li key={j}>{li}</li>)}</ul>
              : <p key={i} className="text-[14px] leading-6 text-ink-2">{b}</p>)}
          </section>
        ))}
      </article>
      <footer className="grid gap-3 border-t border-line pt-4">
        <LegalFooter />
        {!cfg.published && <p className="text-[12px] text-ink-3">This text is a working draft and is not legal advice.</p>}
      </footer>
    </main>
  );
}
