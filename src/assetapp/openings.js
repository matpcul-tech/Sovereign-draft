// Openings redrawn by hand. A generator's window, door or sign is sometimes past finding: the
// glass is three shards and a wedge of wall, the door has a sheet of stucco torn across it, the
// sign is a blank board. Nothing in the mesh says where the opening was meant to be, so a person
// says it: this rectangle, on this wall, is a window. This file draws what goes there.
//
// Everything here is plain arrays and pixels: geometry for a pane, a frame, a door leaf, a sign
// board; paint for a door, a frame, a lettered sign; and the pieces a clean patch of wall needs
// (the wall's paint laid out flat, a clean stretch of it to copy, a free corner of its texture).
// redraw.js puts them into a file.

// A wall faces one of four ways. Seen from outside, `right` runs along it to the viewer's right
// and (right) x (up) is the way it faces, so a rectangle listed right, up is wound facing out.
const FACES = {
  "+z": { axis: 2, along: 0, sign: 1, rsign: 1 },
  "-z": { axis: 2, along: 0, sign: -1, rsign: -1 },
  "+x": { axis: 0, along: 2, sign: 1, rsign: -1 },
  "-x": { axis: 0, along: 2, sign: -1, rsign: 1 }
};
export const FACE_NAMES = Object.keys(FACES);

// The frame of one opening: where a point (r along the wall, y up, `out` proud of it) sits.
export function frameOf(face, at) {
  const f = FACES[face];
  if (!f) throw new Error("An opening's face must be one of " + FACE_NAMES.join(", ") + ".");
  const normal = [0, 0, 0]; normal[f.axis] = f.sign;
  const right = [0, 0, 0]; right[f.along] = f.rsign;
  return {
    ...f, at, normal, right,
    point(r, y, out = 0) { const p = [0, y, 0]; p[f.along] = f.rsign * r; p[f.axis] = at + f.sign * out; return p; },
    // a world point as [r, y, how far proud of the wall]
    local(p) { return [f.rsign * p[f.along], p[1], (p[f.axis] - at) * f.sign]; },
    // a span given in world coordinates, as a range along `right`
    span(w) { const a = f.rsign * w[0], b = f.rsign * w[1]; return a < b ? [a, b] : [b, a]; }
  };
}

export function builder() { return { P: [], N: [], T: [], I: [] }; }

// Four corners in order round the face, wound to face along n.
export function addQuad(b, pts, uvs, n) {
  const base = b.P.length / 3;
  for (let i = 0; i < 4; i++) { b.P.push(pts[i][0], pts[i][1], pts[i][2]); b.N.push(n[0], n[1], n[2]); b.T.push(uvs[i][0], uvs[i][1]); }
  const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], v = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
  const facing = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
  if (facing >= 0) b.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else b.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// A flat panel the size of the rectangle, `out` proud of the wall. uv maps (r, y) to texture.
export function addPanel(b, fr, r0, r1, y0, y1, out, uv) {
  addQuad(b, [fr.point(r0, y0, out), fr.point(r1, y0, out), fr.point(r1, y1, out), fr.point(r0, y1, out)], [uv(r0, y0), uv(r1, y0), uv(r1, y1), uv(r0, y1)], fr.normal);
}

