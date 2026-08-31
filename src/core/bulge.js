/* Polyline arc segments.
 *
 * A polyline vertex can carry a bulge: the tangent of a quarter of the
 * included angle of the arc running from that vertex to the next one.
 * Zero is a straight segment, positive sweeps counterclockwise, negative
 * clockwise, and 1 is a half circle.
 *
 *   { type:'poly', pts:[[x,y],...], bulge:[b0, b1, ...], closed }
 *
 * This is how DXF stores curved polylines, and it is everywhere in real
 * drawings: rounded slabs, curbs, filleted plate outlines. Reading one
 * without bulges turns every arc into a chord, which is silent geometry
 * loss on import, and writing one without them loses the arcs again on the
 * way out.
 *
 * The bulge array is parallel to pts and sparse in practice, so a polyline
 * with no arcs carries nothing extra and behaves exactly as before.
 */

export const BULGE_TOL = 0.02;   /* model units of chord deviation */
export const BULGE_MIN_STEPS = 2;
export const BULGE_MAX_STEPS = 180;

export function hasBulge(e){
  const b = e && e.bulge;
  if (!b || !b.length) return false;
  for (let i = 0; i < b.length; i++) if (b[i]) return true;
  return false;
}

export function bulgeAt(e, i){
  const b = e && e.bulge;
  const v = b && b[i];
  return Number.isFinite(v) ? v : 0;
}

/* The arc through two points with a given bulge, as a centre, radius and
 * signed sweep. Returns null when the bulge is flat, which is the caller's
 * cue to keep the straight segment. */
export function bulgeArc(p0, p1, b){
  if (!b) return null;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const chord = Math.hypot(dx, dy);
  if (!(chord > 1e-12)) return null;
  const theta = 4 * Math.atan(b);            /* included angle, signed */
  const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
  /* The centre sits off the chord midpoint by the sagitta complement, on the
   * side the sign of the bulge picks. */
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
  const sign = (Math.abs(theta) > Math.PI ? -1 : 1) * (b > 0 ? 1 : -1);
  const cx = mx - sign * h * (dy / chord);
  const cy = my + sign * h * (dx / chord);
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  return { cx, cy, r, a0, sweep: theta };
}

/* Points along one bulged segment, excluding the start vertex so segments
 * chain without duplicates. Step count follows the radius and the sweep so
 * a wide sweeping curb costs what it needs and a tight fillet stays smooth. */
export function bulgeSegPoints(p0, p1, b, tol){
  const arc = bulgeArc(p0, p1, b);
  if (!arc) return [[p1[0], p1[1]]];
  const t = tol || BULGE_TOL;
  /* Chord deviation for n steps is r * (1 - cos(sweep / 2n)). Solve for the
   * smallest n that keeps it under tolerance. */
  const half = Math.min(1, Math.max(-1, 1 - t / arc.r));
  const perStep = 2 * Math.acos(half);
  const n = Math.max(BULGE_MIN_STEPS, Math.min(BULGE_MAX_STEPS,
    perStep > 1e-9 ? Math.ceil(Math.abs(arc.sweep) / perStep) : BULGE_MIN_STEPS));
  const out = [];
  for (let i = 1; i <= n; i++){
    const a = arc.a0 + arc.sweep * (i / n);
    out.push([arc.cx + arc.r * Math.cos(a), arc.cy + arc.r * Math.sin(a)]);
  }
  /* Land exactly on the stored vertex rather than near it. */
  out[out.length - 1] = [p1[0], p1[1]];
  return out;
}

/* The polyline as line work. A polyline with no bulges returns its own
 * points untouched, so nothing that already worked pays for this. */
export function polyOutline(e, tol){
  const pts = (e && e.pts) || [];
  if (!hasBulge(e) || pts.length < 2) return pts;
  const out = [[pts[0][0], pts[0][1]]];
  const last = e.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++){
    const a = pts[i], c = pts[(i + 1) % pts.length];
    bulgeSegPoints(a, c, bulgeAt(e, i), tol).forEach(p => out.push(p));
  }
  if (e.closed) out.pop();
  return out;
}

