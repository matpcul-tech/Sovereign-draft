/* Constructive solid geometry on triangle meshes.
 *
 * This is the gate between "3D export" and "3D modelling": with boolean
 * solids you can cut a stair opening out of a floor plate, join two masses
 * into one building, or intersect a volume with a zoning envelope. Without
 * it a solid is a picture.
 *
 * The method is BSP clipping, the csg.js construction: build a binary space
 * partition from each solid's polygons, clip each solid's polygons against
 * the other's tree, and keep the halves the operation asks for. Polygons
 * stay n-gons through the pipeline, because BSP splits of convex polygons
 * are convex, and a final fan triangulation is exact for convex faces.
 *
 * Honest limits, stated up front: splitting introduces T-junctions along cut
 * seams, so an edge-perfect watertightness check can fail on results even
 * though the surface is closed for every purpose that matters here. The
 * verification that holds exactly is volumetric: for any two solids,
 * vol(A) + vol(B) = vol(A u B) + vol(A n B), and every operation in the
 * test suite is held to that identity rather than to eyeballing.
 */
import { makeMesh } from './mesh.js';

const EPS = 1e-7;

/* ---------- polygon soup ---------- */

function planeOf(pts){
  /* Newell's method: stable for any simple polygon, not just triangles. */
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz);
  if (L < EPS) return null;
  nx /= L; ny /= L; nz /= L;
  const w = nx * pts[0][0] + ny * pts[0][1] + nz * pts[0][2];
  return { nx, ny, nz, w };
}

function poly(pts){
  const pl = planeOf(pts);
  return pl ? { pts, plane: pl } : null;
}

function flipPoly(p){
  return { pts: p.pts.slice().reverse(), plane: { nx: -p.plane.nx, ny: -p.plane.ny, nz: -p.plane.nz, w: -p.plane.w } };
}

export function meshToPolys(mesh){
  const out = [];
  for (const f of mesh.faces){
    const pts = f.map(i => mesh.verts[i].slice());
    const p = poly(pts);
    if (p) out.push(p);
  }
  return out;
}

export function polysToMesh(polys){
  const verts = [];
  const faces = [];
  for (const p of polys){
    const base = verts.length;
    p.pts.forEach(pt => verts.push([pt[0], pt[1], pt[2]]));
    /* Fan triangulation, exact because BSP polygons are convex. */
    for (let i = 2; i < p.pts.length; i++) faces.push([base, base + i - 1, base + i]);
  }
  return makeMesh(verts, faces);
}

/* ---------- splitting one polygon by a plane ---------- */

const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

function splitPolygon(plane, p, coplanarFront, coplanarBack, front, back){
  let polygonType = 0;
  const types = [];
  for (const v of p.pts){
    const t = plane.nx * v[0] + plane.ny * v[1] + plane.nz * v[2] - plane.w;
    const type = t < -EPS ? BACK : (t > EPS ? FRONT : COPLANAR);
    polygonType |= type;
    types.push(type);
  }
  if (polygonType === COPLANAR){
    const dot = plane.nx * p.plane.nx + plane.ny * p.plane.ny + plane.nz * p.plane.nz;
    (dot > 0 ? coplanarFront : coplanarBack).push(p);
  } else if (polygonType === FRONT){
    front.push(p);
  } else if (polygonType === BACK){
    back.push(p);
  } else {
    const f = [], b = [];
    for (let i = 0; i < p.pts.length; i++){
      const j = (i + 1) % p.pts.length;
      const ti = types[i], tj = types[j];
      const vi = p.pts[i], vj = p.pts[j];
      if (ti !== BACK) f.push(vi);
      if (ti !== FRONT) b.push(ti !== BACK ? vi.slice() : vi);
      if ((ti | tj) === SPANNING){
        const di = plane.nx * vi[0] + plane.ny * vi[1] + plane.nz * vi[2] - plane.w;
        const dj = plane.nx * vj[0] + plane.ny * vj[1] + plane.nz * vj[2] - plane.w;
        const t = di / (di - dj);
        const v = [vi[0] + (vj[0] - vi[0]) * t, vi[1] + (vj[1] - vi[1]) * t, vi[2] + (vj[2] - vi[2]) * t];
        f.push(v);
        b.push(v.slice());
      }
    }
    if (f.length >= 3){ const fp = poly(f); if (fp) front.push(fp); }
    if (b.length >= 3){ const bp = poly(b); if (bp) back.push(bp); }
  }
}

/* ---------- the BSP tree ---------- */

function node(polys){
  const n = { plane: null, front: null, back: null, polys: [] };
  if (polys && polys.length) build(n, polys);
  return n;
}

function build(n, polys){
  if (!polys.length) return;
  if (!n.plane) n.plane = polys[0].plane;
  const front = [], back = [];
  for (const p of polys){
    splitPolygon(n.plane, p, n.polys, n.polys, front, back);
  }
  if (front.length){
    if (!n.front) n.front = { plane: null, front: null, back: null, polys: [] };
    build(n.front, front);
  }
  if (back.length){
    if (!n.back) n.back = { plane: null, front: null, back: null, polys: [] };
    build(n.back, back);
  }
}

function invertNode(n){
  for (let i = 0; i < n.polys.length; i++) n.polys[i] = flipPoly(n.polys[i]);
  if (n.plane) n.plane = { nx: -n.plane.nx, ny: -n.plane.ny, nz: -n.plane.nz, w: -n.plane.w };
  if (n.front) invertNode(n.front);
  if (n.back) invertNode(n.back);
  const t = n.front; n.front = n.back; n.back = t;
}

/* Remove every part of `polys` inside the solid this node represents. */
function clipPolygons(n, polys){
  if (!n.plane) return polys.slice();
  let front = [], back = [];
  for (const p of polys){
    splitPolygon(n.plane, p, front, back, front, back);
  }
  if (n.front) front = clipPolygons(n.front, front);
  back = n.back ? clipPolygons(n.back, back) : [];
  return front.concat(back);
}

function clipTo(n, bsp){
  n.polys = clipPolygons(bsp, n.polys);
  if (n.front) clipTo(n.front, bsp);
  if (n.back) clipTo(n.back, bsp);
}

function allPolys(n, out){
  out.push(...n.polys);
  if (n.front) allPolys(n.front, out);
  if (n.back) allPolys(n.back, out);
  return out;
}

/* ---------- the three operations ---------- */

export function csgUnion(meshA, meshB){
  const a = node(meshToPolys(meshA));
  const b = node(meshToPolys(meshB));
  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);
  build(a, allPolys(b, []));
  return polysToMesh(allPolys(a, []));
}

export function csgSubtract(meshA, meshB){
  const a = node(meshToPolys(meshA));
  const b = node(meshToPolys(meshB));
  invertNode(a);
  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);
  build(a, allPolys(b, []));
  invertNode(a);
  return polysToMesh(allPolys(a, []));
}

export function csgIntersect(meshA, meshB){
  const a = node(meshToPolys(meshA));
  const b = node(meshToPolys(meshB));
  invertNode(a);
  clipTo(b, a);
  invertNode(b);
  clipTo(a, b);
  clipTo(b, a);
  build(a, allPolys(b, []));
  invertNode(a);
  return polysToMesh(allPolys(a, []));
}

export function csg(op, meshA, meshB){
  if (op === 'union') return csgUnion(meshA, meshB);
  if (op === 'subtract' || op === 'difference') return csgSubtract(meshA, meshB);
  if (op === 'intersect') return csgIntersect(meshA, meshB);
  throw new Error('Unknown CSG operation ' + op);
}