// A bar standing off the wall from out0 to out1: its face and its four sides. The back is the wall.
export function addBar(b, fr, r0, r1, y0, y1, out0, out1, scale = 1) {
  const n = fr.normal, rt = fr.right, neg = (v) => [-v[0], -v[1], -v[2]];
  const p = (r, y, o) => fr.point(r, y, o);
  const face = (r, y) => [r * scale, -y * scale], side = (o, y) => [o * scale, -y * scale], cap = (r, o) => [r * scale, o * scale];
  addQuad(b, [p(r0, y0, out1), p(r1, y0, out1), p(r1, y1, out1), p(r0, y1, out1)], [face(r0, y0), face(r1, y0), face(r1, y1), face(r0, y1)], n);
  addQuad(b, [p(r0, y1, out1), p(r1, y1, out1), p(r1, y1, out0), p(r0, y1, out0)], [cap(r0, out1), cap(r1, out1), cap(r1, out0), cap(r0, out0)], [0, 1, 0]);
  addQuad(b, [p(r0, y0, out0), p(r1, y0, out0), p(r1, y0, out1), p(r0, y0, out1)], [cap(r0, out0), cap(r1, out0), cap(r1, out1), cap(r0, out1)], [0, -1, 0]);
  addQuad(b, [p(r0, y0, out0), p(r0, y0, out1), p(r0, y1, out1), p(r0, y1, out0)], [side(out0, y0), side(out1, y0), side(out1, y1), side(out0, y1)], neg(rt));
  addQuad(b, [p(r1, y0, out1), p(r1, y0, out0), p(r1, y1, out0), p(r1, y1, out1)], [side(out1, y0), side(out0, y0), side(out0, y1), side(out1, y1)], rt);
}

// A window: one pane the full size of the opening, a frame round it, a sill, and the bars that
// divide it into sashes. The pane goes into `pane`, the woodwork into `trim`.
export function addWindow(pane, trim, fr, r0, r1, y0, y1, o = {}) {
  const frame = o.frame ?? 0.06, bar = o.bar ?? 0.035, proud = o.proud ?? 0.05, sashes = Math.max(1, o.sashes ?? 2), rails = Math.max(0, o.rails ?? 0), k = o.trimScale ?? 2;
  addPanel(pane, fr, r0, r1, y0, y1, o.paneOut ?? 0.012, () => o.paneUv || [0.5, 0.5]);
  addBar(trim, fr, r0, r1, y1 - frame, y1, 0, proud, k);
  addBar(trim, fr, r0 - 0.03, r1 + 0.03, y0 - 0.02, y0 + frame, 0, proud + 0.025, k); // the sill reaches a little wider and further out
  addBar(trim, fr, r0, r0 + frame, y0 + frame, y1 - frame, 0, proud, k);
  addBar(trim, fr, r1 - frame, r1, y0 + frame, y1 - frame, 0, proud, k);
  for (let i = 1; i < sashes; i++) { const c = r0 + (r1 - r0) * i / sashes; addBar(trim, fr, c - bar / 2, c + bar / 2, y0 + frame, y1 - frame, 0, proud * 0.7, k); }
  for (let i = 1; i <= rails; i++) { const c = y0 + (y1 - y0) * i / (rails + 1); addBar(trim, fr, r0 + frame, r1 - frame, c - bar / 2, c + bar / 2, 0, proud * 0.6, k); }
}

// Window bars: upright iron bars a hand apart, standing off the wall on two flat rails.
export function addBars(b, fr, r0, r1, y0, y1, o = {}) {
  const thick = o.thick ?? 0.022, every = o.every ?? 0.13, out = o.out ?? 0.075, k = 4;
  const n = Math.max(2, Math.round((r1 - r0) / every)), stepR = (r1 - r0) / n;
  for (let i = 0; i <= n; i++) { const c = r0 + i * stepR; addBar(b, fr, c - thick / 2, c + thick / 2, y0 - 0.05, y1 + 0.05, out, out + thick, k); }
  for (const share of [0.22, 0.78]) { const c = y0 + (y1 - y0) * share; addBar(b, fr, r0 - 0.04, r1 + 0.04, c - 0.02, c + 0.02, 0, out, k); }
}

// Wrought iron: near black, a little rust in it.
export function paintIron(size = 64) {
  const img = image(size, size, [44, 40, 38]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rust = noise(x / 6, y / 6, 31);
    if (rust > 0.62) blend(img, x, y, [92, 58, 38], (rust - 0.62) * 1.6);
    shade(img, x, y, 0.9 + 0.2 * noise(x / 2, y / 2, 32));
  }
  return img;
}

