// Workspace-scoped datasets, built lazily once per process.
import type { Dataset } from "../types";
import { buildDataset } from "./generate";
import { KAVERI, KERALA, TN } from "./configs";
const CFG = { tn: TN, kerala: KERALA, kaveri: KAVERI } as const;
const cache = new Map<string, Dataset>();
export function datasetFor(key: keyof typeof CFG): Dataset {
  let d = cache.get(key);
  if (!d) { d = buildDataset(CFG[key]); cache.set(key, d); }
  return d;
}
