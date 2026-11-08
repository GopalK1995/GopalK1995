// Import and export limits. One place so the dialog, the server actions and the job agree.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 60;
export const MAX_EXPORT_ROWS = 20_000;
export const SAMPLE_ROWS = 8;
export const WRITE_BATCH = 200;
/** Private Supabase Storage bucket. Objects live under `<tenant uuid>/<workspace uuid>/<job uuid>/<file>`. */
export const IMPORT_BUCKET = "imports";
export const ACCEPT_EXT = [".csv", ".xlsx"] as const;
export const MAX_ERROR_ROWS = 5_000;
