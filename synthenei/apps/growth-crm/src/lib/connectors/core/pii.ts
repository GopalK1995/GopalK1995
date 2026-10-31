// PII and secret scrubbing for sync runs, errors and logs. Reuses the audit redactor (one definition of "secret" and "PII").
import { redactDetail, redactLine } from "@/lib/audit/redact";

const MAX_SAMPLE_BYTES = 2048;

/** Removes secrets, masks personal fields and caps the result at 2 KB of JSON. Never throws. */
export function stripPii(sample: unknown): unknown {
  try {
    let v = redactDetail(sample);
    let s = JSON.stringify(v);
    if (s.length <= MAX_SAMPLE_BYTES) return v;
    if (Array.isArray(v)) {
      let arr = v as unknown[];
      while (arr.length > 1 && JSON.stringify(arr).length > MAX_SAMPLE_BYTES) arr = arr.slice(0, Math.ceil(arr.length / 2));
      v = arr; s = JSON.stringify(v);
      if (s.length <= MAX_SAMPLE_BYTES) return v;
    }
    return { truncated: true, preview: s.slice(0, MAX_SAMPLE_BYTES - 40) };
  } catch { return { truncated: true }; }
}
/** One human-readable line safe to store in sync_runs.error / job logs. */
export const safeError = (e: unknown, max = 300): string => redactLine(e instanceof Error ? e.message : String(e), max) || "Unknown error";
