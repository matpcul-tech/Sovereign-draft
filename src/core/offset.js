/* Parallel-offset an entity by distance d toward the tapped world point tapW.
 * Returns a new entity (no id) or null when the offset is impossible.
 */
import { dist, distToSeg, lineIntersect } from './geometry.js';
import { hasBulge, polyOutline } from './bulge.js';
import { splineToPoly } from './spline.js';

export function offsetEntity(e, d, tapW){
  if (e.type === 'line'){
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    const nx = -dy / len, ny = dx / len;
    const s = Math.sign((tapW[0] - e.x1) * nx + (tapW[1] - e.y1) * ny) || 1;
    return { type: 'line', layer: e.layer, x1: e.x1 + nx * d * s, y1: e.y1 + ny * d * s, x2: e.x2 + nx * d * s, y2: e.y2 + ny * d * s };
  }
  if (e.type === 'circle'){
    const s = dist(tapW[0], tapW[1], e.cx, e.cy) > e.r ? 1 : -1;
    const r = e.r + s * d; if (r <= 0.05) return null;
    return { type: 'circle', layer: e.layer, cx: e.cx, cy: e.cy, r };
  }
  if (e.type === 'arc'){
    const s = dist(tapW[0], tapW[1], e.cx, e.cy) > e.r ? 1 : -1;
    const r = e.r + s * d; if (r <= 0.05) return null;
    return { type: 'arc', layer: e.layer, cx: e.cx, cy: e.cy, r, a1: e.a1, a2: e.a2 };
  }
  if (e.type === 'spline'){
    /* Offsetting the tessellation is honest: a true spline offset is not a
     * spline anyway, and the polyline it returns follows the curve to the
     * same tolerance everything else draws it at. */
    return offsetEntity(splineToPoly(e), d, tapW);
  }
  if (e.type === 'poly'){
    const src = hasBulge(e) ? { type: 'poly', layer: e.layer, closed: e.closed, pts: polyOutline(e), lt: e.lt, lw: e.lw } : e;
    if (src !== e) return offsetEntity(src, d, tapW);
    const pts = e.pts; if (pts.length < 2) return null;
    const n = pts.length, segs = e.closed ? n : n - 1;
    let bi = 0, bd = 1e18;
    for (let i = 0; i < segs; i++){
      const j = (i + 1) % n;
      const dd = distToSeg(tapW[0], tapW[1], pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      if (dd < bd){ bd = dd; bi = i; }
    }
    const bj = (bi + 1) % n, sdx = pts[bj][0] - pts[bi][0], sdy = pts[bj][1] - pts[bi][1], sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1e-9;
    const snx = -sdy / sl, sny = sdx / sl;
    const side = Math.sign((tapW[0] - pts[bi][0]) * snx + (tapW[1] - pts[bi][1]) * sny) || 1;
    const offSegs = [];
    for (let k = 0; k < segs; k++){
      const j = (k + 1) % n, ax = pts[k][0], ay = pts[k][1], bx = pts[j][0], by = pts[j][1];
      const ddx = bx - ax, ddy = by - ay, ll = Math.sqrt(ddx * ddx + ddy * ddy) || 1e-9;
      const nx = -ddy / ll * d * side, ny = ddx / ll * d * side;
      offSegs.push([[ax + nx, ay + ny], [bx + nx, by + ny]]);
    }
    const out = [];
    if (e.closed){
      for (let m = 0; m < segs; m++){
        const prev = offSegs[(m - 1 + segs) % segs];
        out.push(lineIntersect(prev[0], prev[1], offSegs[m][0], offSegs[m][1]));
      }
    } else {
      out.push(offSegs[0][0]);
      for (let m = 1; m < segs; m++) out.push(lineIntersect(offSegs[m - 1][0], offSegs[m - 1][1], offSegs[m][0], offSegs[m][1]));
      out.push(offSegs[segs - 1][1]);
    }
    return { type: 'poly', layer: e.layer, closed: e.closed, pts: out };
  }
  return null;
}
