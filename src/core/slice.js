/* Slice a solid with a horizontal plane and get drawing geometry back.
 *
 * This is the loop that makes 3D modelling useful to a 2D drawing set:
 * model the massing once, then cut z = 4 for the floor plan and z = 40 for
 * the roof plan, and the sections land in the drawing as closed polylines
 * ready to dimension and hatch. Without it the 3D model is a separate
 * artefact that drifts from the sheets.
 *
 * The method is exact for a triangle mesh: every triangle crossing the
 * plane contributes one segment, and chaining shared endpoints closes the
 * rings. Ring nesting then says which are voids, using the same containment
 * rule the hatch islands use.
 */
import { polyArea } from './geometry.js';

const EPS = 1e-9;

/* Segments where the mesh crosses z = h. */
export function sliceSegments(mesh, h){
  const segs = [];
  for (const f of mesh.faces){
    const a = mesh.verts[f[0]], b = mesh.verts[f[1]], c = mesh.verts[f[2]];
    if (!a || !b || !c) continue;
    const pts = [];
    /* Symbolic perturbation: a vertex exactly in the plane is treated as
     * infinitesimally above it. A plane through a ring of vertices, which a
     * sphere sliced at its equator hits exactly, otherwise produces two
     * coincident rings and a doubled section. */
    const side = v => { const d = v[2] - h; return Math.abs(d) < EPS ? EPS : d; };
    const edges = [[a, b], [b, c], [c, a]];
    for (const [p, q] of edges){
      const dp = side(p), dq = side(q);
      if ((dp > 0) === (dq > 0)) continue;
      const t = dp / (dp - dq);
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    if (pts.length === 2){
      if (Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) > EPS) segs.push(pts);
    }
  }
  return segs;
}

const KEY_TOL = 1e-6;
function key(p){ return Math.round(p[0] / KEY_TOL) + ',' + Math.round(p[1] / KEY_TOL); }

/* Chain loose segments into closed rings. Open chains are returned too,
 * because a mesh with a crack still deserves its almost-section rather than
 * silence. */
export function chainSegments(segs){
  const byStart = new Map();
  const add = (k, i) => { if (byStart.has(k)) byStart.get(k).push(i); else byStart.set(k, [i]); };
  segs.forEach((s, i) => { add(key(s[0]), i * 2); add(key(s[1]), i * 2 + 1); });
  const used = new Array(segs.length).fill(false);
  const rings = [];
  const open = [];

  for (let s = 0; s < segs.length; s++){
    if (used[s]) continue;
    used[s] = true;
    const chain = [segs[s][0], segs[s][1]];
    let guard = 0;
    for (;;){
      if (guard++ > segs.length * 2 + 4) break;
      const endK = key(chain[chain.length - 1]);
      const cands = (byStart.get(endK) || []).filter(h2 => !used[h2 >> 1]);
      if (!cands.length) break;
      const h2 = cands[0];
      const idx = h2 >> 1;
      used[idx] = true;
      const nxt = (h2 & 1) === 0 ? segs[idx][1] : segs[idx][0];
      chain.push(nxt);
      if (key(nxt) === key(chain[0])) break;
    }
    if (chain.length > 2 && key(chain[0]) === key(chain[chain.length - 1])){
      chain.pop();
      /* Collapse duplicate consecutive points the tolerance produced. */
      const clean = [chain[0]];
      for (let i = 1; i < chain.length; i++){
        if (key(chain[i]) !== key(clean[clean.length - 1])) clean.push(chain[i]);
      }
      if (clean.length >= 3 && Math.abs(polyArea(clean)) > 1e-9) rings.push(clean);
    } else if (chain.length > 1){
      open.push(chain);
    }
  }
  return { rings, open };
}

/* The plan section of a mesh at height h: closed rings, outers and voids
 * decided by nesting. */
export function sliceMesh(mesh, h){
  const { rings, open } = chainSegments(sliceSegments(mesh, h));
  return { rings, open };
}