// A door: the leaf, painted from the door texture, inside a frame down both sides and across the top.
export function addDoor(leaf, trim, fr, r0, r1, y0, y1, o = {}) {
  const frame = o.frame ?? 0.09, proud = o.proud ?? 0.05, k = o.trimScale ?? 2;
  const a0 = r0 + frame, a1 = r1 - frame, top = y1 - frame;
  addPanel(leaf, fr, a0, a1, y0, top, o.leafOut ?? 0.02, (r, y) => [(r - a0) / (a1 - a0), 1 - (y - y0) / (top - y0)]);
  addBar(trim, fr, r0, r1, top, y1, 0, proud, k);
  addBar(trim, fr, r0, a0, y0, top, 0, proud, k);
  addBar(trim, fr, a1, r1, y0, top, 0, proud, k);
}

// ---------------------------------------------------------------- paint

export function hexColor(text, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(text || ""));
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function image(width, height, color) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = color[0]; rgba[i * 4 + 1] = color[1]; rgba[i * 4 + 2] = color[2]; rgba[i * 4 + 3] = 255; }
  return { width, height, rgba };
}

// The same number for the same cell, every time: paint that does not change between runs.
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
const clamp8 = (v) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

function shade(img, x, y, k) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.rgba[i] = clamp8(img.rgba[i] * k); img.rgba[i + 1] = clamp8(img.rgba[i + 1] * k); img.rgba[i + 2] = clamp8(img.rgba[i + 2] * k);
}
function blend(img, x, y, color, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4, k = a > 1 ? 1 : a;
  img.rgba[i] = clamp8(img.rgba[i] + (color[0] - img.rgba[i]) * k); img.rgba[i + 1] = clamp8(img.rgba[i + 1] + (color[1] - img.rgba[i + 1]) * k); img.rgba[i + 2] = clamp8(img.rgba[i + 2] + (color[2] - img.rgba[i + 2]) * k);
}

// Painted woodwork: one color, a little uneven, brushed up and down.
export function paintTrim(color = [216, 212, 200], size = 128) {
  const img = image(size, size, color);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) shade(img, x, y, 0.955 + 0.06 * noise(x / 3, y / 24, 7) + 0.03 * noise(x / 17, y / 17, 9));
  return img;
}

// A paneled wooden door: stiles and rails round six sunk panels, grain running up it, a knob.
export function paintDoor(color = [122, 79, 42], width = 512, height = 1024) {
  const img = image(width, height, color);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = 0.86 + 0.2 * noise(x / 5, y / 90, 3) + 0.08 * noise(x / 1.7, y / 40, 4) + 0.06 * noise(x / 60, y / 60, 5);
    shade(img, x, y, grain * (y > height * 0.9 ? 1 - 0.18 * (y - height * 0.9) / (height * 0.1) : 1)); // scuffed darker along the bottom
  }
  const stile = Math.round(width * 0.14), mid = Math.round(width * 0.09), rail = Math.round(height * 0.075);
  const cols = [[stile, (width - mid) / 2], [(width + mid) / 2, width - stile]];
  const rows = [[rail, height * 0.24], [height * 0.24 + rail * 0.8, height * 0.6], [height * 0.6 + rail * 0.8, height - rail * 1.5]];
  const bevel = Math.max(3, Math.round(width * 0.022));
  for (const [x0, x1] of cols) for (const [y0, y1] of rows) {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) {
      const dl = x - x0, dr = x1 - 1 - x, dt = y - y0, db = y1 - 1 - y, d = Math.min(dl, dr, dt, db);
      // light comes from above and the left: the sunk edge under the top rail and beside the left stile is in shadow
      let k = 0.93;
      if (d < bevel) k = (d === dt || d === dl) ? 0.62 + 0.25 * d / bevel : 1.14 - 0.16 * d / bevel;
      else if (d < bevel * 2) k = 1.03;
      shade(img, x, y, k);
    }
  }
  // the gap round the leaf reads as a thin dark line
  for (let y = 0; y < height; y++) for (let t = 0; t < 3; t++) { shade(img, t, y, 0.55); shade(img, width - 1 - t, y, 0.55); }
  for (let x = 0; x < width; x++) for (let t = 0; t < 3; t++) { shade(img, x, t, 0.55); shade(img, x, height - 1 - t, 0.6); }
  // a brass knob on its plate, with the shadow it throws
  const kx = width - stile * 0.5, ky = height * 0.53, kr = width * 0.045;
  for (let y = Math.floor(ky - kr * 4); y <= ky + kr * 4; y++) for (let x = Math.floor(kx - kr * 3); x <= kx + kr * 3; x++) {
    if (Math.abs(x - kx) < kr * 1.25 && Math.abs(y - ky) < kr * 3.2) blend(img, x, y, [96, 82, 52], 0.85);
    const s = Math.hypot(x - kx - kr * 0.35, y - ky - kr * 0.45);
    if (s < kr * 1.25) blend(img, x, y, [20, 14, 8], 0.45 * (1 - s / (kr * 1.25)));
    const d = Math.hypot(x - kx, y - ky);
    if (d < kr + 0.5) {
      const lit = 1 - Math.hypot(x - kx + kr * 0.35, y - ky + kr * 0.35) / (kr * 1.6);
      blend(img, x, y, [clamp8(150 + 95 * lit), clamp8(118 + 85 * lit), clamp8(50 + 60 * lit)], Math.min(1, kr + 0.5 - d));
    }
  }
  return img;
}

