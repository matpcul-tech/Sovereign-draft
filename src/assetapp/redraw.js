// Redraw openings by hand, on a file that is already finished.
//
// The finder in windows.js reads the mesh: glass set back in a frame, a sign proud of the wall.
// Where a generator left none of that (a window that is only torn paint, a door with a sheet of
// wall across it, a sign board with nothing on it) there is nothing to find, and running the
// file again finds the same nothing. A plan says what should be there instead:
//
//   { openings: [
//     { kind: "window", face: "+z", at: 3.81, span: [-2.45, -1.23], y: [0.97, 2.03], lit: true },
//     { kind: "door",   face: "+z", at: 2.46, span: [0.17, 1.31],  y: [0.12, 2.13] },
//     { kind: "sign",   face: "+z", at: 2.25, span: [-2.23, 2.13], y: [3.22, 3.86], text: "PAWN * LOANS * GOLD" },
//     { kind: "wall",   face: "+z", at: 3.81, span: [-2.6, -1.1],  y: [0.03, 1.0] },
//     { kind: "cut",    face: "+z", at: 3.81, span: [0.1, 0.4],    y: [1.2, 2.15] }
//   ] }
//
// face is the way the wall faces, at is where the wall stands on that axis, span is the stretch
// along the wall in the file's own X (or Z, for a wall that faces along X), y is bottom and top.
// All in meters, in the finished file. Leave `at` out and the wall is found under the rectangle.
//
// Every kind first cuts away the wall that lies in its rectangle, then puts its own piece there.
// A window or a door also clears out what the generator left in its opening: torn glass set back
// in it, bars and shutters standing out of it (anything wholly inside the rectangle, from 0.4 m
// behind the wall to `clear` meters in front of it, 0.25 unless the plan says; 0 keeps it all).
//   window  one pane (windows_lit or windows_dark), a frame, a sill and sash bars (trim), and
//           with "bars": true a set of iron window bars in front (bars)
//   door    a paneled leaf painted here (door) in a frame (trim); doors found before are retired
//   sign    a lettered board that glows with its own paint (sign_lit); signs found before are retired
//   wall    a clean patch of the wall's own paint, copied from the cleanest stretch of that wall
//           and faded into what is round it, painted into a free corner of the wall's texture
//   cut     nothing: the wall is only taken away (a wedge of wall across an open porch)
//   clear   nothing is cut. Loose triangles that lie flat on the wall inside the rectangle and
//           are not painted as that wall (a generator's stray sheet, still in its old paint,
//           showing as a long streak across a clean wall) are taken off it
import { prune } from "@gltf-transform/functions";
import { readModel, writeModel } from "./engine.js";
import { FACE_NAMES, addBars, addDoor, addPanel, addWindow, builder, cleanStretch, cutTriangle, frameOf, freeBlock, hexColor, layWall, markUsed, paintDoor, paintIron, paintSign, paintTrim, sample } from "./openings.js";

const WINDOW_LIT = "windows_lit", WINDOW_DARK = "windows_dark", SIGN_LIT = "sign_lit", DOOR = "door", TRIM = "trim", BARS = "bars";
const PARTS = [WINDOW_LIT, WINDOW_DARK, SIGN_LIT, DOOR, "walls", TRIM, BARS];
const WINDOW_GLOW = [1, 0.74, 0.45];
const KINDS = ["window", "door", "sign", "wall", "cut", "clear"];
const TOLERANCE = 0.03; // how far off the wall's plane a triangle may sit and still be that wall, meters

const count = (n, word, plural) => n + " " + (n === 1 ? word : plural || word + "s");
const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

function invert(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e) || 1;
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

// Every triangle part in the file, with where its corners are in the world.
function partsOf(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getAttribute("POSITION")) continue;
      out.push({ node, mesh, prim, matrix });
    }
  }
  return out;
}
function worldOf(part) {
  const src = part.prim.getAttribute("POSITION").getArray(), m = part.matrix, out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) { const p = apply(m, [src[i], src[i + 1], src[i + 2]]); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; }
  return out;
}
function indexOf(part) {
  const idx = part.prim.getIndices();
  if (idx) return idx.getArray();
  const n = part.prim.getAttribute("POSITION").getCount(), out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

function readPlan(plan) {
  const list = plan && Array.isArray(plan.openings) ? plan.openings : null;
  if (!list || !list.length) throw new Error("The plan lists no openings.");
  return list.map((o, i) => {
    const where = "Opening " + (i + 1) + (o && o.kind ? " (" + o.kind + ")" : "");
    if (!o || !KINDS.includes(o.kind)) throw new Error(where + ": kind must be one of " + KINDS.join(", ") + ".");
    if (!FACE_NAMES.includes(o.face)) throw new Error(where + ": face must be one of " + FACE_NAMES.join(", ") + ".");
    const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n)) && v[0] !== v[1];
    if (!pair(o.span) || !pair(o.y)) throw new Error(where + ": span and y must each be two different numbers, in meters.");
    if (o.kind === "sign" && !String(o.text || "").trim()) throw new Error(where + ": a sign needs its text.");
    return { ...o, y: [Math.min(...o.y), Math.max(...o.y)], index: i };
  });
}

