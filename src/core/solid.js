/* Extrude the 2D model of record into a 3D solid.
 *
 * The plan stays the source of truth. Height is attrs.height / opts.height
 * when the user set it; otherwise 8'-0" and the view is stamped ASSUMED.
 * Doors 6'-8", window sill 3'-0" / head 6'-8" — same rule: never pretend
 * a 2D drawing knew those numbers.
 *
 * Coordinates are CAD world, Z-up: (x, y_plan, z_height). The 3D view
 * remaps to Three.js Y-up. DXF 3DFACE / DWG use this Z-up frame.
 */
import { hypot } from './geometry.js';
import { explodeForIO } from './entities.js';
import { ASSUMED_HEIGHT } from './section.js';

export const ASSUMED_STORY = ASSUMED_HEIGHT;
export const ASSUMED_DOOR = 6 + 8 / 12;
export const ASSUMED_SILL = 3;
export const ASSUMED_HEAD = 6 + 8 / 12;
export const DOOR_THICK = 1.5 / 12;

const SKIP = {
  dim: 1, text: 1, table: 1, leader: 1, cloud: 1, image: 1, grid: 1,
  xline: 1, centerline: 1, callout: 1, fcf: 1, datum: 1, finish: 1,
  cutplane: 1
};

function hexRgb(c){
  const s = String(c || '#d4a843').replace('#', '');
  const n = parseInt(s.length === 3 ? s[0]+s[0]+s[1]+s[1]+s[2]+s[2] : s, 16);
  if (!isFinite(n)) return [0.83, 0.66, 0.26];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function layerColor(layers, name){
  const L = (layers || []).find(x => x.name === name);
  return (L && L.color) || '#d4a843';
}

function layerPlot(layers, name){
  const L = (layers || []).find(x => x.name === name);
  return !L || L.plot !== false;
}

function mid(e){
  return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2];
}

