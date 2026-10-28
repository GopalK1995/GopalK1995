// Conditions evaluator (CONTRACTS C3.3). Fail closed: anything not understood evaluates to false.
export interface ConditionContext { record?: Record<string, unknown>; principal: Record<string, unknown>; now: Date }
export interface Issue { path: string; message: string }

export const OPERATORS = ["eq", "neq", "in", "nin", "contains", "gte", "lte", "between_hours", "is_true"] as const;
const PREFIXES = ["record.", "principal."];
const MAX_DEPTH = 2, MAX_CLAUSES = 10;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isEmpty = (c: unknown) => c == null || (isObj(c) && Object.keys(c).length === 0);
const fieldOk = (f: unknown) => typeof f === "string" && (f === "now" || PREFIXES.some((p) => f.startsWith(p)));
const hhmm = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string" && /^\d{2}:\d{2}$/.test(x));

/** Static validation (used when saving roles). Empty list = valid. */
export function validateConditions(json: unknown): Issue[] {
  const issues: Issue[] = [];
  let clauses = 0;
  const walk = (node: unknown, depth: number, path: string) => {
    if (!isObj(node)) { issues.push({ path, message: "must be an object" }); return; }
    const group = "all" in node ? "all" : "any" in node ? "any" : null;
    if (group) {
      if (depth > MAX_DEPTH) { issues.push({ path, message: "nesting deeper than 2" }); return; }
      const list = node[group];
      if (Object.keys(node).length !== 1 || !Array.isArray(list)) { issues.push({ path, message: `${group} must be a list` }); return; }
      list.forEach((c, i) => walk(c, depth + 1, `${path}.${group}[${i}]`));
      return;
    }
    clauses++;
    if (!fieldOk(node.field)) issues.push({ path, message: "unknown field prefix" });
    if (!(OPERATORS as readonly string[]).includes(node.op as string)) issues.push({ path, message: "unknown operator" });
    if (node.op === "between_hours" && !hhmm(node.value)) issues.push({ path, message: "between_hours needs [HH:MM, HH:MM]" });
  };
  if (isEmpty(json)) return issues;
  walk(json, 1, "$");
  if (clauses > MAX_CLAUSES) issues.push({ path: "$", message: "more than 10 clauses" });
  return issues;
}

function resolvePath(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const k of path) { if (!isObj(cur)) return undefined; cur = cur[k]; }
  return cur;
}
function resolveField(field: string, ctx: ConditionContext): unknown {
  if (field === "now") return ctx.now;
  if (field.startsWith("record.")) return resolvePath(ctx.record ?? {}, field.slice(7).split("."));
  if (field.startsWith("principal.")) return resolvePath(ctx.principal, field.slice(10).split("."));
  return undefined;
}
const resolveValue = (v: unknown, ctx: ConditionContext): unknown =>
  typeof v === "string" && v.startsWith("@principal.") ? resolvePath(ctx.principal, v.slice(11).split(".")) : v;

function minutesIn(now: Date, tz: string | undefined): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value), m = Number(parts.find((p) => p.type === "minute")?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  } catch { return null; }
}
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const cmp = (a: unknown, b: unknown): number | null => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
};

function clauseOk(c: Record<string, unknown>, ctx: ConditionContext): boolean {
  if (!fieldOk(c.field)) return false;
  const left = resolveField(c.field as string, ctx), right = resolveValue(c.value, ctx);
  if (c.op === "between_hours") {
    if (!(left instanceof Date) || !hhmm(right)) return false;
    const t = minutesIn(left, typeof c.tz === "string" ? c.tz : undefined);
    if (t === null) return false;
    const [a, b] = (right as string[]).map(toMin);
    return a <= b ? t >= a && t < b : t >= a || t < b;
  }
  if (left === undefined || left === null) return false;
  switch (c.op) {
    case "eq": return left === right;
    case "neq": return right !== undefined && left !== right;
    case "in": return Array.isArray(right) && right.includes(left);
    case "nin": return Array.isArray(right) && !right.includes(left);
    case "contains": return Array.isArray(left) ? left.includes(right) : typeof left === "string" && typeof right === "string" && left.includes(right);
    case "gte": { const r = cmp(left, right); return r !== null && r >= 0; }
    case "lte": { const r = cmp(left, right); return r !== null && r <= 0; }
    case "is_true": return left === true;
    default: return false;
  }
}

function nodeOk(node: unknown, depth: number, ctx: ConditionContext): boolean {
  if (!isObj(node)) return false;
  if ("all" in node || "any" in node) {
    const g = "all" in node ? "all" : "any", list = node[g];
    if (depth > MAX_DEPTH || Object.keys(node).length !== 1 || !Array.isArray(list)) return false;
    return g === "all" ? list.every((c) => nodeOk(c, depth + 1, ctx)) : list.some((c) => nodeOk(c, depth + 1, ctx));
  }
  return clauseOk(node, ctx);
}

/** Empty or missing conditions pass. Invalid conditions fail closed. */
export function evaluateConditions(json: unknown, ctx: ConditionContext): boolean {
  if (isEmpty(json)) return true;
  if (validateConditions(json).length > 0) return false;
  return nodeOk(json, 1, ctx);
}
