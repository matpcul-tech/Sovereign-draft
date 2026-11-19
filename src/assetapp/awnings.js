// Shop awnings. A generator paints an awning's stripes the way it paints everything: roughly
// right from far off, wandering and torn up close. Stripes are the one pattern where that shows
// at any distance, because the eye knows they should be straight and even.
//
// So an awning is found by its shape (a flat sloping panel that hangs off a wall, below the
// roofline) and by its paint (two or three strong, different colors), and its stripes are drawn
// again: straight, even, in the awning's own colors, running down the slope.
import { findFlats } from "./geometry.js";

const DEFAULTS = {
  minUp: 0.3, maxUp: 0.93, // how far the panel leans: neither a wall nor a flat slab
  minArea: 0.006,          // share of the diagonal squared
  low: 0.15, high: 0.85,   // it sits between these shares of the building's height
  pad: 0.012,              // how far round the panel its valance and sides are gathered (share of diagonal)
  drop: 0.05,              // and how far below its lower edge (the valance)
};

// The sloping panels that could be awnings. Each: { tris (the whole awning: top, underside, valance,
// sides), top (the top face only, for reading its paint), along [x, z] (the direction across its
// width), out [x, z] (the direction it reaches from the wall), a0, a1 (its width range along `along`) }.
export function findAwnings(pos, indices, diag, floor, tall, options) {
  const o = { ...DEFAULTS, ...options };
  const flats = findFlats(pos, indices, diag, { minShare: 0.0003 });
  const triCount = indices.length / 3, out = [], used = new Uint8Array(triCount);
  const tops = flats.regions.filter((r) => r.normal[1] >= o.minUp && r.normal[1] <= o.maxUp && r.area >= o.minArea * diag * diag).sort((p, q) => q.area - p.area);
  for (const region of tops) {
    if (region.tris.some((t) => used[t])) continue;
    const n = region.normal, flat = Math.hypot(n[0], n[2]);
    if (flat < 1e-6) continue;
    const reach = [n[0] / flat, n[2] / flat], along = [reach[1], -reach[0]];
    let a0 = Infinity, a1 = -Infinity, d0 = Infinity, d1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of region.tris) for (let e = 0; e < 3; e++) {
      const v = indices[t * 3 + e] * 3, a = pos[v] * along[0] + pos[v + 2] * along[1], d = pos[v] * reach[0] + pos[v + 2] * reach[1], y = pos[v + 1];
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (d < d0) d0 = d; if (d > d1) d1 = d; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    // below the roofline and off the ground, wider than it is deep, and it does reach out
    if (y0 - floor < o.low * tall || y1 - floor > o.high * tall) continue;
    if (a1 - a0 < 1.5 * (d1 - d0) || d1 - d0 < 0.01 * diag) continue;
    // everything inside its outline that is not the wall behind it: underside, valance, sides
    const pad = o.pad * diag, tris = [];
    for (let t = 0; t < triCount; t++) {
      if (used[t]) continue;
      let inside = true, onWall = true;
      for (let e = 0; e < 3 && inside; e++) {
        const v = indices[t * 3 + e] * 3, a = pos[v] * along[0] + pos[v + 2] * along[1], d = pos[v] * reach[0] + pos[v + 2] * reach[1], y = pos[v + 1];
        if (a < a0 - pad || a > a1 + pad || d < d0 - pad || d > d1 + pad || y < y0 - o.drop * diag || y > y1 + 0.2 * pad) inside = false;
        if (d > d0 + 0.5 * pad) onWall = false;
      }
      if (inside && !onWall) tris.push(t);
    }
    for (const t of tris) used[t] = 1;
    out.push({ tris, top: Array.from(region.tris), along, out: reach, a0, a1 });
  }
  return out;
}

const lumaOf = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const satOf = (c) => { const max = Math.max(c[0], c[1], c[2]); return max > 0 ? (max - Math.min(c[0], c[1], c[2])) / max : 0; };
// How unlike two colors are. Color counts in full and brightness by half: navy and dark red are
// about as dark as each other and nothing alike.
const apart = (p, q) => 0.5 * Math.abs(lumaOf(p) - lumaOf(q)) + Math.abs((p[0] - p[1]) - (q[0] - q[1])) + Math.abs((p[2] - p[1]) - (q[2] - q[1]));

