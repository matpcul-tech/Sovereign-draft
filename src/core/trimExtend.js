/* Trim and extend, pure over an entity list.
 * isVisible(layerName) filters which entities act as cutting/boundary edges.
 * Both return {ok:true, replace:[...]} — new entities (no ids) that replace the
 * target — or {ok:false, msg} when nothing can be done.
 */
import { dist, distToSeg, clamp, segSegParam, lineCircleTs, angDeg, onArc, arcSpan, deep } from './geometry.js';

const CUT_EPS = 1e-4;

function isCutter(o){ return o.type === 'line' || o.type === 'poly' || o.type === 'circle' || o.type === 'arc'; }

/* All parameters t along segment a-b where a cutter crosses it. */
export function lineCutTs(entities, isVisible, ax, ay, bx, by, excludeId, selfPoly, selfSeg){
  const ts = [];
  for (const o of entities){
    if (!isCutter(o) || !isVisible(o.layer)) continue;
    if (o.id === excludeId && o !== selfPoly) continue;
    if (o.type === 'line'){
      const r = segSegParam(ax, ay, bx, by, o.x1, o.y1, o.x2, o.y2);
      if (r && r.u > -1e-9 && r.u < 1 + 1e-9) ts.push(r.t);
    } else if (o.type === 'poly'){
      const n = o.pts.length, segs = o.closed ? n : n - 1;
      for (let i = 0; i < segs; i++){
        if (o === selfPoly && i === selfSeg) continue;
        const j = (i + 1) % n;
        const r = segSegParam(ax, ay, bx, by, o.pts[i][0], o.pts[i][1], o.pts[j][0], o.pts[j][1]);
        if (r && r.u > -1e-9 && r.u < 1 + 1e-9) ts.push(r.t);
      }
    } else if (o.type === 'circle'){
      lineCircleTs(ax, ay, bx, by, o.cx, o.cy, o.r).forEach(t => ts.push(t));
    } else if (o.type === 'arc'){
      lineCircleTs(ax, ay, bx, by, o.cx, o.cy, o.r).forEach(t => {
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        if (onArc(o, angDeg(o.cx, o.cy, px, py), 0.2)) ts.push(t);
      });
    }
  }
  return ts;
}

export function interiorSorted(ts, lo, hi){
  const out = [];
  ts.sort((a, b) => a - b);
  for (const t of ts){
    if (t <= lo + CUT_EPS || t >= hi - CUT_EPS) continue;
    if (out.length && Math.abs(t - out[out.length - 1]) < CUT_EPS) continue;
    out.push(t);
  }
  return out;
}

/* Angles (deg) where other entities cross circle/arc e. */
export function circleCutAngles(entities, isVisible, e, excludeId){
  const angs = [];
  const addPt = (x, y) => angs.push(angDeg(e.cx, e.cy, x, y));
  for (const o of entities){
    if (o.id === excludeId || !isCutter(o) || !isVisible(o.layer)) continue;
    if (o.type === 'line'){
      lineCircleTs(o.x1, o.y1, o.x2, o.y2, e.cx, e.cy, e.r).forEach(t => {
        if (t > -1e-9 && t < 1 + 1e-9) addPt(o.x1 + (o.x2 - o.x1) * t, o.y1 + (o.y2 - o.y1) * t);
      });
    } else if (o.type === 'poly'){
      const n = o.pts.length, segs = o.closed ? n : n - 1;
      for (let i = 0; i < segs; i++){
        const j = (i + 1) % n, a = o.pts[i], b = o.pts[j];
        lineCircleTs(a[0], a[1], b[0], b[1], e.cx, e.cy, e.r).forEach(t => {
          if (t > -1e-9 && t < 1 + 1e-9) addPt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        });
      }
    } else if (o.type === 'circle' || o.type === 'arc'){
      const d = dist(e.cx, e.cy, o.cx, o.cy);
      if (d < 1e-9 || d > e.r + o.r || d < Math.abs(e.r - o.r)) continue;
      const a2 = (e.r * e.r - o.r * o.r + d * d) / (2 * d);
      const h2 = e.r * e.r - a2 * a2; if (h2 < 0) continue;
      const h = Math.sqrt(h2);
      const mx = e.cx + a2 * (o.cx - e.cx) / d, my = e.cy + a2 * (o.cy - e.cy) / d;
      const px = -(o.cy - e.cy) / d, py = (o.cx - e.cx) / d;
      [[mx + h * px, my + h * py], [mx - h * px, my - h * py]].forEach(p => {
        if (o.type === 'arc' && !onArc(o, angDeg(o.cx, o.cy, p[0], p[1]), 0.2)) return;
        addPt(p[0], p[1]);
      });
    }
  }
  angs.sort((a, b) => a - b);
  const out = [];
  for (const a of angs){
    if (out.length && Math.abs(a - out[out.length - 1]) < 0.05) continue;
    out.push(a);
  }
  return out;
}

