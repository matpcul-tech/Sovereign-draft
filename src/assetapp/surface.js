// Sovereign Asset: what a surface looks like under a game's own lights.
// Pure math on pixel arrays and vertex lists. No DOM, no glTF, so it runs anywhere and is easy to test.
//
// Three jobs:
//   texelDensity   how many texture pixels cover one meter of the model, and how much of it is stretched
//   fitBakedLight  light that was painted into the color texture, found from how brightness follows the
//                  direction a face points and how high it sits, so it can be divided back out
//   normalFromColor, roughnessFromColor   surface maps for a material that came with a color texture only

export const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

function toSrgb(v) {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

// Linear brightness of one pixel, 0 to 1.
function lumaAt(rgba, i) {
  return 0.2126 * LINEAR[rgba[i]] + 0.7152 * LINEAR[rgba[i + 1]] + 0.0722 * LINEAR[rgba[i + 2]];
}

export function lumaOf(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = lumaAt(rgba, i * 4);
  return out;
}

// True when every UV sits inside the texture once. A tiling UV set has no single pixel per point.
export function uvInside(uv) {
  for (let i = 0; i < uv.length; i++) if (!(uv[i] >= -0.001 && uv[i] <= 1.001)) return false;
  return true;
}

// Walk every pixel center inside every UV triangle. fn(pixelIndex, w0, w1, w2, i0, i1, i2).
function eachTexel(width, height, uv, indices, fn) {
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x0 = uv[i0 * 2] * width - 0.5, y0 = uv[i0 * 2 + 1] * height - 0.5;
    const x1 = uv[i1 * 2] * width - 0.5, y1 = uv[i1 * 2 + 1] * height - 0.5;
    const x2 = uv[i2 * 2] * width - 0.5, y2 = uv[i2 * 2 + 1] * height - 0.5;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!(Math.abs(area) > 1e-9)) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    const inv = 1 / area;
    // half a pixel of slack, so the pixels a triangle only touches are still painted and no seam is left bare
    const longest = Math.max(Math.hypot(x1 - x0, y1 - y0), Math.hypot(x2 - x1, y2 - y1), Math.hypot(x0 - x2, y0 - y2));
    const slack = -Math.min(1, 0.5 * longest * Math.abs(inv));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) * inv;
        const w2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) * inv;
        const w0 = 1 - w1 - w2;
        if (w0 < slack || w1 < slack || w2 < slack) continue;
        fn(y * width + x, w0, w1, w2, i0, i1, i2);
      }
    }
  }
}

// Which pixels of the texture the model actually uses.
export function coverageMask(width, height, uv, indices) {
  const mask = new Uint8Array(width * height);
  eachTexel(width, height, uv, indices, (p) => { mask[p] = 1; });
  return mask;
}

// ---------------------------------------------------------------- texture detail

// parts: [{ pos (world, xyz), uv, indices, width, height }]. Area is in square meters, so the answer
// is texture pixels per meter. stretched is the share of the surface with under half the usual detail.
export function texelDensity(parts) {
  const rows = [];
  let total = 0;
  for (const part of parts) {
    const { pos, uv, indices, width, height } = part;
    if (!uv || !width || !height) continue;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const world = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (!(world > 1e-12)) continue;
      const texels = 0.5 * Math.abs((uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1])) * width * height;
      rows.push([Math.sqrt(texels / world), world]);
      total += world;
    }
  }
  if (!rows.length || !(total > 0)) return null;
  rows.sort((p, q) => p[0] - q[0]);
  let run = 0, median = rows[rows.length - 1][0];
  for (const row of rows) { run += row[1]; if (run >= total / 2) { median = row[0]; break; } }
  let thin = 0;
  for (const row of rows) { if (row[0] >= median / 2) break; thin += row[1]; }
  return { median, stretched: thin / total, area: total };
}

// ---------------------------------------------------------------- baked light

// The shapes baked light takes: brighter on faces that point one way (three terms), the five next
// terms of the same series for soft sky light, and darker toward the ground (height, height squared).
const TERMS = 10;
function termsOf(nx, ny, nz, h, out) {
  out[0] = nx; out[1] = ny; out[2] = nz;
  out[3] = nx * ny; out[4] = ny * nz; out[5] = nx * nz; out[6] = nx * nx - nz * nz; out[7] = 3 * ny * ny - 1;
  out[8] = h; out[9] = h * h;
  return out;
}

