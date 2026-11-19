// Sovereign Asset: find the window glass on a building, from its shape.
//
// A generator paints a building's windows into the same shredded texture as its walls, so nothing
// in the texture says "this is glass". Picking dark pixels does not work: stains are dark, and
// glass is often pale. The mesh does know. A pane is a small flat upright rectangle that sits a
// little behind what surrounds it: the frame steps forward from every edge of it. A wall panel is
// not sunken, a sign stands proud, a door reaches the floor, and a brown door is not glass colored.
//
// Pure math on vertex lists. No DOM, no glTF.
import { findFlats, weldIds } from "./geometry.js";

const DEFAULTS = {
  tolerance: 0.002,   // how flat a pane must be, as a share of the model's size
  minPiece: 0.006,    // narrowest piece of glass that counts (the strips between bars are narrow)
  minFill: 0.85,      // a pane fills its own rectangle
  band: 0.012,        // how far outside a pane to look for its frame
  reach: 0.05,        // and how far in front of or behind it
  rise: 0.0008,       // the frame stands at least this far in front of the glass
  maxGap: 0.02,       // pieces closer than this side by side are one window (a mullion, a bar)
  maxStep: 0.03,      // and no further apart than this in depth
  spreadDepth: 0.003, // crumpled glass next to a pane joins it when it is this close to the pane's depth
  spreadSide: 0.05,   // and no further than this past the pane's own edge
  minWindow: 0.035,   // smallest window, as a share of the building's height
  maxSat: 0.42,       // glass is gray, black, white or blue, even when dirty. A painted door is far past this
  minPaint: 0.06,     // darker than this is glass whatever its tint: dark glass picks up the color of the wall around it
  floorGap: 0.03,     // anything that starts this close to the ground is a door
  minSign: 0.2        // narrowest sign, as a share of the building's height
};

