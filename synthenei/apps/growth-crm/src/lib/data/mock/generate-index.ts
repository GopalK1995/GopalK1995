// Workspace-scoped datasets, built lazily once per process.
import type { Dataset } from "../types";
import { buildDataset } from "./generate";
import { buildHospitality } from "./hospitality";
import { KAVERI, KERALA, TN } from "./configs";
const CFG = { tn: TN, kerala: KERALA, kaveri: KAVERI } as const;
const cache = new Map<string, Dataset>();
export function datasetFor(key: keyof typeof CFG | "wg"): Dataset {
  let d = cache.get(key);
  if (!d) { d = key === "wg" ? buildHospitality() : buildDataset(CFG[key]); cache.set(key, d); }
  return d;
}