function solve(a, b, n) {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r * n + col]) > Math.abs(a[pivot * n + col])) pivot = r;
    if (Math.abs(a[pivot * n + col]) < 1e-12) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) { const s = a[col * n + k]; a[col * n + k] = a[pivot * n + k]; a[pivot * n + k] = s; }
      const s = b[col]; b[col] = b[pivot]; b[pivot] = s;
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col] / a[col * n + col];
      if (!f) continue;
      for (let k = col; k < n; k++) a[r * n + k] -= f * a[col * n + k];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r * n + k] * x[k];
    x[r] = s / a[r * n + r];
  }
  return x;
}

// Which paint a sample is: one of twelve hues, or gray, or too dark to tell. Light changes how
// bright a paint is, not which paint it is, so the fit below compares a sample only with others
// of its own paint. A black tire next to a bright door is then never mistaken for shadow.
export const PAINTS = 14;
export function paintOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 0.012) return 13;
  if (max - min < 0.18 * max) return 12;
  let hue = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  if (hue < 0) hue += 6;
  return Math.min(11, Math.floor(hue * 2));
}

// samples: { count, normal (xyz), height (0 at the lowest point, 1 at the highest), luma, paint, weight }.
// Finds how brightness follows direction and height across the whole model, within each paint.
// Odd patches inside a paint (a decal, a lamp) are treated as outliers and do not pull the answer.
// Returns the light at each sample and how strong it was, lit side against dark side.
export function fitBakedLight(samples) {
  const n = samples.count;
  const N = PAINTS + TERMS;
  const logL = new Float32Array(n);
  for (let i = 0; i < n; i++) logL[i] = Math.log(samples.luma[i] + 0.02);
  const f = new Float64Array(TERMS);
  let coef = null;
  const trust = new Float32Array(n).fill(1);
  const lightAt = (i, c) => {
    termsOf(samples.normal[i * 3], samples.normal[i * 3 + 1], samples.normal[i * 3 + 2], samples.height[i], f);
    let v = 0;
    for (let k = 0; k < TERMS; k++) v += c[PAINTS + k] * f[k];
    return v;
  };
  let total = 0;
  for (let i = 0; i < n; i++) total += samples.weight[i];
  if (!(total > 0)) return { range: 1, found: false };
  for (let pass = 0; pass < 6; pass++) {
    const A = new Float64Array(N * N), B = new Float64Array(N);
    for (let i = 0; i < n; i++) {
      const w = samples.weight[i] * trust[i];
      if (!(w > 0)) continue;
      termsOf(samples.normal[i * 3], samples.normal[i * 3 + 1], samples.normal[i * 3 + 2], samples.height[i], f);
      const k = samples.paint[i];
      A[k * N + k] += w; B[k] += w * logL[i];
      for (let r = 0; r < TERMS; r++) {
        const row = PAINTS + r;
        A[k * N + row] += w * f[r];
        B[row] += w * f[r] * logL[i];
        for (let c = r; c < TERMS; c++) A[row * N + PAINTS + c] += w * f[r] * f[c];
      }
    }
    // a little weight on "no light at all", so a paint nobody wears and a direction nothing faces stay at zero
    const ridge = 1e-4 * total;
    for (let r = 0; r < N; r++) { for (let c = 0; c < r; c++) A[r * N + c] = A[c * N + r]; A[r * N + r] += ridge; }
    const next = solve(A, B, N);
    if (!next) break;
    coef = next;
    const resid = new Float32Array(n);
    for (let i = 0; i < n; i++) resid[i] = Math.abs(logL[i] - coef[samples.paint[i]] - lightAt(i, coef));
    const sorted = Float32Array.from(resid).sort();
    const scale = Math.max(0.02, 1.5 * sorted[sorted.length >> 1]);
    for (let i = 0; i < n; i++) trust[i] = resid[i] <= scale ? 1 : scale / resid[i];
  }
  if (!coef) return { range: 1, found: false };
  // the light at each sample, with its weighted mean taken out so overall brightness stays put
  const shade = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { shade[i] = lightAt(i, coef); sum += shade[i] * samples.weight[i]; }
  const mean = sum / total;
  // brightest lit side against the darkest, ignoring the top and bottom 2 percent of the surface
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => samples.weight[i] > 0).sort((p, q) => shade[p] - shade[q]);
  let run = 0, lo = 0, hi = 0, gotLo = false;
  for (const i of order) {
    run += samples.weight[i];
    if (!gotLo && run >= total * 0.02) { lo = shade[i]; gotLo = true; }
    hi = shade[i];
    if (run >= total * 0.98) break;
  }
  for (let i = 0; i < n; i++) shade[i] -= mean;
  return { shade, range: Math.exp(hi - lo), found: true };
}

