/* Pure 2D geometry. World units are feet, Y axis points up. */

export function dist(ax, ay, bx, by){ const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
export function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
export function deep(o){ return JSON.parse(JSON.stringify(o)); }
export function fmtN(n){ return String(Math.round(n * 10000) / 10000); }
export function hypot(dx, dy){ return Math.sqrt(dx * dx + dy * dy); }
export function norm(dx, dy){ const L = hypot(dx, dy) || 1e-12; return [dx / L, dy / L]; }

/* Arc helpers. Arcs run counterclockwise from a1 to a2 (degrees). */
export function arcSpan(e){ const s = ((e.a2 - e.a1) % 360 + 360) % 360; return s === 0 ? 360 : s; }
export function arcPoints(e){
  let span = arcSpan(e);
  const steps = Math.max(2, Math.ceil(span / 6)), pts = [];
  for (let i = 0; i <= steps; i++){
    const a = (e.a1 + span * i / steps) * Math.PI / 180;
    pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]);
  }
  return pts;
}
export function angDeg(cx, cy, x, y){ const a = Math.atan2(y - cy, x - cx) * 180 / Math.PI; return (a % 360 + 360) % 360; }
export function onArc(e, deg, tol){
  const span = arcSpan(e);
  const off = ((deg - e.a1) % 360 + 360) % 360;
  return off <= span + (tol || 0.05) || off >= 360 - (tol || 0.05);
}

export function distToSeg(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (!L2) return dist(px, py, ax, ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
  return dist(px, py, ax + t * dx, ay + t * dy);
}

export function closestOnSeg(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (!L2) return { t: 0, x: ax, y: ay, d: dist(px, py, ax, ay) };
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d: dist(px, py, x, y) };
}

/* Perpendicular foot from P onto the infinite line A-B. */
export function perpFoot(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (!L2) return { t: 0, x: ax, y: ay };
  const t = ((px - ax) * dx + (py - ay) * dy) / L2;
  return { t, x: ax + t * dx, y: ay + t * dy };
}

/* Intersection of infinite lines a-b and c-d; midpoint fallback when parallel. */
export function lineIntersect(a, b, c, d){
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export function lineIntersectStrict(a, b, c, d){
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1], t];
}

/* Parametric intersection: returns {t on ab, u on cd} or null when parallel. */
export function segSegParam(ax, ay, bx, by, cx, cy, dx, dy){
  const rx = bx - ax, ry = by - ay, sx2 = dx - cx, sy2 = dy - cy;
  const den = rx * sy2 - ry * sx2;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy2 - (cy - ay) * sx2) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return { t, u };
}

export function segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy, tol){
  const r = segSegParam(ax, ay, bx, by, cx, cy, dx, dy);
  if (!r) return null;
  const eps = tol == null ? 1e-9 : tol;
  if (r.t < -eps || r.t > 1 + eps || r.u < -eps || r.u > 1 + eps) return null;
  return { x: ax + (bx - ax) * r.t, y: ay + (by - ay) * r.t, t: r.t, u: r.u };
}