// Where the wall under a rectangle stands, when the plan does not say: the depth most of the
// outward facing surface in the rectangle lies at.
function findWall(parts, o) {
  const fr = frameOf(o.face, 0), [r0, r1] = fr.span(o.span), [y0, y1] = o.y, buckets = new Map();
  for (const part of parts) {
    const pos = worldOf(part), idx = indexOf(part);
    for (let t = 0; t < idx.length; t += 3) {
      const a = fr.local([pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]]), b = fr.local([pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]]), c = fr.local([pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]]);
      // the wall round an opening counts too: a wall built up to a window's edge never crosses into it
      if (Math.max(a[0], b[0], c[0]) < r0 - 0.3 || Math.min(a[0], b[0], c[0]) > r1 + 0.3 || Math.max(a[1], b[1], c[1]) < y0 - 0.3 || Math.min(a[1], b[1], c[1]) > y1 + 0.3) continue;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; // its size seen square on
      if (area < 1e-8 || Math.max(a[2], b[2], c[2]) - Math.min(a[2], b[2], c[2]) > 0.05) continue;
      // only surface that faces the way the wall does: the far wall of the building lies under the
      // same rectangle, facing the other way
      const w0 = [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]], w1 = [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]], w2 = [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]];
      const e1 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]], e2 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];
      const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (nrm[fr.axis] * fr.sign <= 0) continue;
      const key = Math.round((a[2] + b[2] + c[2]) / 3 / 0.02);
      const hit = buckets.get(key) || { area: 0, sum: 0 };
      hit.area += area; hit.sum += area * (a[2] + b[2] + c[2]) / 3; buckets.set(key, hit);
    }
  }
  // of the depths with a good share of that surface, the outermost is the wall's face
  let most = 0, best = null;
  for (const hit of buckets.values()) if (hit.area > most) most = hit.area;
  for (const hit of buckets.values()) if (hit.area >= most * 0.25 && (!best || hit.sum / hit.area > best.sum / best.area)) best = hit;
  if (!best) throw new Error("Opening " + (o.index + 1) + " (" + o.kind + "): no wall was found under it. Give its depth as `at`.");
  return frameOf(o.face, 0).sign * best.sum / best.area;
}

// Take the wall out of a rectangle: every triangle lying in the wall's plane loses the part of
// it inside. Returns how many triangles were touched.
function cutWall(doc, buffer, parts, fr, r0, y0, r1, y1) {
  let touched = 0;
  for (const part of parts) {
    const prim = part.prim, pos = worldOf(part), idx = indexOf(part);
    const names = prim.listSemantics(), arrays = names.map((name) => prim.getAttribute(name).getArray()), sizes = names.map((name) => prim.getAttribute(name).getElementSize());
    const width = sizes.reduce((s, n) => s + n, 0);
    const keep = [], added = [];
    let next = prim.getAttribute("POSITION").getCount();
    for (let t = 0; t < idx.length; t += 3) {
      const loc = [0, 1, 2].map((e) => fr.local([pos[idx[t + e] * 3], pos[idx[t + e] * 3 + 1], pos[idx[t + e] * 3 + 2]]));
      const on = loc.every((p) => Math.abs(p[2]) <= TOLERANCE);
      const apart = Math.max(loc[0][0], loc[1][0], loc[2][0]) <= r0 || Math.min(loc[0][0], loc[1][0], loc[2][0]) >= r1 || Math.max(loc[0][1], loc[1][1], loc[2][1]) <= y0 || Math.min(loc[0][1], loc[1][1], loc[2][1]) >= y1;
      if (!on || apart) { keep.push(idx[t], idx[t + 1], idx[t + 2]); continue; }
      // corners as (r, y, then every attribute as stored), so new corners get all of them
      const corners = [0, 1, 2].map((e) => {
        const v = idx[t + e], row = [loc[e][0], loc[e][1]];
        for (let k = 0; k < names.length; k++) for (let c = 0; c < sizes[k]; c++) row.push(arrays[k][v * sizes[k] + c]);
        return row;
      });
      for (const piece of cutTriangle(corners, r0, y0, r1, y1)) for (const corner of piece) { added.push(corner); keep.push(next++); }
      touched++;
    }
    if (keep.length === idx.length && !added.length) continue;
    if (added.length) {
      let offset = 2;
      for (let k = 0; k < names.length; k++) {
        const old = arrays[k], grown = new old.constructor(old.length + added.length * sizes[k]);
        grown.set(old);
        for (let a = 0; a < added.length; a++) {
          // a normal carried to a new corner is the blend of three: it is brought back to length one
          const unit = names[k] === "NORMAL" ? Math.hypot(added[a][offset], added[a][offset + 1], added[a][offset + 2]) || 1 : 1;
          for (let c = 0; c < sizes[k]; c++) grown[old.length + a * sizes[k] + c] = names[k] === "NORMAL" ? added[a][offset + c] / unit : added[a][offset + c];
        }
        offset += sizes[k];
        const acc = prim.getAttribute(names[k]);
        prim.setAttribute(names[k], doc.createAccessor().setType(acc.getType()).setNormalized(acc.getNormalized()).setArray(grown).setBuffer(buffer));
      }
      if (offset !== width + 2) throw new Error("cut: attribute widths do not add up");
    }
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(keep)).setBuffer(buffer));
  }
  return touched;
}

