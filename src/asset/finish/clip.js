// Cylinder clip for a wheel boundary. New vertices are interpolated.
// A chord is kept only when its midpoint stays within 1 mm of the cylinder.
// 24 to 32 segments is the target for a full circle. A larger radius uses
// more segments so the 1 mm chord limit still holds.

const MM = 0.001;

export function segmentCountForRadius(radius) {
  const sag = (count) => radius * (1 - Math.cos(Math.PI / count));
  if (!(radius > 0)) return { count: 0, ok: false, sag: Infinity };
  if (sag(32) <= MM) {
    const count = sag(24) <= MM ? 24 : 32;
    return { count, ok: true, sag: sag(count) };
  }
  let count = 33;
  while (count < 192 && sag(count) > MM) count += 1;
  return { count, ok: sag(count) <= MM, sag: sag(count) };
}

export function loopOnCurve(points, cyl, limit = MM) {
  if (!points || points.length < 3) return { ok: false, vertex: Infinity, chord: Infinity };
  let vertex = 0;
  let chord = 0;
  for (let i = 0; i < points.length; i++) {
    vertex = Math.max(vertex, Math.abs(radial(points[i], cyl) - cyl.radius));
    const next = points[(i + 1) % points.length];
    const mid = [
      (points[i][0] + next[0]) / 2,
      (points[i][1] + next[1]) / 2,
      (points[i][2] + next[2]) / 2
    ];
    chord = Math.max(chord, Math.abs(radial(mid, cyl) - cyl.radius));
  }
  return { ok: vertex <= limit && chord <= limit, vertex, chord };
}

export function resampleCircle(cyl) {
  const chosen = segmentCountForRadius(cyl.radius);
  if (!chosen.ok) return { ok: false, points: [], count: chosen.count, sag: chosen.sag };
  const basis = basisOf(cyl);
  const points = [];
  for (let i = 0; i < chosen.count; i++) {
    const angle = (i / chosen.count) * Math.PI * 2;
    points.push(pointAt(cyl, basis, angle, cyl.along || 0));
  }
  const check = loopOnCurve(points, cyl);
  return { ok: check.ok, points, count: chosen.count, sag: chosen.sag, vertex: check.vertex, chord: check.chord };
}

export function clipTriangle(tri, cyl) {
  const hits = [];
  for (let edge = 0; edge < 3; edge++) {
    const a = tri[edge];
    const b = tri[(edge + 1) % 3];
    for (const t of edgeHits(a.p, b.p, cyl)) {
      hits.push({ edge, t, v: lerpVert(a, b, t) });
    }
  }
  const sides = tri.map((vert) => radial(vert.p, cyl) - cyl.radius);
  const inside = sides.filter((value) => value < -MM).length;
  const outside = sides.filter((value) => value > MM).length;
  if (!hits.length && inside === 3) return { ok: true, kind: "inside", inside: [tri], outside: [], boundary: [] };
  if (!hits.length && outside === 3) {
    const disk = diskInside(tri, cyl);
    if (disk === "miss") return { ok: true, kind: "outside", inside: [], outside: [tri], boundary: [] };
    if (!disk) return { ok: false, reason: "This triangle meets the cylinder in a way that was not clipped. No wedge was assigned by a corner test." };
    return disk;
  }
  if (hits.length === 2) return clipTwoHits(tri, cyl, hits);
  return { ok: false, reason: "This triangle has " + hits.length + " cylinder crossings. It was left uncut rather than guessed." };
}

export function bleedCount(tris, cyl) {
  let count = 0;
  for (const tri of tris) {
    const dists = tri.map((vert) => radial(vert.p, cyl) - cyl.radius);
    if (dists.some((value) => value < -MM) && dists.some((value) => value > MM)) count += 1;
  }
  return count;
}

