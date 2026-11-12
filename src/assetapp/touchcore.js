// Touch up: the hand tool for what no rule can find. Works on a finished car that carries a window mask.
// You point at the car in 3D; this turns the point into texels and changes the mask, the texture, or both.
//
// The brush is a ball in the car's own space, not a circle on the texture, so it never spills onto a part
// that only sits next to the spot in the texture atlas. With "similar only" a stroke touches just the texels
// whose color is close to the one first touched: drag across a white windshield and the red pillars stay red.
//
// No DOM and no three.js here, so it runs in tests and in a worker.
import { readModel, writeModel } from "./engine.js";
import { decodePng, encodePng } from "../asset/finish/png.js";

// what each tool writes into the mask: R glass, G body paint, B chrome, none of them trim
export const KINDS = { glass: [255, 0, 0], paint: [0, 255, 0], chrome: [0, 0, 255], trim: [0, 0, 0] };
export const TOOLS = ["glass", "paint", "chrome", "trim", "clean"];
const NEAR = 60; // how far apart two colors can be (0 to 441) and still count as similar

export async function openTouch(bytes) {
  const doc = await readModel(bytes);
  const mat = doc.getRoot().listMaterials().find((m) => m.getBaseColorTexture() && m.getExtras() && m.getExtras().kitMask && m.getEmissiveTexture());
  if (!mat) return null;
  const tex = mat.getBaseColorTexture(), maskTex = mat.getEmissiveTexture();
  if (tex.getMimeType() !== "image/png" || maskTex.getMimeType() !== "image/png") return null;
  const base = decodePng(tex.getImage()), small = decodePng(maskTex.getImage());
  const W = base.width, H = base.height, px = base.rgba;
  // the mask is edited at the size of the texture, so one texel means the same place in both
  let mk = small.rgba;
  if (small.width !== W || small.height !== H) {
    mk = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (Math.floor(x * small.width / W) + Math.floor(y * small.height / H) * small.width) * 4, d = (y * W + x) * 4;
      mk[d] = small.rgba[s]; mk[d + 1] = small.rgba[s + 1]; mk[d + 2] = small.rgba[s + 2]; mk[d + 3] = 255;
    }
  }

  // where each texel sits on the car, in the model's own space (NaN where no face uses the texel)
  const where = new Float32Array(W * H * 3).fill(NaN);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() !== mat) continue;
      const P = prim.getAttribute("POSITION"), UV = prim.getAttribute("TEXCOORD_0"), I = prim.getIndices();
      if (!P || !UV || !I) continue;
      const p = P.getArray(), uv = UV.getArray(), idx = I.getArray(), w = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) w[i + k] = m[k] * p[i] + m[4 + k] * p[i + 1] + m[8 + k] * p[i + 2] + m[12 + k];
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const x0 = uv[a * 2] * W, y0 = uv[a * 2 + 1] * H, x1 = uv[b * 2] * W, y1 = uv[b * 2 + 1] * H, x2 = uv[c * 2] * W, y2 = uv[c * 2 + 1] * H;
        const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (Math.abs(area) < 1e-9) continue;
        const s = area < 0 ? -1 : 1, k = 1 / Math.abs(area);
        for (let py = Math.max(0, Math.floor(Math.min(y0, y1, y2))); py <= Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2))); py++) {
          for (let qx = Math.max(0, Math.floor(Math.min(x0, x1, x2))); qx <= Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2))); qx++) {
            const at = (py * W + qx) * 3;
            if (where[at] === where[at]) continue;
            const X = qx + 0.5, Y = py + 0.5;
            let e0 = s * ((x2 - x1) * (Y - y1) - (y2 - y1) * (X - x1)), e1 = s * ((x0 - x2) * (Y - y2) - (y0 - y2) * (X - x2)), e2 = s * ((x1 - x0) * (Y - y0) - (y1 - y0) * (X - x0));
            if (e0 < -0.5 || e1 < -0.5 || e2 < -0.5) continue;
            e0 = Math.max(0, e0) * k; e1 = Math.max(0, e1) * k; e2 = Math.max(0, e2) * k;
            const sum = e0 + e1 + e2 || 1;
            for (let j = 0; j < 3; j++) where[at + j] = (w[a * 3 + j] * e0 + w[b * 3 + j] * e1 + w[c * 3 + j] * e2) / sum;
          }
        }
      }
    }
  }

  const sat = (i) => { const top = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); return top ? (top - Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) / top : 0; };
  // the body color, for putting paint back where glass was marked by mistake. A white, gray or black car has none.
  let bodyColor = null;
  {
    const r = [], g = [], b = [];
    let all = 0;
    for (let i = 0; i < W * H; i += 5) {
      if (mk[i * 4 + 1] <= 127 || where[i * 3] !== where[i * 3]) continue;
      all++;
      if (sat(i) > 0.3) { r.push(px[i * 4]); g.push(px[i * 4 + 1]); b.push(px[i * 4 + 2]); }
    }
    const mid = (list) => list.sort((x, y) => x - y)[list.length >> 1];
    if (r.length && r.length >= all * 0.25) bodyColor = [mid(r), mid(g), mid(b)];
  }

  const history = [];
  let stroke = null;
  const flag = new Uint8Array(W * H);
  const far = (i, c) => Math.hypot(px[i * 4] - c[0], px[i * 4 + 1] - c[1], px[i * 4 + 2] - c[2]);

  function change(i) {
    const s = stroke, o = i * 4;
    s.index.push(i);
    s.old.push(px[o], px[o + 1], px[o + 2], mk[o], mk[o + 1], mk[o + 2]);
    flag[i] = 1;
    if (s.tool === "clean") { px[o] = s.fill[0]; px[o + 1] = s.fill[1]; px[o + 2] = s.fill[2]; return; }
    const kind = KINDS[s.tool];
    mk[o] = kind[0]; mk[o + 1] = kind[1]; mk[o + 2] = kind[2]; mk[o + 3] = 255;
    if (s.tool === "glass") {
      // the same glass tone the even glass step gives
      const v = 20 + (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255 * 34;
      px[o] = Math.round(v * 0.86); px[o + 1] = Math.round(v * 0.96); px[o + 2] = Math.round(v * 1.12);
    } else if (s.tool === "paint" && bodyColor && sat(i) < 0.3) {
      px[o] = bodyColor[0]; px[o + 1] = bodyColor[1]; px[o + 2] = bodyColor[2];
    }
  }

  function sweep(point) {
    const s = stroke, r2 = s.radius * s.radius, [x, y, z] = point;
    for (let i = 0, at = 0; i < W * H; i++, at += 3) {
      const dx = where[at] - x, dy = where[at + 1] - y, dz = where[at + 2] - z;
      if (!(dx * dx + dy * dy + dz * dz <= r2) || flag[i]) continue;
      if (s.similar && far(i, s.ref) > NEAR) continue;
      change(i);
    }
  }

  // Start a stroke at a point on the car. tool is one of TOOLS; radius is in model units (meters on a finished car).
  // Returns a short reason when the stroke cannot start, otherwise null.
  function begin(point, tool, { radius = 0.08, similar = true } = {}) {
    if (stroke) end();
    if (!TOOLS.includes(tool)) return "Unknown tool.";
    // the color first touched: the mean of the texels right under the finger
    const [x, y, z] = point, core = Math.max(radius * 0.3, 1e-6), c2 = core * core;
    let n = 0, r = 0, g = 0, b = 0, best = Infinity, bestAt = -1;
    for (let i = 0, at = 0; i < W * H; i++, at += 3) {
      const dx = where[at] - x, dy = where[at + 1] - y, dz = where[at + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (!(d === d)) continue;
      if (d < best) { best = d; bestAt = i; }
      if (d <= c2) { n++; r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
    }
    if (bestAt < 0 || best > radius * radius * 9) return "That spot is not on the textured car.";
    const ref = n ? [r / n, g / n, b / n] : [px[bestAt * 4], px[bestAt * 4 + 1], px[bestAt * 4 + 2]];
    stroke = { tool, radius, similar, ref, fill: null, index: [], old: [] };
    if (tool === "clean") {
      // clean paints the spot the color of what surrounds it: the middle color of nearby texels that do not look like the spot
      const wide = radius * radius * 9, rs = [], gs = [], bs = [];
      for (let i = 0, at = 0; i < W * H; i++, at += 3) {
        const dx = where[at] - x, dy = where[at + 1] - y, dz = where[at + 2] - z;
        if (!(dx * dx + dy * dy + dz * dz <= wide) || far(i, ref) <= NEAR) continue;
        rs.push(px[i * 4]); gs.push(px[i * 4 + 1]); bs.push(px[i * 4 + 2]);
      }
      if (rs.length < 12) { stroke = null; return "Nothing nearby differs from that spot, so there is no color to clean it with. Try a smaller brush on the mark itself."; }
      const mid = (list) => list.sort((p, q) => p - q)[list.length >> 1];
      stroke.fill = [mid(rs), mid(gs), mid(bs)];
      stroke.similar = true; // clean always keeps to the mark it was pointed at
    }
    sweep(point);
    return null;
  }

  function move(point) { if (stroke) sweep(point); }

  // Finish the stroke: carry the change 2 px into texels no face uses, so filtering at an edge does not show the old color.
  function end() {
    if (!stroke) return 0;
    const s = stroke;
    let edge = s.index.slice();
    for (let pass = 0; pass < 2 && edge.length; pass++) {
      const next = [];
      for (const i of edge) {
        const x = i % W, y = (i - x) / W;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0) - (d === 1), ny = y + (d === 2) - (d === 3);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (flag[n] || where[n * 3] === where[n * 3]) continue;
          s.index.push(n); s.old.push(px[n * 4], px[n * 4 + 1], px[n * 4 + 2], mk[n * 4], mk[n * 4 + 1], mk[n * 4 + 2]);
          flag[n] = 1;
          for (let j = 0; j < 3; j++) { px[n * 4 + j] = px[i * 4 + j]; mk[n * 4 + j] = mk[i * 4 + j]; }
          mk[n * 4 + 3] = 255;
          next.push(n);
        }
      }
      edge = next;
    }
    for (const i of s.index) flag[i] = 0;
    stroke = null;
    if (s.index.length) { history.push(s); if (history.length > 40) history.shift(); }
    return s.index.length;
  }

  function restore(s) {
    for (let k = 0; k < s.index.length; k++) {
      const o = s.index[k] * 4, q = k * 6;
      px[o] = s.old[q]; px[o + 1] = s.old[q + 1]; px[o + 2] = s.old[q + 2];
      mk[o] = s.old[q + 3]; mk[o + 1] = s.old[q + 4]; mk[o + 2] = s.old[q + 5];
      flag[s.index[k]] = 0;
    }
  }
  // drop a stroke in progress (a second finger came down to turn the view)
  function cancel() { if (stroke) { restore(stroke); stroke = null; } }
  function undo() { const s = history.pop(); if (!s) return false; restore(s); return true; }

  async function toBytes() {
    if (stroke) end();
    tex.setImage(encodePng(W, H, px));
    maskTex.setImage(encodePng(W, H, mk));
    return writeModel(doc);
  }

  return { width: W, height: H, base: px, mask: mk, bodyColor, begin, move, end, cancel, undo, strokes: () => history.length, bytes: toBytes };
}