/* Net cut area at the plane, voids subtracted by nesting parity. */
export function sliceArea(mesh, h){
  const { rings } = sliceMesh(mesh, h);
  let area = 0;
  rings.forEach((r, i) => {
    let depth = 0;
    for (let j = 0; j < rings.length; j++){
      if (i === j) continue;
      if (contains(rings[j], r)) depth++;
    }
    area += (depth % 2 === 0 ? 1 : -1) * Math.abs(polyArea(r));
  });
  return Math.max(0, area);
}

/* ---------- cuts along any axis ----------
 * A vertical section reuses the horizontal engine by mapping the wanted
 * plane onto z = h and mapping the results back. The section's own plane
 * coordinates are what land in the drawing: for a cut at y = c looking
 * north, that is (x, height); for x = c looking east, (y, height).
 */
function remapped(mesh, axis){
  if (axis === 'z') return mesh;
  const verts = mesh.verts.map(axis === 'y'
    ? v => [v[0], v[2], v[1]]      /* cut plane y=c -> z=c; section reads (x, z) */
    : v => [v[1], v[2], v[0]]);    /* cut plane x=c -> z=c; section reads (y, z) */
  return { verts, faces: mesh.faces };
}

export function sliceMeshAxis(mesh, axis, at){
  const a = axis === 'x' || axis === 'y' ? axis : 'z';
  return sliceMesh(remapped(mesh, a), Number(at) || 0);
}

export function sliceAreaAxis(mesh, axis, at){
  const a = axis === 'x' || axis === 'y' ? axis : 'z';
  return sliceArea(remapped(mesh, a), Number(at) || 0);
}

/* ---------- the elevation silhouette ----------
 * An elevation is the outline of everything the mesh occupies seen from one
 * side: the union of every triangle's projection onto the view plane. The
 * union runs through the 2D boolean engine in batches, so the accumulator
 * stays small. No hidden line removal: this is the massing outline with its
 * interior voids, which is the drawing an elevation starts from.
 */
export function silhouette(mesh, dir, boolean){
  const proj = dir === 'x'
    ? v => [v[1], v[2]]            /* looking along x: (y, height) */
    : dir === 'y'
      ? v => [v[0], v[2]]          /* looking along y: (x, height) */
      : v => [v[0], v[1]];         /* looking down: the plan shadow */
  const tris = [];
  for (const f of mesh.faces){
    const a = proj(mesh.verts[f[0]]), b = proj(mesh.verts[f[1]]), c = proj(mesh.verts[f[2]]);
    const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area2) < 1e-9) continue;              /* edge-on to the view */
    tris.push([a, b, c]);
  }
  /* Batched union: fold triangles in, merging pairwise up a tree so no
   * single boolean sees hundreds of rings. */
  let level = tris.map(t => [t]);
  while (level.length > 1){
    const next = [];
    for (let i = 0; i < level.length; i += 2){
      if (i + 1 >= level.length){ next.push(level[i]); break; }
      next.push(boolean(level[i], level[i + 1], 'union'));
    }
    level = next;
  }
  return level[0] || [];
}

/* ---------- depth along a view ray ----------
 * The first surface the view ray meets at elevation-plane point (u, v):
 * the smallest signed depth over every triangle whose projection covers the
 * point. For a view along y, (u, v) is (x, height) and depth is sign * y;
 * along x it is (y, height) and sign * x. Faces edge-on to the view project
 * to nothing and occlude nothing, so they are skipped. Infinity means the
 * ray hits open air.
 */
/* The accelerated form of depthAt: build once, query many. Triangles are
 * bucketed into a uniform grid over their projected bounding boxes, so a
 * query tests only the handful of candidates in its cell instead of every
 * face. The arithmetic per candidate is identical to depthAt, and bbox
 * pruning can never drop a triangle that contains the query point, so the
 * probe returns exactly what the linear scan returns. The hidden line
 * pass over a campus of buildings was quadratic without this. */
