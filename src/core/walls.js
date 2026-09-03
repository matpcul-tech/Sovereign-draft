/* Optional wall mode: two parallel faces + end caps, grouped. Thickness in feet
 * from a chip (4" / 6" / 8"). Doors and windows are blocks that cut the wall.
 * After explode the remaining lines are ordinary geometry.
 */
import { dist, hypot, deep } from './geometry.js';
import { SYMBOLS } from './symbols.js';
import { translateEnt } from './entities.js';
import { rotateEntities } from './modify.js';

export const WALL_THICKNESS = [
  { label: '4"',  th: 4 / 12 },
  { label: '6"',  th: 6 / 12 },
  { label: '8"',  th: 8 / 12 }
];

export function wallFrags(x1, y1, x2, y2, th, layer){
  const dx = x2 - x1, dy = y2 - y1, L = hypot(dx, dy) || 1e-9;
  const nx = -dy / L * th / 2, ny = dx / L * th / 2;
  const ly = layer || 'WALLS';
  const ocl = { x1, y1, x2, y2, th, layer: ly };
  return [
    { type: 'line', layer: ly, kind: 'wall', th, role: 'a', ocl, x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny },
    { type: 'line', layer: ly, kind: 'wall', th, role: 'b', ocl, x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny },
    { type: 'line', layer: ly, kind: 'wall', th, role: 'cap0', ocl, x1: x1 + nx, y1: y1 + ny, x2: x1 - nx, y2: y1 - ny },
    { type: 'line', layer: ly, kind: 'wall', th, role: 'cap1', ocl, x1: x2 + nx, y1: y2 + ny, x2: x2 - nx, y2: y2 - ny }
  ];
}

/* The centerline of a wall group from its faces: the full run, whatever
 * has been cut out of it. A door splits each face into two segments, and
 * reading only the first pair told the whole wall its centerline ended
 * at the jamb; the room loop then broke at every door, silently. */
export function wallCenterline(members){
  const as = members.filter(e => e.role === 'a');
  const bs = members.filter(e => e.role === 'b');
  if (!as.length || !bs.length) return null;
  const lead = as.reduce((m, e) => dist(e.x1, e.y1, e.x2, e.y2) > dist(m.x1, m.y1, m.x2, m.y2) ? e : m, as[0]);
  const L = dist(lead.x1, lead.y1, lead.x2, lead.y2);
  if (L < 1e-9) return null;
  const ux = (lead.x2 - lead.x1) / L, uy = (lead.y2 - lead.y1) / L;
  const nx = -uy, ny = ux;
  const ox = lead.x1, oy = lead.y1;
  let tMin = Infinity, tMax = -Infinity, offA = 0, offB = 0;
  const walk = (list, sink) => {
    let acc = 0, n = 0;
    list.forEach(e => {
      [[e.x1, e.y1], [e.x2, e.y2]].forEach(p => {
        const t = (p[0] - ox) * ux + (p[1] - oy) * uy;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
        acc += (p[0] - ox) * nx + (p[1] - oy) * ny; n++;
      });
    });
    sink(n ? acc / n : 0);
  };
  walk(as, v => { offA = v; });
  walk(bs, v => { offB = v; });
  const mid = (offA + offB) / 2;
  return {
    x1: ox + ux * tMin + nx * mid, y1: oy + uy * tMin + ny * mid,
    x2: ox + ux * tMax + nx * mid, y2: oy + uy * tMax + ny * mid,
    th: lead.th || Math.abs(offA - offB)
  };
}

/* Split a wall group to insert an opening of `width` feet centered at parameter t in [0,1].
 * Returns { removeIds, add: entities without ids } — caller assigns ids / groups.
 */