// pos: world positions. indices: triangles. diag: model size. colorOf(t): mean linear [r, g, b] of
// triangle t, or null. Returns { windows, signs, doors, pieces, seen }. A sign is a wide panel that
// stands proud of the wall. A door is set back like a window but reaches the ground or is painted. Each window is
// { tris, normal, width, height, bottom, left, depth, area }. tris index into the triangle list.
export function findWindows(pos, indices, diag, colorOf, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = { windows: [], signs: [], doors: [], pieces: 0, seen: { flat: 0, upright: 0, rectangle: 0, sunken: 0, glass: 0 } };
  const tris = indices.length / 3;
  if (!(diag > 0) || tris < 4) return out;
  let floor = Infinity, top = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { if (pos[i] < floor) floor = pos[i]; if (pos[i] > top) top = pos[i]; }
  const height = top - floor;
  if (!(height > 0)) return out;

  const flats = findFlats(pos, indices, diag, { tolerance: o.tolerance, minShare: 0.0003, minSpan: 0.015, keepBowed: true });
  out.seen.flat = flats.regions.length;
  if (!flats.regions.length) return out;

  const welded = weldIds(pos, diag * 1e-6), ids = welded.ids;
  const verts = pos.length / 3, own = new Set(), ahead = [0, 0, 0, 0], behind = [0, 0, 0, 0];

  // how wide the whole model is along a wall's direction
  const spans = new Map();
  const spanAlong = (hx, hz) => {
    const key = Math.round(Math.atan2(hz, hx) * 20);
    if (!spans.has(key)) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pos.length; i += 3) { const a = pos[i] * hx + pos[i + 2] * hz; if (a < lo) lo = a; if (a > hi) hi = a; }
      spans.set(key, hi - lo);
    }
    return spans.get(key);
  };

  const pieces = [];
  flats.regions.forEach((region, k) => {
    const n = region.normal;
    if (Math.abs(n[1]) > 0.2) return;
    out.seen.upright++;
    const len = Math.hypot(n[0], n[2]);
    const hx = n[2] / len, hz = -n[0] / len; // the direction that runs along the wall
    let a0 = Infinity, a1 = -Infinity, y0 = Infinity, y1 = -Infinity, cx = 0, cy = 0, cz = 0, cw = 0;
    for (const t of region.tris) {
      for (let e = 0; e < 3; e++) {
        const i = indices[t * 3 + e] * 3, a = pos[i] * hx + pos[i + 2] * hz, y = pos[i + 1];
        if (a < a0) a0 = a; if (a > a1) a1 = a; if (y < y0) y0 = y; if (y > y1) y1 = y;
        cx += pos[i]; cy += y; cz += pos[i + 2]; cw++;
      }
    }
    const w = a1 - a0, h = y1 - y0;
    if (!(w >= o.minPiece * diag && h >= o.minPiece * diag)) return;
    const fill = region.area / (w * h);
    if (fill < 0.5) return;
    if (fill >= o.minFill) out.seen.rectangle++;

    // look at the band just outside the rectangle, side by side: does the surface there stand in
    // front of the pane? A frame, a sill or a row of bars does. A wall the pane is simply part of
    // does not, and around a sign or a panel that stands proud it sits behind.
    own.clear();
    for (const t of region.tris) for (let e = 0; e < 3; e++) own.add(ids[indices[t * 3 + e]]);
    const band = Math.max(o.band * diag, 0.15 * Math.min(w, h)), reach = o.reach * diag, slack = 1e-4 * diag, rise = o.rise * diag;
    ahead.fill(0); behind.fill(0);
    for (let v = 0; v < verts; v++) {
      const i = v * 3;
      const d = pos[i] * n[0] + pos[i + 1] * n[1] + pos[i + 2] * n[2] - region.d;
      if (d > reach || d < -reach) continue;
      const a = pos[i] * hx + pos[i + 2] * hz, y = pos[i + 1];
      if (a < a0 - band || a > a1 + band || y < y0 - band || y > y1 + band) continue;
      if (own.has(ids[v])) continue;
      const left = a <= a0 + slack, right = a >= a1 - slack, low = y <= y0 + slack, high = y >= y1 - slack;
      if (!left && !right && !low && !high) continue; // in front of or behind the glass itself: bars, a curtain rail
      if ((a < a0 - slack || a > a1 + slack) && (y < y0 - slack || y > y1 + slack)) continue; // off past a corner: not beside the pane
      // surface level with the pane says nothing either way: it is the next strip of the same glass
      // behind a bar, or the rest of a wall this piece is only a fragment of
      if (d <= rise && d >= -rise) continue;
      const tally = d > 0 ? ahead : behind;
      if (left) tally[0]++;
      if (right) tally[1]++;
      if (low) tally[2]++;
      if (high) tally[3]++;
    }
    let raised = 0, lowered = 0;
    for (let k = 0; k < 4; k++) {
      if (ahead[k] >= 2 && ahead[k] >= 0.7 * (ahead[k] + behind[k])) raised++;
      if (behind[k] >= 2 && behind[k] >= 0.7 * (ahead[k] + behind[k])) lowered++;
    }
    const shape = { tris: Array.from(region.tris), normal: [n[0], 0, n[2]], width: w, height: h, bottom: y0 - floor, left: a0 };
    // What paint is it? Glass is gray, black, white or blue. A sign or a door is painted.
    let luma = -1, painted = false;
    if (colorOf) {
      let r = 0, g = 0, b = 0, m = 0;
      for (const t of region.tris) { const c = colorOf(t); if (!c) continue; r += c[0]; g += c[1]; b += c[2]; m++; }
      if (m) {
        const max = Math.max(r, g, b) / m, min = Math.min(r, g, b) / m;
        const sat = max > 1e-4 ? (max - min) / max : 0;
        painted = max > o.minPaint && sat > (b >= r && b >= g ? 0.6 : o.maxSat);
        luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / m;
      }
    }
    // a sign: a wide painted panel up off the ground, proud of the wall or set in a frame of its
    // own, and not a band that runs the whole width of the building (that is a cornice)
    const wide = w >= o.minSign * height && w >= 1.6 * h && h >= 0.06 * height && y0 - floor > 0.2 * height && w < 0.9 * spanAlong(hx, hz);
    if (painted && wide && fill >= o.minFill && raised + lowered >= 2) { out.signs.push({ ...shape, depth: region.d, hx, hz }); return; }
    if (raised < 3) return;
    if (fill >= o.minFill) out.seen.sunken++;

    const tall = h >= 1.4 * w && h >= 0.1 * height;
    if (y0 - floor < o.floorGap * height) { if (tall) out.doors.push(shape); return; } // reaches the ground: a door
    if (painted) { if (tall) out.doors.push(shape); return; } // painted, not glass: a door upstairs
    if (fill < o.minFill) return;
    out.seen.glass++;
    pieces.push({ tris: Array.from(region.tris), n, d: region.d, hx, hz, a0, a1, y0, y1, area: region.area, c: [cx / cw, cy / cw, cz / cw], luma });
  });
  out.pieces = pieces.length;

  // Glass behind bars comes out of a generator crumpled: some of it is flat strips, found above,
  // and the rest is small facets leaning every way. Spread each piece into the facets that touch
  // it, as long as they face the same way, sit at the same depth, stay within the piece's own
  // height and are the same kind of dark or pale. The frame is a step forward, so it stops this.
  if (colorOf && pieces.length) {
    const { unique } = welded;
    const across = new Map();
    for (let t = 0; t < tris; t++) for (let e = 0; e < 3; e++) {
      const a = ids[indices[t * 3 + e]], b = ids[indices[t * 3 + (e + 1) % 3]];
      if (a === b) continue;
      const key = a < b ? a * unique + b : b * unique + a;
      const list = across.get(key);
      if (list) list.push(t); else across.set(key, [t]);
    }
    const taken = new Int32Array(tris).fill(-1);
    pieces.forEach((p, i) => { for (const t of p.tris) taken[t] = i; });
    const depth = o.spreadDepth * diag, side = o.spreadSide * diag, lift = o.tolerance * diag;
    pieces.forEach((p, i) => {
      const lo = p.a0 - side, hi = p.a1 + side;
      for (let head = 0; head < p.tris.length; head++) {
        const t = p.tris[head];
        for (let e = 0; e < 3; e++) {
          const a = ids[indices[t * 3 + e]], b = ids[indices[t * 3 + (e + 1) % 3]];
          if (a === b) continue;
          for (const u of across.get(a < b ? a * unique + b : b * unique + a)) {
            if (taken[u] >= 0) continue;
            const i0 = indices[u * 3] * 3, i1 = indices[u * 3 + 1] * 3, i2 = indices[u * 3 + 2] * 3;
            const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
            const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (!(len > 0) || (nx * p.n[0] + ny * p.n[1] + nz * p.n[2]) / len < 0.75) continue;
            let ok = true;
            for (const iv of [i0, i1, i2]) {
              const d = pos[iv] * p.n[0] + pos[iv + 1] * p.n[1] + pos[iv + 2] * p.n[2] - p.d;
              const al = pos[iv] * p.hx + pos[iv + 2] * p.hz, y = pos[iv + 1];
              if (d > depth || d < -depth || y < p.y0 - lift || y > p.y1 + lift || al < lo || al > hi) { ok = false; break; }
            }
            if (!ok) continue;
            const c = colorOf(u);
            if (!c) continue;
            const max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
            if (max > o.minPaint && (max - min) / max > (c[2] >= c[0] && c[2] >= c[1] ? 0.6 : o.maxSat)) continue;
            const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            if (p.luma >= 0 && (l + 0.01) / (p.luma + 0.01) > 2.5) continue; // much brighter than the glass: a bar, a frame
            taken[u] = i;
            p.tris.push(u);
            p.area += len / 2;
            for (const iv of [i0, i1, i2]) { const al = pos[iv] * p.hx + pos[iv + 2] * p.hz; if (al < p.a0) p.a0 = al; if (al > p.a1) p.a1 = al; }
          }
        }
      }
    });
  }

  // pieces side by side at the same height and depth are one window
  const parent = pieces.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const p = pieces[i], q = pieces[j];
    if (p.n[0] * q.n[0] + p.n[2] * q.n[2] < 0.9) continue;
    // measure along p's wall direction, and the step along p's facing
    const qa0 = q.a0 * (q.hx * p.hx + q.hz * p.hz), qa1 = q.a1 * (q.hx * p.hx + q.hz * p.hz);
    const lo = Math.min(qa0, qa1), hi = Math.max(qa0, qa1);
    const overlapY = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0), overlapA = Math.min(p.a1, hi) - Math.max(p.a0, lo);
    // side by side at the same height (a mullion, a bar between them), or one right above the
    // other across the same width (the lights over a crossbar, a transom): either way one window
    const beside = overlapY >= 0.7 * Math.min(p.y1 - p.y0, q.y1 - q.y0) && Math.max(lo - p.a1, p.a0 - hi) <= o.maxGap * diag;
    const stacked = overlapA >= 0.7 * Math.min(p.a1 - p.a0, hi - lo) && Math.max(q.y0 - p.y1, p.y0 - q.y1) <= o.maxGap * diag;
    if (!beside && !stacked) continue;
    const step = Math.abs((q.c[0] - p.c[0]) * p.n[0] + (q.c[2] - p.c[2]) * p.n[2]);
    if (step > o.maxStep * diag) continue;
    parent[find(i)] = find(j);
  }
  const groups = new Map();
  pieces.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });

  for (const list of groups.values()) {
    const lead = list[0];
    let a0 = Infinity, a1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0, count = 0, depth = 0;
    for (const p of list) {
      const k = p.hx * lead.hx + p.hz * lead.hz;
      a0 = Math.min(a0, p.a0 * k, p.a1 * k); a1 = Math.max(a1, p.a0 * k, p.a1 * k);
      y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1);
      area += p.area; count += p.tris.length;
      depth += (p.c[0] * lead.n[0] + p.c[2] * lead.n[2]) * p.area;
    }
    const w = a1 - a0, h = y1 - y0;
    if (w < o.minWindow * height || h < o.minWindow * height) continue;
    if (w / h < 0.2 || w / h > 6) continue;
    if (area / (w * h) < 0.45) continue;
    const tri = new Int32Array(count);
    let at = 0;
    for (const p of list) { tri.set(p.tris, at); at += p.tris.length; }
    out.windows.push({ tris: tri, normal: [lead.n[0], 0, lead.n[2]], width: w, height: h, bottom: y0 - floor, left: a0, depth: depth / area, area });
  }
  // a sign made of two or three level strips is one sign
  for (let i = 0; i < out.signs.length; i++) for (let j = out.signs.length - 1; j > i; j--) {
    const p = out.signs[i], q = out.signs[j];
    if (p.normal[0] * q.normal[0] + p.normal[2] * q.normal[2] < 0.9 || Math.abs(p.depth - q.depth) > o.maxStep * diag) continue;
    const gapY = Math.max(q.bottom - (p.bottom + p.height), p.bottom - (q.bottom + q.height));
    const overlap = Math.min(p.left + p.width, q.left + q.width) - Math.max(p.left, q.left);
    if (gapY > o.maxGap * diag || overlap < 0.7 * Math.min(p.width, q.width)) continue;
    const top = Math.max(p.bottom + p.height, q.bottom + q.height), right = Math.max(p.left + p.width, q.left + q.width);
    p.tris = p.tris.concat(q.tris); p.bottom = Math.min(p.bottom, q.bottom); p.left = Math.min(p.left, q.left); p.height = top - p.bottom; p.width = right - p.left;
    out.signs.splice(j, 1);
  }
  // a steady order: by the side they face, then floor by floor, then left to right
  const side = (wdw) => Math.round(Math.atan2(wdw.normal[0], wdw.normal[2]) / (Math.PI / 4));
  out.windows.sort((p, q) => side(p) - side(q) || Math.round((p.bottom - q.bottom) / (0.05 * height)) || p.left - q.left);
  return out;
}

// Which windows have a light on. About two in three, in a fixed scatter that depends only on
// where each window is, so the same building always lights the same rooms.
export function litPattern(windows) {
  const on = windows.map((w) => {
    const key = Math.round(w.left * 37.1) * 73856093 ^ Math.round(w.bottom * 53.3) * 19349663 ^ Math.round(Math.atan2(w.normal[0], w.normal[2]) * 2) * 83492791;
    return ((key >>> 0) % 100) < 66;
  });
  // The biggest window on the ground floor is the shop window, or the front room of a house. A
  // building whose one big window is dark reads as shut, so that one is always lit.
  if (windows.length) {
    let low = Infinity;
    for (const w of windows) low = Math.min(low, w.bottom);
    let best = -1;
    windows.forEach((w, i) => { if (w.bottom <= low + 0.6 * w.height && (best < 0 || w.width * w.height > windows[best].width * windows[best].height)) best = i; });
    if (best >= 0) on[best] = true;
  }
  return on;
}