// Sign lettering: capitals, digits and a few marks, each a handful of strokes on a grid 4 wide and
// 6 tall, drawn with a round brush. Plain block capitals are what a painted shop sign carries.
const O = [[1.2, 0], [0, 1.2], [0, 4.8], [1.2, 6], [2.8, 6], [4, 4.8], [4, 1.2], [2.8, 0], [1.2, 0]];
const P = [[0, 0], [0, 6], [2.7, 6], [3.8, 5], [3.8, 3.7], [2.7, 2.7], [0, 2.7]];
const S = [[3.9, 4.9], [2.9, 6], [1.1, 6], [0.1, 4.9], [0.1, 4], [1.1, 3.2], [2.9, 2.8], [3.9, 2], [3.9, 1.1], [2.9, 0], [1.1, 0], [0.1, 1.1]];
export const GLYPHS = {
  A: { s: [[[0, 0], [2, 6], [4, 0]], [[0.8, 2.1], [3.2, 2.1]]] },
  B: { s: [[[0, 0], [0, 6], [2.6, 6], [3.6, 5.2], [3.6, 3.9], [2.6, 3.1], [0, 3.1]], [[2.6, 3.1], [3.8, 2.3], [3.8, 0.9], [2.8, 0], [0, 0]]] },
  C: { s: [[[4, 4.8], [2.9, 6], [1.2, 6], [0, 4.8], [0, 1.2], [1.2, 0], [2.9, 0], [4, 1.2]]] },
  D: { s: [[[0, 0], [0, 6], [2.4, 6], [4, 4.6], [4, 1.4], [2.4, 0], [0, 0]]] },
  E: { w: 3.7, s: [[[3.7, 6], [0, 6], [0, 0], [3.7, 0]], [[0, 3.1], [2.9, 3.1]]] },
  F: { w: 3.7, s: [[[3.7, 6], [0, 6], [0, 0]], [[0, 3.1], [2.9, 3.1]]] },
  G: { s: [[[4, 4.8], [2.9, 6], [1.2, 6], [0, 4.8], [0, 1.2], [1.2, 0], [2.9, 0], [4, 1.2], [4, 2.8], [2.3, 2.8]]] },
  H: { s: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3.1], [4, 3.1]]] },
  I: { w: 0, s: [[[0, 0], [0, 6]]] },
  J: { w: 3.4, s: [[[3.4, 6], [3.4, 1.3], [2.3, 0], [1.1, 0], [0, 1.3]]] },
  K: { s: [[[0, 0], [0, 6]], [[4, 6], [0, 2.4]], [[1.5, 3.7], [4, 0]]] },
  L: { w: 3.5, s: [[[0, 6], [0, 0], [3.5, 0]]] },
  M: { w: 5, s: [[[0, 0], [0, 6], [2.5, 2.2], [5, 6], [5, 0]]] },
  N: { s: [[[0, 0], [0, 6], [4, 0], [4, 6]]] },
  O: { s: [O] },
  P: { w: 3.8, s: [P] },
  Q: { s: [O, [[2.4, 1.6], [4.2, -0.4]]] },
  R: { s: [P, [[2.2, 2.7], [4, 0]]] },
  S: { s: [S] },
  T: { s: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]] },
  U: { s: [[[0, 6], [0, 1.2], [1.2, 0], [2.8, 0], [4, 1.2], [4, 6]]] },
  V: { s: [[[0, 6], [2, 0], [4, 6]]] },
  W: { w: 5.6, s: [[[0, 6], [1.3, 0], [2.8, 4.2], [4.3, 0], [5.6, 6]]] },
  X: { s: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]] },
  Y: { s: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]] },
  Z: { s: [[[0, 6], [4, 6], [0, 0], [4, 0]]] },
  0: { s: [O] },
  1: { w: 1.8, s: [[[0, 4.6], [1.8, 6], [1.8, 0]]] },
  2: { s: [[[0.1, 4.8], [1.1, 6], [2.9, 6], [3.9, 4.9], [3.9, 3.8], [0, 0], [4, 0]]] },
  3: { s: [[[0.1, 5], [1.1, 6], [2.9, 6], [3.9, 5], [3.9, 4], [2.9, 3.1], [1.6, 3.1]], [[2.9, 3.1], [3.9, 2.2], [3.9, 1], [2.9, 0], [1.1, 0], [0.1, 1]]] },
  4: { s: [[[3, 0], [3, 6], [0, 1.8], [4, 1.8]]] },
  5: { s: [[[3.8, 6], [0.4, 6], [0.2, 3.4], [1.2, 3.8], [2.8, 3.8], [3.9, 2.8], [3.9, 1.1], [2.9, 0], [1.1, 0], [0.1, 1]]] },
  6: { s: [[[3.7, 5.2], [2.8, 6], [1.2, 6], [0.1, 4.8], [0.1, 1.2], [1.2, 0], [2.8, 0], [3.9, 1.1], [3.9, 2.5], [2.8, 3.5], [1.2, 3.5], [0.1, 2.6]]] },
  7: { s: [[[0, 6], [4, 6], [1.6, 0]]] },
  8: { s: [[[1.2, 3.2], [0.3, 4.1], [0.3, 5.1], [1.2, 6], [2.8, 6], [3.7, 5.1], [3.7, 4.1], [2.8, 3.2], [1.2, 3.2], [0.1, 2.2], [0.1, 1.1], [1.2, 0], [2.8, 0], [3.9, 1.1], [3.9, 2.2], [2.8, 3.2]]] },
  9: { s: [[[0.3, 0.8], [1.2, 0], [2.8, 0], [3.9, 1.2], [3.9, 4.8], [2.8, 6], [1.2, 6], [0.1, 4.9], [0.1, 3.5], [1.2, 2.5], [2.8, 2.5], [3.9, 3.4]]] },
  "-": { w: 2.6, s: [[[0, 3], [2.6, 3]]] },
  "/": { w: 3, s: [[[0, 0], [3, 6]]] },
  "&": { s: [[[4, 0], [0.8, 4.2], [0.8, 5.2], [1.6, 6], [2.4, 6], [3.1, 5.2], [3.1, 4.4], [0.2, 2.2], [0.2, 1], [1.2, 0], [2.4, 0], [4, 2.4]]] },
  $: { s: [S, [[2, 6.9], [2, -0.9]]] },
  "!": { w: 0, s: [[[0, 6], [0, 2]], [[0, 0]]] },
  ".": { w: 0, s: [[[0, 0]]] },
  ":": { w: 0, s: [[[0, 0.6]], [[0, 3.8]]] },
  "'": { w: 0, s: [[[0, 6], [0, 4.6]]] },
  "*": { w: 0, dot: 1.5, s: [[[0, 3]]] } // a bullet between words
};
const GAP = 1.7, SPACE = 2.6;

