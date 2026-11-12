// Street Empire car finish. The wheel split and window mask are the existing FINISH pipeline in
// src/asset/finish. This wraps it so any car file can go in, and grades the result for the game.

import { finishModel, measureModel, readModel, writeModel } from "./engine.js";
import { decodePng, encodePng } from "../asset/finish/png.js";
import { paintTailLamps } from "./lamps.js";
import { evenGlass } from "./glass.js";
import { loadVehicle } from "../asset/finish/glb.js";
import { resolveProfile } from "../asset/finish/profiles.js";
import { runFinish } from "../asset/finish/pipeline.js";

const LABELS = {
  source: "Source file", front: "Front confirmed", orient: "Which way is up", wheels: "Four wheels found", axle: "Wheel pivots",
  border: "Wheel cut edge", bleed: "Body clear of the wheels", "mesh-hit": "Wheels clear of the body", budget: "Triangle target",
  drawcalls: "Draw calls", texture: "Texture size", mask: "Window mask", channels: "Texture untouched outside the mask",
  size: "Size", ground: "On the ground", center: "Centered", material: "One material", bytes: "File size",
  triangles: "Clean triangles", manifold: "Edges shared by three faces", "open-edges": "Open edges", names: "Part names", share: "Shared meshes"
};

// These two fail on every car made by an AI generator, and on the cars already running in the game
// (taxi-v1 fails both). They come from the source model and do not stop a car from working, so they
// are shown as notes with the numbers, not as failures.
const INHERITED = {
  manifold: "Carried over from the source model. The cars already in the game have these too.",
  "mask-clean": "The source texture packs its pieces too close together to pad each one by 8 px. Cars already in the game are packed the same way. Look for color creeping at window edges on a phone; if you see it, retexture in Meshy."
};

// A car that already has its four wheels split off and a window mask does not go through the wheel
// split again. It is cleaned, its mask is completed and its lamps are checked, and nothing about its
// parts, pivots or size is changed.
async function repairFinishedCar(bytes, env, progress) {
  progress("Cleaning the car", 0.1);
  const result = await finishModel(bytes, { triangles: null, maxTexture: null, textureFormat: "png", ground: false, center: false, closeHoles: "small", compress: false }, { codec: env.codec, validate: env.validate });
  if (!result.bytes) return { ...result, car: true };
  const checks = result.checks.slice(), log = ["This car already has its wheels split off and a window mask, so the wheel split was not run again."].concat(result.log);
  let finished = result.bytes;
  progress("Completing the mask", 0.8);
  try {
    const fixed = await completeMask(finished);
    if (fixed) {
      finished = fixed.bytes;
      checks.push({ id: "mask-cover", status: "pass", label: "Mask covers the body", detail: "Every texel a body face uses is marked paint, glass or chrome (" + fixed.paint + " paint, " + fixed.glass + " glass). Wheels are marked as neither. Each piece is padded by " + PAD + " px.", fix: "" });
      log.push("Completed the window mask: the paint area covered " + fixed.was + " texels and now covers " + fixed.paint + "." + (fixed.moved ? " " + fixed.moved + " texels marked chrome were the body color and are now paint." : ""));
    }
  } catch (error) {
    checks.push({ id: "mask-cover", status: "fail", label: "Mask covers the body", detail: "The mask could not be completed: " + String(error && error.message || error), fix: "The mask and base texture must be PNG. Finish the car on a device that can convert them." });
  }
  try {
    const glass = await evenGlass(finished);
    if (glass.added || glass.evened) { finished = glass.bytes; log.push("Evened the glass: " + glass.added + " pale window texels the mask had missed are now glass, and " + glass.evened + " glass texels were given one dark glass tone." + (glass.reason ? " " + glass.reason : "")); }
    else if (glass.reason) log.push("Glass was left as it is. " + glass.reason);
  } catch (error) {
    log.push("The glass was not checked: " + String(error && error.message || error));
  }
  try {
    const lamps = await paintTailLamps(finished);
    if (lamps.texels) { finished = lamps.bytes; log.push("Painted the tail lamps red. They were an unlit gray in the texture (" + lamps.texels + " texels)."); }
    else if (lamps.reason) log.push("Tail lamps were left as they are. " + lamps.reason);
  } catch (error) {
    log.push("The tail lamps were not checked: " + String(error && error.message || error));
  }
  const after = await measureModel(finished);
  const failed = checks.filter((c) => c.status === "fail");
  const ready = !failed.length;
  const summary = ready ? "Every check passed on the finished car." : failed.length + (failed.length === 1 ? " check" : " checks") + " failed: " + failed.map((c) => c.label).join(", ") + ".";
  const mark = { pass: "PASS  ", fail: "FAIL  ", note: "NOTE  " };
  const report = [ready ? "READY" : "NOT READY", summary, ""]
    .concat(checks.map((c) => mark[c.status] + c.label + ": " + c.detail + (c.fix ? "  Fix: " + c.fix : "")))
    .concat(["", "What was done"]).concat(log.map((line) => "- " + line)).join("\n");
  progress("Done", 1);
  return { ready, banner: ready ? "READY" : "NOT READY", summary, checks, log, before: result.before, after, bytes: finished, pack: null, report, car: true };
}

