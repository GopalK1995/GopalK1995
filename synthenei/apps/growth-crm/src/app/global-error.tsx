"use client";

/** Last-resort boundary (the root layout itself failed). Plain markup with inline styles: no app CSS or providers are guaranteed here. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f6f7f9", color: "#0e2236" }}>
        <main role="alert" style={{ maxWidth: 440, margin: "96px auto", padding: 24, background: "#fff", border: "1px solid #d9dee5", borderRadius: 8 }}>
          <h1 style={{ fontSize: 19, margin: 0 }}>Something went wrong on our side</h1>
          <p style={{ fontSize: 13, color: "#4a5a6a" }}>The app could not start this screen. Try again, and if it keeps happening tell your admin.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", border: 0, borderRadius: 6, background: "#0e2236", color: "#fff", fontSize: 13, cursor: "pointer" }}>Retry</button>
        </main>
      </body>
    </html>
  );
}
