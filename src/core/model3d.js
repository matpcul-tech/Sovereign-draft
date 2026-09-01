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
  makeGable, makeHip,
  extrudeRings, revolveProfile, loftRings,
  meshVolume, meshArea, meshBBox, isWatertight,
  translateMesh, rotateMesh, scaleMesh, mergeMeshes
} from './mesh.js';
import { csg } from './csg.js';
import {
  sliceMesh, sliceArea, sliceMeshAxis, sliceAreaAxis, silhouette,
  makeDepthProbe, visibleMeshEdges, clipMeshBeyond
} from './slice.js';
import { polyBoolean, ringsArea, differenceRings } from './boolean.js';
import { extrudeDrawing } from './solid.js';
import { alignedDim } from './dimStyle.js';
import { fmtFtIn } from './format.js';
import { makeCutPlane } from './section.js';

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
  wedge: (a) => makeWedge(a[0], a[1], a[2] || 0, a[3], a[4], a[5]),
  gable: (a) => makeGable(a[0], a[1], a[2] || 0, a[3], a[4], a[5]),
  hip: (a) => makeHip(a[0], a[1], a[2] || 0, a[3], a[4], a[5])
};

/* ---------- a roof over what is modelled ----------
 * The architectural form of the command: MODEL the walls, then ROOF puts a
 * gable or hip over the whole massing, sized from its bounding box plus an
 * overhang, seated on its top, with the rise computed from a pitch in
 * inches per foot of half the shorter span. Existing ROOF solids are
 * ignored when measuring, so re-roofing replaces the idea rather than
 * stacking hats on hats.
 */
export function roofOverModel(kind, pitch, overhang){
  const list = (state.solids || []).filter(s => s && !/^ROOF/.test(s.name));
  if (!list.length) throw new Error('Nothing to roof: MODEL first, or make a solid');
  let bb = null;
  for (const s of list){
    const b = meshBBox(s.mesh);
    bb = bb ? [
      Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.min(bb[2], b[2]),
      Math.max(bb[3], b[3]), Math.max(bb[4], b[4]), Math.max(bb[5], b[5])
    ] : b;
  }
  const o = overhang == null ? 1 : Math.max(0, Number(overhang));
  const x = bb[0] - o, y = bb[1] - o;
  const w = bb[3] - bb[0] + 2 * o, d = bb[4] - bb[1] + 2 * o;
  const p = Number(pitch) > 0 ? Number(pitch) : 6;
  const rise = Math.min(w, d) / 2 * p / 12;
  const mk = kind === 'hip' ? makeHip : makeGable;
  return addSolid(mk(x, y, bb[5], w, d, rise), 'ROOF');
}

/* ---------- stacking stories ----------
 * The mesh paradigm's multi-story: one modelled storey, replicated
 * vertically. Every non-roof solid is copied up n-1 times at the story
 * height (measured from the massing's own z extent unless given), named
 * with a -L2, -L3 suffix per level so upper windows still read as openings
 * in elevations, and any existing roof rides to the top. Stacking a stack
 * is refused: undo or model fresh, or the tower doubles.
 */