export function trimEntity(entities, isVisible, e, w){
  if (e.type === 'line'){
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1, L2 = dx * dx + dy * dy || 1e-12;
    const tTap = clamp(((w[0] - e.x1) * dx + (w[1] - e.y1) * dy) / L2, 0, 1);
    const cuts = interiorSorted(lineCutTs(entities, isVisible, e.x1, e.y1, e.x2, e.y2, e.id), 0, 1);
    if (!cuts.length) return { ok: false, msg: 'No intersections to trim to' };
    const bounds = [0, ...cuts, 1];
    const keep = [];
    for (let i = 0; i < bounds.length - 1; i++){
      if (tTap >= bounds[i] && tTap <= bounds[i + 1]) continue;
      keep.push({ type: 'line', layer: e.layer,
        x1: e.x1 + dx * bounds[i], y1: e.y1 + dy * bounds[i],
        x2: e.x1 + dx * bounds[i + 1], y2: e.y1 + dy * bounds[i + 1] });
    }
    return { ok: true, replace: keep };
  }
  if (e.type === 'circle'){
    const angs = circleCutAngles(entities, isVisible, e, e.id);
    if (angs.length < 2) return { ok: false, msg: 'Needs two intersections to trim a circle' };
    const tap = angDeg(e.cx, e.cy, w[0], w[1]);
    let ki = -1;
    for (let q = 0; q < angs.length; q++){
      const a1 = angs[q], a2 = angs[(q + 1) % angs.length];
      const span = ((a2 - a1) % 360 + 360) % 360 || 360;
      const off = ((tap - a1) % 360 + 360) % 360;
      if (off < span){ ki = q; break; }
    }
    if (ki < 0) ki = angs.length - 1;
    const keepA1 = angs[(ki + 1) % angs.length], keepA2 = angs[ki];
    return { ok: true, replace: [{ type: 'arc', layer: e.layer, cx: e.cx, cy: e.cy, r: e.r, a1: keepA1, a2: keepA2 }] };
  }
  if (e.type === 'arc'){
    const span = arcSpan(e);
    const raw = circleCutAngles(entities, isVisible, e, e.id);
    const offs = [];
    raw.forEach(a => {
      const o = ((a - e.a1) % 360 + 360) % 360;
      if (o > 0.1 && o < span - 0.1) offs.push(o);
    });
    offs.sort((a, b) => a - b);
    if (!offs.length) return { ok: false, msg: 'No intersections to trim to' };
    let tapOff = ((angDeg(e.cx, e.cy, w[0], w[1]) - e.a1) % 360 + 360) % 360;
    tapOff = clamp(tapOff, 0, span);
    const bounds = [0, ...offs, span];
    const keep = [];
    for (let m = 0; m < bounds.length - 1; m++){
      if (tapOff >= bounds[m] && tapOff <= bounds[m + 1]) continue;
      if (bounds[m + 1] - bounds[m] < 0.5) continue;
      keep.push({ type: 'arc', layer: e.layer, cx: e.cx, cy: e.cy, r: e.r, a1: e.a1 + bounds[m], a2: e.a1 + bounds[m + 1] });
    }
    return { ok: true, replace: keep };
  }
  if (e.type === 'poly'){
    const pts = e.pts, n = pts.length, segs = e.closed ? n : n - 1;
    let si = 0, bd = 1e18;
    for (let s = 0; s < segs; s++){
      const j = (s + 1) % n;
      const dd = distToSeg(w[0], w[1], pts[s][0], pts[s][1], pts[j][0], pts[j][1]);
      if (dd < bd){ bd = dd; si = s; }
    }
    const A = pts[si], B = pts[(si + 1) % n];
    const ddx = B[0] - A[0], ddy = B[1] - A[1], LL = ddx * ddx + ddy * ddy || 1e-12;
    const tt = clamp(((w[0] - A[0]) * ddx + (w[1] - A[1]) * ddy) / LL, 0, 1);
    const cuts = interiorSorted(lineCutTs(entities, isVisible, A[0], A[1], B[0], B[1], e.id, e, si), 0, 1);
    if (!cuts.length) return { ok: false, msg: 'No intersections to trim to' };
    const b2 = [0, ...cuts, 1];
    let ua = 0, ub = 1;
    for (let m = 0; m < b2.length - 1; m++){
      if (tt >= b2[m] && tt <= b2[m + 1]){ ua = b2[m]; ub = b2[m + 1]; break; }
    }
    const lerp = t => [A[0] + ddx * t, A[1] + ddy * t];
    const out = [];
    if (e.closed){
      const chain = [];
      if (ub < 1 - CUT_EPS) chain.push(lerp(ub));
      for (let k = 1; k <= n; k++) chain.push(pts[(si + k) % n].slice());
      if (ua > CUT_EPS) chain.push(lerp(ua));
      if (chain.length >= 2) out.push({ type: 'poly', layer: e.layer, closed: false, pts: chain });
    } else {
      const left = pts.slice(0, si + 1).map(p => p.slice());
      if (ua > CUT_EPS) left.push(lerp(ua));
      if (left.length >= 2) out.push({ type: 'poly', layer: e.layer, closed: false, pts: left });
      const right = [];
      if (ub < 1 - CUT_EPS) right.push(lerp(ub));
      pts.slice(si + 1).forEach(p => right.push(p.slice()));
      if (right.length >= 2) out.push({ type: 'poly', layer: e.layer, closed: false, pts: right });
    }
    return { ok: true, replace: out };
  }
  return { ok: false, msg: 'Trim works on lines, polylines, circles and arcs' };
}

