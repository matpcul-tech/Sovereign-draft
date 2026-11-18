// Sovereign Asset: give a building's walls a clean texture of their own.
//
// A generator shreds every wall across thousands of scraps of one small texture, and paints the
// crumple of its own mesh into the color. Up close the wall is smeared and creased. But the broad
// color it painted is good: the stains, a darker base course, brick at the corners. So keep that
// and replace only the fine detail:
//   1. each flat wall gets one upright rectangle in a new texture, at one even scale
//   2. the old paint is copied across, then smoothed until thin lines and creases are gone and
//      only areas of color are left
//   3. a sharp surface made at the new scale (stucco grain, block courses, brick) is laid over
//      it, tinted by that color, with a normal and a roughness map to match
//
// Pure math on pixel and vertex arrays. No DOM, no glTF.
import { eachTexel } from "./surface.js";

// ---------------------------------------------------------------- layout

// rects: [{ w, h }] in model units. Finds the largest scale (pixels per unit) at which every
// rectangle, with `pad` pixels of margin round it, fits in a size x size texture, and where each
// one goes. Returns { ppu, spots: [{ x, y, w, h }] } in pixels, or null when there is nothing to pack.
export function packWalls(rects, size, pad = 6) {
  if (!rects.length) return null;
  let area = 0;
  for (const r of rects) area += r.w * r.h;
  if (!(area > 0)) return null;
  const order = rects.map((_, i) => i).sort((a, b) => rects[b].h - rects[a].h);
  for (let ppu = Math.sqrt(size * size * 0.95 / area); ppu > 1e-6; ppu *= 0.96) {
    const spots = new Array(rects.length);
    let x = 0, y = 0, shelf = 0, ok = true;
    for (const i of order) {
      const w = Math.ceil(rects[i].w * ppu) + pad * 2, h = Math.ceil(rects[i].h * ppu) + pad * 2;
      if (w > size || h > size) { ok = false; break; }
      if (x + w > size) { x = 0; y += shelf; shelf = 0; }
      if (y + h > size) { ok = false; break; }
      spots[i] = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };
      x += w;
      if (h > shelf) shelf = h;
    }
    if (ok) return { ppu, spots };
  }
  return null;
}

// ---------------------------------------------------------------- copying the old paint across

