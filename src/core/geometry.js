/* Pure 2D geometry. World units are feet, Y axis points up. */

export function dist(ax, ay, bx, by){ const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
export function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
export function deep(o){ return JSON.parse(JSON.stringify(o)); }
export function fmtN(n){ return String(Math.round(n * 10000) / 10000); }

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

/* Intersection of infinite lines a-b and c-d; midpoint fallback when parallel. */
export function lineIntersect(a, b, c, d){
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
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

/* Linear dimension geometry: extension lines, dimension line, midpoint, direction. */
export function dimGeom(e){
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, off = e.off;
  return {
    len, ang: Math.atan2(dy, dx),
    e1: [[e.x1, e.y1], [e.x1 + nx * (off + Math.sign(off) * 0.3), e.y1 + ny * (off + Math.sign(off) * 0.3)]],
    e2: [[e.x2, e.y2], [e.x2 + nx * (off + Math.sign(off) * 0.3), e.y2 + ny * (off + Math.sign(off) * 0.3)]],
    d: [[e.x1 + nx * off, e.y1 + ny * off], [e.x2 + nx * off, e.y2 + ny * off]],
    mid: [(e.x1 + e.x2) / 2 + nx * off, (e.y1 + e.y2) / 2 + ny * off],
    u: [ux, uy]
  };
}