export function cutWallOpening(members, t, width){
  const cl = wallCenterline(members);
  if (!cl) return { ok: false, msg: 'Not a wall' };
  const L = dist(cl.x1, cl.y1, cl.x2, cl.y2) || 1e-9;
  const half = width / 2;
  const t0 = Math.max(0.02, t - half / L);
  const t1 = Math.min(0.98, t + half / L);
  if (t1 - t0 < 0.02) return { ok: false, msg: 'Opening too wide for this wall' };
  const ux = (cl.x2 - cl.x1) / L, uy = (cl.y2 - cl.y1) / L;
  const nx = -uy * cl.th / 2, ny = ux * cl.th / 2;
  const at = (s, ox, oy) => [cl.x1 + (cl.x2 - cl.x1) * s + ox, cl.y1 + (cl.y2 - cl.y1) * s + oy];
  const ly = members[0].layer || 'WALLS';
  const th = cl.th;
  const leftA0 = at(0, nx, ny), leftA1 = at(t0, nx, ny);
  const leftB0 = at(0, -nx, -ny), leftB1 = at(t0, -nx, -ny);
  const rightA0 = at(t1, nx, ny), rightA1 = at(1, nx, ny);
  const rightB0 = at(t1, -nx, -ny), rightB1 = at(1, -nx, -ny);
  const jamb0a = at(t0, nx, ny), jamb0b = at(t0, -nx, -ny);
  const jamb1a = at(t1, nx, ny), jamb1b = at(t1, -nx, -ny);
  const mk = (role, p, q) => ({ type: 'line', layer: ly, kind: 'wall', th, role, x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
  const add = [
    mk('a', leftA0, leftA1), mk('b', leftB0, leftB1),
    mk('a', rightA0, rightA1), mk('b', rightB0, rightB1),
    mk('jamb', jamb0a, jamb0b), mk('jamb', jamb1a, jamb1b),
    mk('cap0', leftA0, leftB0), mk('cap1', rightA1, rightB1)
  ];
  return {
    ok: true,
    add,
    cl,
    opening: { x1: cl.x1 + ux * t0 * L, y1: cl.y1 + uy * t0 * L, x2: cl.x1 + ux * t1 * L, y2: cl.y1 + uy * t1 * L, ux, uy, t0, t1, width, th }
  };
}

/* Rebuild a wall from its original centerline with every opening punched at once. */
export function wallWithOpenings(cl, openings){
  if (!cl) return [];
  const L = dist(cl.x1, cl.y1, cl.x2, cl.y2) || 1e-9;
  const ux = (cl.x2 - cl.x1) / L, uy = (cl.y2 - cl.y1) / L;
  const nx = -uy * cl.th / 2, ny = ux * cl.th / 2;
  const at = (s, ox, oy) => [cl.x1 + ux * L * s + ox, cl.y1 + uy * L * s + oy];
  const ly = cl.layer || 'WALLS';
  const th = cl.th;
  const mk = (role, p, q) => ({ type: 'line', layer: ly, kind: 'wall', th, role, x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
  const gaps = (openings || []).map(o => {
    const half = (o.width || 3) / 2 / L;
    return { t0: Math.max(0.015, o.t - half), t1: Math.min(0.985, o.t + half) };
  }).filter(g => g.t1 - g.t0 > 0.02).sort((a, b) => a.t0 - b.t0);
  const merged = [];
  for (const g of gaps){
    const last = merged[merged.length - 1];
    if (last && g.t0 <= last.t1 + 0.01) last.t1 = Math.max(last.t1, g.t1);
    else merged.push({ t0: g.t0, t1: g.t1 });
  }
  const add = [];
  let cursor = 0;
  for (const g of merged){
    if (g.t0 - cursor > 0.008){
      add.push(mk('a', at(cursor, nx, ny), at(g.t0, nx, ny)));
      add.push(mk('b', at(cursor, -nx, -ny), at(g.t0, -nx, -ny)));
    }
    add.push(mk('jamb', at(g.t0, nx, ny), at(g.t0, -nx, -ny)));
    add.push(mk('jamb', at(g.t1, nx, ny), at(g.t1, -nx, -ny)));
    cursor = g.t1;
  }
  if (1 - cursor > 0.008){
    add.push(mk('a', at(cursor, nx, ny), at(1, nx, ny)));
    add.push(mk('b', at(cursor, -nx, -ny), at(1, -nx, -ny)));
  }
  add.push(mk('cap0', at(0, nx, ny), at(0, -nx, -ny)));
  add.push(mk('cap1', at(1, nx, ny), at(1, -nx, -ny)));
  const ocl = { x1: cl.x1, y1: cl.y1, x2: cl.x2, y2: cl.y2, th: cl.th, layer: ly };
  add.forEach(f => { f.ocl = ocl; });
  return add;
}

function rotateFrags(frags, deg){
  return rotateEntities(frags, 0, 0, deg);
}

export function doorFrags(width, swing){
  const w = width || 3;
  const s = swing === 'R' ? -1 : 1;
  const leaf = [{ type: 'line', layer: 'DOORS', x1: 0, y1: 0, x2: 0, y2: s * w }];
  const arc = [{ type: 'arc', layer: 'DOORS', cx: 0, cy: 0, r: w, a1: s > 0 ? 0 : 270, a2: s > 0 ? 90 : 360 }];
  return leaf.concat(arc);
}

export function windowFrags(width, th){
  const w = width || 3, h = (th || 0.5) / 2 + 0.08;
  return [
    { type: 'line', layer: 'DOORS', x1: -w / 2, y1: -h, x2: w / 2, y2: -h },
    { type: 'line', layer: 'DOORS', x1: -w / 2, y1: 0, x2: w / 2, y2: 0 },
    { type: 'line', layer: 'DOORS', x1: -w / 2, y1: h, x2: w / 2, y2: h },
    { type: 'line', layer: 'DOORS', x1: -w / 2, y1: -h, x2: -w / 2, y2: h },
    { type: 'line', layer: 'DOORS', x1: w / 2, y1: -h, x2: w / 2, y2: h }
  ];
}

/* Place a door/window into a wall: cut the wall, stamp a rotated block at the opening. */
export function placeOpening(members, kind, t, width, swing){
  const cut = cutWallOpening(members, t, width || (kind === 'window' ? 3 : 3));
  if (!cut.ok) return cut;
  const ang = Math.atan2(cut.cl.y2 - cut.cl.y1, cut.cl.x2 - cut.cl.x1) * 180 / Math.PI;
  const mx = (cut.opening.x1 + cut.opening.x2) / 2;
  const my = (cut.opening.y1 + cut.opening.y2) / 2;
  let frags = kind === 'window' ? windowFrags(cut.opening.width, cut.opening.th) : doorFrags(cut.opening.width, swing);
  /* Door hinge at the start of the opening, leaf along the wall. */
  if (kind !== 'window'){
    frags = rotateFrags(frags, ang);
    frags.forEach(f => translateEnt(f, cut.opening.x1, cut.opening.y1));
  } else {
    frags = rotateFrags(frags, ang);
    frags.forEach(f => translateEnt(f, mx, my));
  }
  return { ok: true, wallAdd: cut.add, openingFrags: frags, opening: cut.opening };
}

export function paramOnWall(members, w){
  const cl = wallCenterline(members);
  if (!cl) return 0.5;
  const dx = cl.x2 - cl.x1, dy = cl.y2 - cl.y1, L2 = dx * dx + dy * dy || 1;
  return Math.max(0, Math.min(1, ((w[0] - cl.x1) * dx + (w[1] - cl.y1) * dy) / L2));
}

void SYMBOLS; void deep;