export function stackStories(n, storyH){
  const count = Math.floor(Number(n));
  if (!(count >= 2)) throw new Error('STACK wants a story count of 2 or more');
  if ((state.solids || []).some(s => /-L\d+$/.test(s.name))){
    throw new Error('Already stacked: undo first, or model fresh');
  }
  const base = (state.solids || []).filter(s => s && !/^ROOF/.test(s.name));
  if (!base.length) throw new Error('Nothing to stack: MODEL first, or make a solid');
  let z0 = Infinity, z1 = -Infinity;
  for (const s of base){
    const b = meshBBox(s.mesh);
    z0 = Math.min(z0, b[2]);
    z1 = Math.max(z1, b[5]);
  }
  const h = Number(storyH) > 0 ? Number(storyH) : (z1 - z0);
  const made = [];
  for (let k = 1; k < count; k++){
    for (const s of base){
      made.push(addSolid(translateMesh(s.mesh, 0, 0, h * k), s.name + '-L' + (k + 1)));
    }
  }
  for (const s of state.solids){
    if (/^ROOF/.test(s.name)) s.mesh = translateMesh(s.mesh, 0, 0, h * (count - 1));
  }
  return { made, stories: count, storyHeight: h };
}

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
  /* A vertical cut is a drawing of its own: what the section SEES beyond
   * the cut plane, looking along the positive axis, joins the poche. The
   * whole model, not just the sliced solid, is clipped to the far
   * half-space and run through the hidden line pass; far openings draw as
   * rings the way an elevation draws them. Then a title and overall dims.
   * A plan cut lands inside the plan and stays bare. */
  let beyondSegs = [];
  let beyondOpenings = 0;
  if (a !== 'z'){
    const c = Number(z) || 0;
    const beyond = clipMeshBeyond(allSolidsMesh(), a, c);
    if (beyond.faces.length){
      beyondSegs = clipSegsToInterior(visibleMeshEdges(beyond, a, 1), rings);
      for (const s of beyondSegs){
        pushEnt({
          type: 'line', layer: layer || 'SECTION',
          x1: round6(s[0][0] + offset[0]), y1: round6(s[0][1] + offset[1]),
          x2: round6(s[1][0] + offset[0]), y2: round6(s[1][1] + offset[1])
        }, made);
      }
      const beyondProbe = makeDepthProbe(beyond, a, 1);
      for (const or of state.solids || []){
        if (!OPENING_NAME.test(or.name)) continue;
        const clipped = clipMeshBeyond(or.mesh, a, c);
        if (!clipped.faces.length) continue;
        const orings = silhouette(clipped, a, (A, B, op) => polyBoolean(A, B, op))
          .filter(r => ringVisible(r, makeDepthProbe(clipped, a, 1), beyondProbe));
        placeRings(orings, ensureLayer('OPENINGS'), offset).forEach(e => { made.push(e); beyondOpenings++; });
      }
    }
    const title = 'SECTION ' + a.toUpperCase() + ' AT ' + fmtFtIn(c);
    annotateView(made.filter(e => e.type === 'poly' && e.layer !== 'OPENINGS'), title).forEach(e => made.push(e));
  }
  return {
    made, openChains: open.length, hatches: hatches.length,
    beyond: beyondSegs.length, openings: beyondOpenings,
    area: sliceAreaAxis(rec.mesh, a, Number(z) || 0), axis: a, offset
  };
}

/* The four elevations: the outline of everything modelled, seen from a
 * compass side, drawn beside the plan. Solids named DOOR* or WINDOW*, which
 * is what the plan-to-solids bridge names them, are openings: their own
 * outlines are drawn inside the massing so the elevation shows where the
 * holes are.
 *
 * Hidden line removal for openings: an opening draws only when it faces the
 * viewer. The test is depth against the whole massing along the view ray at
 * sample points inside the opening: the first surface the ray meets must be
 * essentially the wall the opening sits in, within a wall thickness, or the
 * opening is behind something and stays off the drawing. That hides far
 * walls' openings, interior doors, and side walls' edge-on slivers, which
 * is what a drawn elevation omits. Full hidden line removal of the massing
 * itself (roof lines behind parapets and the like) remains out of scope.
 */
const OPENING_NAME = /^(DOOR|WINDOW)/;
const OPENING_DEPTH_TOL = 1.5;

/* Viewer position by compass side: depth = viewSign * coordinate, smaller
 * is closer to the viewer. */
const VIEW_SIGN = { S: 1, N: -1, W: 1, E: -1 };

/* One projected ring of one opening. The bridge merges every door into one
 * DOOR solid, so visibility has to be decided ring by ring: the opening's
 * own front surface at each sample comes from ray-casting its own mesh,
 * which reads the right door even inside a merged bucket. */