function diskInside(tri, cyl) {
  const plane = planeOf(tri);
  if (Math.abs(dot(plane.n, [cyl.ax, cyl.ay, cyl.az])) < 0.95) return null;
  const center = planePoint(plane, cyl);
  if (!center) return null;
  if (!insideTri(center, tri, 1e-4)) return "miss";
  for (let edge = 0; edge < 3; edge++) {
    if (distToSegment(center, tri[edge].p, tri[(edge + 1) % 3].p) < cyl.radius - MM) return null;
  }
  const circle = resampleCircle({ ...cyl, cx: center[0], cy: center[1], cz: center[2], along: 0 });
  if (!circle.ok) return { ok: false, reason: "The wheel radius cannot be held within 1 mm." };
  const boundary = circle.points.map((p) => ({ p, uv: baryUv(p, tri), n: plane.n.slice() }));
  const centerVert = { p: center, uv: baryUv(center, tri), n: plane.n.slice() };
  const inside = [];
  for (let i = 0; i < boundary.length; i++) {
    inside.push([centerVert, boundary[i], boundary[(i + 1) % boundary.length]]);
  }
  const capUv = cyl.capUv || null;
  const cap = capUv ? inside.map((face) => face.map((vert) => ({ p: vert.p.slice(), uv: capUv.slice(), n: vert.n.slice() }))) : [];
  const outside = outsideOfDisk(tri, boundary);
  return { ok: true, kind: "disk", inside, outside, cap, boundary: boundary.map((vert) => vert.p), count: circle.count };
}

function clipTwoHits(tri, cyl, hits) {
  const basis = basisOf(cyl);
  const angles = hits.map((hit) => Math.atan2(
    dot(sub(hit.v.p, [cyl.cx, cyl.cy, cyl.cz]), basis.v),
    dot(sub(hit.v.p, [cyl.cx, cyl.cy, cyl.cz]), basis.u)
  ));
  const chosen = segmentCountForRadius(cyl.radius);
  if (!chosen.ok) return { ok: false, reason: "The wheel radius cannot be held within 1 mm." };
  const step = (Math.PI * 2) / chosen.count;
  let arc = walkArc(angles[0], angles[1], step);
  let samples = arc.map((angle) => pointAt(cyl, basis, angle, axial(hits[0].v.p, cyl)));
  if (!samples.every((point) => insideTri(point, tri, MM * 4))) {
    arc = walkArc(angles[1], angles[0], step);
    samples = arc.map((angle) => pointAt(cyl, basis, angle, axial(hits[0].v.p, cyl)));
  }
  if (!samples.length || !samples.every((point) => insideTri(point, tri, MM * 4))) {
    return { ok: false, reason: "The cylinder arc left the triangle. The cut was not guessed." };
  }
  const boundary = samples.map((p) => ({ p, uv: baryUv(p, tri), n: tri[0].n.slice() }));
  const check = loopOnCurve(samples, cyl);
  if (!check.ok) return { ok: false, reason: "The cut chord leaves the cylinder by more than 1 mm." };
  const insideVerts = tri.filter((vert) => radial(vert.p, cyl) - cyl.radius < MM);
  const polygon = boundary.concat(insideVerts);
  return {
    ok: true,
    kind: "arc",
    inside: fan(polygon),
    outside: fan(tri.filter((vert) => radial(vert.p, cyl) - cyl.radius > -MM).concat(boundary.slice().reverse())),
    cap: [],
    boundary: samples,
    count: chosen.count
  };
}

function outsideOfDisk(tri, boundary) {
  const bridge = 0;
  const ring = boundary.map((vert) => vert);
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const dist = hypot(sub(ring[i].p, tri[bridge].p));
    if (dist < best) {
      best = dist;
      nearest = i;
    }
  }
  const poly = [tri[0], tri[1], tri[2], tri[0]];
  for (let i = 0; i <= ring.length; i++) poly.push(ring[(nearest - i + ring.length * 2) % ring.length]);
  poly.push(tri[0]);
  return fanOpen(poly);
}

function fan(poly) {
  const tris = [];
  if (poly.length < 3) return tris;
  for (let i = 1; i < poly.length - 1; i++) tris.push([poly[0], poly[i], poly[i + 1]]);
  return tris.filter((face) => area(face) > 1e-12);
}

function fanOpen(poly) {
  return fan(poly);
}

function walkArc(from, to, step) {
  let delta = to - from;
  while (delta <= 0) delta += Math.PI * 2;
  while (delta > Math.PI * 2) delta -= Math.PI * 2;
  const count = Math.max(1, Math.round(delta / step));
  const out = [];
  for (let i = 0; i <= count; i++) out.push(from + (delta * i) / count);
  return out;
}