export function extendEntity(entities, isVisible, e, w){
  function nearestForward(ax, ay, bx, by, selfPoly, selfSeg){
    const ts = lineCutTs(entities, isVisible, ax, ay, bx, by, e.id, selfPoly, selfSeg);
    let best = null;
    ts.forEach(t => { if (t > 1 + 1e-6 && (best === null || t < best)) best = t; });
    return best === null ? null : [ax + (bx - ax) * best, ay + (by - ay) * best];
  }
  if (e.type === 'line'){
    const d1 = dist(w[0], w[1], e.x1, e.y1), d2 = dist(w[0], w[1], e.x2, e.y2);
    const ne = deep(e);
    const p = d1 < d2
      ? nearestForward(e.x2, e.y2, e.x1, e.y1)
      : nearestForward(e.x1, e.y1, e.x2, e.y2);
    if (!p) return { ok: false, msg: 'Nothing to extend to' };
    if (d1 < d2){ ne.x1 = p[0]; ne.y1 = p[1]; } else { ne.x2 = p[0]; ne.y2 = p[1]; }
    return { ok: true, replace: [ne] };
  }
  if (e.type === 'poly' && !e.closed && e.pts.length >= 2){
    const n = e.pts.length;
    const dS = dist(w[0], w[1], e.pts[0][0], e.pts[0][1]);
    const dE = dist(w[0], w[1], e.pts[n - 1][0], e.pts[n - 1][1]);
    const ne = deep(e);
    let p;
    if (dS < dE){
      p = nearestForward(e.pts[1][0], e.pts[1][1], e.pts[0][0], e.pts[0][1], e, 0);
      if (p) ne.pts[0] = [p[0], p[1]];
    } else {
      p = nearestForward(e.pts[n - 2][0], e.pts[n - 2][1], e.pts[n - 1][0], e.pts[n - 1][1], e, n - 2);
      if (p) ne.pts[n - 1] = [p[0], p[1]];
    }
    if (!p) return { ok: false, msg: 'Nothing to extend to' };
    return { ok: true, replace: [ne] };
  }
  return { ok: false, msg: 'Extend works on lines and open polylines' };
}