function ringVisible(ring, ownProbe, occProbe){
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const p of ring){
    u0 = Math.min(u0, p[0]); v0 = Math.min(v0, p[1]);
    u1 = Math.max(u1, p[0]); v1 = Math.max(v1, p[1]);
  }
  const at = (tu, tv) => [u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv];
  const samples = [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
  let pass = 0;
  for (const [u, v] of samples){
    const own = ownProbe(u, v);
    if (!isFinite(own)) continue;
    const occ = occProbe(u, v);
    if (own - occ <= OPENING_DEPTH_TOL) pass++;
  }
  return pass >= 3;
}

/* How close a projected edge must run to the outline to count as already
 * drawn by it. */
const ON_OUTLINE_TOL = 0.05;

function distToRings(p, rings){
  let best = Infinity;
  for (const r of rings){
    for (let i = 0, j = r.length - 1; i < r.length; j = i++){
      const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)));
    }
  }
  return best;
}

/* Keep only the parts of each edge that run inside the outline, not along
 * it: the outline poly already draws its own path. An edge partly on the
 * outline, like a roof line whose flanks are the silhouette, survives only
 * where it is interior. The clip can land distinct edges on the same line,
 * a roof junction and the base of the mass above it for one, so the result
 * is deduplicated: the drawing wants each line once. */
function clipSegsToInterior(segs, rings){
  const out = [];
  for (const s of segs){
    const L = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    const N = Math.max(1, Math.min(200, Math.ceil(L / 0.25)));
    const at = t => [s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t];
    const interior = t => distToRings(at(t), rings) > ON_OUTLINE_TOL;
    const refine = (tOn, tIn) => {
      for (let k = 0; k < 10; k++){
        const m = (tOn + tIn) / 2;
        if (interior(m)) tIn = m; else tOn = m;
      }
      return tIn;
    };
    const ts = [];
    for (let i = 0; i < N; i++) ts.push((i + 0.5) / N);
    const flags = ts.map(interior);
    let i = 0;
    while (i < N){
      if (!flags[i]){ i++; continue; }
      let j = i;
      while (j + 1 < N && flags[j + 1]) j++;
      const t0 = i === 0 ? 0 : refine(ts[i - 1], ts[i]);
      const t1 = j === N - 1 ? 1 : refine(ts[j + 1], ts[j]);
      const p0 = at(t0), p1 = at(t1);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.1) out.push([p0, p1]);
      i = j + 1;
    }
  }
  /* Longest first; a segment whose both ends lie on an already kept one
   * is the same drawn line and goes. The clip trims ends by up to the
   * outline tolerance, so twins can differ by a few hundredths. */
  const segLen = s => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
  const distPS = (p, s) => {
    const dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - s[0][0]) * dx + (p[1] - s[0][1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - (s[0][0] + dx * t), p[1] - (s[0][1] + dy * t));
  };
  out.sort((a, b) => segLen(b) - segLen(a));
  const kept = [];
  for (const s of out){
    if (kept.some(k => distPS(s[0], k) < 0.08 && distPS(s[1], k) < 0.08)) continue;
    kept.push(s);
  }
  return kept;
}

