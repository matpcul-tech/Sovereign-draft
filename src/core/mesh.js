/* Mesh solids from 2D profiles: extrude, revolve, loft, sweep.
 *
 * This is not a b-rep kernel and does not pretend to be one. There are no
 * exact surfaces, no filleting and no tolerant modelling. What it does is
 * turn the closed regions this program already draws into closed triangle
 * meshes, which is what a massing study, a takeoff volume, a clash check or
 * a 3D print actually needs.
 *
 *   mesh = { verts: [[x,y,z], ...], faces: [[a,b,c], ...] }
 *
 * Faces are triangles wound counterclockwise seen from outside, so the
 * outward normal follows the right hand rule and the divergence theorem
 * gives a positive volume. Every operation here keeps that invariant,
 * because a mesh with mixed winding renders with holes and measures wrong.
 */
import { polyArea, pointInPoly } from './geometry.js';
import { orient, cleanRings, ringsArea } from './boolean.js';

export const EPS = 1e-10;

export function makeMesh(verts, faces){
  return { verts: verts || [], faces: faces || [] };
}

/* ---------- triangulation ----------
 * Ear clipping, with holes joined to the outer ring by a bridge before
 * clipping starts. Bridging turns a ring with holes into one simple
 * (self touching) polygon, which the ear clipper can then handle without
 * knowing holes exist.
 */

function area2(a, b, c){
  return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
}

function samePt(p, q){
  return Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
}

function inTriangle(p, a, b, c){
  const d1 = area2(p, a, b), d2 = area2(p, b, c), d3 = area2(p, c, a);
  const neg = (d1 < -EPS) || (d2 < -EPS) || (d3 < -EPS);
  const pos = (d1 > EPS) || (d2 > EPS) || (d3 > EPS);
  return !(neg && pos);
}

/* Join every hole into the outer ring with a bridge to the mutually visible
 * vertex, which is the standard way to make a holed region ear clippable. */
function bridgeHoles(outer, holes){
  let poly = outer.map((p, i) => ({ p, src: i }));
  const pending = holes.slice().sort((a, b) => maxX(b) - maxX(a));
  for (const hole of pending){
    /* Start the bridge from the hole's rightmost point: the segment going
     * right from there is guaranteed to leave the hole. */
    let hi = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0]) hi = i;
    const hp = hole[hi];

    /* Nearest outer vertex to the right that the bridge can reach without
     * crossing anything. Distance first, then a visibility check. */
    let best = -1, bestD = Infinity;
    for (let i = 0; i < poly.length; i++){
      const q = poly[i].p;
      if (q[0] < hp[0] - EPS) continue;
      const d = (q[0] - hp[0]) * (q[0] - hp[0]) + (q[1] - hp[1]) * (q[1] - hp[1]);
      if (d < bestD && visible(poly, hp, q)){ bestD = d; best = i; }
    }
    if (best < 0){
      /* Fall back to the plain nearest vertex rather than dropping the hole,
       * which would silently fill it in. */
      for (let i = 0; i < poly.length; i++){
        const q = poly[i].p;
        const d = (q[0] - hp[0]) * (q[0] - hp[0]) + (q[1] - hp[1]) * (q[1] - hp[1]);
        if (d < bestD){ bestD = d; best = i; }
      }
    }
    if (best < 0) continue;

    /* Splice the hole in, walking it from its rightmost point and closing
     * back along the bridge. */
    const run = [];
    for (let k = 0; k < hole.length; k++) run.push({ p: hole[(hi + k) % hole.length], src: -1 });
    run.push({ p: hole[hi], src: -1 });
    run.push({ p: poly[best].p, src: poly[best].src });
    poly = poly.slice(0, best + 1).concat(run, poly.slice(best + 1));
  }
  return poly;
}

function maxX(ring){
  let m = -Infinity;
  for (const p of ring) if (p[0] > m) m = p[0];
  return m;
}