function dist2(a, b){
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function signedArea(pts){
  let a = 0;
  for (let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInTri(p, a, b, c){
  const v0x = c[0] - a[0], v0y = c[1] - a[1];
  const v1x = b[0] - a[0], v1y = b[1] - a[1];
  const v2x = p[0] - a[0], v2y = p[1] - a[1];
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-12);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

function isEar(a, b, c, ccw){
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return ccw ? cross > 1e-12 : cross < -1e-12;
}

/* Convex means every turn goes the same way round. */
function convexQuad(p){
  let neg = false, pos = false;
  for (let i = 0; i < 4; i++){
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr < -1e-12) neg = true;
    if (cr > 1e-12) pos = true;
  }
  return !(neg && pos);
}

export function triangulate(pts){
  const n0 = (pts || []).length;
  if (n0 < 3) return [];
  if (n0 === 3) return [0, 1, 2];
  /* A quad can only be split on the 0-2 diagonal when that diagonal stays
   * inside it. On a concave quad it does not, and the two triangles cover
   * area the polygon never had: a dart of area 6 came out as 10. */
  if (n0 === 4 && convexQuad(pts)) return [0, 1, 2, 0, 2, 3];
  const ccw = signedArea(pts) > 0;
  const idx = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n0 * n0){
    let clipped = false;
    for (let i = 0; i < idx.length; i++){
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (!isEar(a, b, c, ccw)) continue;
      let ear = true;
      for (let j = 0; j < idx.length; j++){
        const k = idx[j];
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTri(pts[k], a, b, c)){ ear = false; break; }
      }
      if (!ear) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

function pushBox(positions, indices, x1, y1, x2, y2, th, z0, z1){
  const L = hypot(x2 - x1, y2 - y1) || 1e-9;
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  const nx = -uy * th / 2, ny = ux * th / 2;
  const base = positions.length / 3;
  const corners = [
    [x1 + nx, y1 + ny, z0], [x1 - nx, y1 - ny, z0],
    [x2 - nx, y2 - ny, z0], [x2 + nx, y2 + ny, z0],
    [x1 + nx, y1 + ny, z1], [x1 - nx, y1 - ny, z1],
    [x2 - nx, y2 - ny, z1], [x2 + nx, y2 + ny, z1]
  ];
  corners.forEach(p => { positions.push(p[0], p[1], p[2]); });
  const faces = [
    [0, 1, 2, 3], [4, 7, 6, 5],
    [0, 3, 7, 4], [1, 5, 6, 2],
    [0, 4, 5, 1], [3, 2, 6, 7]
  ];
  faces.forEach(f => {
    indices.push(base + f[0], base + f[1], base + f[2]);
    indices.push(base + f[0], base + f[2], base + f[3]);
  });
}

function pushPrism(positions, indices, pts, z0, z1){
  if (!pts || pts.length < 3) return;
  const ring = pts.map(p => [p[0], p[1]]);
  if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
    ring.pop();
  if (ring.length < 3) return;
  const tris = triangulate(ring);
  const n = ring.length;
  const base = positions.length / 3;
  ring.forEach(p => positions.push(p[0], p[1], z0));
  ring.forEach(p => positions.push(p[0], p[1], z1));
  const area = signedArea(ring);
  const ccw = area >= 0;
  for (let i = 0; i < tris.length; i += 3){
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    if (ccw){
      indices.push(base + a, base + c, base + b);
      indices.push(base + n + a, base + n + b, base + n + c);
    } else {
      indices.push(base + a, base + b, base + c);
      indices.push(base + n + a, base + n + c, base + n + b);
    }
  }
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n;
    const b0 = base + i, b1 = base + j, t0 = base + n + i, t1 = base + n + j;
    if (ccw){
      indices.push(b0, b1, t1); indices.push(b0, t1, t0);
    } else {
      indices.push(b0, t1, b1); indices.push(b0, t0, t1);
    }
  }
}

function pushCylinder(positions, indices, cx, cy, r, z0, z1, segs){
  segs = segs || 24;
  const ring = [];
  for (let i = 0; i < segs; i++){
    const a = i / segs * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  pushPrism(positions, indices, ring, z0, z1);
}

function meshOf(kind, layer, color, positions, indices, extra){
  if (!positions.length || !indices.length) return null;
  return Object.assign({
    kind, layer, color,
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices)
  }, extra || {});
}

function wallSegments(members){
  const as = members.filter(m => m.role === 'a' && m.x1 != null);
  const bs = members.filter(m => m.role === 'b' && m.x1 != null).slice();
  const segs = [];
  as.forEach(a => {
    let best = -1, bd = 1e9;
    const ma = mid(a);
    bs.forEach((b, i) => {
      const d = dist2(ma, mid(b));
      if (d < bd){ bd = d; best = i; }
    });
    if (best < 0) return;
    const b = bs.splice(best, 1)[0];
    segs.push({
      x1: (a.x1 + b.x1) / 2, y1: (a.y1 + b.y1) / 2,
      x2: (a.x2 + b.x2) / 2, y2: (a.y2 + b.y2) / 2,
      th: hypot(a.x1 - b.x1, a.y1 - b.y1) || a.th || 0.5
    });
  });
  return segs;
}

function flattenTree(entities){
  const out = [];
  (entities || []).forEach(e => {
    if (!e) return;
    if (e.type === 'xref' && e.entities) flattenTree(e.entities).forEach(x => out.push(x));
    else out.push(e);
  });
  return out;
}

export function resolveHeight(opts){
  const o = opts || {};
  if (o.height != null && Number(o.height) > 0){
    return { height: Number(o.height), assumed: o.assumed !== false && o.assumed !== 0 ? !!o.assumed : false };
  }
  return { height: ASSUMED_STORY, assumed: true };
}

export function extrudeDrawing(entities, opts){
  const o = opts || {};
  const layers = o.layers || [];
  const { height, assumed } = resolveHeight(o);
  const doorH = o.doorHeight > 0 ? o.doorHeight : ASSUMED_DOOR;
  const sill = o.sill > 0 ? o.sill : ASSUMED_SILL;
  const head = o.head > 0 ? o.head : Math.min(ASSUMED_HEAD, height);
  const openingsAssumed = !(o.doorHeight > 0 && o.sill > 0 && o.head > 0);
  const ents = flattenTree(entities);
  const meshes = [];
  const used = new Set();

  const groups = new Map();
  ents.forEach(e => {
    if (e.kind === 'wall' && e.g){
      if (!groups.has(e.g)) groups.set(e.g, []);
      groups.get(e.g).push(e);
    }
  });
  groups.forEach(members => {
    members.forEach(m => { if (m.id != null) used.add(m.id); });
    const segs = wallSegments(members);
    const positions = [], indices = [];
    const ly = (members[0] && members[0].layer) || 'WALLS';
    if (!layerPlot(layers, ly)) return;
    segs.forEach(s => pushBox(positions, indices, s.x1, s.y1, s.x2, s.y2, s.th, 0, height));
    const m = meshOf('wall', ly, layerColor(layers, ly), positions, indices, { assumed });
    if (m) meshes.push(m);
  });

  ents.forEach(e => {
    if (e.id != null && used.has(e.id)) return;
    if (SKIP[e.type]) return;
    if (!layerPlot(layers, e.layer)) return;
    if (e.kind === 'wall') return;
    /* Generated views are drawings OF the model, not model: an elevation
     * ring extruded into a prism would put a building-shaped ghost beside
     * the building. */
    if (e.layer === 'SECTION' || e.layer === 'OPENINGS') return;

    if (e.type === 'insert' && (e.def === 'door' || e.def === 'window')){
      const rot = (e.rot || 0) * Math.PI / 180;
      const c = Math.cos(rot), s = Math.sin(rot);
      const w = e.width || 3;
      const th = e.th || 0.5;
      const positions = [], indices = [];
      if (e.def === 'door'){
        const swing = e.swing === 'R' ? -1 : 1;
        const x1 = e.x, y1 = e.y;
        const x2 = e.x + c * 0 + -s * (swing * w);
        const y2 = e.y + s * 0 + c * (swing * w);
        pushBox(positions, indices, x1, y1, x2, y2, DOOR_THICK, 0, Math.min(doorH, height));
        const m = meshOf('door', e.layer || 'DOORS', layerColor(layers, e.layer || 'DOORS'), positions, indices, { assumed: openingsAssumed });
        if (m) meshes.push(m);
      } else {
        const hx = c * (w / 2), hy = s * (w / 2);
        pushBox(positions, indices, e.x - hx, e.y - hy, e.x + hx, e.y + hy, Math.max(0.06, th * 0.25), sill, Math.min(head, height));
        const m = meshOf('window', e.layer || 'DOORS', layerColor(layers, e.layer || 'DOORS'), positions, indices, {
          assumed: openingsAssumed, opacity: 0.45
        });
        if (m) meshes.push(m);
      }
      return;
    }

    if (e.type === 'hatch' || e.type === 'hatchRegion' || e.type === 'room'){
      const pts = e.pts;
      if (!pts || pts.length < 3) return;
      const positions = [], indices = [];
      pushPrism(positions, indices, pts, 0, 0.04);
      const ly = e.layer || (e.type === 'room' ? 'ROOMS' : 'HATCH');
      const m = meshOf('floor', ly, layerColor(layers, ly), positions, indices, { opacity: 0.85 });
      if (m) meshes.push(m);
      return;
    }

    if (e.type === 'profile' || (e.type === 'poly' && e.closed && e.pts && e.pts.length >= 3)){
      const positions = [], indices = [];
      const h = e.height > 0 ? e.height : height;
      pushPrism(positions, indices, e.pts, 0, h);
      const ly = e.layer || 'WALLS';
      const m = meshOf('solid', ly, layerColor(layers, ly), positions, indices, { assumed: !(e.height > 0) && assumed });
      if (m) meshes.push(m);
      return;
    }

    if (e.type === 'circle'){
      const positions = [], indices = [];
      const h = e.height > 0 ? e.height : (e.r < 1.5 ? height : 0.04);
      pushCylinder(positions, indices, e.cx, e.cy, e.r, 0, h, e.r < 1.5 ? 20 : 32);
      const ly = e.layer || 'WALLS';
      const kind = e.r < 1.5 ? 'column' : 'floor';
      const m = meshOf(kind, ly, layerColor(layers, ly), positions, indices, { assumed: !(e.height > 0) && assumed });
      if (m) meshes.push(m);
      return;
    }

    if (e.type === 'insert'){
      explodeForIO(e).forEach(f => {
        if (f.type === 'poly' && f.closed && f.pts && f.pts.length >= 3){
          const positions = [], indices = [];
          pushPrism(positions, indices, f.pts, 0, Math.min(3, height));
          const m = meshOf('fixture', e.layer || 'FIXTURES', layerColor(layers, e.layer || 'FIXTURES'), positions, indices, { assumed: true });
          if (m) meshes.push(m);
        }
      });
    }
  });

  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  let verts = 0;
  meshes.forEach(m => {
    const p = m.positions;
    verts += p.length / 3;
    for (let i = 0; i < p.length; i += 3){
      if (p[i] < minX) minX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2];
      if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
  });
  if (minX > 1e8){ minX = 0; minY = 0; minZ = 0; maxX = 1; maxY = 1; maxZ = height; }

  return {
    meshes,
    height,
    assumed,
    openingsAssumed,
    doorH, sill, head,
    bbox: [minX, minY, minZ, maxX, maxY, maxZ],
    verts,
    rgb: hexRgb
  };
}

export function meshesToFaces(meshes){
  const faces = [];
  (meshes || []).forEach(m => {
    const p = m.positions, idx = m.indices;
    for (let i = 0; i + 2 < idx.length; i += 3){
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      faces.push({
        type: 'face',
        layer: m.layer,
        a: [p[a], p[a + 1], p[a + 2]],
        b: [p[b], p[b + 1], p[b + 2]],
        c: [p[c], p[c + 1], p[c + 2]],
        d: [p[c], p[c + 1], p[c + 2]]
      });
    }
  });
  return faces;
}

export function heightStamp(solid){
  const h = solid && solid.height != null ? solid.height : ASSUMED_STORY;
  const ft = (n) => {
    const whole = Math.floor(n + 1e-9);
    const inch = Math.round((n - whole) * 12);
    if (inch === 0) return whole + "'-0\"";
    if (inch === 12) return (whole + 1) + "'-0\"";
    return whole + "'-" + inch + '"';
  };
  let s = ft(h) + ' story';
  if (solid && solid.assumed) s += ' ASSUMED';
  if (solid && solid.openingsAssumed) s += ' · openings assumed';
  return s;
}
