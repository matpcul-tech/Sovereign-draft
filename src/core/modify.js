/* Fillet, chamfer, 3-point arc, mirror, scale, rotate, rectangular / polar array, join.
 * Pure over entity objects (no ids). Callers push undo and assign ids.
 */
import {
  dist, deep, hypot, norm, angDeg, onArc, arcSpan, circleFrom3,
  lineIntersectStrict, rotatePt, scalePt, mirrorPt, copyStyle, perpFoot
} from './geometry.js';

function lineEnds(e){
  if (e.type === 'line') return [[e.x1, e.y1], [e.x2, e.y2]];
  return null;
}

function setLine(e, a, b){
  e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1];
}

function keepDirFromPick(a, b, I, pick){
  /* Direction from I along the line toward the pick (or the farther end). */
  const da = dist(I[0], I[1], a[0], a[1]);
  const db = dist(I[0], I[1], b[0], b[1]);
  const towardA = [a[0] - I[0], a[1] - I[1]];
  const towardB = [b[0] - I[0], b[1] - I[1]];
  if (pick){
    const dA = dist(pick[0], pick[1], a[0], a[1]);
    const dB = dist(pick[0], pick[1], b[0], b[1]);
    /* Prefer the end the pick is closer to, as long as that end isn't I itself. */
    if (dA < dB && da > 1e-8) return norm(towardA[0], towardA[1]);
    if (dB <= dA && db > 1e-8) return norm(towardB[0], towardB[1]);
  }
  if (db >= da && db > 1e-8) return norm(towardB[0], towardB[1]);
  if (da > 1e-8) return norm(towardA[0], towardA[1]);
  return norm(b[0] - a[0], b[1] - a[1]);
}

/* Fillet two lines. r=0 is a sharp corner (trim/extend to the intersection).
 * Returns {ok, replace:[{orig, ents}]} — each orig is swapped for ents.
 */
