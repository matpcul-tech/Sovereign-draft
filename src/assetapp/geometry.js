// Mesh analysis and repair on plain typed arrays. Nothing here knows about glTF.
// Positions are world space, three floats per vertex. Indices are triangles.

// Vertices at the same position get the same id, whatever their UV or normal.
// Open addressing on the quantized position: no strings, so a 500k vertex mesh stays fast on a phone.
export function weldIds(pos, eps) {
  const n = pos.length / 3;
  const ids = new Uint32Array(n);
  if (!n) return { ids, unique: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
  }
  const inv = 1 / Math.max(eps, 1e-12);
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    qx[i] = Math.round((pos[i * 3] - minX) * inv);
    qy[i] = Math.round((pos[i * 3 + 1] - minY) * inv);
    qz[i] = Math.round((pos[i * 3 + 2] - minZ) * inv);
  }
  let cap = 16;
  while (cap < n * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const mask = cap - 1;
  let unique = 0;
  for (let i = 0; i < n; i++) {
    let h = (Math.imul(qx[i], 73856093) ^ Math.imul(qy[i], 19349663) ^ Math.imul(qz[i], 83492791)) & mask;
    for (;;) {
      const j = table[h];
      if (j < 0) { table[h] = i; ids[i] = unique++; break; }
      if (qx[j] === qx[i] && qy[j] === qy[i] && qz[j] === qz[i]) { ids[i] = ids[j]; break; }
      h = (h + 1) & mask;
    }
  }
  return { ids, unique };
}

