// Redraw openings on a finished building and give its panes rooms, from a plan, without a browser.
//   node scripts/asset-redraw.mjs <finished.glb> <plan.json> <out.glb>
// Writes the file and, next to it, <out>.verdict.json: what was done and every check, measured
// on the written file. Exits 1 when the file is not READY.
import { readFileSync, writeFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { checkModel } from "../src/assetapp/engine.js";
import { redrawOpenings } from "../src/assetapp/redraw.js";
import { drawRooms } from "../src/assetapp/rooms.js";
import { validate } from "../src/assetapp/validate.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";

// JPEG and PNG in plain JavaScript. The browser app uses the canvas instead.
export const codec = {
  async decode(bytes, mime) {
    if (mime === "image/png") return decodePng(bytes);
    if (mime === "image/jpeg") { const d = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024, formatAsRGBA: true }); return { width: d.width, height: d.height, rgba: d.data }; }
    return null;
  },
  async encode(rgba, width, height, mime, quality = 0.92) {
    if (mime === "image/png") return encodePng(width, height, rgba);
    if (mime === "image/jpeg") return new Uint8Array(jpeg.encode({ data: rgba, width, height }, Math.round(quality * 100)).data);
    return null;
  }
};

if (process.argv[1] && process.argv[1].endsWith("asset-redraw.mjs")) {
  const [file, planFile, out] = process.argv.slice(2);
  if (!file || !planFile || !out) { console.error("usage: node scripts/asset-redraw.mjs <finished.glb> <plan.json> <out.glb>"); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  // a plan may redraw openings, give every pane a room ("rooms": true), or both, in that order
  let result = { bytes: new Uint8Array(readFileSync(file)), log: [], done: {} };
  if (plan.openings && plan.openings.length) result = await redrawOpenings(result.bytes, plan, { codec });
  if (plan.rooms) { const rooms = await drawRooms(result.bytes, { codec }); result = { bytes: rooms.bytes, log: result.log.concat(rooms.log), done: { ...result.done, panes: rooms.panes } }; }
  writeFileSync(out, result.bytes);
  const verdict = await checkModel(result.bytes, {}, { codec, validate });
  const report = { file: out, plan, done: result.done, log: result.log, ready: verdict.ready, summary: verdict.summary, checks: verdict.checks, after: verdict.after };
  writeFileSync(out.replace(/\.glb$/i, "") + ".verdict.json", JSON.stringify(report, (k, v) => ArrayBuffer.isView(v) ? undefined : v, 1));
  console.log(verdict.banner + "  " + out + "  " + (result.bytes.length / 1e6).toFixed(2) + " MB");
  for (const line of result.log) console.log("- " + line);
  for (const c of verdict.checks) if (c.status === "fail") console.log("FAIL " + c.label + ": " + c.detail);
  process.exit(verdict.ready ? 0 : 1);
}
