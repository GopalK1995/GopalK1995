// node deck.mjs -> out/deck-raw/<id>.png at 2x; crop.py trims + pads to the final deck-screens/.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
const browserExecutable = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const ids = ["00-hero", "01-dashboard", "02-calendar", "03-hearings", "04-cases", "05-sites", "06-team", "07-ecourts", "08-ask-nidhi"];
fs.mkdirSync("out/deck-raw", { recursive: true });
for (const id of ids) {
  const inputProps = { id };
  const composition = await selectComposition({ serveUrl, id: "DeckStill", inputProps, browserExecutable });
  await renderStill({ composition, serveUrl, frame: 0, output: `out/deck-raw/${id}.png`, inputProps, browserExecutable, scale: 2 });
  console.log(id);
}