// How wide a line of lettering runs, in grid units (capitals are 6 tall).
export function textWidth(text) {
  let w = 0, any = false;
  for (const ch of String(text).toUpperCase()) {
    if (ch === " ") { w += SPACE; continue; }
    const g = GLYPHS[ch];
    if (!g) continue;
    w += (any ? GAP : 0) + (g.w ?? 4); any = true;
  }
  return w;
}

// Letter a line into the box, as tall as `cap` pixels unless it has to shrink to fit the width.
// Returns the cap height it used.
export function paintText(img, text, box, color, o = {}) {
  const line = String(text).toUpperCase(), units = textWidth(line);
  if (!units) return 0;
  const weight = o.weight ?? 1.25; // brush width in grid units
  let unit = (o.cap ?? box.h * 0.55) / 6;
  unit = Math.min(unit, (box.w * (o.fill ?? 0.92)) / (units + weight));
  const half = weight * unit / 2, x0 = box.x + (box.w - units * unit) / 2, base = box.y + box.h / 2 + 3 * unit;
  let pen = x0, any = false;
  for (const ch of line) {
    if (ch === " ") { pen += SPACE * unit; continue; }
    const g = GLYPHS[ch];
    if (!g) continue;
    if (any) pen += GAP * unit;
    any = true;
    for (const stroke of g.s) {
      const pts = stroke.map(([gx, gy]) => [pen + gx * unit, base - gy * unit]);
      const r = pts.length === 1 ? half * (g.dot ?? 1.15) : half;
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const [px, py] of pts) { if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py; }
      for (let y = Math.floor(by0 - r - 1); y <= Math.ceil(by1 + r + 1); y++) for (let x = Math.floor(bx0 - r - 1); x <= Math.ceil(bx1 + r + 1); x++) {
        let best = Infinity;
        const cx = x + 0.5, cy = y + 0.5;
        if (pts.length === 1) best = Math.hypot(cx - pts[0][0], cy - pts[0][1]);
        for (let i = 0; i + 1 < pts.length; i++) {
          const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, len = dx * dx + dy * dy;
          let t = len ? ((cx - ax) * dx + (cy - ay) * dy) / len : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(cx - ax - dx * t, cy - ay - dy * t);
          if (d < best) best = d;
        }
        blend(img, x, y, color, r + 0.5 - best);
      }
    }
    pen += (g.w ?? 4) * unit;
  }
  return unit * 6;
}

