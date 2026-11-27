"use client";
import { useEffect, useState } from "react";
import { errorCopy } from "@/lib/error-message";
import { LOCALE_COOKIE } from "@/i18n/config";

/** Last-resort boundary (the root layout itself failed). Plain markup with inline styles: no app CSS or providers are guaranteed here.
 * The language comes from the locale cookie (nothing else is available); never prints error text. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState("en");
  useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
    if (m) setLang(decodeURIComponent(m[1]));
    console.error("[global-error]", { digest: error.digest ?? null, name: error.name });
  }, [error]);
  const c = errorCopy(lang);
  return (
    <html lang={lang === "ta" ? "ta-IN" : "en-IN"}>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "Canvas", color: "CanvasText" }}>
        <main role="alert" style={{ maxWidth: 440, margin: "96px auto", padding: 24, background: "Canvas", border: "1px solid GrayText", borderRadius: 8 }}>
          <h1 style={{ fontSize: 19, margin: 0 }}>{c.fatalTitle}</h1>
          <p style={{ fontSize: 13, color: "GrayText" }}>{c.fatalBody}</p>
          {error.digest && <p style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "GrayText" }}>{c.boundaryId} {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", border: 0, borderRadius: 6, background: "CanvasText", color: "Canvas", fontSize: 13, cursor: "pointer" }}>{c.boundaryRetry}</button>
        </main>
      </body>
    </html>
  );
}
