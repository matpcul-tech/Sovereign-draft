/* 2D parametric constraint solver.
 *
 * This is the line between drafting and parametric CAD: geometry that holds
 * its relationships while you edit. A constraint is a residual function over
 * entity coordinates; the solver drives every residual to zero at once with
 * damped Gauss-Newton, taking the smallest step from the current geometry so
 * an edit moves as little as possible while every rule stays true.
 *
 * Constraint records are plain objects, serialized with the project:
 *   { id, type, a, ea?, b?, eb?, value? }
 * a and b are entity ids. ea and eb name endpoints (1 or 2) where relevant.
 *
 * Types:
 *   horizontal      a line lies flat
 *   vertical        a line stands straight
 *   parallel        two lines share a direction
 *   perpendicular   two lines meet square
 *   equal           two lines share a length
 *   coincident      endpoint ea of a touches endpoint eb of b
 *   distance        a line's length is driven to value
 *   radius          a circle's radius is driven to value
 *   fix             endpoint ea of a is pinned at value [x, y]
 *   tangent         a line grazes a circle
 */

let seq = 1;
export function makeConstraint(type, opts){
  const o = opts || {};
  return {
    id: 'k' + (seq++),
    type,
    a: o.a,
    ea: o.ea != null ? o.ea : null,
    b: o.b != null ? o.b : null,
    eb: o.eb != null ? o.eb : null,
    value: o.value != null ? o.value : null
  };
}

export const CONSTRAINT_TYPES = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'coincident', 'distance', 'radius', 'fix', 'tangent'];

/* ---------- variable mapping ----------
 * Only entities that participate in a constraint become variables; everything
 * else is untouchable by construction. Lines contribute x1,y1,x2,y2; circles
 * cx,cy,r. */

function isLine(e){ return e && e.type === 'line'; }
function isCircle(e){ return e && e.type === 'circle'; }

function participants(constraints){
  const ids = new Set();
  (constraints || []).forEach(k => {
    if (k.a != null) ids.add(k.a);
    if (k.b != null) ids.add(k.b);
  });
  return ids;
}

function buildVars(entities, constraints){
  const ids = participants(constraints);
  const map = new Map();   /* entityId -> { ent, at } offset into x */
  const x = [];
  (entities || []).forEach(e => {
    if (!e || e.id == null || !ids.has(e.id)) return;
    if (isLine(e)){
      map.set(e.id, { ent: e, at: x.length, kind: 'line' });
      x.push(e.x1, e.y1, e.x2, e.y2);
    } else if (isCircle(e)){
      map.set(e.id, { ent: e, at: x.length, kind: 'circle' });
      x.push(e.cx, e.cy, e.r);
    }
  });
  return { map, x };
}

function writeBack(map, x){
  map.forEach(v => {
    if (v.kind === 'line'){
      v.ent.x1 = x[v.at]; v.ent.y1 = x[v.at + 1];
      v.ent.x2 = x[v.at + 2]; v.ent.y2 = x[v.at + 3];
    } else {
      v.ent.cx = x[v.at]; v.ent.cy = x[v.at + 1];
      v.ent.r = Math.max(0.01, x[v.at + 2]);
    }
  });
}

/* ---------- residuals ---------- */

function lineOf(map, id){ const v = map.get(id); return v && v.kind === 'line' ? v : null; }
function circleOf(map, id){ const v = map.get(id); return v && v.kind === 'circle' ? v : null; }

function pt(x, v, end){
  return end === 2 ? [x[v.at + 2], x[v.at + 3]] : [x[v.at], x[v.at + 1]];
}
function dir(x, v){
  return [x[v.at + 2] - x[v.at], x[v.at + 3] - x[v.at + 1]];
}
function norm(d){ return Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1e-9; }

/* Push this constraint's residuals onto r. Unknown references contribute
 * nothing, so a constraint whose entity was deleted goes quiet instead of
 * exploding; validateConstraints reports those separately. */
function residualsOf(k, map, x, r){
  if (k.type === 'horizontal'){
    const a = lineOf(map, k.a); if (!a) return;
    r.push(x[a.at + 3] - x[a.at + 1]);
  } else if (k.type === 'vertical'){
    const a = lineOf(map, k.a); if (!a) return;
    r.push(x[a.at + 2] - x[a.at]);
  } else if (k.type === 'parallel'){
    const a = lineOf(map, k.a), b = lineOf(map, k.b); if (!a || !b) return;
    const da = dir(x, a), db = dir(x, b);
    r.push((da[0] * db[1] - da[1] * db[0]) / (norm(da) * norm(db)));
  } else if (k.type === 'perpendicular'){
    const a = lineOf(map, k.a), b = lineOf(map, k.b); if (!a || !b) return;
    const da = dir(x, a), db = dir(x, b);
    r.push((da[0] * db[0] + da[1] * db[1]) / (norm(da) * norm(db)));
  } else if (k.type === 'equal'){
    const a = lineOf(map, k.a), b = lineOf(map, k.b); if (!a || !b) return;
    r.push(norm(dir(x, a)) - norm(dir(x, b)));
  } else if (k.type === 'coincident'){
    const a = lineOf(map, k.a), b = lineOf(map, k.b); if (!a || !b) return;
    const pa = pt(x, a, k.ea || 1), pb = pt(x, b, k.eb || 1);
    r.push(pa[0] - pb[0], pa[1] - pb[1]);
  } else if (k.type === 'distance'){
    const a = lineOf(map, k.a); if (!a) return;
    r.push(norm(dir(x, a)) - (k.value || 0));
  } else if (k.type === 'radius'){
    const a = circleOf(map, k.a); if (!a) return;
    r.push(x[a.at + 2] - (k.value || 0));
  } else if (k.type === 'fix'){
    const a = lineOf(map, k.a); if (!a) return;
    const p = pt(x, a, k.ea || 1);
    r.push(p[0] - (k.value ? k.value[0] : 0), p[1] - (k.value ? k.value[1] : 0));
  } else if (k.type === 'tangent'){
    const a = lineOf(map, k.a), c = circleOf(map, k.b); if (!a || !c) return;
    /* Distance from the circle center to the infinite line equals r. */
    const x1 = x[a.at], y1 = x[a.at + 1], x2 = x[a.at + 2], y2 = x[a.at + 3];
    const cx = x[c.at], cy = x[c.at + 1], rr = x[c.at + 2];
    const dxl = x2 - x1, dyl = y2 - y1, L = Math.sqrt(dxl * dxl + dyl * dyl) || 1e-9;
    const d = Math.abs((cx - x1) * dyl - (cy - y1) * dxl) / L;
    r.push(d - rr);
  }
}