export function filletLines(e1, e2, r, p1, p2){
  if (e1.type !== 'line' || e2.type !== 'line') return { ok: false, msg: 'Fillet works on two lines' };
  const a = [e1.x1, e1.y1], b = [e1.x2, e1.y2];
  const c = [e2.x1, e2.y1], d = [e2.x2, e2.y2];
  const I = lineIntersectStrict(a, b, c, d);
  if (!I) return { ok: false, msg: 'Lines are parallel' };
  const Ix = [I[0], I[1]];
  const k1 = keepDirFromPick(a, b, Ix, p1);
  const k2 = keepDirFromPick(c, d, Ix, p2);
  const cross = k1[0] * k2[1] - k1[1] * k2[0];
  if (Math.abs(cross) < 1e-8) return { ok: false, msg: 'Lines are collinear' };

  const n1 = [-k1[1], k1[0]];
  const n2 = [-k2[1], k2[0]];
  /* Interior test point slightly along both keep directions. */
  const mid = [Ix[0] + k1[0] * 0.25 + k2[0] * 0.25, Ix[1] + k1[1] * 0.25 + k2[1] * 0.25];
  const s1 = Math.sign((mid[0] - Ix[0]) * n1[0] + (mid[1] - Ix[1]) * n1[1]) || 1;
  const s2 = Math.sign((mid[0] - Ix[0]) * n2[0] + (mid[1] - Ix[1]) * n2[1]) || 1;

  if (!r || r <= 1e-9){
    const L1 = copyStyle(e1, { type: 'line', layer: e1.layer, x1: Ix[0] + k1[0] * 0, y1: Ix[1] + k1[1] * 0, x2: Ix[0] + k1[0] * Math.max(dist(Ix[0], Ix[1], a[0], a[1]), dist(Ix[0], Ix[1], b[0], b[1])), y2: Ix[1] + k1[1] * Math.max(dist(Ix[0], Ix[1], a[0], a[1]), dist(Ix[0], Ix[1], b[0], b[1])) });
    /* Keep the far endpoint of each original segment. */
    const far1 = dist(Ix[0], Ix[1], a[0], a[1]) > dist(Ix[0], Ix[1], b[0], b[1]) ? a : b;
    const far2 = dist(Ix[0], Ix[1], c[0], c[1]) > dist(Ix[0], Ix[1], d[0], d[1]) ? c : d;
    /* If pick prefers a particular end, keep that end when it isn't I. */
    const keep1 = (p1 && dist(p1[0], p1[1], a[0], a[1]) < dist(p1[0], p1[1], b[0], b[1]) && dist(Ix[0], Ix[1], a[0], a[1]) > 1e-6) ? a
      : (p1 && dist(p1[0], p1[1], b[0], b[1]) <= dist(p1[0], p1[1], a[0], a[1]) && dist(Ix[0], Ix[1], b[0], b[1]) > 1e-6) ? b
      : far1;
    const keep2 = (p2 && dist(p2[0], p2[1], c[0], c[1]) < dist(p2[0], p2[1], d[0], d[1]) && dist(Ix[0], Ix[1], c[0], c[1]) > 1e-6) ? c
      : (p2 && dist(p2[0], p2[1], d[0], d[1]) <= dist(p2[0], p2[1], c[0], c[1]) && dist(Ix[0], Ix[1], d[0], d[1]) > 1e-6) ? d
      : far2;
    const nL1 = copyStyle(e1, { type: 'line', layer: e1.layer, x1: keep1[0], y1: keep1[1], x2: Ix[0], y2: Ix[1] });
    const nL2 = copyStyle(e2, { type: 'line', layer: e2.layer, x1: keep2[0], y1: keep2[1], x2: Ix[0], y2: Ix[1] });
    void L1;
    return { ok: true, replace: [{ orig: e1, ents: [nL1] }, { orig: e2, ents: [nL2] }] };
  }

  /* Offset both infinite lines by r toward the interior; their intersection is the arc center. */
  const o1a = [Ix[0] + n1[0] * s1 * r, Ix[1] + n1[1] * s1 * r];
  const o1b = [o1a[0] + k1[0], o1a[1] + k1[1]];
  const o2a = [Ix[0] + n2[0] * s2 * r, Ix[1] + n2[1] * s2 * r];
  const o2b = [o2a[0] + k2[0], o2a[1] + k2[1]];
  const C = lineIntersectStrict(o1a, o1b, o2a, o2b);
  if (!C) return { ok: false, msg: 'Cannot place fillet' };
  const T1 = [C[0] - n1[0] * s1 * r, C[1] - n1[1] * s1 * r];
  const T2 = [C[0] - n2[0] * s2 * r, C[1] - n2[1] * s2 * r];

  const far1 = dist(Ix[0], Ix[1], a[0], a[1]) > dist(Ix[0], Ix[1], b[0], b[1]) ? a : b;
  const far2 = dist(Ix[0], Ix[1], c[0], c[1]) > dist(Ix[0], Ix[1], d[0], d[1]) ? c : d;
  const keep1 = (p1 && dist(p1[0], p1[1], a[0], a[1]) < dist(p1[0], p1[1], b[0], b[1])) ? a : (p1 ? b : far1);
  const keep2 = (p2 && dist(p2[0], p2[1], c[0], c[1]) < dist(p2[0], p2[1], d[0], d[1])) ? c : (p2 ? d : far2);
  /* If keep end is on the I side of T, use the far end instead. */
  const use1 = (dist(keep1[0], keep1[1], T1[0], T1[1]) < 1e-6) ? far1 : keep1;
  const use2 = (dist(keep2[0], keep2[1], T2[0], T2[1]) < 1e-6) ? far2 : keep2;

  const nL1 = copyStyle(e1, { type: 'line', layer: e1.layer, x1: use1[0], y1: use1[1], x2: T1[0], y2: T1[1] });
  const nL2 = copyStyle(e2, { type: 'line', layer: e2.layer, x1: use2[0], y1: use2[1], x2: T2[0], y2: T2[1] });

  let a1 = angDeg(C[0], C[1], T1[0], T1[1]);
  let a2 = angDeg(C[0], C[1], T2[0], T2[1]);
  const arc = copyStyle(e1, { type: 'arc', layer: e1.layer, cx: C[0], cy: C[1], r, a1, a2 });
  /* Arc midpoint should sit near the interior, not the exterior. */
  const midOff = ((a2 - a1) % 360 + 360) % 360;
  const midA = (a1 + (midOff === 0 ? 180 : midOff / 2)) * Math.PI / 180;
  const midP = [C[0] + r * Math.cos(midA), C[1] + r * Math.sin(midA)];
  const dInt = dist(midP[0], midP[1], mid[0], mid[1]);
  const a1s = a2, a2s = a1;
  const midOff2 = ((a2s - a1s) % 360 + 360) % 360;
  const midA2 = (a1s + (midOff2 === 0 ? 180 : midOff2 / 2)) * Math.PI / 180;
  const midP2 = [C[0] + r * Math.cos(midA2), C[1] + r * Math.sin(midA2)];
  if (dist(midP2[0], midP2[1], mid[0], mid[1]) < dInt){
    arc.a1 = a1s; arc.a2 = a2s;
  }
  void onArc; void arcSpan;
  return {
    ok: true,
    replace: [
      { orig: e1, ents: [nL1] },
      { orig: e2, ents: [nL2] }
    ],
    extra: [arc]
  };
}