function visible(poly, a, b){
  for (let i = 0; i < poly.length; i++){
    const c = poly[i].p, d = poly[(i + 1) % poly.length].p;
    if (segCross(a, b, c, d)) return false;
  }
  return true;
}

function segCross(a, b, c, d){
  const s = area2(a, b, c), t = area2(a, b, d);
  const u = area2(c, d, a), v = area2(c, d, b);
  if (Math.abs(s) < EPS || Math.abs(t) < EPS || Math.abs(u) < EPS || Math.abs(v) < EPS) return false;
  return (s > 0) !== (t > 0) && (u > 0) !== (v > 0);
}

/* Triangles for a set of rings, holes included. Returns index triples into
 * a flat point list, which is also returned so callers can build vertices
 * from exactly the points the triangles reference. */
export function triangulateRings(rings){
  const oriented = orient(rings);
  if (!oriented.length) return { points: [], tris: [] };

  /* Outer rings are counterclockwise after orient; holes are clockwise. */
  const outers = oriented.filter(r => polyArea(r) > 0);
  const holes = oriented.filter(r => polyArea(r) <= 0);

  const points = [];
  const tris = [];

  for (const outer of outers){
    const mine = holes.filter(h => h.length && pointInPoly(h[0][0], h[0][1], outer));
    /* Holes stay wound opposite to the outer ring. That is what makes the
     * bridge fold the hole's boundary back on itself so the ear clipper
     * walks around the void instead of across it. Reversing them first fills
     * the hole in as solid. */
    const poly = bridgeHoles(outer, mine);
    const base = points.length;
    poly.forEach(v => points.push([v.p[0], v.p[1]]));
    earClip(poly.map(v => v.p), base).forEach(t => tris.push(t));
  }
  return { points, tris };
}