/* Liang-Barsky clip of segment a-b to axis-aligned box [x0,y0,x1,y1]. */
export function clipSegToBox(x1, y1, x2, y2, box){
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  function clip(p, q){
    if (Math.abs(p) < 1e-12) return q >= -1e-12;
    const r = q / p;
    if (p < 0){ if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  }
  if (!clip(-dx, x1 - box[0])) return null;
  if (!clip(dx, box[2] - x1)) return null;
  if (!clip(-dy, y1 - box[1])) return null;
  if (!clip(dy, box[3] - y1)) return null;
  if (t1 < t0) return null;
  return {
    x1: x1 + t0 * dx, y1: y1 + t0 * dy,
    x2: x1 + t1 * dx, y2: y1 + t1 * dy
  };
}

export function ptInBox(x, y, box, pad){
  const p = pad || 0;
  return x >= box[0] - p && x <= box[2] + p && y >= box[1] - p && y <= box[3] + p;
}

/* Parameters t along a-b where the infinite line crosses circle (cx,cy,r). */
export function lineCircleTs(ax, ay, bx, by, cx, cy, r){
  const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  if (A < 1e-12) return [];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out = [(-B - sq) / (2 * A)];
  if (sq > 1e-12) out.push((-B + sq) / (2 * A));
  return out;
}

export function rotatePt(x, y, cx, cy, deg){
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

export function scalePt(x, y, cx, cy, f){
  return [cx + (x - cx) * f, cy + (y - cy) * f];
}

/* Reflect P across the infinite line A-B. */
export function mirrorPt(x, y, ax, ay, bx, by){
  const f = perpFoot(x, y, ax, ay, bx, by);
  return [2 * f.x - x, 2 * f.y - y];
}

/* Unique circle through three non-collinear points. Returns {cx,cy,r} or null. */
export function circleFrom3(p1, p2, p3){
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { cx: ux, cy: uy, r: dist(ux, uy, ax, ay) };
}

export function snapGrid(x, y, g){
  const s = g || 0.5;
  return [Math.round(x / s) * s, Math.round(y / s) * s];
}

export function polarSnap(p1, p2, stepDeg){
  const step = (stepDeg || 15) * Math.PI / 180;
  const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  const snapped = Math.round(ang / step) * step;
  const d = dist(p1[0], p1[1], p2[0], p2[1]);
  return [p1[0] + d * Math.cos(snapped), p1[1] + d * Math.sin(snapped)];
}

export function pointInPoly(x, y, pts){
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

export function polyArea(pts){
  let a = 0;
  for (let i = 0; i < pts.length; i++){
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a / 2;
}

export function polyCentroid(pts){
  const A = polyArea(pts) || 1e-12;
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++){
    const j = (i + 1) % pts.length;
    const c = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    cx += (pts[i][0] + pts[j][0]) * c;
    cy += (pts[i][1] + pts[j][1]) * c;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

/* Linear dimension geometry: extension lines, dimension line, midpoint, direction. */
export function dimGeom(e){
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, off = e.off;
  return {
    len, ang: Math.atan2(dy, dx),
    e1: [[e.x1, e.y1], [e.x1 + nx * (off + Math.sign(off || 1) * 0.3), e.y1 + ny * (off + Math.sign(off || 1) * 0.3)]],
    e2: [[e.x2, e.y2], [e.x2 + nx * (off + Math.sign(off || 1) * 0.3), e.y2 + ny * (off + Math.sign(off || 1) * 0.3)]],
    d: [[e.x1 + nx * off, e.y1 + ny * off], [e.x2 + nx * off, e.y2 + ny * off]],
    mid: [(e.x1 + e.x2) / 2 + nx * off, (e.y1 + e.y2) / 2 + ny * off],
    u: [ux, uy], n: [nx, ny]
  };
}

export function angularGeom(e){
  const a1 = Math.atan2(e.y1 - e.y2, e.x1 - e.x2);
  const a2 = Math.atan2(e.y3 - e.y2, e.x3 - e.x2);
  let span = a2 - a1;
  while (span > Math.PI) span -= Math.PI * 2;
  while (span < -Math.PI) span += Math.PI * 2;
  const r = Math.abs(e.off) || 2;
  const steps = Math.max(8, Math.ceil(Math.abs(span) * 18 / Math.PI));
  const arc = [];
  for (let i = 0; i <= steps; i++){
    const a = a1 + span * i / steps;
    arc.push([e.x2 + Math.cos(a) * r, e.y2 + Math.sin(a) * r]);
  }
  const midA = a1 + span / 2;
  return {
    vertex: [e.x2, e.y2],
    a1, a2, span, r,
    pA: arc[0],
    pB: arc[arc.length - 1],
    arc,
    mid: [e.x2 + Math.cos(midA) * r, e.y2 + Math.sin(midA) * r],
    value: Math.abs(span) * 180 / Math.PI
  };
}

export function copyStyle(from, to){
  if (!from || !to) return to;
  if (from.lt) to.lt = from.lt;
  if (from.lw != null) to.lw = from.lw;
  if (from.layer) to.layer = from.layer;
  return to;
}

export function ellipsePoints(e, n){
  n = n || 48;
  const rot = (e.rot || 0) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const rx = e.rx || 0, ry = e.ry || 0;
  const pts = [];
  for (let i = 0; i < n; i++){
    const t = (i / n) * Math.PI * 2;
    const lx = rx * Math.cos(t), ly = ry * Math.sin(t);
    pts.push([e.cx + lx * c - ly * s, e.cy + lx * s + ly * c]);
  }
  return pts;
}

/* Scalloped revision-cloud polyline. `amp` is bulge radius in feet. */
export function cloudPoints(pts, amp){
  amp = amp == null ? 0.4 : amp;
  if (!pts || pts.length < 3) return pts || [];
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++){
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
    const steps = Math.max(2, Math.round(L / Math.max(amp * 1.8, 0.25)));
    const nx = -dy / L, ny = dx / L;
    for (let k = 0; k < steps; k++){
      const t0 = k / steps, t1 = (k + 1) / steps;
      const p0 = [a[0] + dx * t0, a[1] + dy * t0];
      const p1 = [a[0] + dx * t1, a[1] + dy * t1];
      const mid = [(p0[0] + p1[0]) / 2 + nx * amp, (p0[1] + p1[1]) / 2 + ny * amp];
      for (let s = 0; s <= 4; s++){
        const u = s / 4, o = 1 - u;
        out.push([
          o * o * p0[0] + 2 * o * u * mid[0] + u * u * p1[0],
          o * o * p0[1] + 2 * o * u * mid[1] + u * u * p1[1]
        ]);
      }
    }
  }
  return out;
}

/* Tangent points on a circle from an external point. kind 6 = TAN. */
export function tanPoints(e, from){
  if (!from || e.type !== 'circle' || !e.r) return [];
  const dx = from[0] - e.cx, dy = from[1] - e.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= e.r + 1e-6) return [];
  const base = Math.atan2(dy, dx);
  const th = Math.acos(e.r / d);
  return [1, -1].map(s => {
    const a = base + s * th;
    return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a), 6];
  });
}

export function imageCorners(e){
  const rot = (e.rot || 0) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const w = e.w || 1, h = e.h || 1;
  const pts = [[0, 0], [w, 0], [w, h], [0, h]];
  return pts.map(p => [e.x + p[0] * c - p[1] * s, e.y + p[0] * s + p[1] * c]);
}

