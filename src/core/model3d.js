/* Solids as document objects.
 *
 * A mesh with no name is a one-way export. A solid the document owns can be
 * referred to, cut, moved, sliced into the plan, saved with the project and
 * undone, which is the difference between having a 3D exporter and being a
 * 3D CAD program. Every record is { id, name, mesh }, names unique and
 * uppercase, ids from the same counter as entities so nothing ever collides.
 *
 * All mutation here follows the app convention: the caller pushes undo, the
 * functions mutate state, afterChange tells the world.
 */
import { state, ensureLayer } from './state.js';
import { hatchWithIslands } from './hatch.js';
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeWedge, sweepPath,
  extrudeRings, revolveProfile, loftRings,
  meshVolume, meshArea, meshBBox, isWatertight,
  translateMesh, rotateMesh, scaleMesh, mergeMeshes
} from './mesh.js';
import { csg } from './csg.js';
import { sliceMesh, sliceArea, sliceMeshAxis, sliceAreaAxis, silhouette } from './slice.js';
import { polyBoolean, ringsArea } from './boolean.js';
import { extrudeDrawing } from './solid.js';

export function solidByName(name){
  const n = String(name || '').trim().toUpperCase();
  return (state.solids || []).find(s => s && s.name === n) || null;
}

export function solidNames(){
  return (state.solids || []).map(s => s.name);
}

function uniqueName(base){
  const b = String(base || 'SOLID').trim().toUpperCase().slice(0, 24) || 'SOLID';
  if (!solidByName(b)) return b;
  for (let i = 2; i < 10000; i++){
    if (!solidByName(b + '-' + i)) return b + '-' + i;
  }
  return b + '-' + Date.now();
}

export function addSolid(mesh, name){
  if (!mesh || !mesh.faces || !mesh.faces.length) throw new Error('Nothing solid to add');
  const rec = { id: state.idSeq++, name: uniqueName(name), mesh };
  state.solids = (state.solids || []).concat([rec]);
  return rec;
}

export function removeSolid(name){
  const rec = solidByName(name);
  if (!rec) return false;
  state.solids = state.solids.filter(s => s !== rec);
  return true;
}

/* ---------- creation ---------- */
export const MAKERS = {
  box: (a) => makeBox(a[0], a[1], a[2] || 0, a[3], a[4], a[5]),
  cylinder: (a) => makeCylinder(a[0], a[1], a[2] || 0, a[3], a[4], a[5] || 48),
  sphere: (a) => makeSphere(a[0], a[1], a[2] || 0, a[3], a[4] || 32),
  cone: (a) => makeCone(a[0], a[1], a[2] || 0, a[3], a[4], a[5] || 48),
  wedge: (a) => makeWedge(a[0], a[1], a[2] || 0, a[3], a[4], a[5])
};

export function createSolid(kind, args, name){
  const mk = MAKERS[kind];
  if (!mk) throw new Error('Unknown solid kind ' + kind);
  const nums = (args || []).map(Number);
  if (nums.some(n => !Number.isFinite(n))) throw new Error(kind + ' wants numbers');
  return addSolid(mk(nums), name || kind.toUpperCase());
}

/* ---------- booleans: the result replaces the operands ---------- */
export function booleanSolids(op, nameA, nameB, outName){
  const A = solidByName(nameA), B = solidByName(nameB);
  if (!A || !B) throw new Error('Need two solids; have ' + (solidNames().join(', ') || 'none'));
  const mesh = csg(op, A.mesh, B.mesh);
  state.solids = state.solids.filter(s => s !== A && s !== B);
  if (!mesh.faces.length) return null;                 /* a real empty answer */
  return addSolid(mesh, outName || (op === 'subtract' ? A.name : op.toUpperCase()));
}

/* ---------- transforms, in place, name kept ---------- */
export function transformSolid(name, fn){
  const rec = solidByName(name);
  if (!rec) throw new Error('No solid ' + name);
  rec.mesh = fn(rec.mesh);
  return rec;
}

export const moveSolid = (name, dx, dy, dz) => transformSolid(name, m => translateMesh(m, dx, dy, dz));
export const rotateSolid = (name, axis, cx, cy, cz, deg) => transformSolid(name, m => rotateMesh(m, axis, cx, cy, cz, deg));
export const scaleSolid = (name, cx, cy, cz, k) => transformSolid(name, m => scaleMesh(m, cx, cy, cz, k));

