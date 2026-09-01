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

/* ---------- the BSP tree ----------
 * Every walk here runs on an explicit stack, never the call stack: a mesh
 * whose polygons arrive in strip order (every tessellated sphere does) used
 * to build a comb-shaped tree deep enough to overflow the interpreter.
 */

function node(polys){
  const n = { plane: null, front: null, back: null, polys: [] };
  if (polys && polys.length) build(n, polys);
  return n;
}

/* The splitter is the first polygon's own plane, as in csg.js. It looks
 * naive next to a balancing heuristic, but for convex bodies it is the
 * right choice: every other face of a convex solid lies in front of any
 * face plane, so the tree degenerates to a deep list with almost no cuts,
 * while a "balanced" plane through the middle of a sphere severs a whole
 * great circle of polygons at every level. Measured on the drill case a
 * sampled balancing splitter was 2.5x slower. Deep lists are safe because
 * every walk here is iterative. */
function build(n, polys){
  const stack = [[n, polys]];
  while (stack.length){
    const [c, ps] = stack.pop();
    if (!ps.length) continue;
    if (!c.plane) c.plane = ps[0].plane;
    const front = [], back = [];
    for (const p of ps){
      splitPolygon(c.plane, p, c.polys, c.polys, front, back);
    }
    if (front.length){
      if (!c.front) c.front = { plane: null, front: null, back: null, polys: [] };
      stack.push([c.front, front]);
    }
    if (back.length){
      if (!c.back) c.back = { plane: null, front: null, back: null, polys: [] };
      stack.push([c.back, back]);
    }
  }
}

function invertNode(root){
  const stack = [root];
  while (stack.length){
    const n = stack.pop();
    for (let i = 0; i < n.polys.length; i++) n.polys[i] = flipPoly(n.polys[i]);
    if (n.plane) n.plane = { nx: -n.plane.nx, ny: -n.plane.ny, nz: -n.plane.nz, w: -n.plane.w };
    const t = n.front; n.front = n.back; n.back = t;
    if (n.front) stack.push(n.front);
    if (n.back) stack.push(n.back);
  }
}

/* Remove every part of `polys` inside the solid this node represents. */
function clipPolygons(root, polys){
  const out = [];
  const stack = [[root, polys]];
  while (stack.length){
    const [n, ps] = stack.pop();
    if (!ps.length) continue;
    if (!n.plane){ out.push(...ps); continue; }
    const front = [], back = [];
    for (const p of ps){
      splitPolygon(n.plane, p, front, back, front, back);
    }
    if (n.front) stack.push([n.front, front]);
    else out.push(...front);
    /* No back child means the back half-space is inside the solid: dropped. */
    if (n.back) stack.push([n.back, back]);
  }
  return out;
}

function clipTo(root, bsp){
  const stack = [root];
  while (stack.length){
    const n = stack.pop();
    n.polys = clipPolygons(bsp, n.polys);
    if (n.front) stack.push(n.front);
    if (n.back) stack.push(n.back);
  }
}

function allPolys(root, out){
  const stack = [root];
  while (stack.length){
    const n = stack.pop();
    out.push(...n.polys);
    if (n.front) stack.push(n.front);
    if (n.back) stack.push(n.back);
  }
  return out;
}

/* ---------- overlap pruning ----------
 * A polygon outside the bbox overlap of the two solids can never be cut or
 * removed differently than a rule can state in advance: in a union both
 * sides keep their far polygons whole, in a subtraction A keeps its far
 * polygons and B's never appear, in an intersection neither side's do. So
 * only the polygons near the overlap ride through the clipping, while the
 * trees keep every plane and stay the full solids for classification. The
 * result is polygon-for-polygon what the unpruned run produces; drilling a
 * small hole in a big wall stops paying for the whole wall.
 */
const MARGIN = 1e-6;

function overlapBox(pa, pb){
  const box = ps => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of ps) for (const v of p.pts){
      b[0] = Math.min(b[0], v[0]); b[1] = Math.min(b[1], v[1]); b[2] = Math.min(b[2], v[2]);
      b[3] = Math.max(b[3], v[0]); b[4] = Math.max(b[4], v[1]); b[5] = Math.max(b[5], v[2]);
    }
    return b;
  };
  const A = box(pa), B = box(pb);
  const o = [
    Math.max(A[0], B[0]) - MARGIN, Math.max(A[1], B[1]) - MARGIN, Math.max(A[2], B[2]) - MARGIN,
    Math.min(A[3], B[3]) + MARGIN, Math.min(A[4], B[4]) + MARGIN, Math.min(A[5], B[5]) + MARGIN
  ];
  return (o[0] <= o[3] && o[1] <= o[4] && o[2] <= o[5]) ? o : null;
}

function touchesBox(p, box){
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of p.pts){
    x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); z0 = Math.min(z0, v[2]);
    x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); z1 = Math.max(z1, v[2]);
  }
  return x1 >= box[0] && x0 <= box[3] && y1 >= box[1] && y0 <= box[4] && z1 >= box[2] && z0 <= box[5];
}

/* Pull far polygons out of the tree payload; planes and structure stay. */
function pruneFar(root, box){
  const far = [];
  const stack = [root];
  while (stack.length){
    const n = stack.pop();
    if (n.polys.length){
      const near = [];
      for (const p of n.polys){
        if (box && touchesBox(p, box)) near.push(p);
        else far.push(p);
      }
      n.polys = near;
    }
    if (n.front) stack.push(n.front);
    if (n.back) stack.push(n.back);
  }
  return far;
}

function prep(meshA, meshB){
  const pa = meshToPolys(meshA);
  const pb = meshToPolys(meshB);
  const box = overlapBox(pa, pb);
  const a = node(pa);
  const b = node(pb);
  return { a, b, farA: pruneFar(a, box), farB: pruneFar(b, box) };
}

/* ---------- the three operations ---------- */

export function csgUnion(meshA, meshB){
  const { a, b, farA, farB } = prep(meshA, meshB);
  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);
  build(a, allPolys(b, []));
  return polysToMesh(allPolys(a, []).concat(farA, farB));
}

export function csgSubtract(meshA, meshB){
  const { a, b, farA } = prep(meshA, meshB);
  invertNode(a);
  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);
  build(a, allPolys(b, []));
  invertNode(a);
  return polysToMesh(allPolys(a, []).concat(farA));
}

export function csgIntersect(meshA, meshB){
  const { a, b } = prep(meshA, meshB);
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
