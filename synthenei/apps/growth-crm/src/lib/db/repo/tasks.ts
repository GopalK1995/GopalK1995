import { dbForRequest } from "../client";
import { throwIfError } from "../errors";
import { from } from "../query";
import { makeRepo, type DbProvider } from "./base";
import type { TaskInput, TaskRow } from "./types";

export function createTasksRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<TaskRow, TaskInput>({ table: "tasks" }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    /** Mark tasks done. Idempotent: already completed tasks are left alone. */
    async complete(ws: string, ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const db = await getDb();
      const { error } = await from(db, "tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("workspace_id", ws).in("id", ids).is("completed_at", null);
      throwIfError(error);
    },
  };
}

export const tasksRepo = createTasksRepo();