// The decoded pixels of a texture, read once and written back at the end if they changed.
function pixelStore(codec) {
  const held = new Map();
  return {
    async get(tex) {
      if (!tex) return null;
      if (!held.has(tex)) {
        let img = null;
        try { img = tex.getImage() && codec ? await codec.decode(tex.getImage(), tex.getMimeType()) : null; } catch (error) { img = null; }
        held.set(tex, img ? { ...img, rgba: new Uint8Array(img.rgba), dirty: false } : null);
      }
      return held.get(tex);
    },
    async save() {
      for (const [tex, img] of held) {
        if (!img || !img.dirty) continue;
        let bytes = null, mime = tex.getMimeType();
        for (const m of mime === "image/png" ? ["image/png"] : [mime, "image/png"]) {
          try { bytes = await codec.encode(img.rgba, img.width, img.height, m, 0.93); } catch (error) { bytes = null; }
          if (bytes) { mime = m; break; }
        }
        if (!bytes) throw new Error("The wall texture could not be written back on this device.");
        tex.setImage(bytes).setMimeType(mime);
      }
    }
  };
}

async function newTexture(doc, codec, name, img, mime = "image/jpeg") {
  let bytes = null, used = mime;
  for (const m of mime === "image/png" ? ["image/png"] : [mime, "image/png"]) {
    try { bytes = await codec.encode(img.rgba, img.width, img.height, m, 0.92); } catch (error) { bytes = null; }
    if (bytes) { used = m; break; }
  }
  if (!bytes) throw new Error("A new texture could not be written on this device.");
  return doc.createTexture(name).setImage(bytes).setMimeType(used);
}

// The wall in a plane: the material most of it is painted with, and its triangles laid flat.
function wallIn(parts, fr) {
  const byMat = new Map();
  for (const part of parts) {
    const mat = part.prim.getMaterial(), uvAcc = part.prim.getAttribute("TEXCOORD_0");
    if (!mat || !mat.getBaseColorTexture() || !uvAcc) continue;
    const pos = worldOf(part), idx = indexOf(part), uv = uvAcc.getArray();
    for (let t = 0; t < idx.length; t += 3) {
      const loc = [0, 1, 2].map((e) => fr.local([pos[idx[t + e] * 3], pos[idx[t + e] * 3 + 1], pos[idx[t + e] * 3 + 2]]));
      if (!loc.every((p) => Math.abs(p[2]) <= TOLERANCE)) continue;
      const area = Math.abs((loc[1][0] - loc[0][0]) * (loc[2][1] - loc[0][1]) - (loc[2][0] - loc[0][0]) * (loc[1][1] - loc[0][1])) / 2;
      if (area < 1e-9) continue;
      const hit = byMat.get(mat) || { tris: [], area: 0 };
      hit.tris.push({ p: loc.map((p) => [p[0], p[1]]), uv: [0, 1, 2].map((e) => [uv[idx[t + e] * 2], uv[idx[t + e] * 2 + 1]]), area });
      hit.area += area; byMat.set(mat, hit);
    }
  }
  let mat = null, wall = null;
  for (const [m, hit] of byMat) if (!wall || hit.area > wall.area) { mat = m; wall = hit; }
  return wall ? { mat, wall } : null;
}

