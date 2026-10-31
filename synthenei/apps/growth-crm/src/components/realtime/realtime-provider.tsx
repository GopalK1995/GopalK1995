"use client";
// Mount once inside the authenticated shell (src/components/shell/providers.tsx, integrator/T059):
//   <RealtimeProvider wsId={active.ws.id} me={{ id: session.userId, name: session.name }} demo={session.demo}>{children}</RealtimeProvider>
// Demo sessions get a hub with no transport (cannot open a socket). Real sessions get one RealtimeManager per tab.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRealtimeHub } from "@/lib/realtime/client";
import { RealtimeContext } from "@/lib/realtime/context";
import { DemoHub } from "@/lib/realtime/demo";
import type { ConnectionState, Identity, RealtimeHub } from "@/lib/realtime/types";

export function RealtimeProvider({ wsId, me, demo, hub: injected, children }: {
  wsId: string; me: Identity; demo: boolean; children: ReactNode;
  /** Tests inject a hub. */
  hub?: RealtimeHub;
}) {
  const [hub, setHub] = useState<RealtimeHub | null>(null);
  const [state, setState] = useState<ConnectionState>("live");
  const meId = me.id, meName = me.name;

  useEffect(() => {
    const h = injected ?? (demo ? new DemoHub() : createRealtimeHub({ wsId, me: { id: meId, name: meName } }));
    setHub(h);
    if (!h) return;
    setState(h.getState());
    const off = h.onState(setState);
    return () => { off(); h.dispose(); setHub(null); }; // no leaked channels or listeners on unmount or workspace switch
  }, [wsId, meId, meName, demo, injected]);

  const value = useMemo(() => ({ hub, wsId, me: { id: meId, name: meName }, demo, state }), [hub, wsId, meId, meName, demo, state]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
