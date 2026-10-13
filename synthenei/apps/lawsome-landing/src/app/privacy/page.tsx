export const metadata = { title: "Privacy notice — LAWSOME" };

export default function Privacy() {
  return (
    <main className="wrap" style={{ padding: "64px 0", maxWidth: 760 }}>
      <a href="/" style={{ color: "var(--c-blue-600)" }}>← Back</a>
      <h1 style={{ fontSize: "2rem", margin: "16px 0" }}>Privacy notice</h1>
      <p style={{ background: "var(--c-warn-bg)", padding: 12, borderRadius: 10, marginBottom: 20 }}><b>DRAFT — requires legal review before launch</b> (DPDP Act 2023 and applicable rules).</p>
      <p><b>What we collect.</b> The details you submit in the demo form (name, work email, law firm, role, optional phone) and, only if you accept analytics, anonymous page-usage events and campaign (UTM) parameters.</p>
      <p style={{ marginTop: 12 }}><b>Why.</b> To respond to your demo request and understand which campaigns work. We do not use this form to collect case or client data.</p>
      <p style={{ marginTop: 12 }}><b>Your choices.</b> You can decline analytics, and withdraw consent or request deletion at any time by contacting [privacy contact email — to be added].</p>
      <p style={{ marginTop: 12 }}><b>Retention and sharing.</b> [To be defined by the LAWSOME team.]</p>
    </main>
  );
}