export function elevationToPlan(dir, layer){
  const mesh = allSolidsMesh();
  if (!mesh.faces.length) throw new Error('Nothing modelled to take an elevation of');
  const d = { N: 'y', S: 'y', E: 'x', W: 'x' }[String(dir || 'S').toUpperCase()];
  if (!d) throw new Error('ELEV wants N, S, E or W');
  const boolean = (A, B, op) => polyBoolean(A, B, op);
  let rings = silhouette(mesh, d, boolean);
  const sign = VIEW_SIGN[String(dir || 'S').toUpperCase()];
  const occProbe = makeDepthProbe(mesh, d, sign);
  let openRings = [];
  for (const rec of state.solids || []){
    if (!OPENING_NAME.test(rec.name)) continue;
    const ownProbe = makeDepthProbe(rec.mesh, d, sign);
    openRings = openRings.concat(
      silhouette(rec.mesh, d, boolean).filter(r => ringVisible(r, ownProbe, occProbe)));
  }
  /* The interior lines of the elevation: visible feature edges of the
   * massing, clipped to where they run inside the outline. Opening rings
   * count as already drawn too, so the header and sill creases the wall
   * infill creates do not double-draw the reveals. */
  let edgeSegs = clipSegsToInterior(visibleMeshEdges(mesh, d, sign), rings.concat(openRings));
  /* Seen from the south or the west the horizontal axis reads the other
   * way, so mirror it: elevations read left to right the way you face them.
   * Openings and edges mirror with the massing or they land on the wrong
   * side. */
  const flip = String(dir).toUpperCase() === 'N' || String(dir).toUpperCase() === 'W';
  if (flip){
    const mirror = rs => rs.map(r => r.map(p => [-p[0], p[1]]).reverse());
    rings = mirror(rings);
    openRings = mirror(openRings);
    edgeSegs = edgeSegs.map(s => s.map(p => [-p[0], p[1]]));
  }
  const offset = nextViewOffset(rings);
  const made = placeRings(rings, layer || 'SECTION', offset);
  const openings = placeRings(openRings, ensureLayer('OPENINGS'), offset);
  for (const s of edgeSegs){
    pushEnt({
      type: 'line', layer: layer || 'SECTION',
      x1: round6(s[0][0] + offset[0]), y1: round6(s[0][1] + offset[1]),
      x2: round6(s[1][0] + offset[0]), y2: round6(s[1][1] + offset[1])
    }, made);
  }
  const NAMES = { S: 'SOUTH', N: 'NORTH', E: 'EAST', W: 'WEST' };
  const notes = annotateView(made, NAMES[String(dir || 'S').toUpperCase()] + ' ELEVATION');
  /* Each opening gets its own height dim at its right edge: sill to head,
   * the number a builder reads off an elevation. */
  for (const o of openings){
    const bb = viewBounds([o]);
    if (bb && bb[3] - bb[1] > 1e-9) pushEnt(alignedDim([bb[2], bb[1]], [bb[2], bb[3]], -0.8), notes);
  }
  return {
    made: made.concat(openings, notes), openings: openings.length,
    edges: edgeSegs.length, area: ringsArea(rings), offset
  };
}

/* ---------- per-storey plans ----------
 * A stacked building documents each level: the whole massing except roofs
 * is cut horizontally at the drafting convention of four feet above each
 * floor (half the storey when it is shorter), and every level's plan lands
 * beside the drawing as closed rings with poche, titled LEVEL k PLAN with
 * overall dims. Storeys come from the -L suffixes STACK writes; a single
 * storey model gets its one LEVEL 1 PLAN.
 */
export function storyPlans(){
  const list = (state.solids || []).filter(s => s && !/^ROOF/.test(s.name));
  if (!list.length) throw new Error('Nothing to cut plans from: MODEL first');
  let levels = 1;
  for (const s of list){
    const m = s.name.match(/-L(\d+)$/);
    if (m) levels = Math.max(levels, Number(m[1]));
  }
  const base = list.filter(s => !/-L\d+$/.test(s.name));
  let z0 = Infinity, z1 = -Infinity;
  for (const s of (base.length ? base : list)){
    const b = meshBBox(s.mesh);
    z0 = Math.min(z0, b[2]);
    z1 = Math.max(z1, b[5]);
  }
  const h = Math.max(z1 - z0, 0.1);
  const mesh = mergeMeshes(list.map(s => s.mesh));
  const plans = [];
  for (let k = 1; k <= levels; k++){
    const cutZ = z0 + h * (k - 1) + Math.min(4, h / 2);
    const { rings } = sliceMeshAxis(mesh, 'z', cutZ);
    if (!rings.length) continue;
    const offset = nextViewOffset(rings);
    const made = placeRings(rings, 'SECTION', offset);
    const hatches = hatchWithIslands(made.map(e => e.pts), { layer: 'SECTION', pattern: 'ANSI31' });
    for (const ha of hatches){
      ha.id = state.idSeq++;
      state.entities.push(ha);
      made.push(ha);
    }
    annotateView(made.filter(e => e.type === 'poly'), 'LEVEL ' + k + ' PLAN').forEach(e => made.push(e));
    plans.push({ level: k, cutZ, made, rings: rings.length, hatches: hatches.length });
  }
  if (!plans.length) throw new Error('No level cuts the massing: nothing solid at cut height');
  return { plans, levels, storyHeight: h };
}