function earClip(pts, base){
  const n = pts.length;
  const out = [];
  if (n < 3) return out;
  const idx = pts.map((_, i) => i);
  let guard = 0;
  const limit = n * n + 16;

  while (idx.length > 3 && guard++ < limit){
    let clipped = false;
    for (let i = 0; i < idx.length; i++){
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      /* Convex here means the ear points out of a counterclockwise ring. */
      if (area2(a, b, c) <= EPS) continue;
      let ok = true;
      for (let j = 0; j < idx.length; j++){
        const k = idx[j];
        if (k === i0 || k === i1 || k === i2) continue;
        /* Bridging a hole puts the same coordinate in the ring twice. A
         * duplicate sitting exactly on a corner of the candidate ear is that
         * corner, not a point inside it. Counting it as inside means no ear
         * is ever found and the whole cap comes out as garbage. */
        if (samePt(pts[k], a) || samePt(pts[k], b) || samePt(pts[k], c)) continue;
        if (inTriangle(pts[k], a, b, c)){ ok = false; break; }
      }
      if (!ok) continue;
      out.push([base + i0, base + i1, base + i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    /* Nothing clippable left means the ring is degenerate or self
     * intersecting. Drop a vertex rather than emit a triangle that is not
     * part of the region: a missing sliver is recoverable, a face lying
     * across a void is not. */
    if (!clipped) idx.splice(1, 1);
  }
  if (idx.length === 3) out.push([base + idx[0], base + idx[1], base + idx[2]]);
  return out;
}

/* ---------- solids ---------- */

/* A prism from closed 2D rings. Caps are the triangulated profile, walls are
 * a quad per boundary edge, and the bottom cap is wound the other way so the
 * whole thing is closed with outward normals. */
export function extrudeRings(rings, height, opts){
  const o = opts || {};
  const z0 = Number(o.base) || 0;
  const h = Number(height) || 0;
  const z1 = z0 + h;
  const oriented = orient(rings);
  if (!oriented.length || Math.abs(h) < EPS) return makeMesh([], []);

  const { points, tris } = triangulateRings(oriented);
  const verts = [];
  const faces = [];

  /* Cap vertices: the same plan points at both heights. */
  points.forEach(p => verts.push([p[0], p[1], z1]));
  const bottomBase = verts.length;
  points.forEach(p => verts.push([p[0], p[1], z0]));

  const up = h > 0;
  tris.forEach(t => {
    /* Top faces up, bottom faces down. Reversing one of them is what makes
     * both normals point away from the solid. */
    if (up){
      faces.push([t[0], t[1], t[2]]);
      faces.push([bottomBase + t[2], bottomBase + t[1], bottomBase + t[0]]);
    } else {
      faces.push([t[2], t[1], t[0]]);
      faces.push([bottomBase + t[0], bottomBase + t[1], bottomBase + t[2]]);
    }
  });

  /* Walls, from the original rings rather than the bridged triangulation, so
   * each boundary edge appears exactly once. */
  oriented.forEach(ring => {
    const start = verts.length;
    ring.forEach(p => verts.push([p[0], p[1], z1]));
    ring.forEach(p => verts.push([p[0], p[1], z0]));
    const n = ring.length;
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n;
      const tA = start + i, tB = start + j;
      const bA = start + n + i, bB = start + n + j;
      if (up){
        faces.push([tA, bA, bB]);
        faces.push([tA, bB, tB]);
      } else {
        faces.push([tA, bB, bA]);
        faces.push([tA, tB, bB]);
      }
    }
  });

  return makeMesh(verts, faces);
}

/* Spin a closed section around an axis in its own plane.
 *
 * The section is given in the half plane as [radius, z] pairs and is treated
 * as a closed ring: the last point joins the first. Requiring the caller to
 * repeat the first point instead is the kind of interface that silently
 * produces an open shell, a wrong volume and a file a printer rejects.
 *
 * A full turn needs no caps because the surface closes on itself. A partial
 * turn is capped with the section at each end, or it is a shell rather than
 * a solid.
 */
export function revolveProfile(profile, opts){
  const o = opts || {};
  const segs = Math.max(3, Math.min(2048, Math.round(o.segments || 48)));
  const deg = o.angle == null ? 360 : Number(o.angle);
  const sweep = deg * Math.PI / 180;
  const closed = Math.abs(Math.abs(deg) - 360) < 1e-9;

  /* Section points, de-duplicated and with any repeated closing point
   * dropped, so a caller that closes it by hand gets the same solid. */
  const sec = [];
  for (const p of profile || []){
    const q = [Math.abs(Number(p[0]) || 0), Number(p[1]) || 0];
    const last = sec[sec.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-12 && Math.abs(last[1] - q[1]) < 1e-12) continue;
    sec.push(q);
  }
  while (sec.length > 1 && Math.abs(sec[0][0] - sec[sec.length - 1][0]) < 1e-12
      && Math.abs(sec[0][1] - sec[sec.length - 1][1]) < 1e-12) sec.pop();
  if (sec.length < 3) return makeMesh([], []);

  /* Work with the section counterclockwise in the (r, z) plane so the
   * surface normals come out pointing away from the solid. */
  const ring = polyArea(sec) > 0 ? sec : sec.slice().reverse();
  const m = ring.length;
  const rings = closed ? segs : segs + 1;

  const verts = [];
  for (let s2 = 0; s2 < rings; s2++){
    const a = sweep * (s2 / segs);
    const ca = Math.cos(a), sa = Math.sin(a);
    ring.forEach(p => verts.push([p[0] * ca, p[0] * sa, p[1]]));
  }

  const faces = [];
  for (let s2 = 0; s2 < segs; s2++){
    const a = s2 * m, b = ((s2 + 1) % rings) * m;
    for (let i = 0; i < m; i++){
      const j = (i + 1) % m;
      faces.push([a + i, b + i, b + j]);
      faces.push([a + i, b + j, a + j]);
    }
  }

  if (!closed){
    /* Cap with the section itself at both ends, triangulated in its own
     * plane and then placed at the start and end angles. */
    const { points, tris } = triangulateRings([ring]);
    const place = (ang, flip) => {
      const base = verts.length;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      points.forEach(p => verts.push([p[0] * ca, p[0] * sa, p[1]]));
      tris.forEach(t => faces.push(flip
        ? [base + t[2], base + t[1], base + t[0]]
        : [base + t[0], base + t[1], base + t[2]]));
    };
    place(0, sweep > 0);
    place(sweep, sweep <= 0);
  }
  return makeMesh(verts, faces);
}

/* Loft between rings at increasing heights. Each pair must have the same
 * point count, which is what makes the correspondence unambiguous. */
export function loftRings(sections){
  const secs = (sections || []).filter(s => s && s.ring && s.ring.length >= 3);
  if (secs.length < 2) return makeMesh([], []);
  const n = secs[0].ring.length;
  if (!secs.every(s => s.ring.length === n)) throw new Error('Loft sections must have the same number of points');

  const verts = [];
  secs.forEach(s => s.ring.forEach(p => verts.push([p[0], p[1], Number(s.z) || 0])));
  const faces = [];
  for (let k = 0; k + 1 < secs.length; k++){
    const a = k * n, b = (k + 1) * n;
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n;
      /* Wound so the normal points away from the solid. With a
       * counterclockwise section seen from above, walking the lower edge
       * forward and the upper edge back is what faces outward. */
      faces.push([a + i, b + j, b + i]);
      faces.push([a + i, a + j, b + j]);
    }
  }
  /* Cap both ends so the loft is a closed solid. */
  const first = triangulateRings([secs[0].ring]);
  const last = triangulateRings([secs[secs.length - 1].ring]);
  const fBase = verts.length;
  first.points.forEach(p => verts.push([p[0], p[1], Number(secs[0].z) || 0]));
  first.tris.forEach(t => faces.push([fBase + t[2], fBase + t[1], fBase + t[0]]));
  const lBase = verts.length;
  last.points.forEach(p => verts.push([p[0], p[1], Number(secs[secs.length - 1].z) || 0]));
  last.tris.forEach(t => faces.push([lBase + t[0], lBase + t[1], lBase + t[2]]));
  return makeMesh(verts, faces);
}

/* ---------- measurement ----------
 * Both of these are surface integrals over the triangles, so they are exact
 * for the mesh and only as good as the mesh is as an approximation of the
 * shape. They are also the check that the winding is consistent: a mesh with
 * a flipped face measures wrong.
 */
export function meshVolume(mesh){
  let v = 0;
  for (const f of mesh.faces){
    const a = mesh.verts[f[0]], b = mesh.verts[f[1]], c = mesh.verts[f[2]];
    if (!a || !b || !c) continue;
    v += (a[0] * (b[1] * c[2] - c[1] * b[2])
        - a[1] * (b[0] * c[2] - c[0] * b[2])
        + a[2] * (b[0] * c[1] - c[0] * b[1])) / 6;
  }
  return v;
}

export function meshArea(mesh){
  let s = 0;
  for (const f of mesh.faces){
    const a = mesh.verts[f[0]], b = mesh.verts[f[1]], c = mesh.verts[f[2]];
    if (!a || !b || !c) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    s += Math.hypot(n[0], n[1], n[2]) / 2;
  }
  return s / 1;
}

export function meshBBox(mesh){
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts){
    for (let i = 0; i < 3; i++){
      if (v[i] < bb[i]) bb[i] = v[i];
      if (v[i] > bb[i + 3]) bb[i + 3] = v[i];
    }
  }
  return bb;
}

