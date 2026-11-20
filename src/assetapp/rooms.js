// Rooms behind the glass. A window that glows one flat color reads as a sheet of paper stuck on
// the wall, and by day the same pane is a flat gray card. A real window shows what hangs in it:
// curtains drawn back, a blind half down, shelves in a shop. So every pane in a finished file is
// made one clean rectangle and painted from a small sheet of windows drawn here, twice over: how
// each looks by day (dark glass, the sky in it, the blind behind) and how it glows at night.
//
// windows_lit carries both (the night sheet as its emission, at full strength, for the game's
// clock to turn up and down). windows_dark carries the day sheet only.
import { prune } from "@gltf-transform/functions";
import { readModel, writeModel } from "./engine.js";

const WINDOW_LIT = "windows_lit", WINDOW_DARK = "windows_dark";
const TILE = 256, COLS = 4, ROWS = 2;
// which drawing a pane gets: four for a house, two for a shopfront, one for door glass and
// transoms, one for a small window
const HOUSE = [0, 1, 2, 3], SHOP = [4, 5], DOOR_GLASS = 6, SMALL = 7;

const clamp8 = (v) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
function hash(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const step = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// What hangs in a window, at a point of it (u across, v down, both 0 to 1). Returns
// { cover: how much of the glass is covered there (0 the bare room, 1 cloth or slat),
//   cloth: how bright that cover is next to its neighbors (folds, slats), light: extra light from a lamp }
function hanging(kind, u, v) {
  if (kind === 0) { // curtains drawn back to each side, a lamp low in the room
    const edge = 0.2 + 0.07 * Math.sin(v * 5) + 0.05 * v, side = Math.min(u, 1 - u);
    const cover = 1 - step(edge - 0.02, edge + 0.02, side);
    const fold = 0.78 + 0.22 * Math.sin(side * 95 + Math.sin(v * 7) * 1.5);
    const lamp = Math.exp(-(((u - 0.62) ** 2) / 0.02 + ((v - 0.66) ** 2) / 0.03));
    return { cover, cloth: fold, light: lamp * (1 - cover) };
  }
  if (kind === 1) { // a slatted blind half way down
    const drop = 0.56, on = v < drop ? 1 : 0, slat = (v * 22) % 1;
    return { cover: on * (slat < 0.8 ? 1 : 0.25), cloth: 0.72 + 0.28 * (1 - Math.abs(slat - 0.4) / 0.4), light: 0.18 * (1 - on) * step(1, 0.55, v) };
  }
  if (kind === 2) { // a sheer curtain right across
    return { cover: 0.72, cloth: 0.8 + 0.2 * Math.sin(u * 60 + Math.sin(v * 5) * 2), light: 0.25 * Math.exp(-(((u - 0.4) ** 2) / 0.05 + ((v - 0.5) ** 2) / 0.12)) };
  }
  if (kind === 3) { // a blind all the way down, light through the gaps
    const slat = (v * 26) % 1;
    return { cover: slat < 0.86 ? 1 : 0.1, cloth: 0.6 + 0.3 * (1 - Math.abs(slat - 0.43) / 0.43), light: 0 };
  }
  if (kind === 4 || kind === 5) { // a shop: shelves along the back wall with things on them, strip lights overhead
    const rows = kind === 4 ? 4 : 3, top = 0.2, shelfV = (v - top) / (0.95 - top) * rows, r = Math.floor(shelfV), f = shelfV - r;
    let cover = 0, cloth = 0.5;
    if (v > top && r < rows) {
      if (f > 0.9) { cover = 1; cloth = 0.35; } // the shelf board
      else {
        const slot = Math.floor(u * (kind === 4 ? 9 : 7)), tall = 0.35 + 0.5 * hash(slot, r, kind), wide = 0.25 + 0.6 * hash(slot, r, kind + 9), fu = (u * (kind === 4 ? 9 : 7)) % 1;
        if (hash(slot, r, kind + 3) > 0.18 && f > 0.9 - tall * 0.85 && Math.abs(fu - 0.5) < wide / 2) { cover = 1; cloth = 0.3 + 0.5 * hash(slot, r, kind + 5); }
      }
    }
    const strip = v < top ? 0.5 * Math.exp(-((v - 0.07) ** 2) / 0.002) * (Math.abs((u * 2) % 1 - 0.5) < 0.38 ? 1 : 0) : 0;
    return { cover, cloth, light: strip, shop: true };
  }
  if (kind === 6) return { cover: 0.55, cloth: 0.92 + 0.08 * noise(u * 40, v * 40, 3), light: 0 }; // frosted glass in a door or over it
  return { cover: 0.8, cloth: 0.8 + 0.2 * ((Math.floor(u * 10) + Math.floor(v * 10)) % 2), light: 0 }; // small pebbled glass
}

// The two sheets, each COLS by ROWS drawings TILE pixels square.
export function paintRooms() {
  const width = TILE * COLS, height = TILE * ROWS;
  const day = new Uint8Array(width * height * 4), night = new Uint8Array(width * height * 4);
  for (let kind = 0; kind < COLS * ROWS; kind++) {
    const ox = (kind % COLS) * TILE, oy = Math.floor(kind / COLS) * TILE;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const u = (x + 0.5) / TILE, v = (y + 0.5) / TILE, h = hanging(kind, u, v), at = ((oy + y) * width + ox + x) * 4;
      // by night: the room's wall, warm and brightest in the middle, with what hangs in the window in front of it
      const room = h.shop ? [255, 232, 196] : [255, 196, 128];
      const fall = 0.72 + 0.28 * (1 - Math.min(1, ((u - 0.5) ** 2 + (v - 0.45) ** 2) * 2.4));
      const cloth = h.shop ? scale([120, 96, 70], h.cloth) : scale(kind === 1 || kind === 3 ? [236, 206, 160] : [255, 226, 178], h.cloth * 0.92);
      let glow = mix(scale(room, fall * (h.shop ? 0.95 : 0.85)), cloth, h.cover);
      glow = mix(glow, [255, 246, 220], Math.min(1, h.light));
      const grain = 0.97 + 0.06 * noise(x / 3, y / 3, kind);
      night[at] = clamp8(glow[0] * grain); night[at + 1] = clamp8(glow[1] * grain); night[at + 2] = clamp8(glow[2] * grain); night[at + 3] = 255;
      // by day: dark glass with a band of sky across it, and the same hanging seen dimly through it
      const sky = 0.5 + 0.5 * Math.sin((u * 0.9 + v * 1.3) * 3.2 + 0.6), band = step(0.55, 0.95, sky) * 0.5;
      const glass = mix([26, 31, 38], [96, 116, 138], band * (0.7 + 0.3 * noise(x / 30, y / 30, 21)));
      const seen = h.shop ? scale([70, 62, 52], 0.6 + 0.5 * h.cloth) : scale(kind === 1 || kind === 3 ? [176, 170, 158] : [188, 178, 164], 0.55 + 0.4 * h.cloth);
      const through = mix(glass, seen, h.cover * (h.shop ? 0.45 : 0.62));
      const lit = mix(through, [96, 116, 138], band * 0.35);
      day[at] = clamp8(lit[0]); day[at + 1] = clamp8(lit[1]); day[at + 2] = clamp8(lit[2]); day[at + 3] = 255;
    }
  }
  return { day: { width, height, rgba: day }, night: { width, height, rgba: night } };
}

