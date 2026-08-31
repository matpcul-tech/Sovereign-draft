/* Associative dimensions: a dim stores the wall-end or entity-end it was
 * taken from, and follows when that geometry moves.
 *
 * Stretch / move update the host first; afterChange calls refreshAssocDims
 * so the measured points snap back to the live geometry. A dim without
 * assoc is a free annotation and stretches with the window.
 */
import { dist } from './geometry.js';
import { clFromMembers } from './dynblock.js';
import { wallCenterline } from './walls.js';

const TOL = 0.2;

function wallGroups(entities){
  const g = {};
  (entities || []).forEach(e => {
    if (e.kind === 'wall' && e.g){ (g[e.g] = g[e.g] || []).push(e); }
  });
  return g;
}

function liveWallCl(members){
  const live = wallCenterline(members);
  if (live) return live;
  return clFromMembers(members);
}

export function syncWallOcls(entities){
  const groups = wallGroups(entities);
  Object.keys(groups).forEach(id => {
    const cl = wallCenterline(groups[id]);
    if (!cl) return;
    groups[id].forEach(m => {
      if (!m.ocl) m.ocl = { x1: cl.x1, y1: cl.y1, x2: cl.x2, y2: cl.y2, th: cl.th, layer: m.layer };
      else {
        m.ocl.x1 = cl.x1; m.ocl.y1 = cl.y1;
        m.ocl.x2 = cl.x2; m.ocl.y2 = cl.y2;
        if (cl.th) m.ocl.th = cl.th;
      }
    });
  });
}

function ptsOf(e){
  const out = [];
  if (e.type === 'line' || e.type === 'xline' || e.type === 'dim'){
    out.push([e.x1, e.y1, { kind: 'ent', id: e.id, k: 'a' }]);
    out.push([e.x2, e.y2, { kind: 'ent', id: e.id, k: 'b' }]);
  } else if ((e.type === 'poly' || e.type === 'hatch' || e.type === 'profile') && e.pts){
    e.pts.forEach((p, i) => out.push([p[0], p[1], { kind: 'ent', id: e.id, k: 'p' + i }]));
  } else if (e.type === 'insert'){
    out.push([e.x, e.y, { kind: 'ent', id: e.id, k: 'ins' }]);
  } else if (e.type === 'circle' || e.type === 'arc'){
    out.push([e.cx, e.cy, { kind: 'ent', id: e.id, k: 'c' }]);
  }
  return out;
}

export function bindAlignedDim(e, entities){
  if (!e || e.type !== 'dim') return e;
  if (e.kind === 'radius' || e.kind === 'diameter'){
    const c = nearestCircle(entities, e.x1, e.y1, e);
    if (c) e.assoc = [c, c];
    return e;
  }
  if (e.kind === 'angular') return e;
  const a = nearestAssoc(entities, e.x1, e.y1, e);
  const b = nearestAssoc(entities, e.x2, e.y2, e);
  if (a && b) e.assoc = [a, b];
  return e;
}

export function bindAllDims(entities){
  (entities || []).forEach(e => {
    if (e.type === 'dim' && !e.assoc) bindAlignedDim(e, entities);
  });
  return entities;
}

function nearestCircle(entities, x, y, self){
  let best = null, bd = TOL * 2;
  (entities || []).forEach(ent => {
    if (ent === self || (ent.type !== 'circle' && ent.type !== 'arc')) return;
    const d = dist(x, y, ent.cx, ent.cy);
    if (d < bd){ bd = d; best = { kind: 'ent', id: ent.id, k: 'c' }; }
  });
  return best;
}

export function nearestAssoc(entities, x, y, self){
  let best = null, bd = TOL;
  const groups = wallGroups(entities);
  Object.keys(groups).forEach(id => {
    const cl = liveWallCl(groups[id]);
    if (!cl) return;
    [[cl.x1, cl.y1, 0], [cl.x2, cl.y2, 1]].forEach(p => {
      const d = dist(x, y, p[0], p[1]);
      if (d < bd){ bd = d; best = { kind: 'wall', g: id, end: p[2] }; }
    });
  });
  (entities || []).forEach(ent => {
    if (ent === self || ent.type === 'dim' || ent.type === 'room' || ent.kind === 'wall') return;
    ptsOf(ent).forEach(p => {
      const d = dist(x, y, p[0], p[1]);
      if (d < bd){ bd = d; best = p[2]; }
    });
  });
  return best;
}

function resolve(ref, entities){
  if (!ref) return null;
  if (ref.kind === 'wall'){
    const members = (entities || []).filter(e => e.g === ref.g);
    const cl = liveWallCl(members);
    if (!cl) return null;
    return ref.end === 0 ? [cl.x1, cl.y1] : [cl.x2, cl.y2];
  }
  const e = (entities || []).find(x => x.id === ref.id);
  if (!e) return null;
  if (ref.k === 'a') return [e.x1, e.y1];
  if (ref.k === 'b') return [e.x2, e.y2];
  if (ref.k === 'ins') return [e.x, e.y];
  if (ref.k === 'c') return [e.cx, e.cy];
  if (ref.k && ref.k[0] === 'p' && e.pts){
    const i = parseInt(ref.k.slice(1), 10);
    return e.pts[i] ? [e.pts[i][0], e.pts[i][1]] : null;
  }
  return null;
}

export function refreshAssocDims(entities){
  syncWallOcls(entities);
  (entities || []).forEach(e => {
    if (e.type !== 'dim' || !e.assoc || e.assoc.length < 2) return;
    if (e.kind === 'angular') return;
    if (e.kind === 'radius' || e.kind === 'diameter'){
      const c = resolve(e.assoc[0], entities);
      if (!c) return;
      const host = (entities || []).find(x => x.id === e.assoc[0].id);
      const r = host && host.r != null ? host.r : dist(e.x1, e.y1, e.x2, e.y2);
      const ang = Math.atan2((e.y2 - e.y1) || 0, (e.x2 - e.x1) || 1);
      e.x1 = c[0]; e.y1 = c[1];
      e.x2 = c[0] + Math.cos(ang) * r;
      e.y2 = c[1] + Math.sin(ang) * r;
      return;
    }
    const a = resolve(e.assoc[0], entities);
    const b = resolve(e.assoc[1], entities);
    if (!a || !b) return;
    e.x1 = a[0]; e.y1 = a[1];
    e.x2 = b[0]; e.y2 = b[1];
  });
}
