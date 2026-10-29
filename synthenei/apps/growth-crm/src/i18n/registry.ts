// Static namespace registry. A later task adds its namespace with two lines here and two JSON files.
import enCommon from "../../messages/en/common.json";
import enShell from "../../messages/en/shell.json";
import enAuth from "../../messages/en/auth.json";
import enErrors from "../../messages/en/errors.json";
import taCommon from "../../messages/ta/common.json";
import taShell from "../../messages/ta/shell.json";
import taAuth from "../../messages/ta/auth.json";
import taErrors from "../../messages/ta/errors.json";
import type { Locale } from "./config";

export type Messages = { [k: string]: string | Messages };
export const BASE: Record<Locale, Messages> = {
  en: { common: enCommon, shell: enShell, auth: enAuth, errors: enErrors },
  ta: { common: taCommon, shell: taShell, auth: taAuth, errors: taErrors },
};