// Which drawing a pane gets, from its size and where it sits. Told apart by shape, since nothing
// in a file says what a building is: a big pane near the ground is a shopfront.
export function roomFor(w, h, bottom, seed) {
  if (w >= 1.5 && h >= 1.2 && bottom <= 1.3) return SHOP[seed % SHOP.length];
  if ((w < 0.95 && h >= 1.5 * w && bottom <= 0.5) || w >= 2.4 * h) return DOOR_GLASS;
  if (w * h < 0.3) return SMALL;
  return HOUSE[seed % HOUSE.length];
}
export function tileUv(kind) {
  const pad = 1.5 / TILE, c = kind % COLS, r = Math.floor(kind / COLS);
  return { u0: (c + pad) / COLS, u1: (c + 1 - pad) / COLS, v0: (r + pad) / ROWS, v1: (r + 1 - pad) / ROWS };
}

// The panes in a set of glass triangles: triangles that face the same way, sit at about the same
// depth and touch or overlap are one pane. tris: [{ axis, sign, r0, r1, y0, y1, depth, area, lit }].
export function gatherPanes(tris, gap = 0.03, deep = 0.3, sash = 0.12) {
  const parent = tris.map((_, i) => i), find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
    const a = tris[i], b = tris[j];
    if (a.axis !== b.axis || a.sign !== b.sign || Math.abs(a.depth - b.depth) > deep) continue;
    if (a.r1 + gap < b.r0 || b.r1 + gap < a.r0 || a.y1 + gap < b.y0 || b.y1 + gap < a.y0) continue;
    parent[find(i)] = find(j);
  }
  const groups = new Map();
  tris.forEach((t, i) => {
    const k = find(i), g = groups.get(k) || { axis: t.axis, sign: t.sign, r0: Infinity, r1: -Infinity, y0: Infinity, y1: -Infinity, area: 0, depth: 0, lit: 0, count: 0 };
    g.r0 = Math.min(g.r0, t.r0); g.r1 = Math.max(g.r1, t.r1); g.y0 = Math.min(g.y0, t.y0); g.y1 = Math.max(g.y1, t.y1);
    g.area += t.area; g.depth += t.depth * t.area; g.lit += (t.lit ? 1 : -1) * t.area; g.count++;
    groups.set(k, g);
  });
  let panes = [...groups.values()].map((g) => ({ ...g, depth: g.area ? g.depth / g.area : 0 }));
  // the sashes of one window are one window: panes side by side at the same height, or one above
  // the other at the same width, with only a bar between them, share what hangs behind them
  const near = (a, b, t) => Math.abs(a - b) <= t;
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < panes.length && !again; i++) for (let j = i + 1; j < panes.length && !again; j++) {
      const a = panes[i], b = panes[j];
      if (a.axis !== b.axis || a.sign !== b.sign || !near(a.depth, b.depth, 0.15)) continue;
      const beside = near(a.y0, b.y0, 0.1) && near(a.y1, b.y1, 0.1) && Math.max(a.r0, b.r0) - Math.min(a.r1, b.r1) <= sash;
      const stacked = near(a.r0, b.r0, 0.1) && near(a.r1, b.r1, 0.1) && Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) <= sash;
      if (!beside && !stacked) continue;
      panes[i] = { ...a, r0: Math.min(a.r0, b.r0), r1: Math.max(a.r1, b.r1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), depth: (a.depth * a.area + b.depth * b.area) / (a.area + b.area), area: a.area + b.area, lit: a.lit + b.lit, count: a.count + b.count };
      panes.splice(j, 1); again = true;
    }
  }
  return panes.map((g) => ({ ...g, lit: g.lit >= 0 }));
}