/* Arc length of a bulged polyline, which is what a length readout wants. */
export function bulgeLength(e){
  const pts = (e && e.pts) || [];
  if (pts.length < 2) return 0;
  let L = 0;
  const last = e.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++){
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const arc = bulgeArc(a, c, bulgeAt(e, i));
    L += arc ? Math.abs(arc.r * arc.sweep) : Math.hypot(c[0] - a[0], c[1] - a[1]);
  }
  return L;
}

/* Exact area of a bulged polygon: the shoelace over the vertices plus the
 * circular segment each arc adds or removes. Tessellating and measuring the
 * polygon instead always under-reports an outward arc and over-reports an
 * inward one, and area is a number people bill from. */
export function bulgeArea(e){
  const pts = (e && e.pts) || [];
  /* Two vertices and two bulges is a full circle, which is a shape a real
   * drawing does contain, so it cannot be rejected as degenerate. */
  if (pts.length < 3 && !(pts.length === 2 && hasBulge(e))) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++){
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  a /= 2;
  for (let i = 0; i < pts.length; i++){
    const b = bulgeAt(e, i);
    if (!b) continue;
    if (!e.closed && i === pts.length - 1) continue;
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (!(chord > 1e-12)) continue;
    const theta = 4 * Math.atan(b);
    const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
    /* Signed circular segment: positive sweeps bulge left of travel and add
     * to a counterclockwise loop, negative ones cut in. */
    a += (r * r / 2) * (theta - Math.sin(theta));
  }
  return Math.abs(a);
}

/* The bulge that makes the arc from p0 to p1 pass through a third point.
 * This is what a vertex drag or an arc-segment edit needs. */
export function bulgeThrough(p0, p1, mid){
  const a0 = Math.atan2(p0[1] - mid[1], p0[0] - mid[0]);
  const a1 = Math.atan2(p1[1] - mid[1], p1[0] - mid[0]);
  let inscribed = a1 - a0;
  while (inscribed <= -Math.PI) inscribed += 2 * Math.PI;
  while (inscribed > Math.PI) inscribed -= 2 * Math.PI;
  /* The inscribed angle is half the central angle, and the arc runs on the
   * far side of the chord from the point it passes through. */
  const theta = 2 * (Math.PI - Math.abs(inscribed));
  const cross = (p1[0] - p0[0]) * (mid[1] - p0[1]) - (p1[1] - p0[1]) * (mid[0] - p0[0]);
  const b = Math.tan(theta / 4) * (cross > 0 ? -1 : 1);
  return Number.isFinite(b) ? b : 0;
}

/* Set one segment's bulge, creating the array only when there is a curve to
 * record so straight polylines stay clean. */
export function setBulge(e, i, b){
  if (!e || !e.pts) return e;
  if (!b && !e.bulge) return e;
  if (!e.bulge) e.bulge = new Array(e.pts.length).fill(0);
  while (e.bulge.length < e.pts.length) e.bulge.push(0);
  e.bulge[i] = b || 0;
  if (!hasBulge(e)) delete e.bulge;
  return e;
}

/* An arc entity as a two vertex bulged polyline, which is how a polyline
 * join keeps the curve instead of flattening it. */
export function arcToBulge(a){
  const rad = d => d * Math.PI / 180;
  let span = ((a.a2 - a.a1) % 360 + 360) % 360;
  if (span === 0) span = 360;
  const p0 = [a.cx + a.r * Math.cos(rad(a.a1)), a.cy + a.r * Math.sin(rad(a.a1))];
  const p1 = [a.cx + a.r * Math.cos(rad(a.a1 + span)), a.cy + a.r * Math.sin(rad(a.a1 + span))];
  return { type: 'poly', layer: a.layer, closed: false, pts: [p0, p1], bulge: [Math.tan(rad(span) / 4), 0] };
}