export function boundsOf(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function diagOf(box) {
  if (!isFinite(box.min[0])) return 0;
  return Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
}

// One pass over a triangle list. Reports what is wrong and how the mesh falls into connected pieces.
//   degenerate[t]  the triangle has no area
//   duplicate[t]   the same three points were already a triangle
//   island[t]      which connected piece the triangle is in, or -1 when it is degenerate or a repeat
// floorScale raises the no-area threshold. Cleanup uses 10 so a sliver that sits right on the line
// is removed, and cannot drift back under it when the file is written and measured again.
export function analyze(pos, indices, diag, floorScale = 1) {
  const tris = indices.length / 3;
  const scale = diag > 0 ? diag : 1;
  const { ids, unique } = weldIds(pos, scale * 1e-6);
  const degenerate = new Uint8Array(tris), duplicate = new Uint8Array(tris);
  const island = new Int32Array(tris).fill(-1);
  const parent = new Uint32Array(unique);
  for (let i = 0; i < unique; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const areaFloor = scale * scale * 1e-12 * floorScale;

  let cap = 16;
  while (cap < tris * 2) cap <<= 1;
  const seen = new Int32Array(cap).fill(-1), mask = cap - 1;
  const ta = new Uint32Array(tris), tb = new Uint32Array(tris), tc = new Uint32Array(tris);
  let nDegenerate = 0, nDuplicate = 0;
  for (let t = 0; t < tris; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    let a = ids[i0], b = ids[i1], c = ids[i2];
    if (a === b || b === c || a === c || !(triArea(pos, i0, i1, i2) > areaFloor)) { degenerate[t] = 1; nDegenerate++; continue; }
    if (a > b) { const s = a; a = b; b = s; }
    if (b > c) { const s = b; b = c; c = s; }
    if (a > b) { const s = a; a = b; b = s; }
    ta[t] = a; tb[t] = b; tc[t] = c;
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
    for (;;) {
      const j = seen[h];
      if (j < 0) { seen[h] = t; break; }
      if (ta[j] === a && tb[j] === b && tc[j] === c) { duplicate[t] = 1; nDuplicate++; break; }
      h = (h + 1) & mask;
    }
    if (duplicate[t]) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
    const rc = find(c), rb2 = find(b);
    if (rc !== rb2) parent[rc] = rb2;
  }

  // dense island numbers, then size, area, volume and edge counts for each
  const dense = new Int32Array(unique).fill(-1);
  const islands = [];
  const edges = new Map();
  const center = boundsCenter(pos);
  for (let t = 0; t < tris; t++) {
    if (degenerate[t] || duplicate[t]) continue;
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const root = find(ids[i0]);
    let k = dense[root];
    if (k < 0) {
      k = dense[root] = islands.length;
      islands.push({ tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], area: 0, volume: 0, edges: 0, open: 0, nonManifold: 0 });
    }
    island[t] = k;
    const isl = islands[k];
    isl.tris++;
    isl.area += triArea(pos, i0, i1, i2);
    isl.volume += signedVolume(pos, i0, i1, i2, center);
    for (const i of [i0, i1, i2]) {
      for (let d = 0; d < 3; d++) {
        const v = pos[i * 3 + d];
        if (v < isl.min[d]) isl.min[d] = v;
        if (v > isl.max[d]) isl.max[d] = v;
      }
    }
    countEdge(edges, ids[i0], ids[i1], unique);
    countEdge(edges, ids[i1], ids[i2], unique);
    countEdge(edges, ids[i2], ids[i0], unique);
  }
  let openEdges = 0, nonManifold = 0;
  for (const [key, count] of edges) {
    const isl = islands[dense[find(key % unique)]];
    isl.edges++;
    if (count === 1) { isl.open++; openEdges++; }
    else if (count > 2) { isl.nonManifold++; nonManifold++; }
  }
  return { tris, ids, unique, degenerate, duplicate, island, islands, edges, nDegenerate, nDuplicate, openEdges, nonManifold };
}

function edgeKey(a, b, unique) {
  return a < b ? a * unique + b : b * unique + a;
}

function countEdge(edges, a, b, unique) {
  const key = a < b ? a * unique + b : b * unique + a;
  edges.set(key, (edges.get(key) || 0) + 1);
}

function boundsCenter(pos) {
  const box = boundsOf(pos);
  if (!isFinite(box.min[0])) return [0, 0, 0];
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function triArea(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function signedVolume(pos, a, b, c, o) {
  const ax = pos[a * 3] - o[0], ay = pos[a * 3 + 1] - o[1], az = pos[a * 3 + 2] - o[2];
  const bx = pos[b * 3] - o[0], by = pos[b * 3 + 1] - o[1], bz = pos[b * 3 + 2] - o[2];
  const cx = pos[c * 3] - o[0], cy = pos[c * 3 + 1] - o[1], cz = pos[c * 3 + 2] - o[2];
  return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
}

// A closed (or very nearly closed) piece whose volume comes out negative has its faces pointing inward.
// A piece that sits wholly inside a larger closed piece is left alone: that is how a hollow is modeled.
export function invertedIslands(analysis) {
  const out = [];
  const list = analysis.islands;
  for (let k = 0; k < list.length; k++) {
    const isl = list[k];
    if (isl.tris < 4 || isl.open > isl.edges * 0.02) continue;
    const box = (isl.max[0] - isl.min[0]) * (isl.max[1] - isl.min[1]) * (isl.max[2] - isl.min[2]);
    if (!(isl.volume < -Math.max(box * 1e-4, 1e-18))) continue;
    let hollow = false;
    for (let j = 0; j < list.length && !hollow; j++) {
      const outer = list[j];
      if (j === k || outer.volume <= 0 || outer.open > outer.edges * 0.02) continue;
      hollow = [0, 1, 2].every((d) => outer.min[d] < isl.min[d] && outer.max[d] > isl.max[d]);
    }
    if (!hollow) out.push(k);
  }
  return out;
}

// Small pieces that touch nothing. AI generators leave these floating near the model or buried inside it.
// groups: [{ pos, indices, analysis }] for every surface of the model, all in world space.
// A piece is debris when it is small, and no part of it is near any piece that is not small.
// If the debris would add up to a real share of the model, nothing is flagged: that many loose pieces
// are more likely leaves, hair cards or particles than junk.
export function findDebris(groups, diag, opts = {}) {
  const smallFrac = opts.smallFrac ?? 0.04, gapFrac = opts.gapFrac ?? 0.012;
  const maxAreaShare = opts.maxAreaShare ?? 0.02, maxTriShare = opts.maxTriShare ?? 0.05;
  const flagged = groups.map(() => new Set());
  const empty = { flagged, pieces: 0, triangles: 0, held: 0 };
  if (!(diag > 0)) return empty;
  let totalArea = 0, totalTris = 0;
  for (const g of groups) for (const isl of g.analysis.islands) { totalArea += isl.area; totalTris += isl.tris; }
  if (!totalTris) return empty;
  const isSmall = (isl) => diagOf(isl) < smallFrac * diag && isl.area < totalArea * 0.005;
  let anyBig = false, anySmall = false;
  for (const g of groups) for (const isl of g.analysis.islands) { if (isSmall(isl)) anySmall = true; else anyBig = true; }
  if (!anyBig || !anySmall) return empty;

  // every cell that holds part of a piece that is not small
  const gap = gapFrac * diag;
  let lo = [Infinity, Infinity, Infinity];
  for (const g of groups) { const b = boundsOf(g.pos); for (let d = 0; d < 3; d++) lo[d] = Math.min(lo[d], b.min[d]); }
  lo = lo.map((v) => v - gap * 2);
  const cell = (x, y, z) => Math.floor((x - lo[0]) / gap) + Math.floor((y - lo[1]) / gap) * 4096 + Math.floor((z - lo[2]) / gap) * 16777216;
  const full = new Set();
  for (const g of groups) {
    const { pos, indices, analysis } = g;
    for (let t = 0; t < analysis.tris; t++) {
      const k = analysis.island[t];
      if (k < 0 || isSmall(analysis.islands[k])) continue;
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
      const longest = Math.max(dist(pos, a, b), dist(pos, b, c), dist(pos, c, a));
      const n = Math.min(64, Math.max(1, Math.ceil(longest / gap)));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          full.add(cell(pos[a] * u + pos[b] * v + pos[c] * w, pos[a + 1] * u + pos[b + 1] * v + pos[c + 1] * w, pos[a + 2] * u + pos[b + 2] * v + pos[c + 2] * w));
        }
      }
    }
  }
  const near = (x, y, z) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (full.has(cell(x + dx * gap, y + dy * gap, z + dz * gap))) return true;
    }
    return false;
  };
  let pieces = 0, triangles = 0, area = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const { pos, indices, analysis } = groups[gi];
    const touches = new Uint8Array(analysis.islands.length);
    for (let t = 0; t < analysis.tris; t++) {
      const k = analysis.island[t];
      if (k < 0 || touches[k] || !isSmall(analysis.islands[k])) continue;
      for (let e = 0; e < 3 && !touches[k]; e++) {
        const i = indices[t * 3 + e] * 3;
        if (near(pos[i], pos[i + 1], pos[i + 2])) touches[k] = 1;
      }
    }
    analysis.islands.forEach((isl, k) => {
      if (!isSmall(isl) || touches[k]) return;
      flagged[gi].add(k); pieces++; triangles += isl.tris; area += isl.area;
    });
  }
  if (area > totalArea * maxAreaShare || triangles > totalTris * maxTriShare) {
    return { flagged: groups.map(() => new Set()), pieces: 0, triangles: 0, held: pieces };
  }
  return { flagged, pieces, triangles, held: 0 };
}

