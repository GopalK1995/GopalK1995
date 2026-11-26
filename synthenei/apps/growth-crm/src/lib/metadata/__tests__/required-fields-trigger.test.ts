// The 0028 trigger must understand every catalogue key the app enforces (src/lib/metadata/pipelines.ts REQUIRED_FIELD_CATALOGUE.deal), and stay idempotent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_FIELD_CATALOGUE } from "../pipelines";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0028_deal_required_fields_trigger.sql"), "utf8");

describe("migration 0028 deals required-fields trigger", () => {
  it("handles every deal catalogue key", () => {
    for (const f of REQUIRED_FIELD_CATALOGUE.deal) expect(sql).toContain(`v_k = '${f.key}'`);
    expect(sql).toContain("like 'custom.%'");
  });
  it("is a BEFORE UPDATE OF stage_id trigger, idempotent, errcode 23514", () => {
    expect(sql).toMatch(/create or replace function metadata\.deals_required_fields_guard/);
    expect(sql).toMatch(/drop trigger if exists z9_deals_required_fields/);
    expect(sql).toMatch(/before update of stage_id on public\.deals/);
    expect(sql).toContain("errcode = '23514'");
  });
  it("does nothing when the stage does not change", () => {
    expect(sql).toContain("new.stage_id is not distinct from old.stage_id then return new");
  });
});