/* ---------- the roof plan ----------
 * The set's top-down view: the plan shadow of everything modelled as the
 * outline, with the visible edges seen from straight above drawn inside
 * it. On a hip roof that is the ridge and the four hip lines; on a gable,
 * the ridge. The same hidden line pass as the elevations, pointed down.
 */
export function roofPlanToPlan(layer){
  const mesh = allSolidsMesh();
  if (!mesh.faces.length) throw new Error('Nothing modelled to take a roof plan of');
  const boolean = (A, B, op) => polyBoolean(A, B, op);
  const rings = silhouette(mesh, 'z', boolean);
  const edgeSegs = clipSegsToInterior(visibleMeshEdges(mesh, 'z', -1), rings);
  const offset = nextViewOffset(rings);
  const made = placeRings(rings, layer || 'SECTION', offset);
  for (const s of edgeSegs){
    pushEnt({
      type: 'line', layer: layer || 'SECTION',
      x1: round6(s[0][0] + offset[0]), y1: round6(s[0][1] + offset[1]),
      x2: round6(s[1][0] + offset[0]), y2: round6(s[1][1] + offset[1])
    }, made);
  }
  annotateView(made.filter(e => e.type === 'poly'), 'ROOF PLAN').forEach(e => made.push(e));
  return { made, edges: edgeSegs.length, area: ringsArea(rings), offset };
}

/* ---------- the whole set, one command ----------
 * DRAWINGS composes what already exists: model the plan into solids if
 * that has not happened yet, optionally seat a roof, then take all four
 * elevations and one section through the middle of the main mass, looking
 * north. Every piece lands beside the last, titled and dimensioned, and
 * the caller wraps the lot in a single undo step.
 */
/* The extent of one generated view, every entity kind included, padded a
 * foot so nothing touches the frame. */
function viewExtent(made){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = (x, y) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const e of made || []){
    if (e.pts) e.pts.forEach(q => p(q[0], q[1]));
    if (e.holes) e.holes.forEach(h => h.forEach(q => p(q[0], q[1])));
    if (e.x1 != null && e.y1 != null){ p(e.x1, e.y1); p(e.x2, e.y2); }
    if (e.x != null && e.y != null) p(e.x, e.y);
  }
  return isFinite(x0) ? [x0 - 1, y0 - 1, x1 + 1, y1 + 1] : null;
}