// A clean patch of wall. `found` is the wall as it stood before anything was cut out of it.
async function patchWall(doc, parts, fr, o, r0, y0, r1, y1, plan, store, islands, wallBuilders, log, found) {
  if (!found) throw new Error("no textured wall lies in that plane");
  const { mat, wall } = found;
  const paint = await store.get(mat.getBaseColorTexture());
  if (!paint) throw new Error("the wall's texture could not be read on this device");
  const W = paint.width, H = paint.height;

  // how finely the wall is painted, and whether its texture stands upright on it
  const dens = [], upright = { yes: 0, no: 0 };
  for (const t of wall.tris) {
    const du1 = (t.uv[1][0] - t.uv[0][0]) * W, dv1 = (t.uv[1][1] - t.uv[0][1]) * H, du2 = (t.uv[2][0] - t.uv[0][0]) * W, dv2 = (t.uv[2][1] - t.uv[0][1]) * H;
    const dr1 = t.p[1][0] - t.p[0][0], dy1 = t.p[1][1] - t.p[0][1], dr2 = t.p[2][0] - t.p[0][0], dy2 = t.p[2][1] - t.p[0][1], det = dr1 * dy2 - dr2 * dy1;
    const px = Math.abs(du1 * dv2 - du2 * dv1) / 2;
    if (px > 0) dens.push(Math.sqrt(px / t.area));
    const ur = (du1 * dy2 - du2 * dy1) / det, vy = (dv2 * dr1 - dv1 * dr2) / det, uy = (du2 * dr1 - du1 * dr2) / det;
    if (ur > 0 && vy < 0 && Math.abs(uy) < 0.2 * Math.abs(ur)) upright.yes += t.area; else upright.no += t.area;
  }
  dens.sort((a, b) => a - b);
  const density = Math.min(400, Math.max(48, dens[dens.length >> 1] || 128));
  const stands = upright.yes > 4 * upright.no;

  // the wall laid out flat round the patch, and the cleanest stretch of it to copy
  const reach = 3, lay = layWall(wall.tris, r0 - reach, y0 - reach, r1 + reach, y1 + reach, density);
  const cell = (r, y) => { const i = Math.floor((r - lay.r0) * density), j = Math.floor((y - lay.y0) * density); return i < 0 || j < 0 || i >= lay.width || j >= lay.height ? -1 : j * lay.width + i; };
  const avoid = plan.filter((q) => q.kind !== "clear" && q.face === o.face && Math.abs(q.frame.at - fr.at) <= TOLERANCE).map((q) => [Math.floor((q.r0 - 0.15 - lay.r0) * density), Math.floor((q.y[0] - 0.15 - lay.y0) * density), Math.ceil((q.r1 + 0.15 - lay.r0) * density), Math.ceil((q.y[1] + 0.15 - lay.y0) * density)]);
  // the wall's brightness just outside the patch: the stretch to copy should be about that bright
  let tone = null, toneSum = 0, toneN = 0;
  for (let j = 0; j < lay.height; j += 3) for (let i = 0; i < lay.width; i += 3) {
    const at = j * lay.width + i;
    if (Number.isNaN(lay.U[at])) continue;
    const r = lay.r0 + (i + 0.5) / density, y = lay.y0 + (j + 0.5) / density, dist = Math.max(r0 - r, r - r1, y0 - y, y - y1);
    if (dist < 0.02 || dist > 0.3) continue;
    const c = sample(paint, lay.U[at], lay.V[at]);
    toneSum += 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; toneN++;
  }
  if (toneN > 20) tone = toneSum / toneN;
  let src = null, sw = 0, sh = 0;
  for (const k of [1, 0.7, 0.5, 0.35, 0.25]) {
    sw = Math.max(8, Math.round(Math.min(r1 - r0, 1.2) * k * density)); sh = Math.max(8, Math.round(Math.min(y1 - y0, 0.9) * k * density));
    src = cleanStretch(lay, paint, sw, sh, avoid, Math.max(2, Math.round(density * 0.04)), tone);
    if (src) break;
  }
  if (!src) throw new Error("no clean stretch of that wall was found to copy from");
  const mirror = (n, size) => { const m = ((n % (2 * size)) + 2 * size) % (2 * size); return m < size ? m : 2 * size - 1 - m; };

  // the maps the wall carries: its color, and its normal and roughness when it has them
  const maps = [{ tex: mat.getBaseColorTexture(), img: paint, role: "color" }];
  for (const [role, tex] of [["normal", mat.getNormalTexture()], ["rough", mat.getMetallicRoughnessTexture()], ["occlusion", mat.getOcclusionTexture()]]) {
    if (!tex || maps.some((mp) => mp.tex === tex)) continue;
    const img = await store.get(tex);
    if (img && img.width === W && img.height === H) maps.push({ tex, img, role });
  }

  // a free corner of the texture for the patch
  const CELL = 4, gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
  let used = islands.get(mat.getBaseColorTexture());
  if (!used) {
    used = new Uint8Array(gw * gh);
    const shared = new Set(maps.map((mp) => mp.tex));
    for (const part of parts) {
      const pm = part.prim.getMaterial(), uvAcc = part.prim.getAttribute("TEXCOORD_0");
      if (!pm || !uvAcc || ![pm.getBaseColorTexture(), pm.getNormalTexture(), pm.getMetallicRoughnessTexture(), pm.getOcclusionTexture(), pm.getEmissiveTexture()].some((t) => t && shared.has(t))) continue;
      const uv = uvAcc.getArray(), idx = indexOf(part);
      for (let t = 0; t < idx.length; t += 3) markUsed(used, gw, gh, [0, 1, 2].map((e) => [uv[idx[t + e] * 2], uv[idx[t + e] * 2 + 1]]), 2);
    }
    islands.set(mat.getBaseColorTexture(), used);
  }
  const gutter = 6;
  let spot = null, scale = 1, pw = 0, ph = 0;
  for (const k of [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.28, 0.22]) {
    pw = Math.ceil((r1 - r0) * density * k) + 2 * gutter; ph = Math.ceil((y1 - y0) * density * k) + 2 * gutter;
    spot = freeBlock(used, gw, gh, Math.ceil(pw / CELL) + 1, Math.ceil(ph / CELL) + 1);
    if (spot) { scale = k; break; }
  }
  if (!spot) throw new Error("the wall's texture has no free corner big enough for the patch");
  for (let j = spot.j; j < spot.j + Math.ceil(ph / CELL) + 1; j++) for (let i = spot.i; i < spot.i + Math.ceil(pw / CELL) + 1; i++) used[j * gw + i] = 1;
  const ox = spot.i * CELL, oy = spot.j * CELL, d2 = density * scale, feather = Math.min(o.feather ?? 0.1, (r1 - r0) / 3, (y1 - y0) / 3);

  // the wall's color just inside the patch's edge, and the copied stretch's color: the copy is
  // shifted by the difference, so the patch sits in the wall's own tone
  const srcUv = (r, y) => { const at = (src.j + mirror(Math.floor((y - y0) * density), sh)) * lay.width + src.i + mirror(Math.floor((r - r0) * density), sw); return [lay.U[at], lay.V[at]]; };
  const here = [0, 0, 0], there = [0, 0, 0]; let nHere = 0, nThere = 0;
  for (let j = 0; j < ph; j += 2) for (let i = 0; i < pw; i += 2) {
    const r = r0 + (i - gutter + 0.5) / d2, y = y1 - (j - gutter + 0.5) / d2, edge = Math.min(r - r0, r1 - r, y - y0, y1 - y);
    if (edge < 0) continue;
    const s = srcUv(r, y), c = sample(paint, s[0], s[1]);
    there[0] += c[0]; there[1] += c[1]; there[2] += c[2]; nThere++;
    const at = cell(r, y);
    if (edge < feather * 0.4 && at >= 0 && !Number.isNaN(lay.U[at])) { const e = sample(paint, lay.U[at], lay.V[at]); here[0] += e[0]; here[1] += e[1]; here[2] += e[2]; nHere++; }
  }
  const shift = nHere > 20 ? [0, 1, 2].map((k) => Math.max(-40, Math.min(40, here[k] / nHere - there[k] / nThere))) : [0, 0, 0];

  for (const mp of maps) {
    const flat = mp.role === "normal" && !stands; // a texture lying on its side would turn the copied relief with it
    const out = new Uint8Array(pw * ph * 3);
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      const r = r0 + (i - gutter + 0.5) / d2, y = y1 - (j - gutter + 0.5) / d2, edge = Math.min(r - r0, r1 - r, y - y0, y1 - y);
      const at = cell(r, y), has = at >= 0 && !Number.isNaN(lay.U[at]);
      let clean;
      if (flat) clean = [128, 128, 255];
      else { const s = srcUv(Math.min(r1, Math.max(r0, r)), Math.min(y1, Math.max(y0, y))); clean = sample(mp.img, s[0], s[1]); if (mp.role === "color") clean = [clean[0] + shift[0], clean[1] + shift[1], clean[2] + shift[2]]; }
      let w = 1;
      if (has && !flat) { const t = edge <= 0 ? 0 : edge >= feather ? 1 : edge / feather; w = t * t * (3 - 2 * t); }
      const old = has && w < 1 ? sample(mp.img, lay.U[at], lay.V[at]) : clean;
      const q = (j * pw + i) * 3;
      for (let k = 0; k < 3; k++) { const v = old[k] + (clean[k] - old[k]) * w; out[q + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    }
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      if (ox + i >= W || oy + j >= H) continue;
      const q = (j * pw + i) * 3, at = ((oy + j) * W + ox + i) * 4;
      mp.img.rgba[at] = out[q]; mp.img.rgba[at + 1] = out[q + 1]; mp.img.rgba[at + 2] = out[q + 2]; mp.img.rgba[at + 3] = 255;
    }
    mp.img.dirty = true;
  }
  if (!wallBuilders.has(mat)) wallBuilders.set(mat, builder());
  addPanel(wallBuilders.get(mat), fr, r0, r1, y0, y1, 0.004, (r, y) => [(ox + gutter + (r - r0) * d2) / W, (oy + gutter + (y1 - y) * d2) / H]);
  log.push("Wall patch " + m2(r1 - r0) + " by " + m2(y1 - y0) + " m on the " + o.face + " wall: clean paint copied from the cleanest " + m2(sw / density) + " by " + m2(sh / density) + " m of that wall, faded into the wall over " + Math.round(feather * 100) + " cm at its edge, painted into a free corner of the wall's own texture at " + Math.round(d2) + " pixels per meter" + (scale < 1 ? " (the wall is at " + Math.round(density) + "; the free corner was smaller)" : "") + (maps.length > 1 ? ", color and " + (maps.length - 1) + " surface " + (maps.length === 2 ? "map" : "maps") : "") + ".");
}