function residualVector(constraints, map, x){
  const r = [];
  (constraints || []).forEach(k => residualsOf(k, map, x, r));
  return r;
}

function sq(r){ return r.reduce((s, v) => s + v * v, 0); }

/* Solve (JtJ + lambda I) d = -Jt r by Gaussian elimination. */
function solveNormal(J, r, lambda){
  const m = J.length, n = m ? J[0].length : 0;
  const A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let i = 0; i < n; i++){
    for (let j = 0; j < n; j++){
      let s = 0;
      for (let q = 0; q < m; q++) s += J[q][i] * J[q][j];
      A[i][j] = s + (i === j ? lambda : 0);
    }
    let s = 0;
    for (let q = 0; q < m; q++) s += J[q][i] * r[q];
    A[i][n] = -s;
  }
  for (let col = 0; col < n; col++){
    let piv = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
    const t = A[piv]; A[piv] = A[col]; A[col] = t;
    if (Math.abs(A[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++){
      if (row === col) continue;
      const f = A[row][col] / A[col][col];
      for (let j = col; j <= n; j++) A[row][j] -= f * A[col][j];
    }
  }
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : A[i][n] / A[i][i];
  return d;
}

export const SOLVE_TOL = 1e-6;

/* Drive every constraint residual to zero. Mutates the participating
 * entities in place; entities under no constraint are never touched.
 * Returns { ok, iterations, residual, vars, equations }.
 */
export function solveConstraints(entities, constraints){
  const active = (constraints || []).filter(Boolean);
  if (!active.length) return { ok: true, iterations: 0, residual: 0, vars: 0, equations: 0 };
  const { map, x } = buildVars(entities, active);
  if (!x.length) return { ok: true, iterations: 0, residual: 0, vars: 0, equations: 0 };

  let r = residualVector(active, map, x);
  let cost = sq(r);
  let lambda = 1e-3;
  const h = 1e-6;
  let it = 0;

  for (; it < 60 && Math.sqrt(cost) > SOLVE_TOL; it++){
    /* Numeric Jacobian, central differences. Systems here are tens of
     * variables; clarity beats cleverness. */
    const J = r.map(() => new Float64Array(x.length));
    for (let j = 0; j < x.length; j++){
      const keep = x[j];
      x[j] = keep + h;
      const rp = residualVector(active, map, x);
      x[j] = keep - h;
      const rm = residualVector(active, map, x);
      x[j] = keep;
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    }
    let stepped = false;
    for (let tries = 0; tries < 8 && !stepped; tries++){
      const d = solveNormal(J, r, lambda);
      const xn = x.slice();
      for (let j = 0; j < x.length; j++) xn[j] += d[j];
      const rn = residualVector(active, map, xn);
      const cn = sq(rn);
      if (cn < cost){
        for (let j = 0; j < x.length; j++) x[j] = xn[j];
        r = rn; cost = cn;
        lambda = Math.max(1e-9, lambda / 3);
        stepped = true;
      } else {
        lambda *= 10;
      }
    }
    if (!stepped) break;
  }

  writeBack(map, x);
  const residual = Math.sqrt(sq(residualVector(active, map, x)));
  return {
    ok: residual <= SOLVE_TOL * 100,
    iterations: it,
    residual,
    vars: x.length,
    equations: r.length
  };
}

/* Constraints whose entities no longer exist. */
export function validateConstraints(entities, constraints){
  const have = new Set((entities || []).map(e => e.id));
  return (constraints || []).filter(k =>
    (k.a != null && !have.has(k.a)) || (k.b != null && !have.has(k.b)));
}

export function dropDanglingConstraints(entities, constraints){
  const bad = new Set(validateConstraints(entities, constraints).map(k => k.id));
  return (constraints || []).filter(k => !bad.has(k.id));
}

export function constraintsOn(constraints, entityId){
  return (constraints || []).filter(k => k.a === entityId || k.b === entityId);
}

export function describeConstraint(k){
  if (!k) return '';
  if (k.type === 'distance') return 'distance ' + k.value;
  if (k.type === 'radius') return 'radius ' + k.value;
  if (k.type === 'fix') return 'fix at ' + (k.value ? k.value.map(v => Math.round(v * 100) / 100).join(',') : '');
  return k.type;
}