function edgeHits(p, q, cyl) {
  const axis = [cyl.ax, cyl.ay, cyl.az];
  const origin = [cyl.cx, cyl.cy, cyl.cz];
  const w = sub(p, origin);
  const d = sub(q, p);
  const pd = dot(w, axis);
  const dd = dot(d, axis);
  const wr = sub(w, scale(axis, pd));
  const dr = sub(d, scale(axis, dd));
  const a = dot(dr, dr);
  const b = 2 * dot(wr, dr);
  const c = dot(wr, wr) - cyl.radius * cyl.radius;
  if (a < 1e-16) return [];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((t) => t > 1e-4 && t < 1 - 1e-4).sort((u, v) => u - v);
}

function planeOf(tri) {
  const n = cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p));
  const length = hypot(n) || 1;
  return { n: n.map((value) => value / length), p: tri[0].p };
}

function planePoint(plane, cyl) {
  const axis = [cyl.ax, cyl.ay, cyl.az];
  const denom = dot(axis, plane.n);
  if (Math.abs(denom) < 1e-8) return null;
  const h = dot(sub(plane.p, [cyl.cx, cyl.cy, cyl.cz]), plane.n) / denom;
  return [cyl.cx + axis[0] * h, cyl.cy + axis[1] * h, cyl.cz + axis[2] * h];
}

function insideTri(p, tri, tol) {
  const areaAll = area([tri[0], tri[1], tri[2]]);
  if (areaAll < 1e-12) return false;
  const a = area([{ p }, tri[1], tri[2]]) + area([tri[0], { p }, tri[2]]) + area([tri[0], tri[1], { p }]);
  return Math.abs(a - areaAll) <= Math.max(tol, areaAll * 1e-4);
}

function baryUv(p, tri) {
  const areaAll = area(tri) || 1;
  const w0 = area([{ p }, tri[1], tri[2]]) / areaAll;
  const w1 = area([tri[0], { p }, tri[2]]) / areaAll;
  const w2 = 1 - w0 - w1;
  return [
    w0 * tri[0].uv[0] + w1 * tri[1].uv[0] + w2 * tri[2].uv[0],
    w0 * tri[0].uv[1] + w1 * tri[1].uv[1] + w2 * tri[2].uv[1]
  ];
}

function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const length = dot(ab, ab) || 1;
  let t = dot(sub(p, a), ab) / length;
  t = Math.max(0, Math.min(1, t));
  return hypot(sub(p, add(a, scale(ab, t))));
}

function radial(p, cyl) {
  const axis = [cyl.ax, cyl.ay, cyl.az];
  const w = sub(p, [cyl.cx, cyl.cy, cyl.cz]);
  return hypot(sub(w, scale(axis, dot(w, axis))));
}

function axial(p, cyl) {
  return dot(sub(p, [cyl.cx, cyl.cy, cyl.cz]), [cyl.ax, cyl.ay, cyl.az]);
}

function basisOf(cyl) {
  const axis = [cyl.ax, cyl.ay, cyl.az];
  const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = cross(helper, axis);
  u = scale(u, 1 / (hypot(u) || 1));
  const v = cross(axis, u);
  return { u, v };
}

function pointAt(cyl, basis, angle, along) {
  const axis = [cyl.ax, cyl.ay, cyl.az];
  return [
    cyl.cx + axis[0] * along + cyl.radius * (Math.cos(angle) * basis.u[0] + Math.sin(angle) * basis.v[0]),
    cyl.cy + axis[1] * along + cyl.radius * (Math.cos(angle) * basis.u[1] + Math.sin(angle) * basis.v[1]),
    cyl.cz + axis[2] * along + cyl.radius * (Math.cos(angle) * basis.u[2] + Math.sin(angle) * basis.v[2])
  ];
}

function lerpVert(a, b, t) {
  return {
    p: a.p.map((value, index) => value + (b.p[index] - value) * t),
    uv: a.uv.map((value, index) => value + (b.uv[index] - value) * t),
    n: a.n.map((value, index) => value + (b.n[index] - value) * t)
  };
}

function area(tri) {
  return hypot(cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p))) * 0.5;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function hypot(a) { return Math.hypot(a[0], a[1], a[2]); }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
