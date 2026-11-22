// Minimal single-page A4 PDF writer for GST tax invoices: text only, built-in Helvetica (no font files, no dependency).
// Pure and deterministic. Characters outside Latin-1 print as "?" (the rupee sign is written "INR").
import { computeTax, fmtInr, placeOfSupply, stateCodeOf } from "./gst";
import type { IssuerConfig } from "./config";
import type { BillingAddress, InvoiceRow } from "./types";

export interface InvoiceDoc {
  invoice: InvoiceRow; issuer: IssuerConfig;
  buyer: { name: string; gstin: string | null; address: BillingAddress | null };
  description: string;
}
const esc = (s: string) => Array.from(s).map((c) => { const n = c.codePointAt(0)!; return n > 255 ? "?" : c; }).join("").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

type Op = { x: number; y: number; t: string; size?: number; bold?: boolean; right?: boolean };
const W = 595, H = 842, M = 48;
const textWidth = (t: string, size: number) => t.length * size * 0.5;  // Helvetica averages ~0.5 em; good enough for right alignment

export function invoiceLines(d: InvoiceDoc): Op[] {
  const { invoice: inv, issuer: is, buyer } = d;
  const tax = computeTax(inv.amountPaise, is.gstRatePercent, is.gstin, placeOfSupply(buyer.gstin, buyer.address?.stateCode));
  const ops: Op[] = [];
  let y = H - M;
  const put = (t: string, o: Partial<Op> = {}) => { ops.push({ x: M, y, t, ...o }); y -= (o.size ?? 10) + 5; };
  put(is.legalName, { size: 16, bold: true });
  for (const l of is.address) put(l);
  put(`GSTIN: ${is.gstin}`);
  y -= 8;
  put("TAX INVOICE", { size: 14, bold: true });
  put(`Invoice no: ${inv.number}`);
  put(`Date: ${(inv.issuedAt ?? inv.createdAt).slice(0, 10)}`);
  put(`Period: ${inv.periodStart} to ${inv.periodEnd}`);
  if (inv.status === "void") put("VOID", { size: 14, bold: true });
  y -= 8;
  put("Bill to", { bold: true });
  put(buyer.name);
  const a = buyer.address;
  for (const l of [a?.line1, a?.line2, [a?.city, a?.state, a?.pincode].filter(Boolean).join(" ")]) if (l) put(l);
  if (buyer.gstin) put(`GSTIN: ${buyer.gstin}`);
  const pos = placeOfSupply(buyer.gstin, a?.stateCode);
  put(`Place of supply: ${pos ?? "not stated"}${pos && pos !== stateCodeOf(is.gstin) ? " (inter-state)" : ""}`);
  y -= 10;
  // table
  const col = { desc: M, sac: 330, amt: W - M };
  ops.push({ x: col.desc, y, t: "Description", bold: true }); ops.push({ x: col.sac, y, t: "SAC", bold: true }); ops.push({ x: col.amt, y, t: "Taxable value (INR)", bold: true, right: true });
  y -= 18;
  ops.push({ x: col.desc, y, t: d.description }); ops.push({ x: col.sac, y, t: inv.sacCode }); ops.push({ x: col.amt, y, t: fmtInr(inv.amountPaise), right: true });
  y -= 28;
  const rate = `${(tax.rateBps / 100).toString()}%`;
  const row = (label: string, paise: number, bold = false) => { ops.push({ x: 330, y, t: label, bold }); ops.push({ x: col.amt, y, t: fmtInr(paise), right: true, bold }); y -= 16; };
  row("Taxable value", inv.amountPaise);
  if (tax.kind === "intra") { row(`CGST @ ${(tax.rateBps / 200).toString()}%`, tax.cgst); row(`SGST @ ${(tax.rateBps / 200).toString()}%`, tax.sgst); }
  else row(`IGST @ ${rate}`, tax.igst);
  row("Total (INR)", inv.amountPaise + inv.gstPaise, true);
  if (inv.gstPaise !== tax.total) put(`Note: stored tax ${fmtInr(inv.gstPaise)} differs from the computed ${fmtInr(tax.total)}`, { size: 8 });
  y -= 16;
  put(`Status: ${inv.status}`);
  put("This is a computer generated invoice.", { size: 8 });
  return ops;
}

export function renderInvoicePdf(d: InvoiceDoc): Uint8Array {
  const ops = invoiceLines(d);
  const content = ops.map((o) => {
    const size = o.size ?? 10, x = o.right ? o.x - textWidth(o.t, size) : o.x;
    return `BT /${o.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${o.y.toFixed(2)} Td (${esc(o.t)}) Tj ET`;
  }).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
