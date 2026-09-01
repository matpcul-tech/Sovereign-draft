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