/* A closed mesh has every edge shared by exactly two triangles. This is the
 * property that decides whether a volume means anything and whether a
 * printer or a downstream tool will accept the file. */
export function isWatertight(mesh, tol){
  const t = tol == null ? 1e-9 : tol;
  const key = v => v.map(c => (Math.round(c / t) * t).toFixed(9)).join(',');
  const keys = mesh.verts.map(key);
  const edges = new Map();
  for (const f of mesh.faces){
    for (let i = 0; i < 3; i++){
      const a = keys[f[i]], b = keys[f[(i + 1) % 3]];
      if (a === b) return false;                /* degenerate triangle */
      const k = a < b ? a + '|' + b : b + '|' + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

/* ---------- export ---------- */

export function meshToSTL(mesh, name){
  const out = ['solid ' + (name || 'sovereign')];
  for (const f of mesh.faces){
    const a = mesh.verts[f[0]], b = mesh.verts[f[1]], c = mesh.verts[f[2]];
    if (!a || !b || !c) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map(v => v / L);
    const f6 = v => (Math.round(v * 1e6) / 1e6).toString();
    out.push('  facet normal ' + n.map(f6).join(' '));
    out.push('    outer loop');
    [a, b, c].forEach(p => out.push('      vertex ' + p.map(f6).join(' ')));
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push('endsolid ' + (name || 'sovereign'));
  return out.join('\n');
}

export function meshToOBJ(mesh, name){
  const f6 = v => (Math.round(v * 1e6) / 1e6).toString();
  const out = ['# ' + (name || 'sovereign')];
  mesh.verts.forEach(v => out.push('v ' + v.map(f6).join(' ')));
  /* OBJ indices are one based. */
  mesh.faces.forEach(f => out.push('f ' + (f[0] + 1) + ' ' + (f[1] + 1) + ' ' + (f[2] + 1)));
  return out.join('\n');
}

/* Merge meshes into one, offsetting indices. */
export function mergeMeshes(list){
  const verts = [], faces = [];
  for (const m of list || []){
    if (!m || !m.verts) continue;
    const base = verts.length;
    m.verts.forEach(v => verts.push(v.slice()));
    m.faces.forEach(f => faces.push([f[0] + base, f[1] + base, f[2] + base]));
  }
  return makeMesh(verts, faces);
}

void cleanRings; void ringsArea;

/* ---------- primitive solids ----------
 * The starting blocks of mesh modelling. Each is closed by construction and
 * verified in the suite against its exact volume formula, because a
 * primitive that is a few percent off poisons every boolean built on it.
 */

export function makeBox(x, y, z, w, d, h){
  return extrudeRings([[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]], h, { base: z });
}

export function makeCylinder(cx, cy, z, r, h, segments){
  const n = Math.max(3, Math.min(256, Math.round(segments || 48)));
  const ring = [];
  for (let i = 0; i < n; i++){
    const a = (i / n) * Math.PI * 2;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return extrudeRings([ring], h, { base: z });
}

export function makeCone(cx, cy, z, r, h, segments){
  const n = Math.max(3, Math.min(256, Math.round(segments || 48)));
  const verts = [];
  for (let i = 0; i < n; i++){
    const a = (i / n) * Math.PI * 2;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  const apex = verts.length; verts.push([cx, cy, z + h]);
  const centre = verts.length; verts.push([cx, cy, z]);
  const faces = [];
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n;
    faces.push([i, j, apex]);        /* side, outward */
    faces.push([j, i, centre]);      /* base, facing down */
  }
  return makeMesh(verts, faces);
}

export function makeSphere(cx, cy, cz, r, segments){
  const n = Math.max(4, Math.min(128, Math.round(segments || 32)));
  const rows = Math.max(3, Math.round(n / 2));
  const verts = [];
  for (let i = 1; i < rows; i++){
    const phi = (i / rows) * Math.PI;
    for (let j = 0; j < n; j++){
      const th = (j / n) * Math.PI * 2;
      verts.push([cx + r * Math.sin(phi) * Math.cos(th), cy + r * Math.sin(phi) * Math.sin(th), cz + r * Math.cos(phi)]);
    }
  }
  const top = verts.length; verts.push([cx, cy, cz + r]);
  const bot = verts.length; verts.push([cx, cy, cz - r]);
  const faces = [];
  const at = (i, j) => (i - 1) * n + (j % n);
  for (let j = 0; j < n; j++){
    faces.push([top, at(1, j), at(1, j + 1)]);
    faces.push([bot, at(rows - 1, j + 1), at(rows - 1, j)]);
  }
  for (let i = 1; i < rows - 1; i++){
    for (let j = 0; j < n; j++){
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
      faces.push([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return makeMesh(verts, faces);
}

export function makeWedge(x, y, z, w, d, h){
  /* A box cut diagonally: full height along y = 0, zero at y = d. */
  const verts = [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h]
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],          /* base, facing down */
    [0, 1, 5], [0, 5, 4],          /* vertical back */
    [1, 2, 5],                     /* right triangle */
    [0, 4, 3],                     /* left triangle */
    [3, 4, 5], [3, 5, 2]           /* slope */
  ];
  return makeMesh(verts, faces);
}

/* Pitched roofs, the two classic forms, watertight by construction and
 * exact by closed form. The ridge runs along the longer footprint side; a
 * footprint deeper than wide is built transposed so the ridge follows it.
 * Volumes: a gable is a triangular prism, span * rise / 2 * length; a hip
 * is that prism over the shortened ridge plus one square pyramid,
 * span^2 * rise / 3, made of its two ends. */
function roofVerts(x, y, z, w, d, rise, hip){
  /* Built with the ridge along x for w >= d; transposed otherwise. */
  const T = d > w;
  const [W, D] = T ? [d, w] : [w, d];
  const inset = hip ? Math.min(D / 2, W / 2) : 0;
  const pts = [
    [0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0],
    [inset, D / 2, rise], [W - inset, D / 2, rise]
  ];
  return pts.map(p => T
    ? [x + p[1], y + p[0], z + p[2]]
    : [x + p[0], y + p[1], z + p[2]]);
}

export function makeGable(x, y, z, w, d, rise){
  const verts = roofVerts(x, y, z, w, d, rise, false);
  const faces = [
    [0, 3, 2], [0, 2, 1],          /* base, facing down */
    [0, 1, 5], [0, 5, 4],          /* near slope */
    [2, 3, 4], [2, 4, 5],          /* far slope */
    [0, 4, 3],                     /* ridge-end triangle */
    [1, 2, 5]                      /* ridge-end triangle */
  ];
  const m = makeMesh(verts, faces);
  /* Transposition mirrors the winding; volume sign says which way. */
  return meshVolume(m) < 0 ? makeMesh(verts, faces.map(f => [f[0], f[2], f[1]])) : m;
}

export function makeHip(x, y, z, w, d, rise){
  /* A square footprint collapses the ridge to a point: a clean pyramid,
   * not a mesh with degenerate faces. */
  if (Math.abs(w - d) < 1e-9){
    const verts = [
      [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
      [x + w / 2, y + d / 2, z + rise]
    ];
    return makeMesh(verts, [
      [0, 3, 2], [0, 2, 1],
      [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]
    ]);
  }
  const verts = roofVerts(x, y, z, w, d, rise, true);
  const faces = [
    [0, 3, 2], [0, 2, 1],          /* base, facing down */
    [0, 1, 5], [0, 5, 4],          /* near slope trapezoid */
    [2, 3, 4], [2, 4, 5],          /* far slope trapezoid */
    [0, 4, 3],                     /* hip end */
    [1, 2, 5]                      /* hip end */
  ];
  const m = makeMesh(verts, faces);
  return meshVolume(m) < 0 ? makeMesh(verts, faces.map(f => [f[0], f[2], f[1]])) : m;
}

/* Sweep a section along a polyline path in plan. The section is [right, up]
 * pairs in the plane perpendicular to travel; joints are mitred on the
 * angle bisector, the way a thick polyline mitres, so the sweep of a closed
 * section along a straight path has exactly area times length. */
export function sweepPath(section, path, opts){
  const o = opts || {};
  const sec = (section || []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0]);
  const pts = (path || []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0]);
  if (sec.length < 3 || pts.length < 2) return makeMesh([], []);
  const ring = polyArea(sec) > 0 ? sec : sec.slice().reverse();
  const m = ring.length;

  /* A frame per path vertex: the mitre direction and its scale. */
  const frames = [];
  for (let i = 0; i < pts.length; i++){
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const L = Math.hypot(dx, dy) || 1e-9;
    const tx = dx / L, ty = dy / L;
    /* The section's 'right' axis: up cross travel, so (right, up, travel)
     * is right handed. The other sign is a reflection, which flips the side
     * quads against the caps and quietly wrecks the volume while every edge
     * still matches. */
    let nx = -ty, ny = tx, k = 1;
    if (i > 0 && i < pts.length - 1){
      /* The mitre scale is 1 / cos(half the turn), and the turn is between
       * the two segments, not between a segment and the bisector: feeding
       * the bisector angle in makes every joint too thin by exactly the
       * factor a right angle shows most. Capped so a hairpin cannot blow
       * the joint out to infinity. */
      const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1];
      const d2x = pts[i + 1][0] - pts[i][0], d2y = pts[i + 1][1] - pts[i][1];
      const L1 = Math.hypot(d1x, d1y) || 1e-9;
      const L2 = Math.hypot(d2x, d2y) || 1e-9;
      const cos = (d1x / L1) * (d2x / L2) + (d1y / L1) * (d2y / L2);
      k = Math.min(4, 1 / Math.max(0.25, Math.sqrt((1 + cos) / 2)));
    }
    frames.push({ x: pts[i][0], y: pts[i][1], nx, ny, k });
  }

  const verts = [];
  frames.forEach(f => {
    ring.forEach(s => {
      verts.push([f.x + f.nx * s[0] * f.k, f.y + f.ny * s[0] * f.k, s[1]]);
    });
  });
  const faces = [];
  for (let s2 = 0; s2 + 1 < frames.length; s2++){
    const a = s2 * m, b = (s2 + 1) * m;
    for (let i = 0; i < m; i++){
      const j = (i + 1) % m;
      faces.push([a + i, b + j, b + i]);
      faces.push([a + i, a + j, b + j]);
    }
  }
  /* Caps: the section triangulated in its own plane, then placed. */
  const { points, tris } = triangulateRings([ring]);
  const place = (frame, flip) => {
    const base = verts.length;
    points.forEach(p => verts.push([frame.x + frame.nx * p[0] * frame.k, frame.y + frame.ny * p[0] * frame.k, p[1]]));
    tris.forEach(t => faces.push(flip ? [base + t[2], base + t[1], base + t[0]] : [base + t[0], base + t[1], base + t[2]]));
  };
  /* Start cap faces backward along the travel, end cap forward. */
  place(frames[0], true);
  place(frames[frames.length - 1], false);
  const mesh = makeMesh(verts, faces);
  /* Winding depends on the path direction; hand back positive volume. */
  if (meshVolume(mesh) < 0) mesh.faces = mesh.faces.map(f => [f[2], f[1], f[0]]);
  return mesh;
  void o;
}

/* ---------- rigid transforms in 3D ---------- */

export function translateMesh(mesh, dx, dy, dz){
  return makeMesh(mesh.verts.map(v => [v[0] + dx, v[1] + dy, v[2] + (dz || 0)]), mesh.faces.map(f => f.slice()));
}

export function scaleMesh(mesh, cx, cy, cz, k){
  return makeMesh(mesh.verts.map(v => [cx + (v[0] - cx) * k, cy + (v[1] - cy) * k, cz + (v[2] - cz) * k]), mesh.faces.map(f => f.slice()));
}

/* Rotate about an axis through a point: 'x', 'y' or 'z'. */
export function rotateMesh(mesh, axis, cx, cy, cz, deg){
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const rot = axis === 'x'
    ? v => [v[0], cy + (v[1] - cy) * c - (v[2] - cz) * s, cz + (v[1] - cy) * s + (v[2] - cz) * c]
    : axis === 'y'
      ? v => [cx + (v[2] - cz) * s + (v[0] - cx) * c, v[1], cz + (v[2] - cz) * c - (v[0] - cx) * s]
      : v => [cx + (v[0] - cx) * c - (v[1] - cy) * s, cy + (v[0] - cx) * s + (v[1] - cy) * c, v[2]];
  return makeMesh(mesh.verts.map(rot), mesh.faces.map(f => f.slice()));
}

/* ---------- T-junction healing ----------
 * A BSP boolean can leave an edge whole on one face and subdivided on
 * its neighbour: geometrically closed, combinatorially open, and the
 * watertight check rightly refuses to call it sealed. Healing splits
 * every edge at any mesh vertex lying on its interior and re-fans the
 * face, so shared boundaries use the same vertices on both sides. The
 * inserted points are exactly on the edges, so the enclosed volume is
 * unchanged to the last bit of the arithmetic. */
export function healTJunctions(mesh){
  const verts = mesh.verts;
  if (!verts.length || !mesh.faces.length) return mesh;
  const K = 1e-6;
  const key = v => Math.round(v[0] / K) + ',' + Math.round(v[1] / K) + ',' + Math.round(v[2] / K);
  /* Unique positions on a coarse grid for the on-edge search. */
  const uniq = [];
  const seen = new Set();
  for (const v of verts){
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(v);
  }
  const CELL = 1.0;
  const grid = new Map();
  const ck = (x, y, z) => x + ',' + y + ',' + z;
  uniq.forEach((v, i) => {
    const k = ck(Math.floor(v[0] / CELL), Math.floor(v[1] / CELL), Math.floor(v[2] / CELL));
    const a = grid.get(k);
    if (a) a.push(i); else grid.set(k, [i]);
  });
  const TOL = 1e-6;
  const interiorPoints = (A, B) => {
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    if (len2 < TOL * TOL) return [];
    const len = Math.sqrt(len2);
    const out = [];
    const x0 = Math.floor(Math.min(A[0], B[0]) / CELL) - 1, x1 = Math.floor(Math.max(A[0], B[0]) / CELL) + 1;
    const y0 = Math.floor(Math.min(A[1], B[1]) / CELL) - 1, y1 = Math.floor(Math.max(A[1], B[1]) / CELL) + 1;
    const z0 = Math.floor(Math.min(A[2], B[2]) / CELL) - 1, z1 = Math.floor(Math.max(A[2], B[2]) / CELL) + 1;
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) for (let gz = z0; gz <= z1; gz++){
      const cell = grid.get(ck(gx, gy, gz));
      if (!cell) continue;
      for (const i of cell){
        const P = uniq[i];
        const ap = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
        const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
        if (t < TOL || t > 1 - TOL) continue;
        const dx = ap[0] - t * ab[0], dy = ap[1] - t * ab[1], dz = ap[2] - t * ab[2];
        if (Math.hypot(dx, dy, dz) < TOL * Math.max(1, len)) out.push({ t, p: P });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  };
  const outVerts = [];
  const outFaces = [];
  const vid = new Map();
  const emit = p => {
    const k = key(p);
    if (vid.has(k)) return vid.get(k);
    vid.set(k, outVerts.length);
    outVerts.push([p[0], p[1], p[2]]);
    return outVerts.length - 1;
  };
  for (const f of mesh.faces){
    const A = verts[f[0]], B = verts[f[1]], C = verts[f[2]];
    /* The face's boundary with every on-edge vertex inserted, in order. */
    const ring = [];
    [[A, B], [B, C], [C, A]].forEach(([P, Q]) => {
      ring.push(P);
      interiorPoints(P, Q).forEach(ip => ring.push(ip.p));
    });
    if (ring.length === 3){
      outFaces.push([emit(A), emit(B), emit(C)]);
      continue;
    }
    /* Fan about the first corner: the ring is the original triangle
     * with collinear insertions, so it stays convex and the fan is
     * exact. Degenerate slivers (fan across a straight corner) drop. */
    const i0 = emit(ring[0]);
    for (let i = 1; i + 1 < ring.length; i++){
      const a = i0, b = emit(ring[i]), c = emit(ring[i + 1]);
      if (a === b || b === c || a === c) continue;
      outFaces.push([a, b, c]);
    }
  }
  return { verts: outVerts, faces: outFaces };
}
