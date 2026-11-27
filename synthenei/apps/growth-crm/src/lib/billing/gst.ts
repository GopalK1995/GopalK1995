// GST maths in integer paise. Rate and seller GSTIN come from config. Intra-state supply (buyer state = seller state) splits into CGST + SGST,
// anything else (or an unknown place of supply) is IGST.
export interface Tax { rateBps: number; cgst: number; sgst: number; igst: number; total: number; kind: "intra" | "inter" }
export const stateCodeOf = (gstin?: string | null): string | null => (gstin && /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : null);

export function computeTax(taxablePaise: number, ratePercent: number, sellerGstin: string, buyerState: string | null): Tax {
  if (!Number.isInteger(taxablePaise) || taxablePaise < 0) throw new Error("taxable amount must be whole paise >= 0");
  const rateBps = Math.round(ratePercent * 100);
  const total = Math.round((taxablePaise * rateBps) / 10000);
  const intra = buyerState != null && buyerState === stateCodeOf(sellerGstin);
  if (!intra) return { rateBps, cgst: 0, sgst: 0, igst: total, total, kind: "inter" };
  const cgst = Math.floor(total / 2);
  return { rateBps, cgst, sgst: total - cgst, igst: 0, total, kind: "intra" };
}
/** Place of supply: the buyer GSTIN's state, else the billing address state code. */
export const placeOfSupply = (gstin: string | null | undefined, stateCode: string | null | undefined): string | null =>
  stateCodeOf(gstin) ?? (stateCode && /^[0-9]{2}$/.test(stateCode) ? stateCode : null);

/** Indian digit grouping, two decimals: 1234567 paise -> "12,345.67". */
export function fmtInr(paise: number): string {
  if (!Number.isFinite(paise)) return "No data";
  const neg = paise < 0, a = Math.abs(paise), r = String(Math.floor(a / 100)), p = String(a % 100).padStart(2, "0");
  const last3 = r.slice(-3), rest = r.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}${grouped}.${p}`;
}

/** "1234.50" -> 123450. Exact decimal parsing, no floats; null when not a plain amount with at most two decimals. */
export function rupeesToPaise(x: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(x.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0) : null;
}
