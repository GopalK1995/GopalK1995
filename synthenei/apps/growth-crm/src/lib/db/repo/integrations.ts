import { makeRepo, type DbProvider } from "./base";
import type { IntegrationRow, IntegrationInput } from "./types";

export function createIntegrationsRepo(getDb?: DbProvider) {
  const r = makeRepo<IntegrationRow, IntegrationInput>({ table: "integrations" }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updatePlain,
  };
}

export const integrationsRepo = createIntegrationsRepo();