// Apply a plan to a finished file. env: { codec: { decode, encode } }. Returns { bytes, log, done }.
export async function redrawOpenings(bytes, plan, env = {}) {
  const codec = env.codec;
  if (!codec) throw new Error("Openings cannot be redrawn on this device: textures can be neither read nor written.");
  const log = [];
  const doc = await readModel(bytes), root = doc.getRoot();
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  let parts = partsOf(doc);
  if (!parts.length) throw new Error("The file has no triangles.");
  const list = readPlan(plan);
  for (const o of list) {
    const at = Number.isFinite(o.at) ? o.at : findWall(parts, o);
    o.frame = frameOf(o.face, at);
    if (!Number.isFinite(o.at)) log.push("Opening " + (o.index + 1) + " (" + o.kind + "): the " + o.face + " wall was found at " + (o.frame.axis === 0 ? "x" : "z") + " = " + m2(at) + ".");
    [o.r0, o.r1] = o.frame.span(o.span);
  }
  const done = { window: 0, door: 0, sign: 0, wall: 0, cut: 0, clear: 0 };

  // parts found before that a redrawn door or sign replaces go back to plain paint
  const plainFor = (mat) => {
    const same = root.listMaterials().find((m) => !PARTS.includes(m.getName()) && m.getBaseColorTexture() === mat.getBaseColorTexture());
    return same || mat.clone().setName("Material_0").setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
  };
  for (const [kind, name, word] of [["door", DOOR, "door"], ["sign", SIGN_LIT, "sign"]]) {
    if (!list.some((o) => o.kind === kind)) continue;
    let retired = 0;
    for (const part of parts) {
      const mat = part.prim.getMaterial();
      if (mat && mat.getName() === name) { part.prim.setMaterial(plainFor(mat)); retired += indexOf(part).length / 3; }
    }
    if (retired) log.push("The " + word + " found before (" + count(retired, "triangle") + ", material " + name + ") went back to plain paint: the redrawn " + word + " is the " + word + " now.");
  }

  // the wall each patch will copy from, read while it is still whole
  for (const o of list) if (o.kind === "wall") o.found = wallIn(parts, o.frame);

  // 1. stray sheets come off the wall, then the wall under every opening is taken away
  for (const o of list) {
    if (o.kind !== "clear") continue;
    const found = wallIn(parts, o.frame);
    let gone = 0;
    for (const part of parts) {
      const mat = part.prim.getMaterial();
      if (!found || mat === found.mat || PARTS.includes(mat ? mat.getName() : "")) continue;
      const pos = worldOf(part), idx = indexOf(part), keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const loc = [0, 1, 2].map((e) => o.frame.local([pos[idx[t + e] * 3], pos[idx[t + e] * 3 + 1], pos[idx[t + e] * 3 + 2]]));
        const flat = loc.every((p) => Math.abs(p[2]) <= TOLERANCE && p[0] >= o.r0 && p[0] <= o.r1 && p[1] >= o.y[0] && p[1] <= o.y[1]);
        if (flat) gone++; else keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      if (keep.length !== idx.length) part.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(keep)).setBuffer(buffer));
    }
    done.clear++;
    log.push("Cleared: " + count(gone, "loose triangle") + " lying flat on the " + o.face + " wall in old paint " + (gone === 1 ? "was" : "were") + " taken off it, so no streak of old paint crosses the wall.");
  }
  for (const o of list) {
    if (o.kind === "clear") continue;
    const inset = o.kind === "cut" ? 0 : o.kind === "wall" ? 0.008 : 0.02;
    const touched = cutWall(doc, buffer, parts, o.frame, o.r0 + inset, o.y[0] + inset, o.r1 - inset, o.y[1] - inset);
    if (o.kind === "cut") { done.cut++; log.push("Cut: the wall inside " + m2(o.r1 - o.r0) + " by " + m2(o.y[1] - o.y[0]) + " m on the " + o.face + " wall was taken away (" + count(touched, "triangle") + " trimmed to its edge)."); }
    parts = partsOf(doc);
  }

  // what a generator left in a window or door opening goes: glass shards set back in it, bars and
  // shutters standing out of it. Only triangles wholly inside the opening, near the wall.
  let emptied = 0;
  for (const o of list) {
    if (o.kind !== "window" && o.kind !== "door") continue;
    const front = o.clear ?? 0.25;
    if (!(front > 0)) continue;
    for (const part of parts) {
      const pos = worldOf(part), idx = indexOf(part), keep = [], name = part.prim.getMaterial() ? part.prim.getMaterial().getName() : "", glass = name === WINDOW_LIT || name === WINDOW_DARK;
      for (let t = 0; t < idx.length; t += 3) {
        const loc = [0, 1, 2].map((e) => o.frame.local([pos[idx[t + e] * 3], pos[idx[t + e] * 3 + 1], pos[idx[t + e] * 3 + 2]]));
        const inside = loc.every((p) => p[0] >= o.r0 - 0.04 && p[0] <= o.r1 + 0.04 && p[1] >= o.y[0] - 0.04 && p[1] <= o.y[1] + 0.04 && p[2] >= -0.4 && p[2] <= front);
        // glass found before that reaches into the opening is that window's old glass, torn wider
        // than its frame: all of it goes, or it would be gathered with the new pane as one window
        const oldGlass = glass && loc.every((p) => p[2] >= -0.4 && p[2] <= front) && Math.max(loc[0][0], loc[1][0], loc[2][0]) > o.r0 && Math.min(loc[0][0], loc[1][0], loc[2][0]) < o.r1 && Math.max(loc[0][1], loc[1][1], loc[2][1]) > o.y[0] && Math.min(loc[0][1], loc[1][1], loc[2][1]) < o.y[1];
        if (inside || oldGlass) emptied++; else keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      if (keep.length !== idx.length) part.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(keep)).setBuffer(buffer));
    }
  }
  if (emptied) log.push("Openings emptied: " + count(emptied, "triangle") + " the generator left inside the redrawn windows and doors (torn glass, bent bars, shutters) " + (emptied === 1 ? "was" : "were") + " taken out.");
  parts = partsOf(doc);

  // 2. clean wall, then the pieces that stand on it
  const store = pixelStore(codec), islands = new Map(), wallBuilders = new Map();
  const trim = builder(), iron = builder(), leaf = builder(), panes = { [WINDOW_LIT]: builder(), [WINDOW_DARK]: builder() }, boards = [];
  const paneUv = {};
  for (const name of [WINDOW_LIT, WINDOW_DARK]) {
    // an existing pane's own color, from the smallest part painted with it (the flat sheet behind a window)
    let best = null;
    for (const part of parts) {
      const mat = part.prim.getMaterial(), uv = part.prim.getAttribute("TEXCOORD_0");
      if (!mat || mat.getName() !== name || !uv) continue;
      if (!best || uv.getCount() < best.getCount()) best = uv;
    }
    if (best) paneUv[name] = [best.getArray()[0], best.getArray()[1]];
  }
  for (const o of list) {
    const fr = o.frame, [y0, y1] = o.y;
    if (o.kind === "wall") {
      try { await patchWall(doc, parts, fr, o, o.r0, y0, o.r1, y1, list, store, islands, wallBuilders, log, o.found); done.wall++; }
      catch (error) { throw new Error("Opening " + (o.index + 1) + " (wall): " + (error && error.message || error) + "."); }
    } else if (o.kind === "window") {
      const name = o.lit === false ? WINDOW_DARK : WINDOW_LIT;
      addWindow(panes[name], trim, fr, o.r0, o.r1, y0, y1, { sashes: o.sashes, rails: o.rails, frame: o.frameWidth, paneUv: paneUv[name] });
      if (o.bars) addBars(iron, fr, o.r0, o.r1, y0, y1);
      done.window++;
    } else if (o.kind === "door") {
      addDoor(leaf, trim, fr, o.r0, o.r1, y0, y1, { frame: o.frameWidth });
      done.door++;
    } else if (o.kind === "sign") {
      boards.push(o); done.sign++;
    }
  }
  await store.save();

  // 3. into the file, as parts of the biggest mesh
  const host = parts.slice().sort((a, b) => indexOf(b).length - indexOf(a).length)[0];
  const inv = invert(host.matrix);
  const addPart = (b, mat) => {
    if (!b.I.length) return;
    const P = new Float32Array(b.P.length), N = new Float32Array(b.N.length);
    for (let i = 0; i < b.P.length; i += 3) {
      const p = apply(inv, [b.P[i], b.P[i + 1], b.P[i + 2]]), o0 = apply(inv, [0, 0, 0]), n = apply(inv, [b.N[i], b.N[i + 1], b.N[i + 2]]);
      const nx = n[0] - o0[0], ny = n[1] - o0[1], nz = n[2] - o0[2], len = Math.hypot(nx, ny, nz) || 1;
      P[i] = p[0]; P[i + 1] = p[1]; P[i + 2] = p[2]; N[i] = nx / len; N[i + 1] = ny / len; N[i + 2] = nz / len;
    }
    host.mesh.addPrimitive(doc.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(N).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(Float32Array.from(b.T)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(b.I)).setBuffer(buffer)));
  };
  for (const [mat, b] of wallBuilders) addPart(b, mat);
  for (const name of [WINDOW_LIT, WINDOW_DARK]) {
    if (!panes[name].I.length) continue;
    let mat = root.listMaterials().find((m) => m.getName() === name);
    if (!mat) mat = doc.createMaterial(name).setBaseColorFactor(name === WINDOW_LIT ? [0.93, 0.84, 0.66, 1] : [0.06, 0.07, 0.08, 1]).setEmissiveFactor(name === WINDOW_LIT ? WINDOW_GLOW : [0, 0, 0]).setRoughnessFactor(0.25).setMetallicFactor(0);
    addPart(panes[name], mat);
  }
  if (trim.I.length) {
    const first = list.find((o) => o.kind === "window" || o.kind === "door");
    const color = hexColor(plan.trim || (first && first.trim), [216, 212, 200]);
    // a file redrawn before already has its woodwork: more of it is painted the same
    let mat = root.listMaterials().find((m) => m.getName() === TRIM);
    if (!mat) mat = doc.createMaterial(TRIM).setBaseColorTexture(await newTexture(doc, codec, "trim_color", paintTrim(color))).setRoughnessFactor(0.6).setMetallicFactor(0);
    addPart(trim, mat);
    log.push("Frames, sills and sash bars are real pieces standing off the wall, material " + TRIM + ", painted one color here.");
  }
  if (iron.I.length) {
    let mat = root.listMaterials().find((m) => m.getName() === BARS);
    if (!mat) mat = doc.createMaterial(BARS).setBaseColorTexture(await newTexture(doc, codec, "bars_color", paintIron())).setRoughnessFactor(0.7).setMetallicFactor(0);
    addPart(iron, mat);
    log.push("Window bars: " + count(list.filter((o) => o.kind === "window" && o.bars).length, "window") + " barred with straight iron bars on two rails, material " + BARS + ".");
  }
  if (leaf.I.length) {
    const first = list.find((o) => o.kind === "door");
    const tex = await newTexture(doc, codec, "door_color", paintDoor(hexColor(first.color, [122, 79, 42])));
    addPart(leaf, doc.createMaterial(DOOR).setBaseColorTexture(tex).setRoughnessFactor(0.55).setMetallicFactor(0));
    log.push("Doors: " + count(done.door, "door") + " redrawn, a paneled leaf painted here (material " + DOOR + ") in a frame.");
  }
  if (boards.length) {
    // every sign on one texture, one above the next
    const ppm = Math.min(600, 2048 / Math.max(...boards.map((o) => o.r1 - o.r0))), gap = 8, width = 2048;
    const sizes = boards.map((o) => [Math.max(16, Math.round((o.r1 - o.r0) * ppm)), Math.max(16, Math.round((o.y[1] - o.y[0]) * ppm))]);
    const height = Math.ceil((sizes.reduce((s, z) => s + z[1] + gap, 0) - gap) / 4) * 4;
    const sheet = { width, height, rgba: new Uint8Array(width * height * 4).fill(255) };
    const b = builder();
    let top = 0;
    boards.forEach((o, n) => {
      const [w, h] = sizes[n], img = paintSign(o.text, w, h, { board: hexColor(o.board), ink: hexColor(o.ink), cap: o.cap });
      for (let y = 0; y < h; y++) {
        sheet.rgba.set(img.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((top + y) * width) * 4);
        // the rest of the row carries the board's edge color on, so nothing pale bleeds in when the texture is shrunk
        for (let x = w; x < width; x++) { const at = ((top + y) * width + x) * 4, from = (y * w + w - 1) * 4; sheet.rgba[at] = img.rgba[from]; sheet.rgba[at + 1] = img.rgba[from + 1]; sheet.rgba[at + 2] = img.rgba[from + 2]; }
      }
      const t0 = top;
      addPanel(b, o.frame, o.r0, o.r1, o.y[0], o.y[1], o.out ?? 0.02, (r, y) => [(r - o.r0) / (o.r1 - o.r0) * w / width, (t0 + (o.y[1] - y) / (o.y[1] - o.y[0]) * h) / height]);
      log.push("Sign: \"" + String(o.text).toUpperCase().replace(/\*/g, "·") + "\" lettered on a " + m2(o.r1 - o.r0) + " by " + m2(o.y[1] - o.y[0]) + " m board, capitals " + Math.round(img.cap / ppm * 100) + " cm tall, material " + SIGN_LIT + ", glowing with its own paint.");
      top += h + gap;
    });
    const tex = await newTexture(doc, codec, "sign_color", sheet);
    addPart(b, doc.createMaterial(SIGN_LIT).setBaseColorTexture(tex).setEmissiveTexture(tex).setEmissiveFactor([1, 1, 1]).setRoughnessFactor(0.5).setMetallicFactor(0));
  }
  if (done.window) log.push("Windows: " + count(done.window, "window") + " redrawn, each one whole pane the size of its opening (" + [WINDOW_LIT, WINDOW_DARK].filter((n) => panes[n].I.length).join(", ") + ") behind a frame and sash bars.");

  // parts emptied by the cuts, and materials nothing uses any more
  for (const part of partsOf(doc)) if (part.prim.getIndices() && !part.prim.getIndices().getCount()) part.mesh.removePrimitive(part.prim);
  await doc.transform(prune({ keepAttributes: true, keepLeaves: false, keepSolidTextures: true, keepExtras: true, keepIndices: true }));
  return { bytes: await writeModel(doc), log, done };
}
