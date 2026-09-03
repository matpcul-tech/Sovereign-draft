/* Dynamic INSERT blocks. Door/window carry width + swing; fixtures and user
 * blocks carry rotation + flip. Stretching a door in a wall recuts the host.
 * Explode yields ordinary fragments so offset/trim/fillet still work.
 */
import { dist, deep } from './geometry.js';
import { doorFrags, windowFrags, wallWithOpenings, wallCenterline } from './walls.js';
import { SYMBOLS } from './symbols.js';

export const DOOR_WIDTHS = [2, 2.5, 2 + 8 / 12, 3, 3.5, 4, 5, 6];
export const WINDOW_WIDTHS = [2, 3, 4, 5, 6, 8];

export function snapWidth(w, kind){
  const min = kind === 'window' ? 1 : 2;
  const s = Math.round((w || min) * 12) / 12;
  return Math.max(min, Math.min(8, s));
}

/* A door belongs on the door layer, not on FIXTURES because that was
 * the first default anybody wrote. The block says what it is. */
function defaultLayerFor(def){
  if (def === 'door' || def === 'window') return 'DOORS';
  if (def === 'sym:Door' || def === 'sym:Window') return 'DOORS';
  return 'FIXTURES';
}

export function makeInsert(opts){
  opts = opts || {};
  return {
    type: 'insert',
    layer: opts.layer || defaultLayerFor(opts.def),
    name: opts.name || 'Block',
    def: opts.def || 'sym',
    x: opts.x || 0,
    y: opts.y || 0,
    rot: opts.rot || 0,
    width: opts.width,
    swing: opts.swing || 'L',
    flip: opts.flip === -1 ? -1 : 1,
    scale: opts.scale || 1,
    th: opts.th,
    host: opts.host || null,
    t: opts.t,
    cl: opts.cl || null,
    frags: opts.frags || null
  };
}

export function insertLocalToWorld(e, x, y){
  const s = e.scale || 1;
  const fl = e.flip == null ? 1 : e.flip;
  const rad = (e.rot || 0) * Math.PI / 180;
  const c = Math.cos(rad), si = Math.sin(rad);
  const lx = x * fl * s, ly = y * s;
  return [e.x + lx * c - ly * si, e.y + lx * si + ly * c];
}

export function insertWorldToLocal(e, x, y){
  const dx = x - e.x, dy = y - e.y;
  const rad = (e.rot || 0) * Math.PI / 180;
  const c = Math.cos(rad), si = Math.sin(rad);
  const rx = dx * c + dy * si;
  const ry = -dx * si + dy * c;
  const s = e.scale || 1;
  const fl = e.flip == null ? 1 : e.flip;
  return [rx / ((fl || 1) * s), ry / s];
}

function xformFrags(frags, e){
  const s = e.scale || 1;
  const fl = e.flip == null ? 1 : e.flip;
  const rad = (e.rot || 0) * Math.PI / 180;
  const c = Math.cos(rad), si = Math.sin(rad);
  const pt = (x, y) => {
    const lx = x * fl * s, ly = y * s;
    return [e.x + lx * c - ly * si, e.y + lx * si + ly * c];
  };
  const addAng = e.rot || 0;
  /* Block geometry lands on the insert's layer, the way AutoCAD resolves
   * block content drawn on layer 0. The fragment makers name a layer for
   * the standalone case; an inserted block follows its insert, so moving
   * a door to a layer of your own moves its lines and swing arc too
   * instead of leaving them behind on DOORS. */
  const onLayer = e.layer || null;
  return (frags || []).map(src => {
    const f = deep(src);
    if (onLayer) f.layer = onLayer;
    if (f.type === 'line'){
      const a = pt(f.x1, f.y1), b = pt(f.x2, f.y2);
      f.x1 = a[0]; f.y1 = a[1]; f.x2 = b[0]; f.y2 = b[1];
    } else if (f.type === 'poly' || f.type === 'hatch'){
      f.pts = (f.pts || []).map(p => pt(p[0], p[1]));
    } else if (f.type === 'circle'){
      const p = pt(f.cx, f.cy);
      f.cx = p[0]; f.cy = p[1]; f.r *= s;
    } else if (f.type === 'arc'){
      const p = pt(f.cx, f.cy);
      f.cx = p[0]; f.cy = p[1]; f.r *= s;
      if (fl < 0){
        const a1 = 180 - f.a2, a2 = 180 - f.a1;
        f.a1 = (a1 + addAng + 360) % 360;
        f.a2 = (a2 + addAng + 360) % 360;
      } else {
        f.a1 = (f.a1 + addAng + 360) % 360;
        f.a2 = (f.a2 + addAng + 360) % 360;
      }
    } else if (f.type === 'text'){
      const p = pt(f.x, f.y);
      f.x = p[0]; f.y = p[1];
      if (s !== 1) f.size = (f.size || 1) * s;
    }
    return f;
  });
}

export function expandInsert(e){
  let local = [];
  if (e.def === 'door') local = doorFrags(e.width || 3, e.swing);
  else if (e.def === 'window') local = windowFrags(e.width || 3, e.th || 0.5);
  else if (e.frags && e.frags.length) local = deep(e.frags);
  else if (e.def && String(e.def).indexOf('sym:') === 0){
    const s = SYMBOLS.find(x => x.name === e.def.slice(4));
    local = s ? s.make() : [];
  }
  return xformFrags(local, e);
}