// Draw triangles into the new texture, reading each pixel's color from the old one.
// uvNew and uvOld are per vertex. Returns the pixels it wrote as a mask.
export function copyPaint(out, size, uvNew, uvOld, indices, src) {
  const mask = new Uint8Array(size * size);
  const { width, height, rgba } = src;
  eachTexel(size, size, uvNew, indices, (p, w0, w1, w2, i0, i1, i2) => {
    const u = w0 * uvOld[i0 * 2] + w1 * uvOld[i1 * 2] + w2 * uvOld[i2 * 2], v = w0 * uvOld[i0 * 2 + 1] + w1 * uvOld[i1 * 2 + 1] + w2 * uvOld[i2 * 2 + 1];
    const fx = Math.min(width - 1, Math.max(0, u * width - 0.5)), fy = Math.min(height - 1, Math.max(0, v * height - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4, c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4, o = p * 4;
    for (let k = 0; k < 3; k++) out[o + k] = Math.round((rgba[a + k] * (1 - tx) + rgba[b + k] * tx) * (1 - ty) + (rgba[c + k] * (1 - tx) + rgba[d + k] * tx) * ty);
    out[o + 3] = 255;
    mask[p] = 1;
  });
  return mask;
}

// ---------------------------------------------------------------- smoothing paint down to color

function median(values, n) {
  // insertion sort: n is at most 25
  for (let i = 1; i < n; i++) { const v = values[i]; let j = i - 1; while (j >= 0 && values[j] > v) { values[j + 1] = values[j]; j--; } values[j + 1] = v; }
  return values[n >> 1];
}

// One wall's paint, inside its rectangle of the texture: shrink it so each cell is `cell` pixels,
// take the middle value of every 5 by 5 block twice (a thin line or a crease never wins a
// majority, an area of color always does), soften, and grow it back. Only pixels in the mask are
// read. Returns a Float32Array of r, g, b per pixel of the rectangle, 0 to 255.
export function colorOnly(rgba, mask, size, spot, cell) {
  const { x, y, w, h } = spot;
  const lw = Math.max(1, Math.ceil(w / cell)), lh = Math.max(1, Math.ceil(h / cell));
  let low = new Float32Array(lw * lh * 3);
  const have = new Uint8Array(lw * lh);
  const sum = new Float64Array(lw * lh * 3), n = new Uint32Array(lw * lh);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = (y + j) * size + x + i;
    if (!mask[p]) continue;
    const q = Math.min(lh - 1, Math.floor(j / cell)) * lw + Math.min(lw - 1, Math.floor(i / cell));
    sum[q * 3] += rgba[p * 4]; sum[q * 3 + 1] += rgba[p * 4 + 1]; sum[q * 3 + 2] += rgba[p * 4 + 2]; n[q]++;
  }
  for (let q = 0; q < lw * lh; q++) if (n[q]) { have[q] = 1; for (let k = 0; k < 3; k++) low[q * 3 + k] = sum[q * 3 + k] / n[q]; }
  // cells with no wall in them (a window opening) borrow from their neighbors, so the color under
  // a window's edge is the wall's and not black
  for (let pass = 0; pass < lw + lh && have.includes(0); pass++) {
    const prev = Uint8Array.from(have), from = Float32Array.from(low);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const q = j * lw + i;
      if (prev[q]) continue;
      let r = 0, g = 0, b = 0, m = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= lw || c >= lh || !prev[c * lw + a]) continue;
        const t = (c * lw + a) * 3; r += from[t]; g += from[t + 1]; b += from[t + 2]; m++;
      }
      if (m) { low[q * 3] = r / m; low[q * 3 + 1] = g / m; low[q * 3 + 2] = b / m; have[q] = 1; }
    }
  }
  const window = new Float32Array(25);
  for (let pass = 0; pass < 2; pass++) {
    const from = low;
    low = new Float32Array(lw * lh * 3);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) for (let k = 0; k < 3; k++) {
      let m = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const a = Math.min(lw - 1, Math.max(0, i + di)), c = Math.min(lh - 1, Math.max(0, j + dj));
        window[m++] = from[(c * lw + a) * 3 + k];
      }
      low[(j * lw + i) * 3 + k] = median(window, m);
    }
  }
  const out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const fy = Math.min(lh - 1, Math.max(0, (j + 0.5) / cell - 0.5)), y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), ty = fy - y0;
    for (let i = 0; i < w; i++) {
      const fx = Math.min(lw - 1, Math.max(0, (i + 0.5) / cell - 0.5)), x0 = Math.floor(fx), x1 = Math.min(lw - 1, x0 + 1), tx = fx - x0;
      for (let k = 0; k < 3; k++) {
        out[(j * w + i) * 3 + k] = (low[(y0 * lw + x0) * 3 + k] * (1 - tx) + low[(y0 * lw + x1) * 3 + k] * tx) * (1 - ty) + (low[(y1 * lw + x0) * 3 + k] * (1 - tx) + low[(y1 * lw + x1) * 3 + k] * tx) * ty;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- reading what the wall is made of

// Does the old paint show level courses, the way block and brick do? Looks at how brightness
// changes from row to row down one wall and whether that repeats. Returns the course height in
// pixels and where the first joint falls, or null for a wall with no courses (stucco, concrete).
export function findCourses(rgba, mask, size, spot, minPx, maxPx, minLike = 0.1) {
  const { x, y, w, h } = spot;
  const row = new Float32Array(h);
  const seen = new Uint8Array(h);
  for (let j = 0; j < h; j++) {
    let s = 0, n = 0;
    for (let i = 0; i < w; i++) { const p = (y + j) * size + x + i; if (!mask[p]) continue; s += 0.3 * rgba[p * 4] + 0.59 * rgba[p * 4 + 1] + 0.11 * rgba[p * 4 + 2]; n++; }
    if (n > w * 0.3) { row[j] = s / n; seen[j] = 1; }
  }
  // take out the slow drift (a stain, a darker base), keep the ripple
  const span = Math.max(3, Math.round(maxPx));
  const ripple = new Float32Array(h);
  for (let j = 0; j < h; j++) {
    if (!seen[j]) continue;
    let s = 0, n = 0;
    for (let k = Math.max(0, j - span); k <= Math.min(h - 1, j + span); k++) if (seen[k]) { s += row[k]; n++; }
    ripple[j] = row[j] - s / n;
  }
  let power = 0, rows = 0;
  for (let j = 0; j < h; j++) if (seen[j]) { power += ripple[j] * ripple[j]; rows++; }
  if (rows < maxPx * 3 || !(power > 0)) return null;
  // How alike is the ripple to itself moved down by each distance? Any soft texture is like itself
  // a few pixels away, so that says nothing. Courses show as the likeness falling away and then
  // coming back: the first clear peak after the first dip is one course.
  const top = Math.round(maxPx), like = new Float32Array(top + 2);
  for (let lag = 1; lag <= top + 1; lag++) {
    let s = 0, a = 0, b = 0;
    for (let j = 0; j + lag < h; j++) if (seen[j] && seen[j + lag]) { s += ripple[j] * ripple[j + lag]; a += ripple[j] * ripple[j]; b += ripple[j + lag] * ripple[j + lag]; }
    like[lag] = a > 0 && b > 0 ? s / Math.sqrt(a * b) : 0;
  }
  let dip = 0;
  for (let lag = 2; lag <= top; lag++) if (like[lag] < 0.05) { dip = lag; break; }
  if (!dip) return null;
  let best = 0, period = 0;
  for (let lag = Math.max(dip + 1, Math.round(minPx)); lag <= top; lag++) {
    if (like[lag] > best && like[lag] >= like[lag - 1] && like[lag] >= like[lag + 1]) { best = like[lag]; period = lag; }
  }
  if (best < minLike || !period) return null;
  // the joints are the darkest rows: fold the ripple by the period and take the lowest point
  const fold = new Float32Array(period), count = new Uint32Array(period);
  for (let j = 0; j < h; j++) if (seen[j]) { fold[j % period] += ripple[j]; count[j % period]++; }
  let phase = 0, low = Infinity;
  for (let k = 0; k < period; k++) { const v = count[k] ? fold[k] / count[k] : 0; if (v < low) { low = v; phase = k; } }
  return { period, phase, strength: best };
}

// ---------------------------------------------------------------- the new surface

function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
// several sizes of noise added together, about 0 to 1
function grain(x, y, seed, octaves) {
  let v = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) { v += noise(x, y, seed + o * 17) * amp; total += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return v / total;
}

// What the surface is at one point of a wall. x and y are in pixels of the wall's rectangle.
// kind: "stucco", or "block" / "brick" with course (pixels per course) and phase (first joint).
// grainPx is the size of the coarsest grain in pixels. Returns [tint, height, roughness]:
// tint multiplies the color (1 is no change), height is 0 to 1 for the normal map.
export function surfaceAt(kind, x, y, grainPx, course, phase, seed, out) {
  const fine = grain(x / (grainPx * 0.12), y / (grainPx * 0.12), seed + 3, 3);
  if (kind === "stucco") {
    const coarse = grain(x / grainPx, y / grainPx, seed, 4);
    out[0] = 1 + (coarse - 0.5) * 0.16 + (fine - 0.5) * 0.1;
    out[1] = 0.5 + (coarse - 0.5) * 0.5 + (fine - 0.5) * 0.5;
    out[2] = 0.88 + (fine - 0.5) * 0.14;
    return out;
  }
  const length = kind === "brick" ? course * 3 : course * 2;
  const row = Math.floor((y - phase) / course), fy = (y - phase) / course - row;
  const shifted = x + (row & 1 ? length / 2 : 0) + hash(row, 0, seed + 5) * length * 0.08;
  const col = Math.floor(shifted / length), fx = shifted / length - col;
  const joint = kind === "brick" ? 0.11 : 0.07;                 // share of a course that is mortar
  const edge = Math.min(fy, 1 - fy, (fx < 0.5 ? fx : 1 - fx) * (length / course));
  const wobble = (grain(x / (course * 0.6), y / (course * 0.6), seed + 9, 2) - 0.5) * joint * 0.5;
  const t = Math.min(1, Math.max(0, (edge - joint * 0.5 - wobble) / (joint * 0.6))); // 0 in the joint, 1 on the face
  const s = t * t * (3 - 2 * t);
  const unit = hash(col, row, seed + 1);                         // each block or brick its own shade
  const face = 1 + (unit - 0.5) * (kind === "brick" ? 0.26 : 0.14) + (fine - 0.5) * 0.14 + (grain(x / (course * 0.4), y / (course * 0.4), seed + 2, 3) - 0.5) * 0.1;
  out[0] = (kind === "brick" ? 0.8 : 0.74) * (1 - s) + face * s;
  out[1] = 0.25 * (1 - s) + (0.8 + (fine - 0.5) * 0.3 + (unit - 0.5) * 0.08) * s;
  out[2] = 0.96 * (1 - s) + (kind === "brick" ? 0.8 : 0.86) * s + (fine - 0.5) * 0.08;
  return out;
}

// A tangent-space normal map from a height field over the whole texture. Green points up the image.
export function normalsFrom(height, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x;
    const l = height[y * size + Math.max(0, x - 1)], r = height[y * size + Math.min(size - 1, x + 1)];
    const u = height[Math.max(0, y - 1) * size + x], d = height[Math.min(size - 1, y + 1) * size + x];
    const nx = -(r - l) * strength, ny = (d - u) * strength, len = Math.hypot(nx, ny, 1);
    out[p * 4] = Math.round((nx / len * 0.5 + 0.5) * 255); out[p * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255); out[p * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255); out[p * 4 + 3] = 255;
  }
  return out;
}

// Spread written pixels outward into the margin, so filtering at the edge of a wall's rectangle
// never mixes in whatever was left in the gap.
export function spreadEdges(rgba, mask, size, passes) {
  let seen = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(seen);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = y * size + x;
      if (seen[p]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      if (x > 0 && seen[p - 1]) { r += rgba[(p - 1) * 4]; g += rgba[(p - 1) * 4 + 1]; b += rgba[(p - 1) * 4 + 2]; n++; }
      if (x < size - 1 && seen[p + 1]) { r += rgba[(p + 1) * 4]; g += rgba[(p + 1) * 4 + 1]; b += rgba[(p + 1) * 4 + 2]; n++; }
      if (y > 0 && seen[p - size]) { r += rgba[(p - size) * 4]; g += rgba[(p - size) * 4 + 1]; b += rgba[(p - size) * 4 + 2]; n++; }
      if (y < size - 1 && seen[p + size]) { r += rgba[(p + size) * 4]; g += rgba[(p + size) * 4 + 1]; b += rgba[(p + size) * 4 + 2]; n++; }
      if (n) { rgba[p * 4] = r / n; rgba[p * 4 + 1] = g / n; rgba[p * 4 + 2] = b / n; rgba[p * 4 + 3] = 255; next[p] = 1; }
    }
    seen = next;
  }
  return seen;
}
