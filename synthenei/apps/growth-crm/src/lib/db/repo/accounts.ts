import { makeRepo, type DbProvider } from "./base";
import type { Account, AccountInput } from "./types";

export function createAccountsRepo(getDb?: DbProvider) {
  const r = makeRepo<Account, AccountInput>({ table: "accounts", softDelete: true }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    softDelete: r.softDeleteV,
  };
}

export const accountsRepo = createAccountsRepo();
