// Minimal structural view of the PostgREST builder, so repositories stay generic over tables without `any`.
import type { Db } from "./client";
import type { PgErrorLike } from "./errors";

export interface QResult { data: unknown; error: PgErrorLike | null }
export interface Qb extends PromiseLike<QResult> {
  select(cols?: string): Qb;
  insert(v: Record<string, unknown> | Record<string, unknown>[]): Qb;
  update(v: Record<string, unknown>): Qb;
  eq(c: string, v: unknown): Qb;
  neq(c: string, v: unknown): Qb;
  gt(c: string, v: unknown): Qb;
  gte(c: string, v: unknown): Qb;
  lt(c: string, v: unknown): Qb;
  lte(c: string, v: unknown): Qb;
  in(c: string, v: unknown[]): Qb;
  ilike(c: string, v: string): Qb;
  is(c: string, v: null | boolean): Qb;
  or(f: string): Qb;
  order(c: string, o?: { ascending?: boolean }): Qb;
  limit(n: number): Qb;
  single(): Qb;
  maybeSingle(): Qb;
}

export const from = (db: Db, table: string): Qb => (db as unknown as { from(t: string): Qb }).from(table);