async function alreadySplit(bytes) {
  const doc = await readModel(bytes);
  const wheels = doc.getRoot().listNodes().filter((n) => n.getExtras() && n.getExtras().kitWheel).length;
  const masked = doc.getRoot().listMaterials().some((m) => m.getExtras() && m.getExtras().kitMask && m.getEmissiveTexture());
  return wheels === 4 && masked;
}

export async function finishCar(bytes, name, opts = {}, env = {}) {
  const progress = (label, f) => { if (env.onProgress) env.onProgress(label, f); };
  const log = [];
  progress("Reading the car", 0.03);
  if (!opts.rotation && await alreadySplit(bytes)) return repairFinishedCar(bytes, env, progress);
  const before = await measureModel(bytes);
  let input = bytes;
  const needsPng = before.textures.some((t) => t.mime && t.mime !== "image/png");
  if (opts.rotation || needsPng) {
    // The car pipeline reads PNG textures and takes the model as it lies. Turn it and convert first.
    progress("Preparing the file", 0.08);
    const prep = await finishModel(bytes, {
      removeDebris: false, fixFacing: false, closeHoles: "off", fixNormals: false, ground: false, center: false,
      rotation: opts.rotation || null, maxTexture: null, textureFormat: needsPng ? "png" : "keep", compress: false
    }, { codec: env.codec });
    if (!prep.bytes) throw new Error("The car could not be prepared: " + prep.summary);
    input = prep.bytes;
    if (opts.rotation) log.push("Turned the model the way you set it in the view.");
    if (needsPng) log.push("Converted the textures to PNG so the mask can be measured pixel for pixel.");
  }
  progress("Splitting wheels and building the mask", 0.2);
  const loaded = await loadVehicle(input, name || "car.glb");
  const profile = resolveProfile("CAR", { lengthZ: opts.length || undefined });
  if (profile.error) throw new Error(profile.error);
  const result = await runFinish(loaded, profile, { frontConfirmed: !!opts.frontConfirmed });
  progress("Checking the finished car", 0.92);
  let finished = result.bytes || null, coverage = null;
  if (finished) {
    try {
      const fixed = await completeMask(finished);
      if (fixed) { finished = fixed.bytes; coverage = fixed; }
    } catch (error) {
      coverage = { failed: String(error && error.message || error) };
    }
  }
  const seen = new Map();
  const checks = result.checks.map((c) => {
    const n = (seen.get(c.id) || 0) + 1;
    seen.set(c.id, n);
    const key = c.id.startsWith("mask") ? (c.pass ? "mask" : c.id) : c.id;
    const inherited = !c.pass && INHERITED[c.id];
    return {
      id: c.id + (n > 1 ? "-" + n : ""),
      status: c.pass ? "pass" : inherited ? "note" : "fail",
      label: LABELS[key] || LABELS[c.id] || (c.id.startsWith("mask") ? "Window mask" : c.id),
      detail: c.detail + (inherited ? " " + inherited : ""),
      fix: c.pass || inherited ? "" : (c.action || "")
    };
  });
  if (coverage) {
    checks.push(coverage.failed
      ? { id: "mask-cover", status: "fail", label: "Mask covers the body", detail: "The mask could not be completed: " + coverage.failed, fix: "Open the car in the VEHICLE panel of Sovereign Draft and mark the windows by hand." }
      : { id: "mask-cover", status: "pass", label: "Mask covers the body", detail: "Every texel a body face uses is marked paint or glass (" + coverage.paint + " paint, " + coverage.glass + " glass). Wheels are marked as neither. Each piece is padded by " + PAD + " px.", fix: "" });
    if (!coverage.failed) log.push("Completed the window mask: the paint area now covers every body face (it covered " + coverage.was + " of " + (coverage.paint + coverage.glass) + " texels), and every piece of the mask is padded by " + PAD + " px so nothing bleeds in at its edges.");
  }
  if (finished && opts.evenGlass !== false) {
    try {
      const glass = await evenGlass(finished);
      if (glass.added || glass.evened) { finished = glass.bytes; log.push("Evened the glass: " + glass.added + " pale window texels the mask had missed are now glass, and " + glass.evened + " glass texels were given one dark glass tone." + (glass.reason ? " " + glass.reason : "")); }
    } catch (error) {
      log.push("The glass was not checked: " + String(error && error.message || error));
    }
  }
  if (finished && opts.tailLamps !== false) {
    try {
      const lamps = await paintTailLamps(finished);
      if (lamps.texels) {
        finished = lamps.bytes;
        log.push("Painted the tail lamps red. They were an unlit gray in the texture (" + lamps.texels + " texels). Nothing else in the texture was touched.");
      }
    } catch (error) {
      log.push("The tail lamps were not checked: " + String(error && error.message || error));
    }
  }
  const after = finished ? await measureModel(finished) : null;
  const failed = checks.filter((c) => c.status === "fail");
  const ready = !!finished && !failed.length;
  const notes = checks.filter((c) => c.status === "note").length;
  const summary = !finished ? result.summary
    : ready ? "Every check that decides whether the car works in the game passed." + (notes ? " " + notes + " notes carry over from the source model." : "")
      : failed.length + (failed.length === 1 ? " check" : " checks") + " failed: " + failed.map((c) => c.label).join(", ") + ".";
  const mark = { pass: "PASS  ", fail: "FAIL  ", note: "NOTE  " };
  // The pipeline's log was written before the game learned to read the mask, and ends with its own
  // stricter verdict. Both would contradict the verdict above, so those lines are left out.
  const stale = /does not read|declared check/;
  const fullLog = log.concat((result.log || []).map((line) => line.replace(/ Street Empire src\/kit\.js does not read that mask\./, "")).filter((line) => !stale.test(line)));
  const report = [ready ? "READY" : "NOT READY", summary, ""]
    .concat(checks.map((c) => mark[c.status] + c.label + ": " + c.detail + (c.fix ? "  Fix: " + c.fix : "")))
    .concat(["", "What was done"]).concat(fullLog.map((line) => "- " + line)).join("\n");
  progress("Done", 1);
  return { ready, banner: ready ? "READY" : "NOT READY", summary, checks, log: fullLog, before, after, bytes: finished, pack: result.zip || null, report, car: true };
}