/* Chamfer two lines. Distances d1, d2 measured from the intersection along each keep dir. */
export function chamferLines(e1, e2, d1, d2, p1, p2){
  if (e1.type !== 'line' || e2.type !== 'line') return { ok: false, msg: 'Chamfer works on two lines' };
  const a = [e1.x1, e1.y1], b = [e1.x2, e1.y2];
  const c = [e2.x1, e2.y1], d = [e2.x2, e2.y2];
  const I = lineIntersectStrict(a, b, c, d);
  if (!I) return { ok: false, msg: 'Lines are parallel' };
  const Ix = [I[0], I[1]];
  const k1 = keepDirFromPick(a, b, Ix, p1);
  const k2 = keepDirFromPick(c, d, Ix, p2);
  const T1 = [Ix[0] + k1[0] * d1, Ix[1] + k1[1] * d1];
  const T2 = [Ix[0] + k2[0] * d2, Ix[1] + k2[1] * d2];
  const far1 = dist(Ix[0], Ix[1], a[0], a[1]) > dist(Ix[0], Ix[1], b[0], b[1]) ? a : b;
  const far2 = dist(Ix[0], Ix[1], c[0], c[1]) > dist(Ix[0], Ix[1], d[0], d[1]) ? c : d;
  const keep1 = (p1 && dist(p1[0], p1[1], a[0], a[1]) < dist(p1[0], p1[1], b[0], b[1])) ? a : (p1 ? b : far1);
  const keep2 = (p2 && dist(p2[0], p2[1], c[0], c[1]) < dist(p2[0], p2[1], d[0], d[1])) ? c : (p2 ? d : far2);
  const nL1 = copyStyle(e1, { type: 'line', layer: e1.layer, x1: keep1[0], y1: keep1[1], x2: T1[0], y2: T1[1] });
  const nL2 = copyStyle(e2, { type: 'line', layer: e2.layer, x1: keep2[0], y1: keep2[1], x2: T2[0], y2: T2[1] });
  const cut = copyStyle(e1, { type: 'line', layer: e1.layer, x1: T1[0], y1: T1[1], x2: T2[0], y2: T2[1] });
  return {
    ok: true,
    replace: [{ orig: e1, ents: [nL1] }, { orig: e2, ents: [nL2] }],
    extra: [cut]
  };
}

