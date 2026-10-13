// Usage: node render.mjs            -> out/lawsome-60s.mp4 (Remotion) + ../lawsome-60s.mp4 (final H.264 yuv420p)
//        node render.mjs frames [f1,f2,...] -> out/frames/f_XXXX.png (default: one frame every 2 s)
// Optional voice-over: put audio/vo-01.wav ... audio/vo-10.wav (one per scene, see ../voiceover-tamil.md).
// Each clip that exists starts at its scene start + 0.2 s and the film renders with audio; with none it renders silent.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const browserExecutable = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const chromiumOptions = { gl: "swangle" };
const audioDir = path.resolve("audio");
const vo = Array.from({ length: 10 }, (_, i) => fs.existsSync(path.join(audioDir, `vo-${String(i + 1).padStart(2, "0")}.wav`)));
const hasAudio = vo.some(Boolean);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), ...(hasAudio ? { publicDir: audioDir } : {}) });
const inputProps = { vo };
const composition = await selectComposition({ serveUrl, id: "Lawsome60", inputProps, browserExecutable, chromiumOptions });
fs.mkdirSync("out/frames", { recursive: true });

if (process.argv[2] === "frames") {
  const list = (process.argv[3] ? process.argv[3].split(",").map(Number) : Array.from({ length: Math.ceil(composition.durationInFrames / 60) }, (_, i) => i * 60 + 30));
  for (const frame of list) {
    const out = `out/frames/f_${String(frame).padStart(4, "0")}.png`;
    await renderStill({ composition, serveUrl, frame, output: out, browserExecutable, chromiumOptions, inputProps });
    console.log(out);
  }
} else {
  console.log(hasAudio ? `Voice-over clips found: ${vo.map((v, i) => (v ? i + 1 : null)).filter(Boolean).join(", ")}` : "No voice-over clips: rendering silent");
  await renderMedia({
    composition, serveUrl, codec: "h264", crf: 20, pixelFormat: "yuv420p", inputProps, muted: !hasAudio,
    outputLocation: "out/lawsome-60s.mp4", browserExecutable, chromiumOptions, concurrency: 2, timeoutInMilliseconds: 180000,
  });
  // Final delivery file: H.264 High, yuv420p (TV range), faststart; AAC only when there is a voice-over.
  const audioArgs = hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"];
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", "out/lawsome-60s.mp4", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-color_range", "tv", "-movflags", "+faststart", ...audioArgs, "../lawsome-60s.mp4"], { stdio: "inherit" });
  console.log("done -> ../lawsome-60s.mp4");
}
