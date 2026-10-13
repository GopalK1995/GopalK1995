"use client";
// Vertical flow: provider -> our ingest step -> Postgres (and the outbound path back, if any).
// Connectors draw in once (<= 280 ms each, staggered); reduced motion renders the final state.
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/components/ui/motion";
import type { Direction } from "./meta";

const W = 320, NODE_W = 232, NODE_H = 52, X = (W - NODE_W) / 2;
const Y = [12, 132, 252];

function Node({ y, title, sub, tone, i }: { y: number; title: string; sub: string; tone: "ext" | "ours" | "db"; i: number }) {
  const reduce = useReducedMotion();
  const fill = tone === "db" ? "var(--navy-900)" : "var(--surface)";
  const ink = tone === "db" ? "var(--navy-ink)" : "var(--ink)";
  const ink2 = tone === "db" ? "var(--navy-ink-2)" : "var(--ink-3)";
  return (
    <motion.g initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: i * 0.12, ease: EASE }}>
      <rect x={X} y={y} width={NODE_W} height={NODE_H} rx={8} fill={fill} stroke={tone === "db" ? "var(--navy-900)" : "var(--line-strong)"} strokeDasharray={tone === "ext" ? "4 3" : undefined} />
      <text x={X + 14} y={y + 22} fontSize={13} fontWeight={600} fill={ink}>{title}</text>
      <text x={X + 14} y={y + 39} fontSize={11} fill={ink2}>{sub}</text>
    </motion.g>
  );
}

function Edge({ x, from, to, label, i, up, labelLeft }: { x: number; from: number; to: number; label: string; i: number; up?: boolean; labelLeft?: boolean }) {
  const reduce = useReducedMotion();
  const y1 = up ? to : from, y2 = up ? from : to; // drawn in the direction data moves
  const head = up ? `M${x - 5},${y2 + 7} L${x},${y2} L${x + 5},${y2 + 7}` : `M${x - 5},${y2 - 7} L${x},${y2} L${x + 5},${y2 - 7}`;
  const stroke = up ? "var(--ink-3)" : "var(--accent)";
  return (
    <g>
      <motion.path d={`M${x},${y1} L${x},${y2}`} stroke={stroke} strokeWidth={1.5} fill="none" strokeDasharray={up ? "3 3" : undefined}
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, delay: 0.15 + i * 0.12, ease: EASE }} />
      <motion.path d={head} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12, delay: 0.4 + i * 0.12 }} />
      <text x={labelLeft ? x - 8 : x + 8} y={(from + to) / 2 + 4} fontSize={11} fill="var(--ink-2)" textAnchor={labelLeft ? "end" : "start"}>{label}</text>
    </g>
  );
}

export function FlowDiagram({ source, ingest, outbound, direction, trigger, tables }: {
  source: string; ingest: string; outbound?: string; direction: Direction; trigger: string; tables: string[];
}) {
  const hasIn = direction !== "out", hasOut = direction !== "in";
  const top = Y[0] + NODE_H, mid = Y[1], midB = Y[1] + NODE_H, bot = Y[2];
  const tableLine = tables.slice(0, 3).join(", ") + (tables.length > 3 ? ` +${tables.length - 3}` : "");
  const desc = `${hasIn ? `${source} sends data by ${trigger} to ${ingest}, which writes to ${tableLine}.` : ""} ${hasOut ? `Changes go back out through ${outbound ?? ingest} to ${source}.` : ""}`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${Y[2] + NODE_H + 8}`} role="img" aria-label={desc} className="h-auto w-full max-w-[360px]">
        <Node y={Y[0]} title={source} sub="Provider (their side)" tone="ext" i={0} />
        <Node y={Y[1]} title={ingest} sub={hasIn ? "Edge Function, verifies signature" : "Edge Function, signs request"} tone="ours" i={1} />
        <Node y={Y[2]} title="Supabase Postgres" sub={tableLine} tone="db" i={2} />
        {hasIn && <><Edge x={hasOut ? 116 : 160} from={top} to={mid} label={trigger} i={0} labelLeft={hasOut} /><Edge x={hasOut ? 116 : 160} from={midB} to={bot} label="upsert" i={1} labelLeft={hasOut} /></>}
        {hasOut && <><Edge x={hasIn ? 204 : 160} from={midB} to={bot} label="on change" i={2} up /><Edge x={hasIn ? 204 : 160} from={top} to={mid} label={outbound ?? "out"} i={3} up /></>}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        {hasIn && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" aria-hidden />Data in</span>}
        {hasOut && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-[1.5px] border-dashed border-ink-3" aria-hidden />Data out</span>}
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border border-dashed border-ink-3" aria-hidden />Not ours</span>
      </figcaption>
    </figure>
  );
}
