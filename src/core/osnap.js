/* Object snaps beyond the endpoint/midpoint/center already in entPoints:
 * intersection, nearest, perpendicular. Each candidate is [x, y, kind]
 * where kind 0=end 1=mid 2=center 3=intersection 4=nearest 5=perp.
 */
import { dist, distToSeg, closestOnSeg, perpFoot, segSegIntersect, lineCircleTs, angDeg, onArc, arcPoints, tanPoints, ellipsePoints, cloudPoints, lineIntersect } from './geometry.js';
import { entPoints, flattenEnt, spanXline } from './entities.js';
import { polyOutline, hasBulge } from './bulge.js';
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

export const SNAP_KIND = { 0: 'END', 1: 'MID', 2: 'CEN', 3: 'INT', 4: 'NEA', 5: 'PER', 6: 'TAN', 7: 'NOD', 8: 'QUA', 9: 'EXT', 10: 'PAR', 11: 'INS', 12: 'XIN' };

/* ---------- the six snaps a drafter reaches for after END and MID ---------- */

/* Quadrants: the four compass points of a circle, the ones on an arc. */
export function quadSnaps(e){
  const out = [];
  if (e.type === 'circle'){
    out.push([e.cx + e.r, e.cy, 8], [e.cx, e.cy + e.r, 8], [e.cx - e.r, e.cy, 8], [e.cx, e.cy - e.r, 8]);
  } else if (e.type === 'arc'){
    for (const a of [0, 90, 180, 270]){
      if (!onArc(e, a, 0.01)) continue;
      const r = a * Math.PI / 180;
      out.push([e.cx + e.r * Math.cos(r), e.cy + e.r * Math.sin(r), 8]);
    }
  }
  return out;
}

/* Extension: the projection onto a segment's infinite line, past its ends.
 * Gated tight to the line and bounded in reach, or empty paper anywhere near
 * a long wall's axis would snap constantly. */
export function extensionSnaps(e, w, wtol){
  const t = wtol == null ? 0.5 : wtol;
  const segs = [];
  if (e.type === 'line') segs.push([[e.x1, e.y1], [e.x2, e.y2]]);
  else if (e.type === 'poly' && !hasBulge(e) && e.pts && e.pts.length > 1 && !e.closed){
    segs.push([e.pts[0], e.pts[1]], [e.pts[e.pts.length - 1], e.pts[e.pts.length - 2]]);
  }
  const out = [];
  for (const [a, b] of segs){
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) continue;
    const u = ((w[0] - a[0]) * dx + (w[1] - a[1]) * dy) / L2;
    if (u >= 0 && u <= 1) continue;                     /* on the segment: END/NEA territory */
    const px = a[0] + dx * u, py = a[1] + dy * u;
    const perp = Math.hypot(w[0] - px, w[1] - py);
    if (perp > t) continue;
    const L = Math.sqrt(L2);
    const past = u < 0 ? -u * L : (u - 1) * L;
    if (past > Math.max(4 * L, 64 * t)) continue;       /* bounded reach */
    out.push([px, py, 9, perp]);
  }
  return out;
}

/* Parallel: from the last picked point, the point that makes the new segment
 * exactly parallel to an existing line. */
export function parallelSnap(e, from, w, wtol){
  if (!from || e.type !== 'line') return null;
  const t = wtol == null ? 0.5 : wtol;
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  const ux = dx / L, uy = dy / L;
  const rx = w[0] - from[0], ry = w[1] - from[1];
  const along = rx * ux + ry * uy;
  if (Math.abs(along) < 2 * t) return null;             /* too close to be a direction yet */
  const px = from[0] + ux * along, py = from[1] + uy * along;
  const off = Math.hypot(w[0] - px, w[1] - py);
  if (off > t) return null;
  return [px, py, 10, off];
}

/* Apparent intersection: where two lines would cross if extended. Only pairs
 * whose imaginary crossing lands under the cursor are considered, so this
 * stays cheap and never fires in open space. */
export function apparentIntSnaps(entities, isVisible, w, wtol){
  const t = wtol == null ? 0.5 : wtol;
  const lines = [];
  for (const e of entities){
    if (e.type !== 'line') continue;
    if (isVisible && !isVisible(e.layer)) continue;
    lines.push(e);
    if (lines.length > 400) break;                      /* bounded pair work */
  }
  const out = [];
  for (let i = 0; i < lines.length; i++){
    const A = lines[i];
    for (let j = i + 1; j < lines.length; j++){
      const B = lines[j];
      const hit = lineIntersect([A.x1, A.y1], [A.x2, A.y2], [B.x1, B.y1], [B.x2, B.y2]);
      if (!hit) continue;
      if (Math.hypot(hit[0] - w[0], hit[1] - w[1]) > t) continue;
      const on = (P, x, y) => {
        const dx = P.x2 - P.x1, dy = P.y2 - P.y1, L2 = dx * dx + dy * dy || 1e-12;
        const u = ((x - P.x1) * dx + (y - P.y1) * dy) / L2;
        return u >= -1e-9 && u <= 1 + 1e-9;
      };
      /* Both on their segments is a real INT and already offered. */
      if (on(A, hit[0], hit[1]) && on(B, hit[0], hit[1])) continue;
      out.push([hit[0], hit[1], 12]);
    }
  }
  return out;
}

/* Collect every snap candidate near a world point, ranked by screen-pixel distance. */
export function allSnapCandidates(entities, isVisible, w, fromPt, wtol){
  const out = [];
  for (const e of entities){
    if (isVisible && !isVisible(e.layer)) continue;
    for (const p of entPoints(e)) out.push(p);
    const n = nearestOnEntity(e, w);
    if (n) out.push(n);
    quadSnaps(e).forEach(q => out.push(q));
    extensionSnaps(e, w, wtol).forEach(x => out.push(x));
    if (fromPt){
      const p = perpSnap(e, fromPt);
      if (p) out.push(p);
      if (e.type === 'circle'){
        tanPoints(e, fromPt).forEach(t => out.push(t));
      }
      const par = parallelSnap(e, fromPt, w, wtol);
      if (par) out.push(par);
    }
  }
  out.push(...intersectionSnaps(entities, isVisible));
  out.push(...apparentIntSnaps(entities, isVisible, w, wtol));
  return out;
}

void distToSeg; void arcPoints;