/* ---------- cuts and elevations back into the drawing ---------- */
function placeRings(rings, layer, offset){
  const made = [];
  const ox = offset ? offset[0] : 0, oy = offset ? offset[1] : 0;
  for (const ring of rings){
    const e = {
      type: 'poly',
      layer: layer || 'SECTION',
      closed: true,
      pts: ring.map(p => [round6(p[0] + ox), round6(p[1] + oy)]),
      id: state.idSeq++
    };
    state.entities.push(e);
    made.push(e);
  }
  return made;
}

/* Where a section or elevation lands: to the right of everything already
 * drawn, so a generated view never sits on top of the plan. */
function nextViewOffset(rings){
  let maxX = -Infinity;
  for (const e of state.entities){
    if (e.type !== 'poly' || !e.pts) continue;
    for (const p of e.pts) maxX = Math.max(maxX, p[0]);
  }
  for (const rec of state.solids || []){
    const bb = meshBBox(rec.mesh);
    maxX = Math.max(maxX, bb[3]);
  }
  if (!isFinite(maxX)) maxX = 0;
  let minX = Infinity;
  rings.forEach(r => r.forEach(p => { minX = Math.min(minX, p[0]); }));
  if (!isFinite(minX)) minX = 0;
  return [maxX + 10 - minX, 0];
}

export function sliceSolidToPlan(name, z, layer, axis){
  const rec = solidByName(name);
  if (!rec) throw new Error('No solid ' + name);
  const a = axis === 'x' || axis === 'y' ? axis : 'z';
  const { rings, open } = sliceMeshAxis(rec.mesh, a, Number(z) || 0);
  /* A plan cut lands in place, where it is the plan. A vertical cut is a
   * different drawing and lands beside everything else. */
  const offset = a === 'z' ? [0, 0] : nextViewOffset(rings);
  const made = placeRings(rings, layer, offset);
  /* Poche: cut material reads as cut because it is hatched. The placed
   * rings go through the island nesting, so a hollow wall hatches the
   * wall and leaves the cavity clear. */
  const hatches = hatchWithIslands(made.map(e => e.pts), { layer: layer || 'SECTION', pattern: 'ANSI31' });
  for (const h of hatches){
    h.id = state.idSeq++;
    state.entities.push(h);
    made.push(h);
  }
  return {
    made, openChains: open.length, hatches: hatches.length,
    area: sliceAreaAxis(rec.mesh, a, Number(z) || 0), axis: a, offset
  };
}

/* The four elevations: the outline of everything modelled, seen from a
 * compass side, drawn beside the plan. Solids named DOOR* or WINDOW*, which
 * is what the plan-to-solids bridge names them, are openings: their own
 * outlines are drawn inside the massing so the elevation shows where the
 * holes are. No hidden line removal, so openings on the far wall project
 * too; this is the massing elevation a drawing starts from, stated honestly.
 */
const OPENING_NAME = /^(DOOR|WINDOW)/;

export function elevationToPlan(dir, layer){
  const mesh = allSolidsMesh();
  if (!mesh.faces.length) throw new Error('Nothing modelled to take an elevation of');
  const d = { N: 'y', S: 'y', E: 'x', W: 'x' }[String(dir || 'S').toUpperCase()];
  if (!d) throw new Error('ELEV wants N, S, E or W');
  const boolean = (A, B, op) => polyBoolean(A, B, op);
  let rings = silhouette(mesh, d, boolean);
  let openRings = [];
  for (const rec of state.solids || []){
    if (!OPENING_NAME.test(rec.name)) continue;
    openRings = openRings.concat(silhouette(rec.mesh, d, boolean));
  }
  /* Seen from the south or the west the horizontal axis reads the other
   * way, so mirror it: elevations read left to right the way you face them.
   * Openings mirror with the massing or they land on the wrong side. */
  const flip = String(dir).toUpperCase() === 'N' || String(dir).toUpperCase() === 'W';
  if (flip){
    const mirror = rs => rs.map(r => r.map(p => [-p[0], p[1]]).reverse());
    rings = mirror(rings);
    openRings = mirror(openRings);
  }
  const offset = nextViewOffset(rings);
  const made = placeRings(rings, layer || 'SECTION', offset);
  const openings = placeRings(openRings, ensureLayer('OPENINGS'), offset);
  return { made: made.concat(openings), openings: openings.length, area: ringsArea(rings), offset };
}