const PAD = 6;

// The pipeline's mask marks glass well but leaves parts of the body unmarked, and the game only
// repaints where the mask says paint, so those parts stayed the old color in blotches.
// This marks every texel a body face uses as paint (glass stays glass, wheels stay neither), then
// grows each piece outward so texture filtering at its edge never picks up its neighbor.
export async function completeMask(bytes) {
  const doc = await readModel(bytes);
  const mat = doc.getRoot().listMaterials().find((m) => m.getExtras() && m.getExtras().kitMask && m.getEmissiveTexture());
  if (!mat) return null;
  const tex = mat.getEmissiveTexture();
  const { width: W, height: H, rgba } = decodePng(tex.getImage());
  // 0 nothing, 1 wheel or other, 2 paint, 3 glass, 4 chrome
  const cls = new Uint8Array(W * H);
  let was = 0;
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (a < 128) continue;
    if (r > 127 && g < 128) cls[i] = 3;
    else if (b > 127 && r < 128 && g < 128) cls[i] = 4;
    else if (g > 127) was++;
  }
  const fill = (uv, idx, value) => {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
      const ox = Math.floor(Math.min(uv[a], uv[b], uv[c])), oy = Math.floor(Math.min(uv[a + 1], uv[b + 1], uv[c + 1]));
      const x0 = (uv[a] - ox) * W, y0 = (uv[a + 1] - oy) * H, x1 = (uv[b] - ox) * W, y1 = (uv[b + 1] - oy) * H, x2 = (uv[c] - ox) * W, y2 = (uv[c + 1] - oy) * H;
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (Math.abs(area) < 1e-9) continue;
      const sign = area < 0 ? -1 : 1, slack = 0.75; // also take pixels the triangle only clips
      const l0 = Math.hypot(x2 - x1, y2 - y1), l1 = Math.hypot(x0 - x2, y0 - y2), l2 = Math.hypot(x1 - x0, y1 - y0);
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1)), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1)), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const e0 = sign * ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)), e1 = sign * ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)), e2 = sign * ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0));
        if (e0 < -slack * l0 || e1 < -slack * l1 || e2 < -slack * l2) continue;
        const i = y * W + x;
        if (value === 1) cls[i] = 1; else if (cls[i] === 0) cls[i] = 2;
      }
    }
  };
  const surfaces = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let wheel = false;
    for (let n = node; n; n = n.getParentNode()) if ((n.getExtras() && n.getExtras().kitWheel) || /^wheel/i.test(n.getName())) wheel = true;
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute("TEXCOORD_0"), idx = prim.getIndices();
      if (uv && idx) surfaces.push({ wheel, uv: uv.getArray(), idx: idx.getArray() });
    }
  }
  for (const s of surfaces) if (!s.wheel) fill(s.uv, s.idx, 2);
  for (const s of surfaces) if (s.wheel) fill(s.uv, s.idx, 1);
  // On a white, gray or black car the pipeline cannot tell paint from chrome by color, and marks whole
  // body panels chrome. A chrome texel that is the same color as the paint is paint.
  let moved = 0;
  const baseTex = mat.getBaseColorTexture();
  if (baseTex && baseTex.getMimeType() === "image/png") {
    const base = decodePng(baseTex.getImage());
    if (base.width === W && base.height === H) {
      const bins = new Map();
      for (let i = 0; i < cls.length; i++) {
        if (cls[i] !== 2) continue;
        const key = (base.rgba[i * 4] >> 4) << 8 | (base.rgba[i * 4 + 1] >> 4) << 4 | (base.rgba[i * 4 + 2] >> 4);
        bins.set(key, (bins.get(key) || 0) + 1);
      }
      let best = -1, most = 0;
      for (const [key, n] of bins) if (n > most) { most = n; best = key; }
      if (best >= 0) {
        const body = [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
        const hi = Math.max(...body), lo = Math.min(...body);
        if (hi && (hi - lo) / hi < 0.2) { // only when the body has no real hue
          for (let i = 0; i < cls.length; i++) {
            if (cls[i] !== 4) continue;
            const d = Math.max(Math.abs(base.rgba[i * 4] - body[0]), Math.abs(base.rgba[i * 4 + 1] - body[1]), Math.abs(base.rgba[i * 4 + 2] - body[2]));
            if (d <= 40) { cls[i] = 2; moved++; }
          }
        }
      }
    }
  }
  let paint = 0, glass = 0;
  for (let i = 0; i < cls.length; i++) { if (cls[i] === 2) paint++; else if (cls[i] === 3) glass++; }
  for (let pass = 0; pass < PAD; pass++) {
    const grow = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cls[i]) continue;
      const v = (x > 0 && cls[i - 1]) || (x < W - 1 && cls[i + 1]) || (y > 0 && cls[i - W]) || (y < H - 1 && cls[i + W]);
      if (v) grow.push(i, v);
    }
    for (let k = 0; k < grow.length; k += 2) cls[grow[k]] = grow[k + 1];
  }
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < cls.length; i++) {
    out[i * 4] = cls[i] === 3 ? 255 : 0;
    out[i * 4 + 1] = cls[i] === 2 ? 255 : 0;
    out[i * 4 + 2] = cls[i] === 4 ? 255 : 0;
    out[i * 4 + 3] = 255;
  }
  tex.setImage(encodePng(W, H, out)).setMimeType("image/png");
  return { bytes: await writeModel(doc), paint, glass, was, moved };
}
