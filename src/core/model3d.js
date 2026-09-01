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
import { state } from './state.js';
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeWedge, sweepPath,
  extrudeRings, revolveProfile, loftRings,
  meshVolume, meshArea, meshBBox, isWatertight,
  translateMesh, rotateMesh, scaleMesh, mergeMeshes
} from './mesh.js';
import { csg } from './csg.js';
import { sliceMesh, sliceArea } from './slice.js';

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

/* ---------- the slice back to the drawing ---------- */
export function sliceSolidToPlan(name, z, layer){
  const rec = solidByName(name);
  if (!rec) throw new Error('No solid ' + name);
  const { rings, open } = sliceMesh(rec.mesh, Number(z) || 0);
  const made = [];
  for (const ring of rings){
    const e = {
      type: 'poly',
      layer: layer || 'SECTION',
      closed: true,
      pts: ring.map(p => [round6(p[0]), round6(p[1])]),
      id: state.idSeq++
    };
    state.entities.push(e);
    made.push(e);
  }
  return { made, openChains: open.length, area: sliceArea(rec.mesh, Number(z) || 0) };
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