// A sign board: a lit face a touch brighter in the middle, a dark edge round it, one line of lettering.
export function paintSign(text, width, height, o = {}) {
  const board = o.board || [233, 196, 64], ink = o.ink || [26, 22, 20];
  const img = image(width, height, board);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = Math.abs(y / height - 0.5) * 2;
    shade(img, x, y, (1.04 - 0.1 * v * v) * (0.975 + 0.05 * noise(x / 40, y / 40, 11)));
  }
  const edge = Math.max(3, Math.round(height * (o.edge ?? 0.05)));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < edge || y < edge || x >= width - edge || y >= height - edge) blend(img, x, y, ink, 0.92);
  const used = paintText(img, text, { x: edge * 2, y: edge, w: width - edge * 4, h: height - edge * 2 }, ink, { cap: (height - edge * 2) * (o.cap ?? 0.6), weight: o.weight });
  return { ...img, cap: used };
}

// ---------------------------------------------------------------- a clean patch of wall

export function sample(img, u, v) {
  const x = Math.min(img.width - 1, Math.max(0, u * img.width - 0.5)), y = Math.min(img.height - 1, Math.max(0, v * img.height - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = (y0 * img.width + x0) * 4, b = (y0 * img.width + x1) * 4, c = (y1 * img.width + x0) * 4, d = (y1 * img.width + x1) * 4, p = img.rgba, out = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = (p[a + k] * (1 - fx) + p[b + k] * fx) * (1 - fy) + (p[c + k] * (1 - fx) + p[d + k] * fx) * fy;
  return out;
}

// A wall's paint laid out flat: for every point of a stretch of wall, where in the texture its
// paint is. tris: [{ p: [[r, y] x3], uv: [[u, v] x3] }]. NaN where no wall lies.
export function layWall(tris, r0, y0, r1, y1, res) {
  const width = Math.max(1, Math.ceil((r1 - r0) * res)), height = Math.max(1, Math.ceil((y1 - y0) * res));
  const U = new Float32Array(width * height).fill(NaN), V = new Float32Array(width * height).fill(NaN);
  for (const t of tris) {
    const [a, b, c] = t.p, d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(d) < 1e-12) continue;
    const xa = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - r0) * res)), xb = Math.min(width - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - r0) * res));
    const ya = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - y0) * res)), yb = Math.min(height - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - y0) * res));
    for (let j = ya; j <= yb; j++) for (let i = xa; i <= xb; i++) {
      const px = r0 + (i + 0.5) / res, py = y0 + (j + 0.5) / res;
      const w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / d, w2 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / d;
      if (w1 < -1e-4 || w2 < -1e-4 || w1 + w2 > 1.0001) continue;
      const at = j * width + i;
      U[at] = t.uv[0][0] + w1 * (t.uv[1][0] - t.uv[0][0]) + w2 * (t.uv[2][0] - t.uv[0][0]);
      V[at] = t.uv[0][1] + w1 * (t.uv[1][1] - t.uv[0][1]) + w2 * (t.uv[2][1] - t.uv[0][1]);
    }
  }
  return { r0, y0, res, width, height, U, V };
}

