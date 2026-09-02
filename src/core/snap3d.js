/* Inference snapping for 3D touch.
 *
 * The bbox face snap sees only the six planes of an axis-aligned box; a
 * roof peak, a dormer corner or anything CSG has made is invisible to
 * it. This module offers the real feature points of a mesh, deduped
 * vertices and the midpoints of feature edges, and lets a drag lock a
 * point of the moving solid exactly onto a point of a stationary one.
 * The lock is exact by construction: the corrected delta is the target
 * coordinate minus the source coordinate, not a rounded approximation.
 * Pure math on the kernel mesh format {verts, faces}: no three.js. */

const KEY_EPS = 1e-6;

function keyOf(p){
  return Math.round(p[0] / KEY_EPS) + ',' + Math.round(p[1] / KEY_EPS) + ',' + Math.round(p[2] / KEY_EPS);
}

function faceNormal(verts, f){
  const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/* Feature points of a mesh: every distinct vertex, plus the midpoint of
 * every feature edge (an edge on the boundary, or shared by two faces
 * that are not coplanar; triangulation diagonals inside a flat face are
 * not features and get no midpoint). Meshes past the cap skip the edge
 * pass so a pathological CSG result cannot stall a drag. */
export function snapPoints(mesh, cap){
  const out = [];
  if (!mesh || !mesh.verts || !mesh.verts.length) return out;
  const seen = new Map();
  for (const v of mesh.verts){
    const k = keyOf(v);
    if (seen.has(k)) continue;
    seen.set(k, out.length);
    out.push({ p: [v[0], v[1], v[2]], kind: 'vertex' });
  }
  const limit = cap || 4000;
  if (!mesh.faces || mesh.verts.length > limit) return out;
  /* Edges keyed by their deduped endpoint ids so seams split by CSG
   * still pair up. */
  const edges = new Map();
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < 3; i++){
      const a = seen.get(keyOf(mesh.verts[f[i]]));
      const b = seen.get(keyOf(mesh.verts[f[(i + 1) % 3]]));
      if (a === b) continue;
      const k = a < b ? a + '_' + b : b + '_' + a;
      const e = edges.get(k);
      if (e) e.push(fi); else edges.set(k, [fi]);
    }
  });
  const normals = mesh.faces.map(f => faceNormal(mesh.verts, f));
  for (const [k, fs] of edges){
    let feature = fs.length === 1;
    if (fs.length === 2){
      const n0 = normals[fs[0]], n1 = normals[fs[1]];
      feature = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < 0.9999;
    }
    if (!feature) continue;
    const [ia, ib] = k.split('_').map(Number);
    const a = out[ia].p, b = out[ib].p;
    /* ends lets edit mode move the edge itself: both endpoints follow. */
    out.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], kind: 'midpoint', ends: [a, b] });
  }
  return out;
}

/* A uniform grid over target points, cells the size of the tolerance,
 * so a query touches at most 27 cells whatever the model holds. */
export function makeSnapIndex(points, cell){
  const c = cell || 0.5;
  const cells = new Map();
  const ck = (x, y, z) => x + ',' + y + ',' + z;
  points.forEach((pt, i) => {
    const k = ck(Math.floor(pt.p[0] / c), Math.floor(pt.p[1] / c), Math.floor(pt.p[2] / c));
    const arr = cells.get(k);
    if (arr) arr.push(i); else cells.set(k, [i]);
  });
  /* axes 'xy' measures plan distance, 'z' vertical only, 'xyz' full. */
  function best(q, tol, axes){
    const ax = axes || 'xyz';
    const gx = Math.floor(q[0] / c), gy = Math.floor(q[1] / c), gz = Math.floor(q[2] / c);
    let win = null, winD = tol;
    /* A z-only query still walks the 3x3x3 block: plan distance is not
     * constrained, but candidate points live near the query in plan
     * because the caller feeds points of solids near the drag. */
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++){
      const arr = cells.get(ck(gx + dx, gy + dy, gz + dz));
      if (!arr) continue;
      for (const i of arr){
        const p = points[i].p;
        const d = ax === 'xy' ? Math.hypot(p[0] - q[0], p[1] - q[1])
          : ax === 'z' ? Math.abs(p[2] - q[2])
          : Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < winD || (d === winD && win != null && points[i].kind === 'vertex' && points[win].kind !== 'vertex')){
          win = i; winD = d;
        }
      }
    }
    return win == null ? null : { point: points[win], dist: winD };
  }
  return { best };
}

/* The inference itself: among every (moving point, target point) pair
 * within tolerance, take the closest and correct the drag delta so the
 * pair coincides exactly. mode 'plan' locks x and y and leaves the lift
 * alone; mode 'lift' locks z only. Returns null when nothing is close,
 * and the caller falls back to face and grid snapping. */
export function inferMove(selfPts, delta, index, tol, mode){
  const axes = mode === 'lift' ? 'z' : 'xy';
  let win = null;
  for (const m of selfPts){
    const q = [m.p[0] + delta[0], m.p[1] + delta[1], m.p[2] + delta[2]];
    const hit = index.best(q, tol, axes);
    if (!hit) continue;
    if (!win || hit.dist < win.dist ||
        (hit.dist === win.dist && hit.point.kind === 'vertex' && win.point.kind !== 'vertex')){
      win = { dist: hit.dist, point: hit.point, from: m };
    }
  }
  if (!win) return null;
  const t = win.point.p, m = win.from.p;
  const out = mode === 'lift'
    ? [delta[0], delta[1], t[2] - m[2]]
    : [t[0] - m[0], t[1] - m[1], delta[2]];
  return { delta: out, kind: win.point.kind, from: win.from.p, to: t };
}

/* What a click in edit mode takes hold of: the nearest vertex within
 * tolerance, or failing that the nearest feature-edge midpoint, in
 * which case both endpoints move together so the edge stays an edge.
 * Returns { kind, at, points } where points are the exact coordinates
 * every matching mesh vertex must follow, or null out of tolerance. */
export function grabTarget(mesh, p, tol){
  const feats = snapPoints(mesh);
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let best = null, bestD = tol || 0.6;
  for (const f of feats){
    const d = d3(f.p, p);
    if (d < bestD || (d === bestD && best && f.kind === 'vertex' && best.kind !== 'vertex')){
      best = f; bestD = d;
    }
  }
  if (!best) return null;
  if (best.kind === 'midpoint' && best.ends) return { kind: 'edge', at: best.p, points: best.ends };
  return { kind: 'vertex', at: best.p, points: [best.p] };
}

/* Move every mesh vertex that sits on one of the given points, exactly.
 * Topology never changes: the same faces reference the same vertex
 * slots, so a watertight mesh stays watertight. Returns a new mesh. */
export function moveMeshPoints(mesh, points, delta){
  const keys = new Set(points.map(keyOf));
  const verts = mesh.verts.map(v => keys.has(keyOf(v))
    ? [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]]
    : [v[0], v[1], v[2]]);
  return { verts, faces: mesh.faces.map(f => f.slice()) };
}
