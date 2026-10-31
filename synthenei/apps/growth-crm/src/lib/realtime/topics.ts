// Topic builders and guards. Every topic starts with ws:<workspace uuid>: which the realtime.messages policy checks.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEG = /^[A-Za-z0-9_-]{1,64}$/;

function need(ok: boolean, what: string): void { if (!ok) throw new Error(`realtime: bad ${what}`); }

export function tableTopic(ws: string, table: string): string { need(UUID.test(ws), "workspace"); need(SEG.test(table), "table"); return `ws:${ws}:tbl:${table}`; }
export function recordTopic(ws: string, objectType: string, id: string): string { need(UUID.test(ws), "workspace"); need(SEG.test(objectType), "object type"); need(SEG.test(id), "id"); return `ws:${ws}:rec:${objectType}:${id}`; }
export function boardTopic(ws: string, pipelineId: string): string { need(UUID.test(ws), "workspace"); need(SEG.test(pipelineId), "pipeline"); return `ws:${ws}:board:${pipelineId}`; }

/** True only for a well-formed topic inside this workspace. The client never joins another tenant's topic even if asked. */
export function topicInWorkspace(topic: string, ws: string): boolean {
  const p = topic.split(":");
  return p.length >= 4 && p[0] === "ws" && UUID.test(p[1]) && p[1].toLowerCase() === ws.toLowerCase() && p.slice(2).every((s) => SEG.test(s));
}