export function paramOnCl(cl, w){
  if (!cl) return 0.5;
  const dx = cl.x2 - cl.x1, dy = cl.y2 - cl.y1, L2 = dx * dx + dy * dy || 1;
  return Math.max(0.05, Math.min(0.95, ((w[0] - cl.x1) * dx + (w[1] - cl.y1) * dy) / L2));
}

export function locateInsert(e, cl){
  if (!cl) return e;
  const L = dist(cl.x1, cl.y1, cl.x2, cl.y2) || 1e-9;
  const ux = (cl.x2 - cl.x1) / L, uy = (cl.y2 - cl.y1) / L;
  e.rot = Math.atan2(uy, ux) * 180 / Math.PI;
  e.th = cl.th;
  const w = e.width || 3;
  const half = w / 2 / L;
  const tIn = e.t == null ? 0.5 : e.t;
  e.t = Math.max(half + 0.02, Math.min(1 - half - 0.02, tIn));
  if (e.def === 'door'){
    const t0 = e.t - w / 2 / L;
    e.x = cl.x1 + ux * t0 * L;
    e.y = cl.y1 + uy * t0 * L;
  } else {
    e.x = cl.x1 + ux * e.t * L;
    e.y = cl.y1 + uy * e.t * L;
  }
  return e;
}

export function clFromMembers(members){
  const tagged = (members || []).find(e => e && e.ocl);
  if (tagged && tagged.ocl){
    const c = tagged.ocl;
    return { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, th: c.th, layer: c.layer || (members[0] && members[0].layer) || 'WALLS' };
  }
  const cl = wallCenterline(members);
  if (!cl) return null;
  return { x1: cl.x1, y1: cl.y1, x2: cl.x2, y2: cl.y2, th: cl.th, layer: (members[0] && members[0].layer) || 'WALLS' };
}

export function syncHostWall(state, host){
  if (!host) return;
  const members = state.entities.filter(e => e.g === host);
  const inserts = state.entities.filter(e => e.type === 'insert' && e.host === host);
  const cl = (inserts[0] && inserts[0].cl) || clFromMembers(members);
  if (!cl) return;
  inserts.forEach(e => { e.cl = cl; locateInsert(e, cl); });
  const add = wallWithOpenings(cl, inserts.map(e => ({ t: e.t, width: e.width || 3 })));
  state.entities = state.entities.filter(e => e.g !== host);
  add.forEach(f => { f.g = host; f.id = state.idSeq++; state.entities.push(f); });
}

export function detachInsert(e){
  if (!e || e.type !== 'insert') return e;
  e.host = null;
  e.cl = null;
  e.t = undefined;
  return e;
}

export function insertGrips(e){
  const g = [];
  g.push({ x: e.x, y: e.y, kind: 'move', apply(p){
    if (e.host && e.cl){
      e.t = paramOnCl(e.cl, p);
      locateInsert(e, e.cl);
    } else { e.x = p[0]; e.y = p[1]; }
  } });
  if (e.def === 'door' || e.def === 'window'){
    const w = e.width || 3;
    if (e.def === 'door'){
      const leaf = insertLocalToWorld(e, 0, (e.swing === 'R' ? -1 : 1) * w);
      g.push({ x: leaf[0], y: leaf[1], kind: 'stretch', apply(p){
        const loc = insertWorldToLocal(e, p[0], p[1]);
        e.width = snapWidth(Math.abs(loc[1]), 'door');
        if (e.host && e.cl) locateInsert(e, e.cl);
      } });
      const flip = insertLocalToWorld(e, 0.6 * w, (e.swing === 'R' ? -0.4 : 0.4) * w);
      g.push({ x: flip[0], y: flip[1], kind: 'flip', once: true, apply(){
        e.swing = e.swing === 'R' ? 'L' : 'R';
      } });
    } else {
      const a = insertLocalToWorld(e, w / 2, 0);
      g.push({ x: a[0], y: a[1], kind: 'stretch', apply(p){
        const loc = insertWorldToLocal(e, p[0], p[1]);
        e.width = snapWidth(Math.abs(loc[0]) * 2, 'window');
        if (e.host && e.cl) locateInsert(e, e.cl);
      } });
    }
  } else {
    const rot = insertLocalToWorld(e, 0, 2);
    g.push({ x: rot[0], y: rot[1], kind: 'rotate', apply(p){
      e.rot = Math.atan2(p[1] - e.y, p[0] - e.x) * 180 / Math.PI - 90;
    } });
    const flip = insertLocalToWorld(e, 1.2, 0);
    g.push({ x: flip[0], y: flip[1], kind: 'flip', once: true, apply(){
      e.flip = (e.flip || 1) * -1;
    } });
  }
  return g;
}

export function flipInsert(e){
  if (e.def === 'door' || e.def === 'window') e.swing = e.swing === 'R' ? 'L' : 'R';
  else e.flip = (e.flip || 1) * -1;
  return e;
}