/* ---------- the plan becomes solids ---------- */
/* Convert the extruded drawing, the model the 3D view has always shown,
 * into real named solids the booleans can cut. One solid per element kind,
 * so WALLS can be drilled without touching FLOOR. */
export function planToSolids(entities, opts){
  const drawn = extrudeDrawing(entities || state.entities, opts || {
    height: state.storyHeight,
    assumed: state.heightAssumed,
    layers: state.layers
  });
  const byKind = {};
  (drawn.meshes || []).forEach(m => {
    const kind = String(m.kind || 'mass').toUpperCase();
    const bucket = byKind[kind] = byKind[kind] || { verts: [], faces: [] };
    const base = bucket.verts.length;
    const p = m.positions;
    for (let i = 0; i + 2 < p.length; i += 3) bucket.verts.push([p[i], p[i + 1], p[i + 2]]);
    const idx = m.indices;
    for (let i = 0; i + 2 < idx.length; i += 3) bucket.faces.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
  });
  const made = [];
  for (const kind of Object.keys(byKind)){
    if (!byKind[kind].faces.length) continue;
    made.push(addSolid(byKind[kind], kind));
  }
  return made;
}

/* ---------- solids out through DXF ---------- */
/* Every face as a 3DFACE entity, which the writer already speaks, so the
 * model reaches AutoCAD and not only slicers. */
export function solidsToFaceEntities(list){
  const out = [];
  for (const rec of list || state.solids || []){
    const m = rec.mesh;
    for (const f of m.faces){
      const a = m.verts[f[0]], b = m.verts[f[1]], c = m.verts[f[2]];
      if (!a || !b || !c) continue;
      out.push({ type: 'face', layer: 'SECTION', a, b, c, d: c });
    }
  }
  return out;
}

function round6(v){ return Math.round(v * 1e6) / 1e6; }

/* ---------- reporting ---------- */
export function describeSolid(rec){
  const v = Math.abs(meshVolume(rec.mesh));
  const bb = meshBBox(rec.mesh);
  return rec.name + '  ·  ' + v.toFixed(1) + ' CF  ·  ' + rec.mesh.faces.length + ' faces  ·  ' +
    (isWatertight(rec.mesh) ? 'closed' : 'open') + '  ·  z ' + bb[2].toFixed(1) + '..' + bb[5].toFixed(1);
}

export function solidsSummary(){
  const list = state.solids || [];
  if (!list.length) return 'No solids yet. BOX, CYL, SPHERE, CONE, WEDGE, EXTRUDE, REVOLVE, LOFT or SWEEP make one.';
  return list.map(describeSolid).join('\n');
}

export function allSolidsMesh(){
  return mergeMeshes((state.solids || []).map(s => s.mesh));
}

/* ---------- persistence ---------- */
export function serializeSolids(list){
  /* Takes the list rather than reading the global, because the project
   * writer serializes whatever state object it is handed. */
  return (list || []).map(s => ({
    id: s.id,
    name: s.name,
    verts: s.mesh.verts.map(v => [round6(v[0]), round6(v[1]), round6(v[2])]),
    faces: s.mesh.faces
  }));
}

export function validateSolids(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list){
    if (!s || !Array.isArray(s.verts) || !Array.isArray(s.faces)) continue;
    const name = String(s.name || 'SOLID').toUpperCase().slice(0, 24);
    if (seen.has(name)) continue;
    const verts = s.verts.filter(v => Array.isArray(v) && v.length >= 3 && v.every(Number.isFinite));
    if (verts.length !== s.verts.length) continue;
    const faces = s.faces.filter(f => Array.isArray(f) && f.length === 3 && f.every(i => Number.isInteger(i) && i >= 0 && i < verts.length));
    if (!faces.length) continue;
    seen.add(name);
    out.push({ id: Number(s.id) || 0, name, mesh: { verts, faces } });
  }
  return out;
}

void extrudeRings; void revolveProfile; void loftRings; void meshArea; void sweepPath;
