import { makeRepo, type DbProvider } from "./base";
import type { Contact, ContactInput } from "./types";

export function createContactsRepo(getDb?: DbProvider) {
  const r = makeRepo<Contact, ContactInput>({ table: "contacts", softDelete: true }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    softDelete: r.softDeleteV,
  };
}

export const contactsRepo = createContactsRepo();
