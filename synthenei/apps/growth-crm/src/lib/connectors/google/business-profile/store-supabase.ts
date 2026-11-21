// Supabase implementation of GbpStore on the SERVICE-ROLE client (scheduled jobs, CONTRACTS C6). RLS does not protect this path, so every
// query is explicitly scoped by tenant_id / workspace_id / integration id. `reviews` is 0019 (its trigger enforces the reply state
// machine and the named approver). Optional columns (reply_source, reply_error, external_reply*) and the gbp_daily table come from the
// SQL under "T045 needs"; without the columns the store falls back to the 0019 shape, without the table the daily stream fails loudly.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { GbpStore, ReplySource, ReplyStatus, StoredReview } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`gbp store: ${what} failed`);   // PostgREST text can quote values: not echoed
const CHUNK = 200;
const missingColumn = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");

export function supabaseGbpStore(db: Db): GbpStore {
  const q = (t: string) => from(db, t);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const toReview = (r: R): StoredReview => ({
    id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), connectionId: str(r.integration_id), externalId: str(r.external_id),
    rating: typeof r.rating === "number" ? r.rating : null, text: str(r.review_text), author: str(r.author_name),
    replyDraft: str(r.reply_draft), replyStatus: (str(r.reply_status) ?? "none") as ReplyStatus, replyApprovedBy: str(r.reply_approved_by), replySource: str(r.reply_source) as ReplySource | null,
  });
  return {
    async upsertReviews(rows, ctx) {
      let created = 0, updated = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const { data, error } = await q("reviews").select("id, external_id, rating, review_text, author_name, reviewed_at")
          .eq("tenant_id", ctx.tenantId).eq("workspace_id", ctx.workspaceId).eq("integration_id", ctx.connectionId).in("external_id", part.map((r) => r.externalId));
        if (error) throw failed("review lookup");
        const known = new Map(((data as R[] | null) ?? []).map((r) => [String(r.external_id), r]));
        const fresh = [];
        for (const r of part) {
          const hit = known.get(r.externalId);
          const core = { rating: r.rating, review_text: r.text, author_name: r.author, reviewed_at: r.reviewedAt };
          const ext = { external_reply: r.externalReply, external_reply_at: r.externalReplyAt };
          if (!hit) { fresh.push({ tenant_id: ctx.tenantId, workspace_id: ctx.workspaceId, integration_id: ctx.connectionId, external_id: r.externalId, ...core, ...ext }); continue; }
          const same = hit.rating === core.rating && (hit.review_text ?? null) === core.review_text && (hit.author_name ?? null) === core.author_name && (hit.reviewed_at ? new Date(String(hit.reviewed_at)).toISOString() : null) === core.reviewed_at;
          const scoped = (b: Qb) => b.eq("id", String(hit.id)).eq("tenant_id", ctx.tenantId).eq("workspace_id", ctx.workspaceId);
          let res = await scoped(q("reviews").update({ ...core, ...ext, updated_at: new Date().toISOString() }));
          if (missingColumn(res.error)) res = same ? { data: null, error: null } : await scoped(q("reviews").update({ ...core, updated_at: new Date().toISOString() }));
          if (res.error) throw failed("review update");
          if (!same) updated++;
        }
        if (fresh.length) {
          let res = await q("reviews").insert(fresh);
          if (missingColumn(res.error)) res = await q("reviews").insert(fresh.map(({ external_reply: _a, external_reply_at: _b, ...core }) => core));
          if (res.error) throw failed("review insert");
          created += fresh.length;
        }
      }
      return { created, updated };
    },
    async upsertDaily(rows, ctx) {
      const now = new Date().toISOString();
      const data = rows.map((m) => ({
        tenant_id: ctx.tenantId, workspace_id: ctx.workspaceId, integration_id: ctx.connectionId, location_id: ctx.locationId, day: m.day,
        impressions_search: m.impressionsSearch, impressions_maps: m.impressionsMaps, call_clicks: m.callClicks, website_clicks: m.websiteClicks,
        direction_requests: m.directionRequests, conversations: m.conversations, bookings: m.bookings, food_orders: m.foodOrders, source: ctx.source, imported_at: now,
      }));
      type Upsertable = { from(t: string): { upsert(v: R[], o: { onConflict: string }): PromiseLike<{ error: { code?: string } | null }> } };
      for (let i = 0; i < data.length; i += CHUNK) {
        const { error } = await (db as unknown as Upsertable).from("gbp_daily").upsert(data.slice(i, i + CHUNK), { onConflict: "workspace_id,integration_id,day" });
        if (error) throw failed("daily upsert");
      }
    },
    async getReview(scope, id) {
      const { data, error } = await q("reviews").select("*").eq("id", id).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).limit(1);
      if (error) throw failed("review read");
      const r = ((data as R[] | null) ?? [])[0];
      return r ? toReview(r) : null;
    },
    async updateReply(scope, id, expect, patch) {
      const core: R = {};
      if (patch.replyDraft !== undefined) core.reply_draft = patch.replyDraft;
      if (patch.replyStatus !== undefined) core.reply_status = patch.replyStatus;
      if (patch.replyApprovedBy !== undefined) core.reply_approved_by = patch.replyApprovedBy;
      core.updated_at = new Date().toISOString();
      const extra: R = {};
      if (patch.replySource !== undefined) extra.reply_source = patch.replySource;
      if (patch.replyError !== undefined) extra.reply_error = patch.replyError;
      const run = (v: R) => q("reviews").update(v).eq("id", id).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).in("reply_status", expect).select("id");
      let res = await run({ ...core, ...extra });
      if (missingColumn(res.error) && Object.keys(extra).length) res = await run(core);
      if (res.error) throw failed("reply update");
      return (((res.data as R[] | null) ?? []).length) > 0;
    },
  };
}