// The cleanest stretch of the wall to copy from: w by h cells of the laid out wall, all of it
// wall, none of it inside `avoid` ([i0, j0, i1, j1] cell ranges), with the least going on in it.
// With `tone`, a stretch about that bright is preferred. Returns { i, j, mean } or null.
export function cleanStretch(lay, paint, w, h, avoid = [], step = 4, tone = null) {
  const { width, height, U, V } = lay, n = width * height;
  const lum = new Float32Array(n), ok = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(U[k])) continue;
    const c = sample(paint, U[k], V[k]);
    lum[k] = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; ok[k] = 1;
  }
  for (const [i0, j0, i1, j1] of avoid) for (let j = Math.max(0, j0); j < Math.min(height, j1); j++) for (let i = Math.max(0, i0); i < Math.min(width, i1); i++) ok[j * width + i] = 0;
  const W1 = width + 1, sumOk = new Float64Array(W1 * (height + 1)), sum = new Float64Array(W1 * (height + 1)), sq = new Float64Array(W1 * (height + 1));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i, at = (j + 1) * W1 + i + 1, v = ok[k] ? lum[k] : 0;
    sumOk[at] = ok[k] + sumOk[at - 1] + sumOk[at - W1] - sumOk[at - W1 - 1];
    sum[at] = v + sum[at - 1] + sum[at - W1] - sum[at - W1 - 1];
    sq[at] = v * v + sq[at - 1] + sq[at - W1] - sq[at - W1 - 1];
  }
  const box = (t, i, j) => t[(j + h) * W1 + i + w] - t[j * W1 + i + w] - t[(j + h) * W1 + i] + t[j * W1 + i];
  let best = null;
  for (let j = 0; j + h <= height; j += step) for (let i = 0; i + w <= width; i += step) {
    if (box(sumOk, i, j) < w * h) continue;
    const mean = box(sum, i, j) / (w * h), spread = box(sq, i, j) / (w * h) - mean * mean;
    // off the wanted brightness counts against a stretch as much as unevenness does
    const score = spread + (tone == null ? 0 : (mean - tone) * (mean - tone));
    if (!best || score < best.score) best = { i, j, spread, mean, score };
  }
  return best;
}