export function arcFrom3(p1, p2, p3){
  const c = circleFrom3(p1, p2, p3);
  if (!c || c.r < 0.05) return null;
  let a1 = angDeg(c.cx, c.cy, p1[0], p1[1]);
  let a2 = angDeg(c.cx, c.cy, p3[0], p3[1]);
  const aMid = angDeg(c.cx, c.cy, p2[0], p2[1]);
  const e = { type: 'arc', cx: c.cx, cy: c.cy, r: c.r, a1, a2 };
  if (!onArc(e, aMid, 0.5)){
    e.a1 = a2; e.a2 = a1;
  }
  return e;
}

export function transformEnt(e, fn, extra){
  if (e.type === 'line' || (e.type === 'dim' && e.kind !== 'angular')){
    const a = fn(e.x1, e.y1), b = fn(e.x2, e.y2);
    e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1];
    if (e.type === 'dim' && extra && extra.scaleOff) e.off *= extra.scaleOff;
  } else if (e.type === 'dim' && e.kind === 'angular'){
    const a = fn(e.x1, e.y1), b = fn(e.x2, e.y2), c = fn(e.x3, e.y3);
    e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1]; e.x3 = c[0]; e.y3 = c[1];
    if (extra && extra.scaleOff) e.off *= extra.scaleOff;
  } else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader'){
    for (let i = 0; i < (e.pts || []).length; i++){
      const p = fn(e.pts[i][0], e.pts[i][1]);
      e.pts[i] = [p[0], p[1]];
    }
  } else if (e.type === 'circle'){
    const p = fn(e.cx, e.cy);
    e.cx = p[0]; e.cy = p[1];
    if (extra && extra.scaleR) e.r *= extra.scaleR;
  } else if (e.type === 'ellipse'){
    const p = fn(e.cx, e.cy);
    e.cx = p[0]; e.cy = p[1];
    if (extra && extra.scaleR){ e.rx = (e.rx || 0) * extra.scaleR; e.ry = (e.ry || 0) * extra.scaleR; }
    if (extra && extra.addAng) e.rot = (e.rot || 0) + extra.addAng;
  } else if (e.type === 'arc'){
    const p = fn(e.cx, e.cy);
    e.cx = p[0]; e.cy = p[1];
    if (extra && extra.scaleR) e.r *= extra.scaleR;
    if (extra && extra.addAng){ e.a1 += extra.addAng; e.a2 += extra.addAng; }
    if (extra && extra.mirrorAng){
      /* Reflect start/end angles across the mirror line's angle. */
      const ma = extra.mirrorAng;
      e.a1 = (2 * ma - e.a2 + 360) % 360;
      e.a2 = (2 * ma - extra._oldA1 + 360) % 360;
    }
  } else if (e.type === 'text'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.scaleR) e.size *= extra.scaleR;
  } else if (e.type === 'table'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.scaleR){
      e.colW = (e.colW || []).map(w => w * extra.scaleR);
      e.rowH = (e.rowH || 0.85) * extra.scaleR;
    }
  } else if (e.type === 'image'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.scaleR){ e.w = (e.w || 1) * extra.scaleR; e.h = (e.h || 1) * extra.scaleR; }
    if (extra && extra.addAng) e.rot = (e.rot || 0) + extra.addAng;
  } else if (e.type === 'insert'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.addAng) e.rot = (e.rot || 0) + extra.addAng;
    if (extra && extra.scaleR){
      e.scale = (e.scale || 1) * extra.scaleR;
      if (e.width) e.width *= extra.scaleR;
    }
    if (extra && extra.mirrorAng != null){
      e.flip = (e.flip || 1) * -1;
      e.rot = extra.mirrorAng * 2 - (e.rot || 0);
    }
  } else if (e.type === 'xref'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.addAng) e.rot = (e.rot || 0) + extra.addAng;
    if (extra && extra.scaleR) e.scale = (e.scale == null ? 1 : e.scale) * extra.scaleR;
    if (extra && extra.mirrorAng != null) e.rot = extra.mirrorAng * 2 - (e.rot || 0);
  } else if (e.type === 'xline'){
    const a = fn(e.x1, e.y1), b = fn(e.x2, e.y2);
    e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1];
  } else if (e.type === 'room'){
    for (let i = 0; i < (e.pts || []).length; i++){
      const p = fn(e.pts[i][0], e.pts[i][1]);
      e.pts[i] = [p[0], p[1]];
    }
    if (e.cx != null){
      const p = fn(e.cx, e.cy);
      e.cx = p[0]; e.cy = p[1];
    }
  } else if (e.type === 'grid'){
    const p = fn(e.x, e.y);
    e.x = p[0]; e.y = p[1];
    if (extra && extra.addAng) e.rot = (e.rot || 0) + extra.addAng;
    if (extra && extra.scaleR){
      e.cx = (e.cx || 12) * extra.scaleR;
      e.ry = (e.ry || 12) * extra.scaleR;
      e.bubble = (e.bubble || 1.1) * extra.scaleR;
    }
  }
  return e;
}

