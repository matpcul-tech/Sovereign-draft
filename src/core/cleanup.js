/* Wall T-junction cleanup: a stem end that lands on a run is extended to the
 * run centerline and the run is recut with a joint the width of the stem.
 */
import { dist, closestOnSeg, lineIntersectStrict } from './geometry.js';
import { wallWithOpenings, wallCenterline } from './walls.js';
import { clFromMembers, paramOnCl } from './dynblock.js';

function groupsOf(entities){
  const g = {};
  (entities || []).forEach(e => {
    if (e.kind === 'wall' && e.g){ (g[e.g] = g[e.g] || []).push(e); }
  });
  return g;
}

export function findTJoins(entities){
  const groups = groupsOf(entities);
  const ids = Object.keys(groups);
  const joins = []; /* { stem, run, t, width, end } */
  ids.forEach(stemId => {
    const clS = clFromMembers(groups[stemId]);
    if (!clS) return;
    const ends = [[clS.x1, clS.y1, 0], [clS.x2, clS.y2, 1]];
    ids.forEach(runId => {
      if (runId === stemId) return;
      const clR = clFromMembers(groups[runId]);
      if (!clR) return;
      ends.forEach(end => {
        const hit = closestOnSeg(end[0], end[1], clR.x1, clR.y1, clR.x2, clR.y2);
        const tol = (clR.th || 0.5) * 0.7 + 0.12;
        if (hit.d > tol) return;
        const t = paramOnCl(clR, [hit.x, hit.y]);
        if (t < 0.07 || t > 0.93) return;
        joins.push({ stem: stemId, run: runId, t, width: clS.th || 0.5, end: end[2], clS, clR, hit });
      });
    });
  });
  return joins;
}

export function cleanupTJunctions(entities){
  const joins = findTJoins(entities);
  if (!joins.length) return { ok: false, count: 0, entities };
  const byRun = {};
  joins.forEach(j => { (byRun[j.run] = byRun[j.run] || []).push(j); });
  const killG = new Set(Object.keys(byRun));
  const inserts = (entities || []).filter(e => e.type === 'insert' && e.host && byRun[e.host]);
  const out = (entities || []).filter(e => !(e.kind === 'wall' && killG.has(e.g)));
  Object.keys(byRun).forEach(runId => {
    const members = (entities || []).filter(e => e.g === runId);
    const cl = clFromMembers(members) || wallCenterline(members);
    if (!cl) return;
    const openings = [];
    inserts.filter(i => i.host === runId).forEach(i => openings.push({ t: i.t, width: i.width || 3 }));
    byRun[runId].forEach(j => openings.push({ t: j.t, width: j.width }));
    const add = wallWithOpenings(cl, openings);
    add.forEach(f => { f.g = runId; out.push(f); });
  });
  /* Snap stem ends onto the run centerline. */
  joins.forEach(j => {
    const stem = out.filter(e => e.g === j.stem);
    const clS = clFromMembers(stem);
    if (!clS) return;
    const target = [j.hit.x, j.hit.y];
    const from = j.end === 0 ? [clS.x1, clS.y1] : [clS.x2, clS.y2];
    const dx = target[0] - from[0], dy = target[1] - from[1];
    if (dist(0, 0, dx, dy) < 1e-6) return;
    stem.forEach(e => {
      if (e.role === 'cap' + j.end || e.role === 'cap' + String(j.end)){
        e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy;
      } else if (e.role === 'a' || e.role === 'b'){
        const d1 = dist(e.x1, e.y1, from[0], from[1]);
        const d2 = dist(e.x2, e.y2, from[0], from[1]);
        if (d1 < d2){ e.x1 += dx; e.y1 += dy; }
        else { e.x2 += dx; e.y2 += dy; }
      }
    });
  });
  return { ok: true, count: joins.length, entities: out };
}

/* L-corners: two wall ends that nearly meet are pulled to the CL intersection
 * and both walls are rebuilt so faces miter instead of overlapping.
 */
export function joinLCorners(entities){
  const groups = groupsOf(entities);
  const ids = Object.keys(groups);
  const cls = {};
  ids.forEach(id => { cls[id] = clFromMembers(groups[id]); });
  let changed = false;
  for (let i = 0; i < ids.length; i++){
    for (let j = i + 1; j < ids.length; j++){
      const A = cls[ids[i]], B = cls[ids[j]];
      if (!A || !B) continue;
      const tol = 1.4 * Math.max(A.th || 0.5, B.th || 0.5);
      const endsA = [[A.x1, A.y1, 0], [A.x2, A.y2, 1]];
      const endsB = [[B.x1, B.y1, 0], [B.x2, B.y2, 1]];
      let pair = null, bd = tol;
      endsA.forEach(a => endsB.forEach(b => {
        const d = dist(a[0], a[1], b[0], b[1]);
        if (d < bd){ bd = d; pair = { a, b }; }
      }));
      if (!pair) continue;
      const hit = lineIntersectStrict([A.x1, A.y1], [A.x2, A.y2], [B.x1, B.y1], [B.x2, B.y2]);
      if (!hit) continue;
      if (dist(hit[0], hit[1], pair.a[0], pair.a[1]) > 3) continue;
      if (dist(hit[0], hit[1], pair.b[0], pair.b[1]) > 3) continue;
      if (pair.a[2] === 0){ A.x1 = hit[0]; A.y1 = hit[1]; }
      else { A.x2 = hit[0]; A.y2 = hit[1]; }
      if (pair.b[2] === 0){ B.x1 = hit[0]; B.y1 = hit[1]; }
      else { B.x2 = hit[0]; B.y2 = hit[1]; }
      changed = true;
    }
  }
  if (!changed) return { ok: false, entities, count: 0 };
  const inserts = (entities || []).filter(e => e.type === 'insert' && e.host);
  const kill = new Set(ids);
  const out = (entities || []).filter(e => !(e.kind === 'wall' && kill.has(e.g)));
  ids.forEach(id => {
    const cl = cls[id];
    if (!cl) return;
    const openings = inserts.filter(i => i.host === id).map(i => ({ t: i.t, width: i.width || 3 }));
    const add = wallWithOpenings(cl, openings);
    add.forEach(f => { f.g = id; out.push(f); });
  });
  return { ok: true, count: 1, entities: out };
}

export function healWalls(entities){
  const L = joinLCorners(entities);
  const base = L.ok ? L.entities : entities;
  const T = cleanupTJunctions(base);
  const ents = T.ok ? T.entities : base;
  const count = (L.ok ? 1 : 0) + (T.count || 0);
  return { ok: count > 0, count, entities: ents };
}

