/** In production Next replaces server error text with a generic sentence (plus a digest); showing that is noise, and in dev it can leak internals. */
export function humanMessage(error: { message?: string; digest?: string }): string {
  const m = error.message ?? "";
  if (error.digest || !m || /Server Components render|omitted in production/i.test(m)) return "Something went wrong while loading this page. Retry in a moment; if it keeps happening, quote the error id below to your admin.";
  if (/^Could not read [a-z_]+:/i.test(m)) return "We could not read this data from the database. Retry in a moment; if it keeps happening, quote the error id below to your admin.";
  return "This page hit an unexpected problem. Retry in a moment.";
}
