// Static SVG version of the hero map: shown before WebGL loads, and instead of it on
// reduced motion, no WebGL or low-power devices. Same geometry as the 3D scene.
import { DISTRICTS, LINKS, TN_OUTLINE, project } from "./tnMap";

const S = 64; // px per degree
const xy = (lat: number, lon: number) => { const [x, y] = project(lat, lon); return [x * S, -y * S] as const; };
const pos = Object.fromEntries(DISTRICTS.map((d) => [d.key, xy(d.lat, d.lon)]));

export function MapFallback() {
  const outline = TN_OUTLINE.map(([la, lo]) => xy(la, lo).join(",")).join(" ");
  const grid: string[] = [];
  for (let lo = 76; lo <= 80.6; lo += 0.5) { const a = xy(7.8, lo), b = xy(13.8, lo); grid.push(`M${a[0]},${a[1]}L${b[0]},${b[1]}`); }
  for (let la = 8; la <= 13.8; la += 0.5) { const a = xy(la, 76), b = xy(la, 80.6); grid.push(`M${a[0]},${a[1]}L${b[0]},${b[1]}`); }
  return (
    <svg className="map-svg" viewBox="-170 -210 340 420" aria-hidden>
      <path d={grid.join("")} stroke="#2a3c78" strokeOpacity=".35" strokeWidth=".6" fill="none" />
      <polygon points={outline} fill="#0f1b3f" fillOpacity=".85" stroke="#3b61e8" strokeOpacity=".75" strokeWidth="1" />
      {LINKS.map(([a, b]) => <line key={a + b} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} stroke="#3b61e8" strokeOpacity=".35" strokeWidth=".8" />)}
      {DISTRICTS.map((d) => (
        <g key={d.key} transform={`translate(${pos[d.key][0]},${pos[d.key][1]})`}>
          <circle r="3.6" fill="#fff" fillOpacity=".85" />
          <text x={d.key === "chennai" || d.key === "coimbatore" ? -8 : 8} y="3.5" textAnchor={d.key === "chennai" || d.key === "coimbatore" ? "end" : "start"} fontSize="10" fill="#b8c2e6" fontWeight="600">{d.name}</text>
        </g>
      ))}
    </svg>
  );
}
