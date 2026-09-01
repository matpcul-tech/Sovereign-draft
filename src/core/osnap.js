/* Object snaps beyond the endpoint/midpoint/center already in entPoints:
 * intersection, nearest, perpendicular. Each candidate is [x, y, kind]
 * where kind 0=end 1=mid 2=center 3=intersection 4=nearest 5=perp.
 */
import { dist, distToSeg, closestOnSeg, perpFoot, segSegIntersect, lineCircleTs, angDeg, onArc, arcPoints, tanPoints, ellipsePoints, cloudPoints } from './geometry.js';
import { entPoints, flattenEnt, spanXline } from './entities.js';
import { polyOutline } from './bulge.js';
import { splinePoints } from './spline.js';

function segsOf(e){
  if (e.type === 'insert'){
    const s = [];
    flattenEnt(e).forEach(f => s.push(...segsOf(f)));
    return s;
  }
  if (e.type === 'grid'){
    const s = [];
    flattenEnt(e).forEach(f => s.push(...segsOf(f)));
    return s;
  }
  if (e.type === 'xline'){
    const sp = spanXline(e);
    return [[[sp.x1, sp.y1], [sp.x2, sp.y2]]];
  }
  if (e.type === 'room' && e.pts){
    const s = [];
    const n = e.pts.length;
    for (let i = 0; i < n; i++) s.push([e.pts[i], e.pts[(i + 1) % n]]);
    return s;
  }
  if (e.type === 'line') return [[[e.x1, e.y1], [e.x2, e.y2]]];
  if (e.type === 'poly' && e.pts){
    /* Snap along the arcs, not the chords a bulged polyline stores. */
    const pts = polyOutline(e);
    const s = [];
    const n = pts.length, segs = e.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) s.push([pts[i], pts[(i + 1) % n]]);
    return s;
  }
  if (e.type === 'spline'){
    const pts = splinePoints(e);
    const s = [];
    for (let i = 0; i + 1 < pts.length; i++) s.push([pts[i], pts[i + 1]]);
    return s;
  }
  if (e.type === 'hatch' && e.pts){
    const s = [];
    const n = e.pts.length;
    for (let i = 0; i < n; i++) s.push([e.pts[i], e.pts[(i + 1) % n]]);
    return s;
  }
  if (e.type === 'ellipse'){
    const pts = ellipsePoints(e);
    const s = [];
    for (let i = 0; i < pts.length; i++) s.push([pts[i], pts[(i + 1) % pts.length]]);
    return s;
  }
  if (e.type === 'cloud' && e.pts){
    const pts = cloudPoints(e.pts, e.amp);
    const s = [];
    for (let i = 0; i < pts.length; i++) s.push([pts[i], pts[(i + 1) % pts.length]]);
    return s;
  }
  if (e.type === 'leader' && e.pts){
    const s = [];
    for (let i = 0; i < e.pts.length - 1; i++) s.push([e.pts[i], e.pts[i + 1]]);
    return s;
  }
  return [];
}

export function intersectionSnaps(entities, isVisible){
  const out = [];
  const list = [];
  entities.forEach(e => {
    if (isVisible && !isVisible(e.layer)) return;
    if (e.type === 'insert') list.push(...flattenEnt(e));
    else list.push(e);
  });
  for (let i = 0; i < list.length; i++){
    const A = list[i];
    const segsA = segsOf(A);
    for (let j = i + 1; j < list.length; j++){
      const B = list[j];
      const segsB = segsOf(B);
      for (const sa of segsA){
        for (const sb of segsB){
          const hit = segSegIntersect(sa[0][0], sa[0][1], sa[1][0], sa[1][1], sb[0][0], sb[0][1], sb[1][0], sb[1][1], 1e-6);
          if (hit) out.push([hit.x, hit.y, 3]);
        }
      }
      /* line/poly vs circle/arc */
      if (B.type === 'circle' || B.type === 'arc'){
        for (const sa of segsA){
          lineCircleTs(sa[0][0], sa[0][1], sa[1][0], sa[1][1], B.cx, B.cy, B.r).forEach(t => {
            if (t < -1e-6 || t > 1 + 1e-6) return;
            const x = sa[0][0] + (sa[1][0] - sa[0][0]) * t, y = sa[0][1] + (sa[1][1] - sa[0][1]) * t;
            if (B.type === 'arc' && !onArc(B, angDeg(B.cx, B.cy, x, y), 0.3)) return;
            out.push([x, y, 3]);
          });
        }
      }
      if (A.type === 'circle' || A.type === 'arc'){
        for (const sb of segsB){
          lineCircleTs(sb[0][0], sb[0][1], sb[1][0], sb[1][1], A.cx, A.cy, A.r).forEach(t => {
            if (t < -1e-6 || t > 1 + 1e-6) return;
            const x = sb[0][0] + (sb[1][0] - sb[0][0]) * t, y = sb[0][1] + (sb[1][1] - sb[0][1]) * t;
            if (A.type === 'arc' && !onArc(A, angDeg(A.cx, A.cy, x, y), 0.3)) return;
            out.push([x, y, 3]);
          });
        }
      }
    }
  }
  return out;
}

