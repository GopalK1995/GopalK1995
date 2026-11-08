// Formula-injection-safe CSV writing. A cell that a spreadsheet would read as a formula (starts with = + - @, a tab or a
// carriage return, also after leading spaces, or the full-width forms) gets a leading apostrophe, so it opens as text.
const TRIGGER = /^[\s ]*[=+\-@＝＋－＠]|^[\t\r]/;

export function guardCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return typeof v === "string" || typeof v === "object" ? (TRIGGER.test(s) ? `'${s}` : s) : s;
}

export function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ToCsvOptions { bom?: boolean }
/** Rows of raw values -> CSV text with every cell guarded and escaped. CRLF line ends (Excel-friendly). */
export function toCsv(headers: string[], rows: unknown[][], opts: ToCsvOptions = {}): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvEscape(guardCell(c))).join(","));
  return `${opts.bom ? "﻿" : ""}${lines.join("\r\n")}\r\n`;
}
