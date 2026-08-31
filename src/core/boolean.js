/* Boolean operations on closed regions: union, intersection, difference.
 *
 * This is the operation behind merging two slabs into one outline, cutting a
 * stair opening out of a floor plate, or asking what area two zones actually
 * share. Without it a drawing can show overlapping regions but cannot say
 * what the combined thing is, and every area takeoff over touching regions
 * double counts.
 *
 * The method is arrangement based rather than a sweep: split every edge of
 * both operands at every crossing, classify each resulting fragment by
 * whether its midpoint is inside the other operand, keep the fragments the
 * operation asks for, then chain them back into loops. It costs more than a
 * sweep on huge inputs and it is far easier to get right on the inputs that
 * actually turn up here, where two regions sharing a wall exactly is the
 * common case rather than the exception.
 *
 * Operands and results are both plain arrays of rings. Nesting decides which
 * rings are holes, so a result feeds straight back into island hatching.
 */
import { polyArea, pointInPoly } from './geometry.js';

export const EPS = 1e-9;
/* Points closer than this are the same point. Loose enough to absorb the
 * rounding in an intersection, tight enough not to weld real geometry. */
export const WELD = 1e-7;

function key(p){ return p[0].toFixed(7) + ',' + p[1].toFixed(7); }
function same(a, b){ return Math.abs(a[0] - b[0]) < WELD && Math.abs(a[1] - b[1]) < WELD; }

/* Rings, cleaned: duplicate and collinear-free enough to work with, closed
 * implicitly (no repeated last point), degenerate ones dropped. */
export function cleanRings(rings){
  const out = [];
  for (const r of rings || []){
    if (!r || r.length < 3) continue;
    const pts = [];
    for (const p of r){
      const q = [Number(p[0]), Number(p[1])];
      if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
      if (pts.length && same(pts[pts.length - 1], q)) continue;
      pts.push(q);
    }
    while (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
    if (pts.length >= 3 && Math.abs(polyArea(pts)) > EPS) out.push(pts);
  }
  return out;
}

/* Containment depth by ring nesting, the same rule island hatching uses: a
 * ring inside an odd number of others is a hole. */
function depthOf(rings, i){
  let d = 0;
  for (let j = 0; j < rings.length; j++){
    if (j === i) continue;
    if (ringContains(rings[j], rings[i])) d++;
  }
  return d;
}

function ringContains(outer, inner){
  /* One interior point is enough for the non self intersecting rings a
   * boolean produces, and it is robust when the rings share a boundary. */
  for (const p of inner){
    if (!onAnyEdge(outer, p)) return pointInPoly(p[0], p[1], outer);
  }
  return false;
}

function onAnyEdge(ring, p){
  for (let i = 0; i < ring.length; i++){
    if (onSeg(ring[i], ring[(i + 1) % ring.length], p)) return true;
  }
  return false;
}

function onSeg(a, b, p){
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < EPS) return same(a, p);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  if (t < -WELD || t > 1 + WELD) return false;
  const cx = a[0] + dx * Math.max(0, Math.min(1, t)), cy = a[1] + dy * Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - cx, p[1] - cy) < WELD;
}

/* Orient so the interior is always on the left of a directed edge: outer
 * rings counterclockwise, holes clockwise. Every later test depends on it. */
export function orient(rings){
  const rs = cleanRings(rings);
  return rs.map((r, i) => {
    const wantCCW = depthOf(rs, i) % 2 === 0;
    const isCCW = polyArea(r) > 0;
    return wantCCW === isCCW ? r : r.slice().reverse();
  });
}

/* Inside by the even-odd rule across the whole ring set, which is what makes
 * holes work without tracking them separately. */
export function insideSet(rings, x, y){
  let n = 0;
  for (const r of rings) if (pointInPoly(x, y, r)) n++;
  return n % 2 === 1;
}

function onSetBoundary(rings, p){
  for (const r of rings) if (onAnyEdge(r, p)) return true;
  return false;
}

/* Every edge of a ring set as a directed segment. */
function edgesOf(rings){
  const out = [];
  for (const r of rings){
    for (let i = 0; i < r.length; i++){
      const a = r[i], b = r[(i + 1) % r.length];
      if (!same(a, b)) out.push([a, b]);
    }
  }
  return out;
}

/* Parameters along `a -> b` where the segment meets `c -> d`, including the
 * overlap ends when the two are collinear. */
function crossParams(a, b, c, d){
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  const qp = [c[0] - a[0], c[1] - a[1]];
  if (Math.abs(den) > EPS){
    const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
    const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    if (t > -WELD && t < 1 + WELD && u > -WELD && u < 1 + WELD) return [t];
    return [];
  }
  /* Parallel. Collinear overlaps still split both edges at the shared ends. */
  const cross = qp[0] * r[1] - qp[1] * r[0];
  const rr = r[0] * r[0] + r[1] * r[1];
  if (Math.abs(cross) > WELD * Math.sqrt(rr || 1)) return [];
  const t0 = (qp[0] * r[0] + qp[1] * r[1]) / rr;
  const t1 = t0 + (s[0] * r[0] + s[1] * r[1]) / rr;
  return [t0, t1].filter(t => t > WELD && t < 1 - WELD);
}