export function nearestOnEntity(e, w){
  if (e.type === 'insert'){
    let best = null;
    flattenEnt(e).forEach(f => {
      const n = nearestOnEntity(f, w);
      if (n && (!best || n[3] < best[3])) best = n;
    });
    return best;
  }
  if (e.type === 'line'){
    const c = closestOnSeg(w[0], w[1], e.x1, e.y1, e.x2, e.y2);
    return [c.x, c.y, 4, c.d];
  }
  if (e.type === 'poly' || e.type === 'spline'){
    /* Nearest point on the curve itself: the arcs of a bulged polyline and
     * the tessellation of a spline, never the stored chords or hull. */
    const pts = e.type === 'spline' ? splinePoints(e) : polyOutline(e);
    let best = null;
    const n = pts.length, segs = (e.type === 'poly' && e.closed) ? n : n - 1;
    for (let i = 0; i < segs; i++){
      const a = pts[i], b = pts[(i + 1) % n];
      const c = closestOnSeg(w[0], w[1], a[0], a[1], b[0], b[1]);
      if (!best || c.d < best[3]) best = [c.x, c.y, 4, c.d];
    }
    return best;
  }
  if (e.type === 'circle'){
    const dx = w[0] - e.cx, dy = w[1] - e.cy, L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    return [e.cx + dx / L * e.r, e.cy + dy / L * e.r, 4, Math.abs(L - e.r)];
  }
  if (e.type === 'arc'){
    const a = angDeg(e.cx, e.cy, w[0], w[1]);
    const use = onArc(e, a, 0.5) ? a : (Math.abs(((a - e.a1) % 360 + 360) % 360) < Math.abs(((a - e.a2) % 360 + 360) % 360) ? e.a1 : e.a2);
    const rad = use * Math.PI / 180;
    const x = e.cx + e.r * Math.cos(rad), y = e.cy + e.r * Math.sin(rad);
    return [x, y, 4, dist(w[0], w[1], x, y)];
  }
  if (e.type === 'ellipse' || e.type === 'cloud' || e.type === 'leader'){
    const pts = e.type === 'ellipse' ? ellipsePoints(e) : (e.type === 'cloud' ? cloudPoints(e.pts || [], e.amp) : (e.pts || []));
    let best = null;
    const n = pts.length, closed = e.type !== 'leader';
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++){
      const a = pts[i], b = pts[(i + 1) % n];
      const c = closestOnSeg(w[0], w[1], a[0], a[1], b[0], b[1]);
      if (!best || c.d < best[3]) best = [c.x, c.y, 4, c.d];
    }
    return best;
  }
  return null;
}

export function perpSnap(e, from){
  if (!from) return null;
  if (e.type === 'insert'){
    let best = null, bd = 1e9;
    flattenEnt(e).forEach(f => {
      const p = perpSnap(f, from);
      if (!p) return;
      const d = dist(from[0], from[1], p[0], p[1]);
      if (d < bd){ bd = d; best = p; }
    });
    return best;
  }
  if (e.type === 'line'){
    const f = perpFoot(from[0], from[1], e.x1, e.y1, e.x2, e.y2);
    if (f.t < -1e-6 || f.t > 1 + 1e-6) return null;
    return [f.x, f.y, 5];
  }
  if (e.type === 'poly'){
    let best = null, bd = 1e9;
    const n = e.pts.length, segs = e.closed ? n : n - 1;
    for (let i = 0; i < segs; i++){
      const a = e.pts[i], b = e.pts[(i + 1) % n];
      const f = perpFoot(from[0], from[1], a[0], a[1], b[0], b[1]);
      if (f.t < -1e-6 || f.t > 1 + 1e-6) continue;
      const d = dist(from[0], from[1], f.x, f.y);
      if (d < bd){ bd = d; best = [f.x, f.y, 5]; }
    }
    return best;
  }
  if (e.type === 'circle'){
    const dx = from[0] - e.cx, dy = from[1] - e.cy, L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    return [e.cx + dx / L * e.r, e.cy + dy / L * e.r, 5];
  }
  return null;
}

export const SNAP_KIND = { 0: 'END', 1: 'MID', 2: 'CEN', 3: 'INT', 4: 'NEA', 5: 'PER', 6: 'TAN' };

/* Collect every snap candidate near a world point, ranked by screen-pixel distance. */
export function allSnapCandidates(entities, isVisible, w, fromPt){
  const out = [];
  for (const e of entities){
    if (isVisible && !isVisible(e.layer)) continue;
    for (const p of entPoints(e)) out.push(p);
    const n = nearestOnEntity(e, w);
    if (n) out.push(n);
    if (fromPt){
      const p = perpSnap(e, fromPt);
      if (p) out.push(p);
      if (e.type === 'circle'){
        tanPoints(e, fromPt).forEach(t => out.push(t));
      }
    }
  }
  out.push(...intersectionSnaps(entities, isVisible));
  return out;
}

void distToSeg; void arcPoints;
