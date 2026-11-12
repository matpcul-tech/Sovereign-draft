// Even glass for a finished car. AI generators paint windows in whatever tone the reference had: some dark,
// some a pale gray "reflection", some both in one windshield. The window mask only caught the dark ones, so a
// pale windshield stayed marked as body and came out white in a game. This finds the missed glass by where it
// is and what color it is, marks it in the mask, and gives every glass texel one dark, even glass tone.
//
// A texel is missed glass when a body face that uses it sits above the belt line (the bottom edge of the
// windows), the texel is gray (no real hue), and the mask does not already call it glass.
// The belt line is read from the glass the mask already has (kept between 58 and 70 percent of the height);
// with too little of that, 60 percent of the height.
// On a white, gray or black car the body is gray too, so nothing new is marked there: only the glass the mask
// already has is evened out.
import { readModel, writeModel } from "./engine.js";
import { decodePng, encodePng } from "../asset/finish/png.js";

export async function evenGlass(bytes) {
  const doc = await readModel(bytes);
  const mat = doc.getRoot().listMaterials().find((m) => m.getBaseColorTexture());
  if (!mat) return { bytes, added: 0, evened: 0, reason: "The car has no base color texture." };
  const tex = mat.getBaseColorTexture();
  const maskTex = mat.getExtras() && mat.getExtras().kitMask ? mat.getEmissiveTexture() : null;
  if (!maskTex) return { bytes, added: 0, evened: 0, reason: "The car has no window mask." };
  if (tex.getMimeType() !== "image/png" || maskTex.getMimeType() !== "image/png") return { bytes, added: 0, evened: 0, reason: "The base texture and the mask must be PNG." };
  const base = decodePng(tex.getImage()), mask = decodePng(maskTex.getImage());
  const W = base.width, H = base.height, px = base.rgba, mk = mask.rgba;
  const mi = (i) => (Math.floor((i % W) * mask.width / W) + Math.floor(Math.floor(i / W) * mask.height / H) * mask.width) * 4;

  // how high on the car each texel sits (body faces only), in world space
  const high = new Float32Array(W * H).fill(NaN);
  let lo = Infinity, hi = -Infinity;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let wheel = false;
    for (let n = node; n; n = n.getParentNode()) if ((n.getExtras() && n.getExtras().kitWheel) || /^wheel/i.test(n.getName())) wheel = true;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute("POSITION"), UV = prim.getAttribute("TEXCOORD_0"), I = prim.getIndices();
      if (!P || !UV || !I) continue;
      const p = P.getArray(), uv = UV.getArray(), idx = I.getArray();
      const y = new Float32Array(p.length / 3);
      for (let i = 0; i < y.length; i++) { y[i] = m[1] * p[i * 3] + m[5] * p[i * 3 + 1] + m[9] * p[i * 3 + 2] + m[13]; lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
      if (wheel) continue;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const x0 = uv[a * 2] * W, y0 = uv[a * 2 + 1] * H, x1 = uv[b * 2] * W, y1 = uv[b * 2 + 1] * H, x2 = uv[c * 2] * W, y2 = uv[c * 2 + 1] * H;
        const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (Math.abs(area) < 1e-9) continue;
        const s = area < 0 ? -1 : 1, k = 1 / Math.abs(area);
        for (let py = Math.max(0, Math.floor(Math.min(y0, y1, y2))); py <= Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2))); py++) {
          for (let qx = Math.max(0, Math.floor(Math.min(x0, x1, x2))); qx <= Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2))); qx++) {
            const X = qx + 0.5, Y = py + 0.5;
            const e0 = s * ((x2 - x1) * (Y - y1) - (y2 - y1) * (X - x1)), e1 = s * ((x0 - x2) * (Y - y2) - (y0 - y2) * (X - x2)), e2 = s * ((x1 - x0) * (Y - y0) - (y1 - y0) * (X - x0));
            if (e0 < -0.5 || e1 < -0.5 || e2 < -0.5) continue;
            // the lowest face wins, so a texel shared with a sill or a fender is not called glass
            const wy = (y[a] * e0 + y[b] * e1 + y[c] * e2) * k, at = py * W + qx;
            if (!(high[at] <= wy)) high[at] = wy;
          }
        }
      }
    }
  }
  const height = hi - lo;
  if (!(height > 0)) return { bytes, added: 0, evened: 0, reason: "The car has no size." };

  const sat = (i) => { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], top = Math.max(r, g, b); return top ? (top - Math.min(r, g, b)) / top : 0; };
  // belt line from the glass the mask already has
  const glassY = [];
  let bodyHue = 0, bodyAll = 0;
  for (let i = 0; i < W * H; i++) {
    const m = mi(i);
    if (mk[m] > 127 && high[i] === high[i]) glassY.push(high[i]);
    if (mk[m + 1] > 127 && i % 7 === 0) { bodyAll++; if (sat(i) > 0.3) bodyHue++; }
  }
  glassY.sort((a, b) => a - b);
  const belt = glassY.length >= 2000 ? Math.min(lo + height * 0.7, Math.max(lo + height * 0.58, glassY[Math.floor(glassY.length * 0.1)])) : lo + height * 0.6;
  // a body has a color when a quarter of its paint area does: the rest is trim, lamps, chrome and the missed glass itself
  const grayBody = bodyHue < bodyAll * 0.25;

  // missed glass: gray, above the belt, on the body, not yet glass
  const add = [];
  if (!grayBody) {
    for (let i = 0; i < W * H; i++) {
      if (!(high[i] >= belt)) continue;
      const m = mi(i);
      if (mk[m] > 127 || (mk[m + 1] <= 127 && mk[m + 2] <= 127)) continue;
      if (sat(i) <= 0.2) add.push(i);
    }
  }
  let reason = grayBody ? "The body is white, gray or black, so gray glass cannot be told from a body panel. Only the glass already in the mask was evened." : "";
  if (add.length > W * H * 0.12) { reason = "The gray area above the belt line is too large to be windows, so no glass was added."; add.length = 0; }
  for (const i of add) { const m = mi(i); mk[m] = 255; mk[m + 1] = 0; mk[m + 2] = 0; mk[m + 3] = 255; }
  // pad the new glass 4 px into texels no face uses, so filtering at the edge of a window does not pull in the pale gutter
  let grown = 0;
  if (add.length) {
    const isGlass = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (mk[mi(i)] > 127) isGlass[i] = 1;
    let edge = add.slice();
    for (let pass = 0; pass < 4 && edge.length; pass++) {
      const next = [];
      for (const i of edge) {
        const x = i % W, y = (i - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (isGlass[n] || high[n] === high[n]) continue;
          isGlass[n] = 1; const m = mi(n); mk[m] = 255; mk[m + 1] = 0; mk[m + 2] = 0; mk[m + 3] = 255; next.push(n); grown++;
        }
      }
      edge = next;
    }
  }

  // one glass tone: dark, slightly blue, with a quarter of the painted light and dark kept so it is not a flat fill
  let evened = 0;
  for (let i = 0; i < W * H; i++) {
    if (mk[mi(i)] <= 127) continue;
    const lum = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255, v = 20 + lum * 34;
    const r = Math.round(v * 0.86), g = Math.round(v * 0.96), b = Math.round(v * 1.12);
    if (px[i * 4] !== r || px[i * 4 + 1] !== g || px[i * 4 + 2] !== b) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; evened++; }
  }
  if (!add.length && !evened) return { bytes, added: 0, evened: 0, reason: reason || "The glass was already even." };
  tex.setImage(encodePng(W, H, px));
  if (add.length) maskTex.setImage(encodePng(mask.width, mask.height, mk));
  return { bytes: await writeModel(doc), added: add.length, evened, belt: (belt - lo) / height, reason };
}
