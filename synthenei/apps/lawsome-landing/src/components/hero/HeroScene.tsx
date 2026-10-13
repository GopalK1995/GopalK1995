"use client";
// The one WebGL moment on the page: a line map of Tamil Nadu with six district offices.
// Thin links light one after another, like hearings moving across a firm's offices.
// Loaded lazily (desktop only) by HeroStage; everything here is client-only.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { MotionValue } from "motion/react";
import { DISTRICTS, LINKS, ROUTE, TN_OUTLINE, project } from "./tnMap";

const COL = { line: new THREE.Color("#3b61e8"), hi: new THREE.Color("#a9bcff"), white: new THREE.Color("#ffffff"), fill: new THREE.Color("#0f1b3f"), grid: new THREE.Color("#2a3c78") };
const SEG = 0.4; // seconds per link: the route draws once (~2.4s) on enter, then the map holds still
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

type Props = { replay: number; onRest: () => void; px: MotionValue<number>; py: MotionValue<number>; settle: MotionValue<number>; active: boolean; onReady: () => void; labels: RefObject<HTMLDivElement | null> };

const pos = Object.fromEntries(DISTRICTS.map((d) => [d.key, project(d.lat, d.lon)])) as Record<string, [number, number]>;

function lineObj(points: [number, number][], color: THREE.Color, opacity: number, loop = false) {
  const g = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  return loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
}

function MapGroup({ px, py, settle, onReady, onRest, labels, replay }: Omit<Props, "active">) {
  const t0 = useRef<number | null>(null);
  const lastReplay = useRef(replay);
  const rested = useRef(false);
  const group = useRef<THREE.Group>(null);
  const ready = useRef(false);
  const { camera, size } = useThree();

  const outline = useMemo(() => TN_OUTLINE.map(([la, lo]) => project(la, lo)), []);
  const statics = useMemo(() => {
    const objs: THREE.Object3D[] = [];
    // graticule: half-degree hairlines, clipped to a rectangle around the state
    for (let lo = 76; lo <= 80.6; lo += 0.5) objs.push(lineObj([project(7.8, lo), project(13.8, lo)], COL.grid, 0.35));
    for (let la = 8; la <= 13.8; la += 0.5) objs.push(lineObj([project(la, 76), project(la, 80.6)], COL.grid, 0.35));
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: COL.fill, transparent: true, opacity: 0.85, depthWrite: false }));
    fill.position.z = -0.01;
    objs.push(fill, lineObj(outline, COL.line, 0.75, true));
    return objs;
  }, [outline]);

  const links = useMemo(() => LINKS.map(([a, b]) => ({ a, b, obj: lineObj([pos[a], pos[b]], COL.line, 0.2) as THREE.Line })), []);
  const nodeGeo = useMemo(() => new THREE.CircleGeometry(0.06, 24), []);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.1, 0.115, 40), []);
  const nodes = useMemo(() => DISTRICTS.map(() => ({
    dot: new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: COL.white, transparent: true, opacity: 0.85 })),
    ring: new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COL.hi, transparent: true, opacity: 0, depthWrite: false })),
  })), [nodeGeo, ringGeo]);
  const traveller = useMemo(() => new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), new THREE.MeshBasicMaterial({ color: COL.hi })), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const g = group.current; if (!g) return;
    const now = state.clock.getElapsedTime();
    if (t0.current === null || lastReplay.current !== replay) { t0.current = now; lastReplay.current = replay; rested.current = false; }
    const t = now - t0.current;
    const n = ROUTE.length, done = t >= n * SEG;
    // pose: tilted back like a map on a desk, follows the pointer a little, flattens as the page scrolls
    const s = settle.get();
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -0.5 + s * 0.22 - py.get() * 0.02, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, px.get() * 0.03, 0.08);
    g.rotation.z = -0.06;

    const cycle = done ? n - 1 + 0.999 : t / SEG, idx = Math.floor(cycle), p = ease(cycle % 1);
    const [a, b] = ROUTE[idx];
    traveller.visible = !done;
    traveller.position.set(pos[a][0] + (pos[b][0] - pos[a][0]) * p, pos[a][1] + (pos[b][1] - pos[a][1]) * p, 0.01);
    for (const l of links) {
      const r = ROUTE.findIndex(([x, y]) => x === l.a && y === l.b);
      let o = 0.24;
      if (r >= 0 && r <= idx) {
        const age = idx - r + (cycle % 1); // segments since this link started
        o += age < 1 ? 0.6 * p : Math.max(0.22, 0.6 - (age - 1) * 0.3);
      }
      if (done) o = Math.max(0.24, o - Math.min(1, (t - n * SEG) / 0.6) * (o - (r >= 0 ? 0.5 : 0.24)));
      (l.obj.material as THREE.LineBasicMaterial).opacity = o;
    }
    const arrivedAt = (k: string) => { // seconds since the traveller last reached node k
      const r = ROUTE.findIndex(([, y]) => y === k); if (r < 0 || done) return 99;
      const since = idx - r - 1 + (cycle % 1); return since < 0 ? 99 : since * SEG;
    };
    const el = labels.current;
    DISTRICTS.forEach((d, i) => {
      const { dot, ring } = nodes[i];
      const since = arrivedAt(d.key);
      // arrival: a fixed ring fades in and out over ~0.6s; no expanding pulse
      (ring.material as THREE.MeshBasicMaterial).opacity = since < 0.5 ? 0.6 * Math.sin((since / 0.5) * Math.PI) : 0;
      (dot.material as THREE.MeshBasicMaterial).opacity = since < SEG ? 1 : 0.75;
      if (el) {
        const lab = el.children[i] as HTMLElement | undefined;
        if (lab) {
          v.set(0, 0, 0).applyMatrix4(dot.matrixWorld).project(camera);
          lab.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0)`;
          lab.dataset.on = since < 0.6 ? "1" : "0";
        }
      }
    });
    if (!ready.current) { ready.current = true; onReady(); }
    if (done && !rested.current && t > n * SEG + 0.8) { rested.current = true; onRest(); } // hold still: stop rendering
  });

  return (
    <group ref={group} position={[0.15, -0.1, 0]}>
      {statics.map((o, i) => <primitive key={`s${i}`} object={o} />)}
      {links.map((l, i) => <primitive key={`l${i}`} object={l.obj} />)}
      <primitive object={traveller} />
      {DISTRICTS.map((d, i) => (
        <group key={d.key} position={[pos[d.key][0], pos[d.key][1], 0.02]}>
          <primitive object={nodes[i].ring} />
          <primitive object={nodes[i].dot} />
        </group>
      ))}
    </group>
  );
}

export default function HeroScene({ active, ...rest }: Props) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "never"}
      camera={{ fov: 30, position: [0, 0, 11.8], near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
    >
      <MapGroup {...rest} />
    </Canvas>
  );
}