// Turn the fitted light into a per-sample gain. strength 1 removes all of it. limit caps the change.
export function gainFrom(fit, strength, limit) {
  if (!fit.shade) return null;
  const gain = new Float32Array(fit.shade.length).fill(1);
  const lo = 1 / limit;
  for (let i = 0; i < gain.length; i++) {
    const g = Math.exp(-strength * fit.shade[i]);
    gain[i] = g < lo ? lo : g > limit ? limit : g;
  }
  return gain;
}

// Paint a per-vertex gain into texture space, then spread it a few pixels past every UV edge so
// filtering at a seam never mixes a corrected pixel with an uncorrected one.
export function gainMap(width, height, uv, indices, gain, spread = 4) {
  const map = new Float32Array(width * height);
  eachTexel(width, height, uv, indices, (p, w0, w1, w2, i0, i1, i2) => { map[p] = w0 * gain[i0] + w1 * gain[i1] + w2 * gain[i2]; });
  for (let pass = 0; pass < spread; pass++) {
    const prev = Float32Array.from(map);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (prev[p]) continue;
      let s = 0, k = 0;
      if (x > 0 && prev[p - 1]) { s += prev[p - 1]; k++; }
      if (x < width - 1 && prev[p + 1]) { s += prev[p + 1]; k++; }
      if (y > 0 && prev[p - width]) { s += prev[p - width]; k++; }
      if (y < height - 1 && prev[p + width]) { s += prev[p + width]; k++; }
      if (k) map[p] = s / k;
    }
  }
  return map;
}

// Multiply the color by the gain, in linear light. Pixels with no gain are left exactly as they were.
// A pixel is never brightened past the point where its color would wash out to white.
export function applyGain(rgba, map) {
  const out = Uint8Array.from(rgba);
  for (let p = 0; p < map.length; p++) {
    let g = map[p];
    if (!g || g === 1) continue;
    const i = p * 4;
    if (g > 1) {
      const top = Math.max(LINEAR[rgba[i]], LINEAR[rgba[i + 1]], LINEAR[rgba[i + 2]]);
      if (top * g > 0.85) g = Math.max(1, 0.85 / top);
    }
    out[i] = toSrgb(LINEAR[rgba[i]] * g); out[i + 1] = toSrgb(LINEAR[rgba[i + 1]] * g); out[i + 2] = toSrgb(LINEAR[rgba[i + 2]] * g);
  }
  return out;
}

// Mean linear color around a UV point, over a small square so one odd pixel does not decide it.
// With a mask only pixels the model uses are read. Returns false when there are none.
export function sampleColor(rgba, width, height, u, v, radius, mask, out) {
  const cx = Math.round(u * width - 0.5), cy = Math.round(v * height - 0.5);
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= width) continue;
      const p = y * width + x;
      if (mask && !mask[p]) continue;
      r += LINEAR[rgba[p * 4]]; g += LINEAR[rgba[p * 4 + 1]]; b += LINEAR[rgba[p * 4 + 2]]; k++;
    }
  }
  if (!k) return false;
  out[0] = r / k; out[1] = g / k; out[2] = b / k;
  return true;
}

// ---------------------------------------------------------------- surface maps

