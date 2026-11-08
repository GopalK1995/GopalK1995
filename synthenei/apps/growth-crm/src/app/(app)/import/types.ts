// Types shared by the import actions and the client components (a "use server" file may not export types).
import type { ImportObject, Mapping, PlanSummary } from "@/lib/import/types";

export interface TargetView { key: string; label: string; required: boolean; custom: boolean }
export interface ObjectOption { key: ImportObject; label: string }

export interface UploadTicket { jobId: string; demo: boolean; path?: string; token?: string; bucket?: string }
export interface InspectView { headers: string[]; sample: Record<string, string>[]; rows: number; mapping: Mapping; targets: TargetView[]; savedUsed: boolean }
export interface ProblemView { rowNo: number; field: string; message: string }
export interface PreviewView { summary: PlanSummary; problems: ProblemView[] }

export type JobStatus = "uploaded" | "mapped" | "validating" | "running" | "done" | "failed" | "cancelled";
export interface JobView {
  id: string; object: string; status: JobStatus; mode: string; rowsTotal: number; rowsOk: number; rowsDup: number; rowsInvalid: number;
  hasReport: boolean; createdAt: string; finishedAt: string | null;
}

export interface ExportInput { object: ImportObject; ids?: string[]; maskPersonal: boolean }
export interface ExportView { csv: string; filename: string; rows: number; masked: boolean; truncated: boolean }