// The colors an awning is striped in, from samples of its paint ([r, g, b] 0..255 each).
// Returns the stripes of one repeat, in order, or null when the paint is not stripes: one color
// only, or nothing strong enough to be cloth (a porch roof of shingles is brown on brown).
export function stripeColors(samples) {
  if (samples.length < 12) return null;
  // Four groups, each started as far as possible from the ones before: the lightest sample, then
  // the sample furthest from it, and so on. Two dark colors (navy and dark red) are near each other
  // in brightness and far apart in color, and this keeps them apart.
  const pick = samples.length > 800 ? samples.filter((c, i) => i % Math.ceil(samples.length / 800) === 0) : samples;
  let first = pick[0];
  for (const c of pick) if (lumaOf(c) > lumaOf(first)) first = c;
  let means = [first.slice()];
  while (means.length < 4) {
    let far = null, reach = -1;
    for (const c of pick) { let near = Infinity; for (const m of means) near = Math.min(near, apart(c, m)); if (near > reach) { reach = near; far = c; } }
    means.push(far.slice());
  }
  let share = means.map(() => 0);
  for (let pass = 0; pass < 10; pass++) {
    const sum = means.map(() => [0, 0, 0]), n = means.map(() => 0);
    for (const c of pick) {
      let best = 0;
      for (let k = 1; k < means.length; k++) if (apart(c, means[k]) < apart(c, means[best])) best = k;
      sum[best][0] += c[0]; sum[best][1] += c[1]; sum[best][2] += c[2]; n[best]++;
    }
    means = means.map((m, k) => (n[k] ? [sum[k][0] / n[k], sum[k][1] / n[k], sum[k][2] / n[k]] : m));
    share = n.map((v) => v / pick.length);
  }
  // groups that are the same color are one
  let groups = means.map((color, k) => ({ color, share: share[k] })).filter((g) => g.share > 0);
  for (let i = 0; i < groups.length; i++) for (let j = groups.length - 1; j > i; j--) {
    if (apart(groups[i].color, groups[j].color) >= 45) continue;
    const a = groups[i], b = groups[j], total = a.share + b.share;
    a.color = a.color.map((v, c) => (v * a.share + b.color[c] * b.share) / total); a.share = total;
    groups.splice(j, 1);
  }
  // a group that lies between two others is where two stripes smeared together, not a stripe of its own
  groups = groups.filter((g) => !groups.some((a) => a !== g && groups.some((b) => b !== g && b !== a && [0.25, 0.5, 0.75].some((t) => apart(g.color, a.color.map((v, c) => v + t * (b.color[c] - v))) < 30))));
  // and a sliver of another color is a smear too
  const whole = groups.reduce((sum, g) => sum + g.share, 0) || 1;
  groups = groups.filter((g) => g.share / whole >= 0.1).sort((p, q) => q.share - p.share).slice(0, 3);
  if (groups.length < 2) return null;
  if (!groups.some((g) => satOf(g.color) >= 0.4 && Math.max(...g.color) >= 70)) return null; // no strong color: not cloth stripes
  const clean = groups.map((g) => g.color.map((v) => Math.round(v)));
  // with a white (or pale) among three, it goes between the other two: red, white, blue, white
  if (clean.length === 3) {
    const pale = clean.reduce((best, c) => (lumaOf(c) > lumaOf(best) ? c : best));
    if (satOf(pale) < 0.3) { const rest = clean.filter((c) => c !== pale); return [rest[0], pale, rest[1], pale]; }
  }
  return clean;
}

// How many stripes fit a width, as a whole number of repeats plus one stripe, so both ends match.
export function stripeCount(width, stripeWidth, repeat) {
  const repeats = Math.max(1, Math.round((width / stripeWidth - 1) / repeat));
  return repeats * repeat + 1;
}