export function moveEntities(ents, dx, dy){
  const out = deep(ents);
  out.forEach(e => transformEnt(e, (x, y) => [x + dx, y + dy]));
  return out;
}

export function rotateEntities(ents, cx, cy, deg){
  const out = deep(ents);
  out.forEach(e => {
    if (e.type === 'arc') { /* angles rotate with the entity */ }
    transformEnt(e, (x, y) => rotatePt(x, y, cx, cy, deg), { addAng: deg });
  });
  return out;
}

export function scaleEntities(ents, cx, cy, f){
  const out = deep(ents);
  out.forEach(e => transformEnt(e, (x, y) => scalePt(x, y, cx, cy, f), { scaleR: f, scaleOff: f }));
  return out;
}

export function mirrorEntities(ents, ax, ay, bx, by){
  const out = deep(ents);
  const ma = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
  out.forEach(e => {
    const oldA1 = e.type === 'arc' ? e.a1 : 0;
    const oldA2 = e.type === 'arc' ? e.a2 : 0;
    transformEnt(e, (x, y) => mirrorPt(x, y, ax, ay, bx, by));
    if (e.type === 'arc'){
      /* After reflecting the center, reflect the sweep so orientation stays CCW. */
      e.a1 = (2 * ma - oldA2 + 720) % 360;
      e.a2 = (2 * ma - oldA1 + 720) % 360;
    }
    if (e.type === 'insert'){
      e.flip = (e.flip || 1) * -1;
      e.rot = ma * 2 - (e.rot || 0);
    }
  });
  return out;
}

export function rectangularArray(ents, cols, rows, colDist, rowDist, angleDeg){
  const out = [];
  const ang = (angleDeg || 0) * Math.PI / 180;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const vx = -Math.sin(ang), vy = Math.cos(ang);
  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      if (r === 0 && c === 0) continue;
      const dx = ux * c * colDist + vx * r * rowDist;
      const dy = uy * c * colDist + vy * r * rowDist;
      out.push(...moveEntities(ents, dx, dy));
    }
  }
  return out;
}

export function polarArray(ents, cx, cy, count, fillDeg){
  const n = Math.max(2, count | 0);
  const fill = fillDeg == null ? 360 : fillDeg;
  const closed = Math.abs(Math.abs(fill) - 360) < 0.5;
  const step = fill / (closed ? n : Math.max(1, n - 1));
  const out = [];
  for (let i = 1; i < n; i++){
    out.push(...rotateEntities(ents, cx, cy, step * i));
  }
  return out;
}

const JOIN_TOL = 0.08;

function endsOf(e){
  if (e.type === 'line') return [[e.x1, e.y1], [e.x2, e.y2]];
  if (e.type === 'poly' && e.pts && e.pts.length) return [e.pts[0], e.pts[e.pts.length - 1]];
  return null;
}

