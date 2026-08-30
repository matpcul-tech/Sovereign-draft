/* External references. An xref is a named snapshot of another drawing, placed
 * as one object. BIND explodes it into ordinary entities. Overlay xrefs do not
 * nest (they drop if the host itself is attached).
 */
import { deep } from './geometry.js';
import { transformEnt } from './modify.js';

export function makeXref(opts){
  const o = opts || {};
  return {
    type: 'xref',
    layer: o.layer || 'UNDERLAY',
    name: o.name || 'XREF',
    path: o.path || '',
    x: o.x || 0,
    y: o.y || 0,
    rot: o.rot || 0,
    scale: o.scale == null ? 1 : o.scale,
    overlay: !!o.overlay,
    entities: o.entities || []
  };
}

function xf(e, x, y){
  const s = e.scale == null ? 1 : e.scale;
  const rad = (e.rot || 0) * Math.PI / 180;
  const lx = x * s, ly = y * s;
  const c = Math.cos(rad), si = Math.sin(rad);
  return [(e.x || 0) + lx * c - ly * si, (e.y || 0) + lx * si + ly * c];
}

function extraOf(e){
  const s = e.scale == null ? 1 : e.scale;
  return { scaleR: s, scaleOff: s, addAng: e.rot || 0 };
}

export function expandXref(e, depth){
  depth = depth || 0;
  if (!e || e.type !== 'xref' || depth > 4) return [];
  const out = [];
  (e.entities || []).forEach(child => {
    if (!child) return;
    if (child.type === 'xref'){
      expandXref(child, depth + 1).forEach(f => {
        const c = deep(f);
        transformEnt(c, (x, y) => xf(e, x, y), extraOf(e));
        out.push(c);
      });
      return;
    }
    const c = deep(child);
    delete c.id;
    delete c.g;
    transformEnt(c, (x, y) => xf(e, x, y), extraOf(e));
    out.push(c);
  });
  return out;
}

export function snapshotEntities(entities){
  const out = [];
  (entities || []).forEach(e => {
    if (!e) return;
    if (e.type === 'xref'){
      if (e.overlay) return;
      expandXref(e).forEach(f => { const c = deep(f); delete c.id; out.push(c); });
      return;
    }
    const c = deep(e);
    delete c.id;
    out.push(c);
  });
  return out;
}

export function attachXref(hostEntities, source, opts){
  const o = opts || {};
  const src = source || {};
  return makeXref({
    name: o.name || src.name || 'XREF',
    path: o.path || '',
    x: o.x || 0,
    y: o.y || 0,
    rot: o.rot || 0,
    scale: o.scale == null ? 1 : o.scale,
    overlay: !!o.overlay,
    layer: o.layer || 'UNDERLAY',
    entities: snapshotEntities(src.entities || src)
  });
}

export function bindXref(e){
  return expandXref(e);
}

export function xrefGrips(e){
  const s = e.scale == null ? 1 : e.scale;
  return [
    { x: e.x, y: e.y, kind: 'move', apply(p){ e.x = p[0]; e.y = p[1]; } },
    { x: e.x + Math.max(2, s * 4), y: e.y, kind: 'scale', apply(p){
      const d = Math.max(0.05, p[0] - e.x);
      e.scale = d / 4;
    } }
  ];
}
