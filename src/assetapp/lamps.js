// Tail lamps for a finished car. AI generators often leave the rear lamps an unlit gray, so the car has
// no brake lights in a game. This finds them by where they are and what color they are, and paints them red
// in the base texture. Nothing else in the texture is touched.
//
// A texel is a tail lamp when a body face that uses it
//   sits in the rear eighth of the car and faces backward,
//   sits in the lamp band of the height and off the center line (the plate is in the middle),
// and the texel itself is gray (no real hue), not too dark and not too bright, and is not glass.
import { readModel, writeModel } from "./engine.js";
import { decodePng, encodePng } from "../asset/finish/png.js";

export async function paintTailLamps(bytes) {
  const doc = await readModel(bytes);
  const mat = doc.getRoot().listMaterials().find((m) => m.getBaseColorTexture());
  if (!mat) return { bytes, texels: 0, reason: "The car has no base color texture." };
  const tex = mat.getBaseColorTexture();
  if (tex.getMimeType() !== "image/png") return { bytes, texels: 0, reason: "The base texture is not a PNG." };
  const base = decodePng(tex.getImage());
  const W = base.width, H = base.height, px = base.rgba;
  const maskTex = mat.getExtras() && mat.getExtras().kitMask ? mat.getEmissiveTexture() : null;
  const mask = maskTex && maskTex.getMimeType() === "image/png" ? decodePng(maskTex.getImage()) : null;

  // body faces in world space
  const faces = [];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
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
      const w = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        w[i] = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12];
        w[i + 1] = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13];
        w[i + 2] = m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14];
        for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], w[i + d]); max[d] = Math.max(max[d], w[i + d]); }
      }
      if (!wheel) faces.push({ w, uv, idx });
    }
  }
  const length = max[2] - min[2], height = max[1] - min[1], half = (max[0] - min[0]) / 2, cx = (max[0] + min[0]) / 2;
  if (!(length > 0)) return { bytes, texels: 0, reason: "The car has no size." };

  const zMax = min[2] + length * 0.125, yMin = min[1] + height * 0.38, yMax = min[1] + height * 0.72, xMin = half * 0.36;
  const hit = new Uint8Array(W * H);
  for (const f of faces) {
    for (let t = 0; t < f.idx.length; t += 3) {
      const a = f.idx[t], b = f.idx[t + 1], c = f.idx[t + 2];
      const A = [f.w[a * 3], f.w[a * 3 + 1], f.w[a * 3 + 2]], B = [f.w[b * 3], f.w[b * 3 + 1], f.w[b * 3 + 2]], C = [f.w[c * 3], f.w[c * 3 + 1], f.w[c * 3 + 2]];
      if (Math.min(A[2], B[2], C[2]) > zMax || Math.max(A[1], B[1], C[1]) < yMin || Math.min(A[1], B[1], C[1]) > yMax) continue;
      const ux = f.w[b * 3] - f.w[a * 3], uy = f.w[b * 3 + 1] - f.w[a * 3 + 1], uz = f.w[b * 3 + 2] - f.w[a * 3 + 2];
      const vx = f.w[c * 3] - f.w[a * 3], vy = f.w[c * 3 + 1] - f.w[a * 3 + 1], vz = f.w[c * 3 + 2] - f.w[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
      if (!(nl > 0) || nz / nl > -0.25) continue; // must face the back, or wrap round the rear corner
      const x0 = f.uv[a * 2] * W, y0 = f.uv[a * 2 + 1] * H, x1 = f.uv[b * 2] * W, y1 = f.uv[b * 2 + 1] * H, x2 = f.uv[c * 2] * W, y2 = f.uv[c * 2 + 1] * H;
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (Math.abs(area) < 1e-9) continue;
      const s = area < 0 ? -1 : 1;
      for (let py = Math.max(0, Math.floor(Math.min(y0, y1, y2))); py <= Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2))); py++) {
        for (let qx = Math.max(0, Math.floor(Math.min(x0, x1, x2))); qx <= Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2))); qx++) {
          const X = qx + 0.5, Y = py + 0.5;
          const e0 = s * ((x2 - x1) * (Y - y1) - (y2 - y1) * (X - x1)), e1 = s * ((x0 - x2) * (Y - y2) - (y0 - y2) * (X - x2)), e2 = s * ((x1 - x0) * (Y - y0) - (y1 - y0) * (X - x0));
          if (e0 < -0.5 || e1 < -0.5 || e2 < -0.5) continue;
          // where on the car this texel is, not just where its triangle is: one big triangle can span the whole rear
          const k = 1 / Math.abs(area), wa = e0 * k, wb = e1 * k, wc = e2 * k;
          const wx = A[0] * wa + B[0] * wb + C[0] * wc, wy = A[1] * wa + B[1] * wb + C[1] * wc, wz = A[2] * wa + B[2] * wb + C[2] * wc;
          if (wz > zMax || wy < yMin || wy > yMax || Math.abs(wx - cx) < xMin) continue;
          hit[py * W + qx] = 1;
        }
      }
    }
  }
  // A car whose lamps already have a color is left alone: count red and amber in the lamp area first.
  let lit = 0, gray = 0;
  const isGray = (r, g, b) => { const hi = Math.max(r, g, b), lo = Math.min(r, g, b); return (hi ? (hi - lo) / hi : 0) <= 0.2 && hi >= 45 && hi <= 215; };
  for (let i = 0; i < W * H; i++) {
    if (!hit[i]) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (isGray(r, g, b)) gray++;
    else if (r > 120 && r > g * 1.6 && r > b * 1.8) lit++;
  }
  if (lit > gray * 0.3) return { bytes, texels: 0, reason: "The tail lamps already have a color." };
  // On a white, gray or black car the body itself is gray, so position and color cannot tell a lamp
  // from a door panel. Painting there would put red blocks on the doors, so nothing is painted.
  let bodyGray = 0, bodyAll = 0;
  for (let i = 0; i < W * H; i += 7) {
    if (mask) { const mi = (Math.floor((i % W) * mask.width / W) + Math.floor(Math.floor(i / W) * mask.height / H) * mask.width) * 4; if (mask.rgba[mi + 1] < 128) continue; }
    bodyAll++;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], hi = Math.max(r, g, b);
    if ((hi ? (hi - Math.min(r, g, b)) / hi : 0) <= 0.2) bodyGray++;
  }
  if (!mask || bodyGray > bodyAll * 0.4) return { bytes, texels: 0, reason: mask ? "The body is white, gray or black, so a gray lamp cannot be told from a body panel." : "The car has no mask to say where its body is." };
  if (gray > W * H * 0.03) return { bytes, texels: 0, reason: "The gray area at the rear is too large to be lamps." };
  let texels = 0;
  for (let i = 0; i < W * H; i++) {
    if (!hit[i]) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (!isGray(r, g, b)) continue; // gray only: paint, chrome highlights and black trim stay
    if (mask) {
      const mi = (Math.floor((i % W) * mask.width / W) + Math.floor(Math.floor(i / W) * mask.height / H) * mask.width) * 4;
      if (mask.rgba[mi] > 127) continue; // glass
    }
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    px[i * 4] = Math.round(Math.min(255, 110 + lum * 190));
    px[i * 4 + 1] = Math.round(8 + lum * 40);
    px[i * 4 + 2] = Math.round(10 + lum * 40);
    texels++;
    if (mask) {
      const mi = (Math.floor((i % W) * mask.width / W) + Math.floor(Math.floor(i / W) * mask.height / H) * mask.width) * 4;
      mask.rgba[mi] = 0; mask.rgba[mi + 1] = 0; mask.rgba[mi + 2] = 0; mask.rgba[mi + 3] = 255; // a lamp is not paint, glass or chrome
    }
  }
  if (!texels) return { bytes, texels: 0, reason: "No gray tail lamp was found at the back of the car." };
  tex.setImage(encodePng(W, H, px));
  if (mask) maskTex.setImage(encodePng(mask.width, mask.height, mask.rgba));
  return { bytes: await writeModel(doc), texels, share: texels / (W * H) };
}
