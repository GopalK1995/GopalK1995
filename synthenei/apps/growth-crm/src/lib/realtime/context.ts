"use client";
import { createContext, useContext } from "react";
import type { ConnectionState, Identity, RealtimeHub } from "./types";

export interface RealtimeContextValue { hub: RealtimeHub | null; wsId: string; me: Identity; demo: boolean; state: ConnectionState }
export const RealtimeContext = createContext<RealtimeContextValue | null>(null);
/** null outside a RealtimeProvider: hooks then return inert values and components render nothing. */
export function useRealtimeContext(): RealtimeContextValue | null { return useContext(RealtimeContext); }