function dist(pos, a, b) {
  return Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
}

// Holes: closed loops of edges that have a triangle on one side only.
// Returns new triangles (vertex indices) that cap each loop the caller accepts, using only vertices
// that are already on the loop, so no UV or normal has to be invented.
// A loop is left open when it forks, when it is not a simple polygon in its own plane, or when
// it is more than about a third of the surface it sits in.
// mode "small": loops under holeFrac of the model size. mode "all": every simple loop up to maxEdges.
export function capHoles(pos, indices, analysis, diag, opts = {}) {
  const mode = opts.mode || "small";
  const holeFrac = opts.holeFrac ?? 0.03;
  const maxEdges = opts.maxEdges ?? (mode === "all" ? 400 : 64);
  const { ids, unique, edges } = analysis;
  // directed boundary half edges, as their triangle walks them
  const next = new Map();
  const forked = new Set();
  for (let t = 0; t < analysis.tris; t++) {
    if (analysis.island[t] < 0) continue;
    for (let e = 0; e < 3; e++) {
      const va = indices[t * 3 + e], vb = indices[t * 3 + (e + 1) % 3];
      const a = ids[va], b = ids[vb];
      const key = a < b ? a * unique + b : b * unique + a;
      if (edges.get(key) !== 1) continue;
      if (next.has(a)) forked.add(a);
      else next.set(a, { to: b, va, vb, island: analysis.island[t] });
    }
  }
  const added = [];
  let filled = 0, left = 0;
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let at = start, ok = true;
    for (;;) {
      if (forked.has(at) || !next.has(at)) { ok = false; break; }
      if (used.has(at)) { ok = at === start && loop.length >= 3; break; }
      used.add(at);
      loop.push(next.get(at).va);
      at = next.get(at).to;
      if (loop.length > 100000) { ok = false; break; }
    }
    if (!ok) { if (loop.length) left++; continue; }
    if (loop.length > maxEdges) { left++; continue; }
    if (mode === "small") {
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const v of loop) for (let d = 0; d < 3; d++) { box.min[d] = Math.min(box.min[d], pos[v * 3 + d]); box.max[d] = Math.max(box.max[d], pos[v * 3 + d]); }
      if (diagOf(box) > holeFrac * diag) { left++; continue; }
    }
    // the cap walks the loop the other way round, so each shared edge runs opposite to its neighbor
    const cap = earClip(pos, loop.slice().reverse());
    if (!cap) { left++; continue; }
    // An opening as large as the surface around it is not a hole. Capping a flat sheet or a lone
    // triangle would only lay a second copy on its back.
    let capArea = 0;
    for (let i = 0; i < cap.length; i += 3) capArea += triArea(pos, cap[i], cap[i + 1], cap[i + 2]);
    const home = analysis.islands[next.get(start).island];
    if (!home || capArea > home.area * 0.35) { left++; continue; }
    // The cap may only add edges the mesh does not have yet. An inner cap edge that already exists
    // would end up shared by three faces, and a sliver adds nothing but a new defect.
    const onLoop = new Set();
    for (let i = 0; i < loop.length; i++) onLoop.add(edgeKey(ids[loop[i]], ids[loop[(i + 1) % loop.length]], unique));
    const floor = (diag > 0 ? diag * diag : 1) * 1e-10;
    let clean = true;
    for (let i = 0; i < cap.length && clean; i += 3) {
      if (!(triArea(pos, cap[i], cap[i + 1], cap[i + 2]) > floor)) clean = false;
      for (let e = 0; e < 3 && clean; e++) {
        const key = edgeKey(ids[cap[i + e]], ids[cap[i + (e + 1) % 3]], unique);
        if (!onLoop.has(key) && edges.has(key)) clean = false;
      }
    }
    if (!clean) { left++; continue; }
    added.push(...cap);
    filled++;
  }
  return { triangles: added, filled, left };
}

