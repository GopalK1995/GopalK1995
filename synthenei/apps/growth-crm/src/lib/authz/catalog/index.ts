import type { PermissionDef } from "../types";
import { PERMISSIONS as core } from "./core";
import { PERMISSIONS as sales } from "./sales";
import { PERMISSIONS as marketing } from "./marketing";
import { PERMISSIONS as inbox } from "./inbox";
import { PERMISSIONS as admin } from "./admin";
import { PERMISSIONS as surfaces } from "./platform-surfaces";
import { PERMISSIONS as platform } from "./platform";

export const PERMISSIONS: PermissionDef[] = [...core, ...sales, ...marketing, ...inbox, ...admin, ...surfaces, ...platform];
export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(PERMISSIONS.map((p) => [p.key, p]));
/** Dynamic custom-object permissions: obj:<key>.read|write|delete. */
export const isObjectPermission = (key: string) => /^obj:[a-z0-9_-]+\.(read|write|delete)$/.test(key);
export const permissionDef = (key: string): PermissionDef | undefined => PERMISSION_BY_KEY.get(key);
