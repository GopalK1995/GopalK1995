// Demo-mode hub: simulates presence with clearly labelled sample colleagues. It has no transport, so it cannot open a socket.
import { initialsOf } from "./presence";
import type { ConnectionState, JoinOptions, Joined, PresenceUser, RealtimeHub } from "./types";

/** Fixed, obviously fictional names. `sample: true` makes the UI label them as sample data. */
export const SAMPLE_COLLEAGUES: readonly PresenceUser[] = [
  { userId: "sample-1", name: "Sample colleague A", initials: initialsOf("Sample colleague A"), color: "chart-1", at: 1, sample: true },
  { userId: "sample-2", name: "Sample colleague B", initials: initialsOf("Sample colleague B"), color: "chart-4", at: 2, sample: true },
];

export class DemoHub implements RealtimeHub {
  readonly demo = true;
  private open = new Set<Joined>();
  getState(): ConnectionState { return "live"; }
  onState(): () => void { return () => undefined; }
  async join(topic: string, opts: JoinOptions): Promise<Joined | null> {
    let ok = false;
    try { ok = await opts.authorize(); } catch { ok = false; }
    if (!ok) return null;
    const j: Joined = { topic, leave: () => { this.open.delete(j); }, send: () => undefined };
    this.open.add(j);
    if (opts.presence) opts.onPresence?.(SAMPLE_COLLEAGUES.map((u) => ({ ...u })));
    return j;
  }
  channelCount(): number { return this.open.size; }
  dispose(): void { this.open.clear(); }
}