// Ear clipping in the loop's own plane. Returns null when the loop is not a simple polygon there.
function earClip(pos, poly) {
  const n = poly.length;
  if (n < 3) return null;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i] * 3, b = poly[(i + 1) % n] * 3;
    nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return null;
  nx /= len; ny /= len; nz /= len;
  // a basis in the plane
  let ux, uy, uz;
  if (Math.abs(nx) < 0.9) { ux = 0; uy = -nz; uz = ny; } else { ux = nz; uy = 0; uz = -nx; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = poly[i] * 3;
    px[i] = pos[a] * ux + pos[a + 1] * uy + pos[a + 2] * uz;
    py[i] = pos[a] * vx + pos[a + 1] * vy + pos[a + 2] * vz;
  }
  const cross = (a, b, c) => (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
  const live = [];
  for (let i = 0; i < n; i++) live.push(i);
  const out = [];
  let guard = n * n + 8;
  while (live.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < live.length; i++) {
      const a = live[(i + live.length - 1) % live.length], b = live[i], c = live[(i + 1) % live.length];
      if (cross(a, b, c) <= 0) continue;
      let blocked = false;
      for (const p of live) {
        if (p === a || p === b || p === c) continue;
        if (cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0) { blocked = true; break; }
      }
      if (blocked) continue;
      out.push(poly[a], poly[b], poly[c]);
      live.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (live.length !== 3 || cross(live[0], live[1], live[2]) <= 0) return null;
  out.push(poly[live[0]], poly[live[1]], poly[live[2]]);
  return out;
}

// Area weighted vertex normals. Vertices that were split (a seam or a hard edge) stay split.
export function computeNormals(pos, indices) {
  const out = new Float32Array(pos.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { out[i] += x; out[i + 1] += y; out[i + 2] += z; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (len > 0) { out[i] /= len; out[i + 1] /= len; out[i + 2] /= len; } else { out[i] = 0; out[i + 1] = 1; out[i + 2] = 0; }
  }
  return out;
}

// How many triangles carry normals that point away from the side the triangle faces.
// Pass a list to collect which ones.
export function wrongNormals(pos, normals, indices, list) {
  let bad = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const sx = normals[a] + normals[b] + normals[c], sy = normals[a + 1] + normals[b + 1] + normals[c + 1], sz = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (x * sx + y * sy + z * sz < 0) { bad++; if (list) list.push(t / 3); }
  }
  return bad;
}

// Area average downsample of an RGBA image. Color is weighted by alpha so clear pixels do not bleed in.
export function resizeRgba(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sh / dh), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sw / dw), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sw / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      else { const i = (y0 * sw + x0) * 4; out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; }
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}