function chainPts(e){
  if (e.type === 'line') return [[e.x1, e.y1], [e.x2, e.y2]];
  if (e.type === 'poly') return e.pts.map(p => p.slice());
  return null;
}

function closeEnough(a, b){ return dist(a[0], a[1], b[0], b[1]) < JOIN_TOL; }

/* Join a set of lines/open polylines into as few polylines as possible. */
export function joinEntities(ents){
  const pool = ents.filter(e => (e.type === 'line' || (e.type === 'poly' && !e.closed)) && chainPts(e));
  if (pool.length < 2) return { ok: false, msg: 'Select at least two lines or polylines' };
  const used = new Set();
  const chains = [];
  function take(i, reverse){
    used.add(i);
    const pts = chainPts(pool[i]);
    return reverse ? pts.reverse() : pts;
  }
  for (let i = 0; i < pool.length; i++){
    if (used.has(i)) continue;
    let pts = take(i, false);
    let grew = true;
    while (grew){
      grew = false;
      for (let j = 0; j < pool.length; j++){
        if (used.has(j)) continue;
        const other = chainPts(pool[j]);
        const head = pts[0], tail = pts[pts.length - 1];
        const oH = other[0], oT = other[other.length - 1];
        if (closeEnough(tail, oH)){ pts = pts.concat(other.slice(1)); used.add(j); grew = true; }
        else if (closeEnough(tail, oT)){ pts = pts.concat(other.slice(0, -1).reverse()); used.add(j); grew = true; }
        else if (closeEnough(head, oT)){ pts = other.slice(0, -1).concat(pts); used.add(j); grew = true; }
        else if (closeEnough(head, oH)){ pts = other.slice(1).reverse().concat(pts); used.add(j); grew = true; }
      }
    }
    /* Dedup consecutive */
    const clean = [pts[0]];
    for (let k = 1; k < pts.length; k++){
      if (!closeEnough(clean[clean.length - 1], pts[k])) clean.push(pts[k]);
    }
    const closed = clean.length > 2 && closeEnough(clean[0], clean[clean.length - 1]);
    if (closed) clean.pop();
    chains.push({ type: 'poly', layer: pool[i].layer, closed, pts: clean, lt: pool[i].lt, lw: pool[i].lw });
  }
  return { ok: true, replace: chains, orig: pool };
}

export function entityLength(e){
  if (e.type === 'line' || e.type === 'xline') return dist(e.x1, e.y1, e.x2, e.y2);
  if (e.type === 'circle') return 2 * Math.PI * e.r;
  if (e.type === 'arc') return arcSpan(e) * Math.PI / 180 * e.r;
  if (e.type === 'ellipse'){
    const rx = e.rx || 0, ry = e.ry || 0;
    const h = ((rx - ry) * (rx - ry)) / (((rx + ry) * (rx + ry)) || 1);
    return Math.PI * (rx + ry) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
  }
  if (e.type === 'poly' || e.type === 'leader' || e.type === 'cloud'){
    const pts = e.pts || [];
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) L += dist(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if ((e.closed || e.type === 'cloud') && pts.length > 2) L += dist(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
    return L;
  }
  if (e.type === 'dim') return dist(e.x1, e.y1, e.x2, e.y2);
  return 0;
}

export function entityArea(e){
  if (e.type === 'circle') return Math.PI * e.r * e.r;
  if (e.type === 'ellipse') return Math.PI * (e.rx || 0) * (e.ry || 0);
  if (e.type === 'room') return e.area != null ? e.area : 0;
  if ((e.type === 'poly' && e.closed) || e.type === 'hatch' || e.type === 'cloud'){
    const pts = e.pts || [];
    let a = 0;
    for (let i = 0; i < pts.length; i++){
      const j = (i + 1) % pts.length;
      a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(a / 2);
  }
  return 0;
}

void lineEnds; void setLine; void hypot; void perpFoot;