// A free corner of a texture: cells no triangle is painted from. used: one byte per cell.
// Returns the top left cell of a free w by h block, or null.
export function freeBlock(used, width, height, w, h) {
  if (w > width || h > height) return null;
  const W1 = width + 1, sum = new Int32Array(W1 * (height + 1));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) { const at = (j + 1) * W1 + i + 1; sum[at] = (used[j * width + i] ? 1 : 0) + sum[at - 1] + sum[at - W1] - sum[at - W1 - 1]; }
  for (let j = 0; j + h <= height; j++) for (let i = 0; i + w <= width; i++) {
    if (sum[(j + h) * W1 + i + w] - sum[j * W1 + i + w] - sum[(j + h) * W1 + i] + sum[j * W1 + i] === 0) return { i, j };
  }
  return null;
}

// Mark the cells of a texture a triangle is painted from, and a margin round them.
export function markUsed(used, width, height, uv, margin = 1) {
  const x = [uv[0][0] * width, uv[1][0] * width, uv[2][0] * width], y = [uv[0][1] * height, uv[1][1] * height, uv[2][1] * height];
  const xa = Math.max(0, Math.floor(Math.min(...x)) - margin), xb = Math.min(width - 1, Math.ceil(Math.max(...x)) + margin);
  const ya = Math.max(0, Math.floor(Math.min(...y)) - margin), yb = Math.min(height - 1, Math.ceil(Math.max(...y)) + margin);
  const d = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
  for (let j = ya; j <= yb; j++) for (let i = xa; i <= xb; i++) {
    if (Math.abs(d) < 1e-9) { used[j * width + i] = 1; continue; }
    // a cell counts when any point within the margin of it is inside the triangle
    const px = i + 0.5, py = j + 0.5, m = margin + 0.75;
    const e = (k, l) => { const ex = x[l] - x[k], ey = y[l] - y[k], len = Math.hypot(ex, ey) || 1; return ((px - x[k]) * ey - (py - y[k]) * ex) / len * (d > 0 ? 1 : -1); };
    if (e(0, 1) <= m && e(1, 2) <= m && e(2, 0) <= m) used[j * width + i] = 1;
  }
}

// ---------------------------------------------------------------- cutting a hole in a wall

// What is left of a triangle outside a rectangle. Corners carry any numbers after their first two
// (r, y): they are carried to the new corners. Returns a list of triangles.
export function cutTriangle(tri, r0, y0, r1, y1) {
  const clip = (poly, axis, limit, keepBelow) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ina = keepBelow ? a[axis] <= limit : a[axis] >= limit, inb = keepBelow ? b[axis] <= limit : b[axis] >= limit;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (limit - a[axis]) / (b[axis] - a[axis]); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
    }
    return out;
  };
  const pieces = [];
  let rest = tri;
  const take = (poly) => { if (poly.length >= 3) pieces.push(poly); };
  take(clip(rest, 0, r0, true)); rest = clip(rest, 0, r0, false);    // left of the hole
  take(clip(rest, 0, r1, false)); rest = clip(rest, 0, r1, true);    // right of it
  take(clip(rest, 1, y0, true)); rest = clip(rest, 1, y0, false);    // below it
  take(clip(rest, 1, y1, false));                                    // above it; what remains is the hole
  const out = [];
  for (const poly of pieces) for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) > 1e-10) out.push([a, b, c]);
  }
  return out;
}