const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function invert(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e) || 1;
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
}

// Give every pane in a finished file a room. env: { codec: { encode } }. Returns { bytes, log, panes }.
export async function drawRooms(bytes, env = {}) {
  const codec = env.codec;
  if (!codec) throw new Error("Rooms cannot be drawn on this device: textures cannot be written.");
  const doc = await readModel(bytes), root = doc.getRoot(), buffer = root.listBuffers()[0] || doc.createBuffer();
  const log = [], tris = [], old = [];
  let host = null, floor = Infinity;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos || prim.getMode() !== 4) continue;
      const p = pos.getArray();
      for (let i = 1; i < p.length; i += 3) { const y = apply(m, [p[i - 1], p[i], p[i + 1]])[1]; if (y < floor) floor = y; }
      if (!host || pos.getCount() > host.count) host = { node, mesh, matrix: m, count: pos.getCount() };
      const name = prim.getMaterial() ? prim.getMaterial().getName() : "";
      if (name !== WINDOW_LIT && name !== WINDOW_DARK) continue;
      old.push({ mesh, prim });
      const idx = prim.getIndices() ? prim.getIndices().getArray() : Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
      for (let t = 0; t < idx.length; t += 3) {
        const a = apply(m, [p[idx[t] * 3], p[idx[t] * 3 + 1], p[idx[t] * 3 + 2]]), b = apply(m, [p[idx[t + 1] * 3], p[idx[t + 1] * 3 + 1], p[idx[t + 1] * 3 + 2]]), c = apply(m, [p[idx[t + 2] * 3], p[idx[t + 2] * 3 + 1], p[idx[t + 2] * 3 + 2]]);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
        if (len < 1e-10) continue;
        const axis = Math.abs(nx) > Math.abs(nz) ? 0 : 2, along = axis === 0 ? 2 : 0, n = axis === 0 ? nx : nz;
        if (Math.abs(ny) > Math.abs(n)) continue; // glass lying flat is not a window pane
        tris.push({ axis, sign: 0, facing: n, r0: Math.min(a[along], b[along], c[along]), r1: Math.max(a[along], b[along], c[along]), y0: Math.min(a[1], b[1], c[1]), y1: Math.max(a[1], b[1], c[1]), depth: (a[axis] + b[axis] + c[axis]) / 3, area: len / 2, lit: name === WINDOW_LIT });
      }
    }
  }
  if (!tris.length) return { bytes, log: ["Rooms: the file has no window panes (materials " + WINDOW_LIT + ", " + WINDOW_DARK + "), so nothing was changed."], panes: 0 };

  // which way each pane faces: a generator winds some glass backwards, so it is read from where
  // the pane sits. Glass on the +X half of a building that stands on X faces +X.
  let cx = 0, cz = 0, n = 0;
  for (const node of root.listNodes()) { const mesh = node.getMesh(); if (!mesh) continue; for (const prim of mesh.listPrimitives()) { const acc = prim.getAttribute("POSITION"); if (!acc) continue; const lo = acc.getMin([]), hi = acc.getMax([]), a = apply(node.getWorldMatrix(), lo), b = apply(node.getWorldMatrix(), hi); cx += (a[0] + b[0]) / 2; cz += (a[2] + b[2]) / 2; n++; } }
  cx /= n || 1; cz /= n || 1;
  for (const t of tris) t.sign = t.depth >= (t.axis === 0 ? cx : cz) ? 1 : -1;

  const panes = gatherPanes(tris).filter((g) => g.area >= 0.02 && g.r1 - g.r0 >= 0.12 && g.y1 - g.y0 >= 0.12);
  const inv = invert(host.matrix), built = { [WINDOW_LIT]: { P: [], N: [], T: [], I: [] }, [WINDOW_DARK]: { P: [], N: [], T: [], I: [] } };
  const counts = { house: 0, shop: 0, door: 0, small: 0 };
  panes.sort((a, b) => a.axis - b.axis || a.sign - b.sign || a.r0 - b.r0 || a.y0 - b.y0);
  panes.forEach((g) => {
    // which of the drawings: from where the pane is, so the same file always comes out the same
    const seed = Math.floor(hash(Math.round(g.r0 * 10), Math.round(g.y0 * 10), g.axis * 2 + (g.sign > 0 ? 1 : 0)) * 1000);
    const kind = roomFor(g.r1 - g.r0, g.y1 - g.y0, g.y0 - floor, seed);
    counts[kind >= 4 && kind <= 5 ? "shop" : kind === DOOR_GLASS ? "door" : kind === SMALL ? "small" : "house"]++;
    const uv = tileUv(kind), b = built[g.lit ? WINDOW_LIT : WINDOW_DARK], base = b.P.length / 3, along = g.axis === 0 ? 2 : 0;
    // seen from outside, left to right: +Z shows X rising, -Z shows it falling, +X shows Z falling, -X rising
    const rising = (g.axis === 2 ? 1 : -1) * g.sign > 0;
    const left = rising ? g.r0 : g.r1, right = rising ? g.r1 : g.r0, normal = [0, 0, 0];
    normal[g.axis] = g.sign;
    for (const [r, y, u, v] of [[left, g.y0, uv.u0, uv.v1], [right, g.y0, uv.u1, uv.v1], [right, g.y1, uv.u1, uv.v0], [left, g.y1, uv.u0, uv.v0]]) {
      const w = [0, y, 0]; w[along] = r; w[g.axis] = g.depth;
      const p = apply(inv, w), o = apply(inv, [0, 0, 0]), q = apply(inv, normal), nl = Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]) || 1;
      b.P.push(p[0], p[1], p[2]); b.N.push((q[0] - o[0]) / nl, (q[1] - o[1]) / nl, (q[2] - o[2]) / nl); b.T.push(u, v);
    }
    b.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  for (const { mesh, prim } of old) mesh.removePrimitive(prim);
  const sheets = paintRooms();
  const texture = async (name, img) => {
    let data = null, mime = "image/jpeg";
    for (const m of ["image/jpeg", "image/png"]) { try { data = await codec.encode(img.rgba, img.width, img.height, m, 0.92); } catch (error) { data = null; } if (data) { mime = m; break; } }
    if (!data) throw new Error("The window sheets could not be written on this device.");
    return doc.createTexture(name).setImage(data).setMimeType(mime);
  };
  const dayTex = await texture("windows_day", sheets.day), nightTex = await texture("windows_night", sheets.night);
  const mats = {
    [WINDOW_LIT]: doc.createMaterial(WINDOW_LIT).setBaseColorTexture(dayTex).setEmissiveTexture(nightTex).setEmissiveFactor([1, 1, 1]).setRoughnessFactor(0.2).setMetallicFactor(0).setDoubleSided(true),
    [WINDOW_DARK]: doc.createMaterial(WINDOW_DARK).setBaseColorTexture(dayTex).setEmissiveFactor([0, 0, 0]).setRoughnessFactor(0.2).setMetallicFactor(0).setDoubleSided(true)
  };
  for (const name of [WINDOW_LIT, WINDOW_DARK]) {
    const b = built[name];
    if (!b.I.length) continue;
    host.mesh.addPrimitive(doc.createPrimitive().setMaterial(mats[name])
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(b.P)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(b.N)).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(Float32Array.from(b.T)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(b.I)).setBuffer(buffer)));
  }
  await doc.transform(prune({ keepAttributes: true, keepLeaves: false, keepSolidTextures: true, keepExtras: true, keepIndices: true }));
  const lit = built[WINDOW_LIT].I.length / 6, dark = built[WINDOW_DARK].I.length / 6;
  const kinds = [[counts.house, "house window"], [counts.shop, "shopfront"], [counts.door, "door or transom glass", "door or transom glass"], [counts.small, "small window"]].filter((k) => k[0]).map((k) => k[0] + " " + (k[0] === 1 ? k[1] : k[2] || k[1] + "s")).join(", ");
  log.push("Rooms: " + panes.length + (panes.length === 1 ? " pane" : " panes") + " (" + lit + " lit, " + dark + " dark), each made one clean rectangle where its glass was and painted with what hangs in it: " + kinds + ". By day a pane is dark glass with the sky in it; " + WINDOW_LIT + " glows at night with the room behind (its emission map, at full strength for the game's clock to scale). " + tris.length + " triangles of generated glass became " + (panes.length * 2) + ".");
  return { bytes: await writeModel(doc), log, panes: panes.length };
}