export function generateDrawings(opts){
  const o = opts || {};
  const out = { modelled: 0, roof: null, elevations: [], section: null, views: [] };
  const massing = () => (state.solids || []).filter(s => s && !OPENING_NAME.test(s.name) && !/^ROOF/.test(s.name));
  if (!massing().length){
    if (!state.entities.length) throw new Error('Draw a plan or model a solid first');
    out.modelled = planToSolids().length;
    if (!massing().length) throw new Error('Nothing in the plan extrudes into a solid');
  }
  if (o.roof) out.roof = roofOverModel(o.roof, o.pitch, o.overhang).name;
  /* A stacked building gets a cut plan per level; a single storey keeps
   * its drawn plan as the plan. */
  if ((state.solids || []).some(s => /-L\d+$/.test(s.name))){
    const sp = storyPlans();
    out.storyPlans = sp.plans.length;
    for (const pl of sp.plans){
      const pb = viewExtent(pl.made);
      if (pb) out.views.push({ name: 'LEVEL ' + pl.level + ' PLAN', bbox: pb });
    }
  }
  const NAMES = { S: 'SOUTH ELEVATION', E: 'EAST ELEVATION', N: 'NORTH ELEVATION', W: 'WEST ELEVATION' };
  for (const d of ['S', 'E', 'N', 'W']){
    const r = elevationToPlan(d);
    out.elevations.push(r);
    const bb = viewExtent(r.made);
    if (bb) out.views.push({ name: NAMES[d], bbox: bb });
  }
  /* Section target: the WALL solid when the bridge made one, else the
   * mass with the largest footprint. */
  const cands = massing();
  let target = cands.find(s => s.name === 'WALL');
  if (!target){
    let best = -Infinity;
    for (const s of cands){
      const b = meshBBox(s.mesh);
      const a = (b[3] - b[0]) * (b[4] - b[1]);
      if (a > best){ best = a; target = s; }
    }
  }
  const bb = meshBBox(target.mesh);
  const cutY = (bb[1] + bb[4]) / 2;
  out.section = sliceSolidToPlan(target.name, cutY, undefined, 'y');
  const sb = viewExtent(out.section.made);
  if (sb) out.views.push({ name: 'SECTION', bbox: sb });
  /* The plan gets its cut marker: a tagged section line where the section
   * was taken, so the set references itself the way an issued set does. */
  const marker = makeCutPlane([bb[0] - 2, cutY], [bb[3] + 2, cutY], 'A');
  marker.id = state.idSeq++;
  state.entities.push(marker);
  out.marker = marker.id;
  /* A roofed model gets its roof plan. */
  if ((state.solids || []).some(s => /^ROOF/.test(s.name))){
    const rp = roofPlanToPlan();
    out.roofPlan = rp.edges;
    const rb = viewExtent(rp.made);
    if (rb) out.views.push({ name: 'ROOF PLAN', bbox: rb });
  }
  return out;
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

/* ---------- annotating generated views ----------
 * A view the model generates should arrive as a drawing, not bare
 * geometry: a title beneath it, an overall width dim below and an overall
 * height dim on the left, real dim entities the user can restyle or erase
 * like any others.
 */
function viewBounds(polys){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of polys){
    if (!e.pts) continue;
    for (const p of e.pts){
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}

function pushEnt(ent, made){
  ent.id = state.idSeq++;
  state.entities.push(ent);
  made.push(ent);
  return ent;
}

function annotateView(polys, title){
  const bb = viewBounds(polys);
  const made = [];
  if (!bb) return made;
  const [x0, y0, x1, y1] = bb;
  pushEnt({ type: 'text', layer: 'SECTION', x: (x0 + x1) / 2, y: y0 - 2.4, size: 1.0, content: title }, made);
  if (x1 - x0 > 1e-9) pushEnt(alignedDim([x0, y0], [x1, y0], -1.2), made);
  if (y1 - y0 > 1e-9) pushEnt(alignedDim([x0, y0], [x0, y1], 1.2), made);
  return made;
}

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

/* An L-plate with a hole so 3D is not an empty orbit of a floor plan. */
export function sampleBracket(){
  const L = [[0, 0], [2, 0], [2, 0.28], [0.28, 0.28], [0.28, 1.6], [0, 1.6]];
  const hole = [];
  for (let i = 0; i < 32; i++){
    const t = (i / 32) * Math.PI * 2;
    hole.push([1.25 + Math.cos(t) * 0.12, 0.14 + Math.sin(t) * 0.12]);
  }
  const rings = differenceRings([L], [hole]);
  const mesh = extrudeRings(rings.length ? rings : [L], 1.2);
  return addSolid(mesh, 'BRACKET');
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
