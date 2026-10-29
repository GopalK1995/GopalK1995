import { makeRepo, type DbProvider } from "./base";
import type { CampaignRow, CampaignInput } from "./types";

export function createCampaignsRepo(getDb?: DbProvider) {
  const r = makeRepo<CampaignRow, CampaignInput>({ table: "campaigns" }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
  };
}

export const campaignsRepo = createCampaignsRepo();
