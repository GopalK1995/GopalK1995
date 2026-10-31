// In-memory pgmq stand-in and run store for drainer tests. Time is a number the test controls.
import type { MessageBody, QueueMessage, QueuePort, RunStart, RunStatus, RunStore } from "../ports";
import type { Logger } from "../registry";

interface Row { msg_id: number; read_ct: number; message: MessageBody; availableAt: number }

export class FakeQueue implements QueuePort {
  t = 0;
  private seq = 0;
  readonly q = new Map<string, Row[]>();
  readonly archived: { queue: string; msg_id: number }[] = [];
  readLog: string[] = [];
  private rows(queue: string) { let r = this.q.get(queue); if (!r) { r = []; this.q.set(queue, r); } return r; }
  async read(queue: string, vt: number, qty: number): Promise<QueueMessage[]> {
    this.readLog.push(queue);
    const out: QueueMessage[] = [];
    for (const r of this.rows(queue)) {
      if (out.length >= qty) break;
      if (r.availableAt > this.t) continue;
      r.read_ct++; r.availableAt = this.t + vt * 1000;
      out.push({ msg_id: r.msg_id, read_ct: r.read_ct, message: structuredClone(r.message) });
    }
    return out;
  }
  async send(queue: string, body: MessageBody, delay = 0): Promise<number> {
    const id = ++this.seq;
    this.rows(queue).push({ msg_id: id, read_ct: 0, message: structuredClone(body), availableAt: this.t + delay * 1000 });
    return id;
  }
  async archive(queue: string, id: number) { this.archived.push({ queue, msg_id: id }); await this.delete(queue, id); }
  async delete(queue: string, id: number) { const r = this.rows(queue); const i = r.findIndex((x) => x.msg_id === id); if (i >= 0) r.splice(i, 1); }
  /** Seeds a message that is readable now. */
  put(queue: string, body: MessageBody, readCt = 0): number {
    const id = ++this.seq;
    this.rows(queue).push({ msg_id: id, read_ct: readCt, message: structuredClone(body), availableAt: this.t });
    return id;
  }
  list(queue: string): Row[] { return this.rows(queue); }
  /** Delay (s) from now until a message is readable. */
  delayOf(queue: string, id: number): number { const r = this.rows(queue).find((x) => x.msg_id === id); return r ? (r.availableAt - this.t) / 1000 : NaN; }
}

export class FakeRuns implements RunStore {
  runs: (RunStart & { id: number; status: "running" | RunStatus; ms?: number; error?: string })[] = [];
  async start(r: RunStart) { const id = this.runs.length + 1; this.runs.push({ ...r, id, status: "running" }); return id; }
  async finish(id: number, status: RunStatus, ms: number, error?: string) { const r = this.runs.find((x) => x.id === id)!; Object.assign(r, { status, ms, error }); }
}

export function memLogger(): Logger & { lines: { level: string; msg: string; f?: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; f?: Record<string, unknown> }[] = [];
  const w = (level: string) => (msg: string, f?: Record<string, unknown>) => { lines.push({ level, msg, f }); };
  return { lines, info: w("info"), warn: w("warn"), error: w("error") };
}

export const fakeDb = {} as never;
