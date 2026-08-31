/* B-spline curves.
 *
 * A spline is control points plus a degree and a knot vector, evaluated by
 * the Cox-de Boor recursion. That matters because it is the curve DXF and
 * every other CAD system actually stores: importing a SPLINE as a polyline
 * throws away the definition and the ability to edit it, and exporting a
 * polyline where a spline belongs loses smoothness at every seam.
 *
 *   { type:'spline', layer, ctrl:[[x,y],...], degree, knots?, closed?, weights? }
 *
 * Knots are generated clamped-uniform when absent, so the curve passes
 * through its first and last control point. Weights turn it rational (a
 * NURBS), which is how DXF stores exact circles and ellipses.
 */

export const DEFAULT_DEGREE = 3;

export function makeSpline(ctrl, opts){
  const o = opts || {};
  const pts = (ctrl || []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0]);
  const degree = Math.max(1, Math.min(o.degree || DEFAULT_DEGREE, Math.max(1, pts.length - 1)));
  const e = {
    type: 'spline',
    layer: o.layer || 'WALLS',
    ctrl: pts,
    degree,
    closed: !!o.closed
  };
  if (o.knots && o.knots.length) e.knots = o.knots.slice();
  if (o.weights && o.weights.length === pts.length) e.weights = o.weights.slice();
  if (o.lt) e.lt = o.lt;
  if (o.lw != null) e.lw = o.lw;
  return e;
}

/* Clamped uniform knots: degree+1 zeros, interior steps, degree+1 ones.
 * Length is n + degree + 1 for n control points, which is what makes the
 * curve start and end exactly on its outer control points. */
export function clampedKnots(n, degree){
  const m = n + degree + 1;
  const k = new Array(m);
  for (let i = 0; i < m; i++){
    if (i <= degree) k[i] = 0;
    else if (i >= n) k[i] = n - degree;
    else k[i] = i - degree;
  }
  const max = k[m - 1] || 1;
  return k.map(v => v / max);
}

export function knotsOf(e){
  if (e.knots && e.knots.length === e.ctrl.length + e.degree + 1) return e.knots;
  return clampedKnots(e.ctrl.length, e.degree);
}

/* Control points as evaluated, wrapping when the spline is closed so the
 * curve joins itself smoothly rather than at a corner. */
function ctrlOf(e){
  if (!e.closed) return e.ctrl;
  return e.ctrl.concat(e.ctrl.slice(0, e.degree));
}

function findSpan(n, p, u, U){
  if (u >= U[n]) return n - 1;
  if (u <= U[p]) return p;
  let lo = p, hi = n, mid = Math.floor((lo + hi) / 2);
  while (u < U[mid] || u >= U[mid + 1]){
    if (u < U[mid]) hi = mid; else lo = mid;
    mid = Math.floor((lo + hi) / 2);
    if (mid <= p) return p;
    if (mid >= n) return n - 1;
  }
  return mid;
}

/* Cox-de Boor basis functions for the span containing u. */
function basis(span, u, p, U){
  const N = new Array(p + 1).fill(0);
  const left = new Array(p + 1).fill(0);
  const right = new Array(p + 1).fill(0);
  N[0] = 1;
  for (let j = 1; j <= p; j++){
    left[j] = u - U[span + 1 - j];
    right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++){
      const den = right[r + 1] + left[j - r];
      const temp = Math.abs(den) < 1e-12 ? 0 : N[r] / den;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

/* The point at parameter u in [0,1]. Rational when weights are present. */
export function splineAt(e, u){
  const P = ctrlOf(e);
  const p = Math.min(e.degree, P.length - 1);
  const n = P.length;
  const U = e.closed ? clampedKnots(n, p) : knotsOf(e);
  const uu = Math.max(0, Math.min(1, u)) * (U[n] - U[p]) + U[p];
  const span = findSpan(n, p, uu, U);
  const N = basis(span, uu, p, U);
  const W = e.weights && !e.closed ? e.weights : null;
  let x = 0, y = 0, w = 0;
  for (let i = 0; i <= p; i++){
    const idx = span - p + i;
    const cp = P[idx] || P[P.length - 1];
    const wi = W && W[idx] != null ? W[idx] : 1;
    x += N[i] * cp[0] * wi;
    y += N[i] * cp[1] * wi;
    w += N[i] * wi;
  }
  if (Math.abs(w) < 1e-12) return [x, y];
  return [x / w, y / w];
}

export const SPLINE_TOL = 0.02;   /* model units of chord deviation */
export const SPLINE_MIN = 8;
export const SPLINE_MAX = 512;

/* Tessellate adaptively: subdivide while the chord sags more than tol from
 * the curve, so a gentle sweep stays cheap and a tight radius gets the
 * points it needs. */
export function splinePoints(e, tol){
  if (!e || !e.ctrl || e.ctrl.length < 2) return [];
  if (e.ctrl.length === 2 && !e.closed) return [e.ctrl[0].slice(), e.ctrl[1].slice()];
  const t = tol || SPLINE_TOL;
  const out = [];
  const seen = new Set();
  const push = u => {
    const k = u.toFixed(6);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ u, p: splineAt(e, u) });
  };
  const steps = Math.max(SPLINE_MIN, Math.min(SPLINE_MAX, e.ctrl.length * 4));
  for (let i = 0; i <= steps; i++) push(i / steps);
  out.sort((a, b) => a.u - b.u);

  /* Refine where a chord deviates too far from the true midpoint. */
  for (let pass = 0; pass < 6; pass++){
    let added = false;
    for (let i = 0; i + 1 < out.length && out.length < SPLINE_MAX; i++){
      const a = out[i], b = out[i + 1];
      const um = (a.u + b.u) / 2;
      const m = splineAt(e, um);
      const cx = (a.p[0] + b.p[0]) / 2, cy = (a.p[1] + b.p[1]) / 2;
      if (Math.hypot(m[0] - cx, m[1] - cy) > t){
        out.splice(i + 1, 0, { u: um, p: m });
        added = true;
        i++;
      }
    }
    if (!added) break;
  }
  const pts = out.map(o => o.p);
  if (e.closed && pts.length > 2) pts.push(pts[0].slice());
  return pts;
}

/* A spline reduces to a polyline for every consumer that only knows how to
 * draw, clip, hit test or export line work. */
export function splineToPoly(e, tol){
  return {
    type: 'poly',
    layer: e.layer,
    closed: !!e.closed,
    pts: splinePoints(e, tol),
    lt: e.lt,
    lw: e.lw
  };
}

/* Fit a spline through points by using them as control points. Real
 * interpolation would solve a banded system; this is the approximating
 * form, which is what a freehand or traced curve wants. */
export function splineThrough(points, opts){
  return makeSpline(points, opts);
}

export function splineLength(e, tol){
  const pts = splinePoints(e, tol);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export function translateSpline(e, dx, dy){
  e.ctrl = (e.ctrl || []).map(p => [p[0] + dx, p[1] + dy]);
  return e;
}