/* Split every edge at every crossing with the other operand. */
function splitEdges(edges, others){
  const out = [];
  for (const [a, b] of edges){
    const ts = [0, 1];
    for (const [c, d] of others){
      for (const t of crossParams(a, b, c, d)) if (t > WELD && t < 1 - WELD) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    let prev = null;
    for (const t of ts){
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (prev && !same(prev, p)) out.push([prev, p]);
      if (!prev || !same(prev, p)) prev = p;
    }
  }
  return out;
}

export const UNION = 'union';
export const INTERSECT = 'intersect';
export const DIFFERENCE = 'difference';
export const XOR = 'xor';

/* Which fragments survive, by where they sit relative to the other operand.
 * A fragment lying along the other boundary is kept only when the two run the
 * same way for union and intersection, and only when they run opposite ways
 * for difference. That is what stops a shared wall being drawn twice or
 * cancelling itself out. */
function keepFragment(op, fromA, inOther, onOther, sameDir){
  if (op === UNION){
    if (onOther) return fromA && sameDir;
    return !inOther;
  }
  if (op === INTERSECT){
    if (onOther) return fromA && sameDir;
    return inOther;
  }
  if (op === DIFFERENCE){
    if (onOther) return fromA && !sameDir;
    return fromA ? !inOther : inOther;
  }
  return false;
}

function dirOnBoundary(rings, a, b){
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const r of rings){
    for (let i = 0; i < r.length; i++){
      const c = r[i], d = r[(i + 1) % r.length];
      if (!onSeg(c, d, mid)) continue;
      const dot = (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]);
      if (Math.abs(dot) > EPS) return dot > 0 ? 1 : -1;
    }
  }
  return 0;
}

/* Chain directed fragments back into closed rings. Where several fragments
 * leave the same point, take the sharpest left turn: that traces the
 * boundary of one region instead of cutting across into another. */
function chain(frags){
  const byStart = new Map();
  frags.forEach((f, i) => {
    const k = key(f[0]);
    if (byStart.has(k)) byStart.get(k).push(i); else byStart.set(k, [i]);
  });
  const used = new Array(frags.length).fill(false);
  const rings = [];
  for (let s = 0; s < frags.length; s++){
    if (used[s]) continue;
    const ring = [];
    let cur = s;
    let guard = 0;
    while (cur != null && !used[cur] && guard++ < frags.length + 4){
      used[cur] = true;
      ring.push(frags[cur][0]);
      const end = frags[cur][1];
      if (ring.length > 1 && same(end, ring[0])) break;
      const cands = (byStart.get(key(end)) || []).filter(i => !used[i]);
      if (!cands.length){ cur = null; break; }
      if (cands.length === 1){ cur = cands[0]; continue; }
      const inDir = Math.atan2(end[1] - frags[cur][0][1], end[0] - frags[cur][0][0]);
      let best = cands[0], bestTurn = -Infinity;
      for (const i of cands){
        const o = frags[i];
        const outDir = Math.atan2(o[1][1] - o[0][1], o[1][0] - o[0][0]);
        let turn = outDir - inDir;
        while (turn <= -Math.PI) turn += 2 * Math.PI;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn > bestTurn){ bestTurn = turn; best = i; }
      }
      cur = best;
    }
    if (ring.length >= 3 && Math.abs(polyArea(ring)) > EPS) rings.push(ring);
  }
  return rings;
}

/* The operation. Both operands are ring sets; the result is a ring set. */
export function polyBoolean(subject, clip, op){
  /* XOR is what is in one operand or the other but not both, which is
   * exactly the two differences taken together. Defining it that way reuses
   * the difference path rather than inventing a fourth set of rules for the
   * shared boundary to get wrong. */
  if (op === XOR){
    const ab = polyBoolean(subject, clip, DIFFERENCE);
    const ba = polyBoolean(clip, subject, DIFFERENCE);
    if (!ab.length) return ba;
    if (!ba.length) return ab;
    return polyBoolean(ab, ba, UNION);
  }
  const A = orient(subject);
  const B = orient(clip);
  if (!A.length && !B.length) return [];
  if (!A.length) return op === UNION ? B.map(r => r.slice()) : [];
  if (!B.length) return op === INTERSECT ? [] : A.map(r => r.slice());

  const ea = edgesOf(A), eb = edgesOf(B);
  const fa = splitEdges(ea, eb), fb = splitEdges(eb, ea);
  const frags = [];

  const consider = (list, fromA, other) => {
    for (const [a, b] of list){
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const onOther = onSetBoundary(other, mid);
      const inOther = onOther ? false : insideSet(other, mid[0], mid[1]);
      const dir = onOther ? dirOnBoundary(other, a, b) : 0;
      if (!keepFragment(op, fromA, inOther, onOther, dir > 0)) continue;
      /* Difference reverses the clip boundary it keeps, so the hole it cuts
       * runs the opposite way from the outline around it. */
      const flip = op === DIFFERENCE && !fromA;
      frags.push(flip ? [b, a] : [a, b]);
    }
  };
  consider(fa, true, B);
  consider(fb, false, A);
  return chain(frags);
}

export function unionRings(a, b){ return polyBoolean(a, b, UNION); }
export function intersectRings(a, b){ return polyBoolean(a, b, INTERSECT); }
export function differenceRings(a, b){ return polyBoolean(a, b, DIFFERENCE); }
export function xorRings(a, b){ return polyBoolean(a, b, XOR); }

/* Net area of a ring set, holes subtracted. This is the number a takeoff
 * over merged regions wants. */
export function ringsArea(rings){
  const rs = cleanRings(rings);
  let a = 0;
  rs.forEach((r, i) => {
    const sign = depthOf(rs, i) % 2 === 0 ? 1 : -1;
    a += sign * Math.abs(polyArea(r));
  });
  return Math.max(0, a);
}
