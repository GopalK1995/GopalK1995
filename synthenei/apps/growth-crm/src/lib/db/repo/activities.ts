import { makeRepo, type DbProvider } from "./base";
import type { ActivityRow, ActivityInput } from "./types";

export function createActivitiesRepo(getDb?: DbProvider) {
  const r = makeRepo<ActivityRow, ActivityInput>({ table: "activities" }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updatePlain,
  };
}

export const activitiesRepo = createActivitiesRepo();