export function makeDepthProbe(mesh, axis, sign){
  const proj = axis === 'y' ? p => [p[0], p[2]] : axis === 'x' ? p => [p[1], p[2]] : p => [p[0], p[1]];
  const dep = axis === 'y' ? p => sign * p[1] : axis === 'x' ? p => sign * p[0] : p => sign * p[2];
  const tris = [];
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const f of mesh.faces){
    const A = mesh.verts[f[0]], B = mesh.verts[f[1]], C = mesh.verts[f[2]];
    if (!A || !B || !C) continue;
    const a = proj(A), b = proj(B), c = proj(C);
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-9) continue;
    const t = {
      a, b, c, det, da: dep(A), db: dep(B), dc: dep(C),
      bx0: Math.min(a[0], b[0], c[0]), by0: Math.min(a[1], b[1], c[1]),
      bx1: Math.max(a[0], b[0], c[0]), by1: Math.max(a[1], b[1], c[1])
    };
    tris.push(t);
    u0 = Math.min(u0, t.bx0); v0 = Math.min(v0, t.by0);
    u1 = Math.max(u1, t.bx1); v1 = Math.max(v1, t.by1);
  }
  if (!tris.length) return () => Infinity;
  const N = Math.max(1, Math.min(64, Math.round(Math.sqrt(tris.length / 2)) || 1));
  const cw = (u1 - u0) / N || 1, ch = (v1 - v0) / N || 1;
  const cells = Array.from({ length: N * N }, () => []);
  const ci = (x, lo, s) => Math.max(0, Math.min(N - 1, Math.floor((x - lo) / s)));
  for (const t of tris){
    const i0 = ci(t.bx0, u0, cw), i1 = ci(t.bx1, u0, cw);
    const j0 = ci(t.by0, v0, ch), j1 = ci(t.by1, v0, ch);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * N + i].push(t);
  }
  return (u, v) => {
    if (u < u0 - 1e-9 || u > u1 + 1e-9 || v < v0 - 1e-9 || v > v1 + 1e-9) return Infinity;
    let best = Infinity;
    for (const t of cells[ci(v, v0, ch) * N + ci(u, u0, cw)]){
      if (u < t.bx0 - 1e-9 || u > t.bx1 + 1e-9 || v < t.by0 - 1e-9 || v > t.by1 + 1e-9) continue;
      const l1 = ((t.b[0] - u) * (t.c[1] - v) - (t.c[0] - u) * (t.b[1] - v)) / t.det;
      const l2 = ((t.c[0] - u) * (t.a[1] - v) - (t.a[0] - u) * (t.c[1] - v)) / t.det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const d = l1 * t.da + l2 * t.db + l3 * t.dc;
      if (d < best) best = d;
    }
    return best;
  };
}

export function depthAt(mesh, axis, sign, u, v){
  const proj = axis === 'y' ? p => [p[0], p[2]] : axis === 'x' ? p => [p[1], p[2]] : p => [p[0], p[1]];
  const dep = axis === 'y' ? p => sign * p[1] : axis === 'x' ? p => sign * p[0] : p => sign * p[2];
  let best = Infinity;
  for (const f of mesh.faces){
    const A = mesh.verts[f[0]], B = mesh.verts[f[1]], C = mesh.verts[f[2]];
    if (!A || !B || !C) continue;
    const a = proj(A), b = proj(B), c = proj(C);
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((b[0] - u) * (c[1] - v) - (c[0] - u) * (b[1] - v)) / det;
    const l2 = ((c[0] - u) * (a[1] - v) - (a[0] - u) * (c[1] - v)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const d = l1 * dep(A) + l2 * dep(B) + l3 * dep(C);
    if (d < best) best = d;
  }
  return best;
}

/* ---------- clipping to a half-space ----------
 * Keep the part of a mesh past a plane, for the beyond-the-cut half of a
 * section. Each triangle is clipped Sutherland-Hodgman style into a
 * triangle or quad and fanned. The cut is left uncapped on purpose: the
 * section's own poche is the cap, and an uncapped rim means the rim edges
 * arrive as boundary edges that coincide with the cut rings and get
 * filtered rather than drawn twice.
 */
export function clipMeshBeyond(mesh, axis, at){
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const verts = [];
  const faces = [];
  for (const f of mesh.faces){
    const tri = [mesh.verts[f[0]], mesh.verts[f[1]], mesh.verts[f[2]]];
    if (tri.some(v => !v)) continue;
    const out = [];
    for (let i = 0; i < 3; i++){
      const P = tri[i], Q = tri[(i + 1) % 3];
      const dp = P[ai] - at, dq = Q[ai] - at;
      if (dp >= -1e-9) out.push(P);
      if ((dp > 1e-9 && dq < -1e-9) || (dp < -1e-9 && dq > 1e-9)){
        const t = dp / (dp - dq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t]);
      }
    }
    if (out.length < 3) continue;
    const base = verts.length;
    out.forEach(p => verts.push([p[0], p[1], p[2]]));
    for (let i = 2; i < out.length; i++) faces.push([base, base + i - 1, base + i]);
  }
  return { verts, faces };
}