function boxBlur(src, width, height, radius) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let s = 0;
    const row = y * width;
    for (let x = -radius; x <= radius; x++) s += src[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = s / span;
      s += src[row + Math.min(width - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = -radius; y <= radius; y++) s += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = s / span;
      s += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

// Fine detail only: brightness with the broad light and shade taken out. Mortar lines, scratches
// and grain stay. A wall that is simply darker at one end does not become a slope. With a mask,
// the broad level is taken from the model's own pixels only, so the unused gutter around a UV
// piece never bleeds into it.
function fineDetail(rgba, width, height, mask) {
  const luma = lumaOf(rgba, width, height);
  for (let i = 0; i < luma.length; i++) luma[i] = Math.sqrt(luma[i]); // closer to how bright it looks
  const radius = Math.max(2, Math.round(Math.max(width, height) / 128));
  const twice = (src) => boxBlur(boxBlur(src, width, height, radius), width, height, radius);
  if (!mask) {
    const broad = twice(luma);
    for (let i = 0; i < luma.length; i++) luma[i] -= broad[i];
    return luma;
  }
  const used = new Float32Array(luma.length), level = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) if (mask[i]) { used[i] = 1; level[i] = luma[i]; }
  const sum = twice(level), share = twice(used);
  for (let i = 0; i < luma.length; i++) luma[i] = mask[i] && share[i] > 1e-6 ? luma[i] - sum[i] / share[i] : 0;
  return luma;
}

// A tangent-space normal map from the color texture: dark lines read as grooves, bright spots as
// raised. Green points up the image, which is what glTF expects. Pixels at the edge of a UV piece,
// or outside every piece, stay perfectly flat so no seam is lit. strength is slope per unit of brightness.
export function normalFromColor(rgba, width, height, mask, strength) {
  const h = fineDetail(rgba, width, height, mask);
  const out = new Uint8Array(width * height * 4);
  const scale = strength * Math.max(width, height) / 1024;
  let bumps = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, o = p * 4;
      let nx = 0, ny = 0;
      const inside = x > 0 && y > 0 && x < width - 1 && y < height - 1;
      let whole = inside;
      if (whole && mask) {
        for (let dy = -1; dy <= 1 && whole; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[p + dy * width + dx]) { whole = false; break; }
      }
      if (whole) {
        const a = h[p - width - 1], b = h[p - width], c = h[p - width + 1];
        const d = h[p - 1], e = h[p + 1];
        const f = h[p + width - 1], g = h[p + width], i = h[p + width + 1];
        const dx = (c + 2 * e + i - a - 2 * d - f) / 8;
        const dy = (f + 2 * g + i - a - 2 * b - c) / 8;
        nx = -dx * scale; ny = dy * scale;
        if (Math.abs(nx) < 1e-3) nx = 0; // rounding dust is not relief
        if (Math.abs(ny) < 1e-3) ny = 0;
      }
      const len = Math.hypot(nx, ny, 1);
      out[o] = Math.round((nx / len * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
      if (out[o] !== 128 || out[o + 1] !== 128) bumps++;
    }
  }
  return { rgba: out, bumps: bumps / (width * height) };
}

// A glTF metallic-roughness texture (green is roughness, blue is metallic) from the color texture.
// Grooves and dark grain are a little rougher, bright worn spots a little smoother, around the
// roughness the material already had. Blue is left at full so the material's own metallic value holds.
export function roughnessFromColor(rgba, width, height, base, mask = null, swing = 0.15) {
  const h = fineDetail(rgba, width, height, mask);
  const out = new Uint8Array(width * height * 4);
  for (let p = 0; p < h.length; p++) {
    let r = base - h[p] * 4 * swing;
    r = r < base - swing ? base - swing : r > base + swing ? base + swing : r;
    r = r < 0.04 ? 0.04 : r > 1 ? 1 : r;
    const o = p * 4;
    out[o] = 255; out[o + 1] = Math.round(r * 255); out[o + 2] = 255; out[o + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- one color standard for every asset

// The range a real surface can have. Nothing reflects less than coal or more than fresh snow, and
// no paint is a pure primary. A generator hands back each model with its own blacks, whites and
// vividness, so two models never sit in the same light the same way. Holding every color texture
// to these limits is what lets one set of lights in a game treat every asset alike.
export const STANDARD = {
  floor: 0.02,     // darkest a surface gets: about 2 percent reflectance
  toe: 0.06,       // below this, brightness is eased up toward the floor
  shoulder: 0.6,   // above this, brightness is eased off
  ceiling: 0.82,   // brightest a surface gets
  vivid: 0.75,     // saturation above this is eased off
  vividMax: 0.9    // most vivid a surface gets
};

function percentile(hist, total, share) {
  let run = 0;
  const want = total * share;
  for (let i = 0; i < hist.length; i++) { run += hist[i]; if (run >= want) return (i + 0.5) / hist.length; }
  return 1;
}

// What a color texture's range is, over the pixels the model uses: brightness at the dark end,
// the middle and the bright end (linear, 0 to 1), and how vivid its most vivid colors are (0 to 1).
export function colorStats(rgba, mask) {
  const bins = 2048;
  const luma = new Uint32Array(bins), sat = new Uint32Array(bins);
  let count = 0, colored = 0;
  for (let p = 0, n = rgba.length / 4; p < n; p++) {
    if (mask && !mask[p]) continue;
    const i = p * 4;
    const r = LINEAR[rgba[i]], g = LINEAR[rgba[i + 1]], b = LINEAR[rgba[i + 2]];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[Math.min(bins - 1, Math.floor(l * bins))]++; count++;
    const max = Math.max(r, g, b);
    // vividness is read where there is enough light to see it: in near-black pixels it is only noise
    if (max > 0.15) { sat[Math.min(bins - 1, Math.floor((max - Math.min(r, g, b)) / max * bins))]++; colored++; }
  }
  if (!count) return null;
  return {
    low: percentile(luma, count, 0.02), mid: percentile(luma, count, 0.5), high: percentile(luma, count, 0.98),
    vivid: colored > count * 0.01 ? percentile(sat, colored, 0.98) : 0
  };
}

// True when the texture already sits inside the standard, with a little room for rounding.
export function insideStandard(stats, standard = STANDARD) {
  return stats.low >= standard.floor * 0.8 && stats.high <= standard.ceiling * 1.05 && stats.vivid <= standard.vividMax * 1.03;
}

// Ease every pixel into the standard. The middle of the range is not touched at all, so a model
// that was already right comes back the same. Hue is kept. Returns the new pixels and the share
// of pixels that changed.
export function holdToStandard(rgba, standard = STANDARD) {
  const { floor, toe, shoulder, ceiling, vivid, vividMax } = standard;
  const out = Uint8Array.from(rgba);
  let changed = 0;
  const n = rgba.length / 4;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    let r = LINEAR[rgba[i]], g = LINEAR[rgba[i + 1]], b = LINEAR[rgba[i + 2]];
    let touched = false;
    // brightness first, so a near-black pixel is judged for vividness at the level it ends up at
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let to = l;
    if (l < toe) to = floor + l * (toe - floor) / toe;
    else if (l > shoulder) to = shoulder + (ceiling - shoulder) * (1 - Math.exp(-(l - shoulder) / (ceiling - shoulder)));
    if (to !== l) {
      if (l > 1e-5) { const k = to / l; r *= k; g *= k; b *= k; }
      else { r = to; g = to; b = to; }
      touched = true;
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 0.02) {
      const s = (max - min) / max;
      if (s > vivid) {
        const want = vivid + (vividMax - vivid) * (1 - Math.exp(-(s - vivid) / (vividMax - vivid)));
        const k = want * to / ((max - min) - want * (max - to));
        if (k > 0 && k < 1) { r = to + (r - to) * k; g = to + (g - to) * k; b = to + (b - to) * k; touched = true; }
      }
    }
    if (!touched) continue;
    const R = toSrgb(r), G = toSrgb(g), B = toSrgb(b);
    if (R !== rgba[i] || G !== rgba[i + 1] || B !== rgba[i + 2]) { out[i] = R; out[i + 1] = G; out[i + 2] = B; changed++; }
  }
  return { rgba: out, changed: n ? changed / n : 0 };
}
