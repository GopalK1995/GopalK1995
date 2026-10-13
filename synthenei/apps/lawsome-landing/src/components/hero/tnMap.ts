// Simplified outline of Tamil Nadu (lat, lon), hand-traced at low resolution for a decorative line map.
// Not survey-accurate: used only as a quiet backdrop for the hero.
export const TN_OUTLINE: [number, number][] = [
  [13.45, 80.3], [13.08, 80.29], [12.62, 80.19], [12.2, 80.02], [11.93, 79.83], [11.75, 79.77], [11.35, 79.8],
  [10.77, 79.84], [10.3, 79.86], [10.12, 79.4], [9.74, 79.02], [9.3, 78.95], [9.15, 78.6], [8.79, 78.13],
  [8.5, 78.12], [8.2, 77.75], [8.08, 77.54], [8.3, 77.2], [8.6, 77.15], [8.97, 77.25], [9.5, 77.2],
  [9.9, 77.25], [10.2, 77.0], [10.4, 76.85], [10.75, 76.85], [10.9, 76.7], [11.2, 76.45], [11.6, 76.25],
  [11.75, 76.5], [11.65, 76.9], [11.9, 77.1], [12.0, 77.5], [12.2, 77.65], [12.6, 77.65], [12.85, 77.95],
  [12.75, 78.25], [12.6, 78.55], [12.85, 78.8], [13.05, 78.9], [13.2, 79.2], [13.25, 79.5], [13.55, 79.85],
  [13.5, 80.15],
];

export type District = { key: string; name: string; lat: number; lon: number; court: string; time: string; dx?: number };
// Six district nodes. Times are illustrative (sample data), matching the page's synthetic firm.
export const DISTRICTS: District[] = [
  { key: "chennai", name: "Chennai", lat: 13.08, lon: 80.27, court: "Commercial Court", time: "10:30" },
  { key: "salem", name: "Salem", lat: 11.66, lon: 78.15, court: "District Court", time: "11:15" },
  { key: "coimbatore", name: "Coimbatore", lat: 11.02, lon: 76.96, court: "District Court", time: "12:00" },
  { key: "trichy", name: "Trichy", lat: 10.8, lon: 78.69, court: "District Court", time: "14:00" },
  { key: "madurai", name: "Madurai", lat: 9.93, lon: 78.12, court: "Madurai Bench, HC", time: "11:00" },
  { key: "tirunelveli", name: "Tirunelveli", lat: 8.71, lon: 77.76, court: "District Court", time: "15:30" },
];

// Thin connections between offices; the scene lights them one after another.
export const ROUTE: [string, string][] = [
  ["chennai", "salem"], ["salem", "coimbatore"], ["coimbatore", "madurai"], ["madurai", "tirunelveli"],
  ["tirunelveli", "trichy"], ["trichy", "chennai"],
];
export const LINKS: [string, string][] = [...ROUTE, ["salem", "trichy"], ["trichy", "madurai"]];

const C_LAT = 10.8, C_LON = 78.25, K = Math.cos((C_LAT * Math.PI) / 180);
/** Equirectangular projection to scene units (1 unit = 1 degree latitude). */
export const project = (lat: number, lon: number): [number, number] => [(lon - C_LON) * K, lat - C_LAT];
