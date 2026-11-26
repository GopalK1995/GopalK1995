export type HitType = "lead" | "account" | "contact" | "task" | "deal" | "campaign" | "record";
export interface SearchHit {
  /** Stable key for lists and recent items: `<type>:<id>` (custom objects: `obj:<key>:<id>`). */
  key: string;
  type: HitType;
  /** Custom object key for type "record". */
  objectKey?: string;
  title: string;
  subtitle?: string;
  href: string;
  /** The title was masked for this viewer (no pii.read). */
  masked?: boolean;
}
/** An action the viewer may run (already filtered by permission on the server). */
export interface SearchAction { id: "new-lead" | "log-call" | "new-task" | "import-leads"; href: string }
export interface SearchResponse {
  hits: SearchHit[];
  /** Present on the bootstrap call (empty q). */
  actions?: SearchAction[];
  /** Hit types the viewer may search, so recent items can be filtered client-side. */
  types?: HitType[];
  /** Custom object keys the viewer may search. */
  objects?: string[];
  tooShort?: boolean;
  /** Some sources failed; the others are still shown. */
  partial?: boolean;
}
export const HIT_LIMIT = 6;
