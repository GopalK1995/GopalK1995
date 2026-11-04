// Shared shapes for custom-object pages. Client-safe (no server imports).
import type { FieldFilters } from "@/lib/metadata/filters";

export interface ObjectRecord {
  id: string; title: string; data: Record<string, unknown>; ownerId: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface SortSpec { id: string; desc: boolean }
export type ViewVisibility = "private" | "team" | "workspace";
export const VIEW_VISIBILITIES: ViewVisibility[] = ["private", "team", "workspace"];

export interface SavedView {
  id: string; objectTypeId: string; ownerId: string | null; name: string; filters: FieldFilters; sort: SortSpec[]; columns: string[];
  visibility: ViewVisibility; position: number;
}
export interface LinkRow { id: string; fromType: string; fromId: string; toType: string; toId: string; relation: string }
export interface RelatedItem { linkId: string; direction: "from" | "to"; type: string; id: string; title: string; href: string | null; relation: string; objectLabel: string | null; canRemove: boolean }

export interface LinkCandidate { key: string; id: string; label: string }

/** The shape of one table row passed to the list client (values already masked on the server). */
export interface ListRow { id: string; title: string; custom: Record<string, unknown>; updatedAt: string; version: number }

export const PAGE_LIMIT = 200;
export const WIDE_LIMIT = 1000;