/* ---------- visible feature edges ----------
 * The full hidden line pass for one orthographic elevation. An edge is
 * worth drawing when it is a boundary edge, a silhouette edge (one face
 * toward the viewer, one away) or a crease (the faces bend more than about
 * twenty degrees, which is every parapet, roof step and corner and no
 * triangulation diagonal). Each feature edge is then depth-tested along its
 * length against the whole mesh, and only the visible runs survive, with
 * the transitions refined by bisection so a line stops exactly where the
 * occluder starts.
 *
 * Probes are nudged slightly to both sides of the edge in projection and
 * the edge counts as visible where either side sees it: an edge on the rim
 * of a face would otherwise be judged hidden by its own face, and a
 * re-entrant corner by the wall that meets it. The depth comparison uses a
 * fifth-of-an-inch tolerance, so coplanar faces never hide each other and
 * gentle slopes survive the nudge.
 */
const EDGE_CREASE_DOT = 0.94;
const EDGE_DEPTH_TOL = 0.02;
const EDGE_STEP = 0.5;
const EDGE_NUDGE = 0.002;

function faceNormal(A, B, C){
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
  const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz);
  return L > 1e-12 ? [nx / L, ny / L, nz / L] : null;
}

export function visibleMeshEdges(mesh, axis, sign){
  const proj = axis === 'y' ? p => [p[0], p[2]] : axis === 'x' ? p => [p[1], p[2]] : p => [p[0], p[1]];
  const dep = axis === 'y' ? p => sign * p[1] : axis === 'x' ? p => sign * p[0] : p => sign * p[2];
  const view = axis === 'y' ? [0, sign, 0] : axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
  const probe = makeDepthProbe(mesh, axis, sign);
  const K = 1e-6;
  const pkey = v => Math.round(v[0] / K) + ',' + Math.round(v[1] / K) + ',' + Math.round(v[2] / K);

  /* Collect every edge with the normals of the faces that share it, keyed
   * by welded endpoint positions so merged meshes still share edges. */
  const edges = new Map();
  for (const f of mesh.faces){
    const P = [mesh.verts[f[0]], mesh.verts[f[1]], mesh.verts[f[2]]];
    if (!P[0] || !P[1] || !P[2]) continue;
    const n = faceNormal(P[0], P[1], P[2]);
    if (!n) continue;
    for (let i = 0; i < 3; i++){
      const A = P[i], B = P[(i + 1) % 3];
      const ka = pkey(A), kb = pkey(B);
      if (ka === kb) continue;
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      let rec = edges.get(key);
      if (!rec){ rec = { A, B, normals: [] }; edges.set(key, rec); }
      rec.normals.push(n);
    }
  }

  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const segs = [];
  for (const rec of edges.values()){
    const ns = rec.normals;
    let feature = ns.length === 1;
    if (!feature){
      for (let i = 0; i < ns.length && !feature; i++){
        for (let j = i + 1; j < ns.length && !feature; j++){
          const si = dot3(ns[i], view), sj = dot3(ns[j], view);
          if ((si < -1e-9 && sj > 1e-9) || (si > 1e-9 && sj < -1e-9)) feature = true;
          else if (dot3(ns[i], ns[j]) < EDGE_CREASE_DOT) feature = true;
        }
      }
    }
    if (!feature) continue;
    /* An edge draws only if it borders a surface the viewer can see: a
     * strictly front-facing face. This drops back-of-solid edges and the
     * coincident twin an edge-on roof would otherwise contribute. */
    if (!ns.some(n => dot3(n, view) < -1e-9)) continue;
    /* Two coplanar front faces at the edge mean the visible surface
     * continues smoothly across it: two flush solids do not get a seam
     * line, and a flush-fronted setback keeps its facade unbroken while
     * its roof step, where only one front face reaches, still draws. */
    const fronts = ns.filter(n => dot3(n, view) < -1e-9);
    let smooth = false;
    for (let i = 0; i < fronts.length && !smooth; i++){
      for (let j = i + 1; j < fronts.length && !smooth; j++){
        if (dot3(fronts[i], fronts[j]) >= 0.999) smooth = true;
      }
    }
    if (smooth) continue;

    const a2 = proj(rec.A), b2 = proj(rec.B);
    const len2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    if (len2 < 1e-6) continue;
    const nudge = [-(b2[1] - a2[1]) / len2 * EDGE_NUDGE, (b2[0] - a2[0]) / len2 * EDGE_NUDGE];

    const at = t => [
      rec.A[0] + (rec.B[0] - rec.A[0]) * t,
      rec.A[1] + (rec.B[1] - rec.A[1]) * t,
      rec.A[2] + (rec.B[2] - rec.A[2]) * t
    ];
    const vis = t => {
      const P = at(t);
      const [u, v] = proj(P);
      const d = dep(P);
      return probe(u + nudge[0], v + nudge[1]) >= d - EDGE_DEPTH_TOL
        || probe(u - nudge[0], v - nudge[1]) >= d - EDGE_DEPTH_TOL;
    };
    const refine = (tHid, tVis) => {
      for (let i = 0; i < 12; i++){
        const m = (tHid + tVis) / 2;
        if (vis(m)) tVis = m; else tHid = m;
      }
      return tVis;
    };

    const N = Math.max(1, Math.min(200, Math.ceil(len2 / EDGE_STEP)));
    const ts = [];
    for (let i = 0; i < N; i++) ts.push((i + 0.5) / N);
    const flags = ts.map(vis);
    let i = 0;
    while (i < N){
      if (!flags[i]){ i++; continue; }
      let j = i;
      while (j + 1 < N && flags[j + 1]) j++;
      /* Ends of the edge count as visible when the first or last sample
       * is, so a fully visible edge keeps its exact endpoints. */
      const t0 = i === 0 ? 0 : refine(ts[i - 1], ts[i]);
      const t1 = j === N - 1 ? 1 : refine(ts[j + 1], ts[j]);
      const p0 = proj(at(t0)), p1 = proj(at(t1));
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.05) segs.push([p0, p1]);
      i = j + 1;
    }
  }
  /* Distinct 3D edges can project onto the same 2D line: a re-entrant
   * corner and the side edge it meets, for one. The drawing wants that
   * line once. */
  const seen = new Set();
  const out = [];
  for (const s of segs){
    const k0 = Math.round(s[0][0] * 100) + ',' + Math.round(s[0][1] * 100);
    const k1 = Math.round(s[1][0] * 100) + ',' + Math.round(s[1][1] * 100);
    const key = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function contains(outer, inner){
  /* One interior test point is enough for section rings. */
  const p = inner[0];
  let hit = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++){
    const xi = outer[i][0], yi = outer[i][1], xj = outer[j][0], yj = outer[j][1];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / ((yj - yi) || 1e-12) + xi) hit = !hit;
  }
  return hit;
}
