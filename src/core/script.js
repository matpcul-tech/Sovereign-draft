/* User scripting: the LISP-shaped hole.
 *
 * Every mature CAD system ends up programmable, because no feature list
 * covers the hundredth firm's numbering scheme or the batch edit someone
 * needs at 6pm before an issue. A script here is plain JavaScript run
 * against `sd`, a small documented facade over the document.
 *
 * Two properties matter more than the surface area of the API:
 *
 * Transactional. A run takes one undo record before it starts; if the
 * script throws, the document is rolled back to exactly that record, so a
 * half-finished script leaves no trace, and a successful one undoes as a
 * single step like any other command.
 *
 * Mediated. Scripts never hold live entity objects. Reads hand out deep
 * copies; writes go through the same functions the editing tools use, so a
 * script cannot put the document into a state the tools cannot. This is a
 * correctness boundary, not a security sandbox: a script is the user's own
 * code running in their own drawing, exactly as LISP always was.
 */
import { deep } from './geometry.js';
import {
  state, pushUndo, addEntity, deleteEntities, ensureLayer, layerByName, afterChange
} from './state.js';
import {
  moveEntities, rotateEntities, scaleEntities, mirrorEntities,
  entityLength, entityArea, joinEntities
} from './modify.js';
import { entBBox } from './entities.js';
import { makeSpline } from './spline.js';
import { makeMText } from './mtext.js';
import { makeHatch, closedLoops, hatchWithIslands } from './hatch.js';
import { polyBoolean, ringsArea } from './boolean.js';
import { solveConstraints, makeConstraint, CONSTRAINT_TYPES } from './constrain.js';
import { createSolid, addSolid, booleanSolids, moveSolid, rotateSolid, scaleSolid, sliceSolidToPlan, solidByName, solidNames, removeSolid, roofOverModel, stackStories, storyPlans, pushPullSolid } from './model3d.js';
import { extrudeRings, meshVolume } from './mesh.js';

const NUMERIC = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Expected a finite number, got ' + JSON.stringify(v));
  return n;
};

function byId(id){
  const e = state.entities.find(x => x.id === id);
  if (!e) throw new Error('No entity with id ' + id);
  return e;
}

function liveByIds(ids){
  const set = new Set(ids);
  return state.entities.filter(e => set.has(e.id));
}

/* Fields a script may set directly. Everything else changes meaning or
 * breaks invariants, and goes through an operation instead. */
const SETTABLE = new Set([
  'layer', 'lt', 'lw', 'content', 'size', 'width', 'just', 'rot', 'anno',
  'pattern', 'angle', 'scale', 'closed', 'style', 'precision'
]);

/* Build the facade bound to the live document. Fresh per run, so a script
 * cannot stash it and mutate outside its transaction. */
export function makeSd(println){
  const print = println || (() => {});
  const track = [];
  const add = e => { const a = addEntity(e); track.push(a.id); return a.id; };

  const sd = {
    /* ---------- creation: returns the new entity's id ---------- */
    add: {
      line: (x1, y1, x2, y2, o) => add(Object.assign({ type: 'line', layer: state.currentLayer, x1: NUMERIC(x1), y1: NUMERIC(y1), x2: NUMERIC(x2), y2: NUMERIC(y2) }, o || {})),
      circle: (cx, cy, r, o) => add(Object.assign({ type: 'circle', layer: state.currentLayer, cx: NUMERIC(cx), cy: NUMERIC(cy), r: Math.abs(NUMERIC(r)) || 0.1 }, o || {})),
      arc: (cx, cy, r, a1, a2, o) => add(Object.assign({ type: 'arc', layer: state.currentLayer, cx: NUMERIC(cx), cy: NUMERIC(cy), r: Math.abs(NUMERIC(r)) || 0.1, a1: NUMERIC(a1), a2: NUMERIC(a2) }, o || {})),
      poly: (pts, o) => {
        if (!Array.isArray(pts) || pts.length < 2) throw new Error('poly wants at least two points');
        return add(Object.assign({ type: 'poly', layer: state.currentLayer, closed: false, pts: pts.map(p => [NUMERIC(p[0]), NUMERIC(p[1])]) }, o || {}));
      },
      spline: (ctrl, o) => add(makeSpline(ctrl, Object.assign({ layer: state.currentLayer }, o || {}))),
      text: (x, y, content, o) => add(Object.assign({ type: 'text', layer: 'TEXT', x: NUMERIC(x), y: NUMERIC(y), size: 1, content: String(content == null ? '' : content) }, o || {})),
      note: (x, y, content, o) => add(makeMText(content, Object.assign({ layer: 'NOTES', x: NUMERIC(x), y: NUMERIC(y), size: 1 }, o || {}))),
      hatch: (pts, o) => {
        const h = makeHatch(pts, Object.assign({ layer: 'HATCH' }, o || {}));
        if (!h) throw new Error('hatch wants a closed boundary of at least three points');
        return add(h);
      },
      dim: (x1, y1, x2, y2, o) => add(Object.assign({ type: 'dim', layer: 'DIMS', x1: NUMERIC(x1), y1: NUMERIC(y1), x2: NUMERIC(x2), y2: NUMERIC(y2), off: (o && o.off) != null ? NUMERIC(o.off) : -2 }, o || {}))
    },

    /* ---------- reading: always copies, never the live objects ---------- */
    entities: () => deep(state.entities),
    get: id => deep(byId(id)),
    count: () => state.entities.length,
    selected: () => state.selIds.slice(),
    select: ids => { state.selIds = (ids || []).filter(id => state.entities.some(e => e.id === id)); },

    query: {
      byType: t => state.entities.filter(e => e.type === t).map(e => e.id),
      byLayer: n => state.entities.filter(e => (e.layer || '0') === String(n).toUpperCase()).map(e => e.id),
      inBox: (x0, y0, x1, y1) => state.entities.filter(e => {
        const bb = [Infinity, Infinity, -Infinity, -Infinity];
        entBBox(e, bb);
        return bb[0] >= Math.min(x0, x1) && bb[2] <= Math.max(x0, x1) && bb[1] >= Math.min(y0, y1) && bb[3] <= Math.max(y0, y1);
      }).map(e => e.id),
      where: fn => state.entities.filter(e => fn(deep(e))).map(e => e.id)
    },

    /* ---------- editing ---------- */
    update(id, props){
      const e = byId(id);
      for (const k of Object.keys(props || {})){
        if (!SETTABLE.has(k)) throw new Error('"' + k + '" is not settable; use an operation');
        e[k] = props[k];
      }
      return id;
    },
    delete: ids => deleteEntities(Array.isArray(ids) ? ids : [ids]),
    move(ids, dx, dy){ sd._replaceWith(ids, ms => moveEntities(ms, NUMERIC(dx), NUMERIC(dy))); },
    rotate(ids, cx, cy, deg){ sd._replaceWith(ids, ms => rotateEntities(ms, NUMERIC(cx), NUMERIC(cy), NUMERIC(deg))); },
    scale(ids, cx, cy, f){ sd._replaceWith(ids, ms => scaleEntities(ms, NUMERIC(cx), NUMERIC(cy), NUMERIC(f))); },
    mirror(ids, ax, ay, bx, by){ sd._replaceWith(ids, ms => mirrorEntities(ms, NUMERIC(ax), NUMERIC(ay), NUMERIC(bx), NUMERIC(by))); },
    copy(ids, dx, dy){
      const ms = liveByIds(Array.isArray(ids) ? ids : [ids]);
      return moveEntities(deep(ms), NUMERIC(dx), NUMERIC(dy)).map(e => { delete e.id; return add(e); });
    },
    _replaceWith(ids, fn){
      const list = Array.isArray(ids) ? ids : [ids];
      const ms = liveByIds(list);
      if (ms.length !== list.length) throw new Error('Some ids do not exist');
      const out = fn(ms);
      /* The modify functions return transformed copies; write them back onto
       * the live entities so ids are stable. */
      ms.forEach((e, i) => Object.assign(e, out[i]));
    },

    join(ids){
      const ms = liveByIds(Array.isArray(ids) ? ids : [ids]);
      const res = joinEntities(ms);
      if (!res.ok) throw new Error(res.msg);
      deleteEntities(res.orig.map(e => e.id));
      return res.replace.map(e => add(e));
    },

    /* Booleans over the closed regions of the named entities. The result
     * replaces the operands, as the UNION command does. */
    boolean(op, ids){
      const ms = liveByIds(ids);
      if (ms.length < 2) throw new Error('boolean wants at least two closed regions');
      let acc = closedLoops([ms[0]]);
      for (let i = 1; i < ms.length; i++){
        acc = polyBoolean(acc, closedLoops([ms[i]]), op);
        if (!acc.length) break;
      }
      const layer = ms[0].layer;
      deleteEntities(ms.map(e => e.id));
      return acc.map(ring => add({ type: 'poly', layer, closed: true, pts: ring.map(p => [p[0], p[1]]) }));
    },

    hatchRegions(ids, opts){
      const loops = closedLoops(liveByIds(ids));
      return hatchWithIslands(loops, Object.assign({ layer: 'HATCH' }, opts || {})).map(h => add(h));
    },

    constrain(type, opts){
      if (CONSTRAINT_TYPES.indexOf(type) < 0) throw new Error('Unknown constraint ' + type + '; have ' + CONSTRAINT_TYPES.join(', '));
      state.constraints.push(makeConstraint(type, opts || {}));
    },
    solve(){
      return solveConstraints(state.entities, state.constraints || []);
    },

    /* ---------- measurement ---------- */
    measure: {
      length: id => entityLength(byId(id)),
      area: id => entityArea(byId(id)),
      netArea: ids => ringsArea(closedLoops(liveByIds(ids))),
      bbox: ids => {
        const bb = [Infinity, Infinity, -Infinity, -Infinity];
        liveByIds(Array.isArray(ids) ? ids : [ids]).forEach(e => entBBox(e, bb));
        return bb;
      }
    },

    /* ---------- layers ---------- */
    layer: {
      list: () => deep(state.layers),
      current: () => state.currentLayer,
      create: name => ensureLayer(name),
      set(name, props){
        const L = layerByName(String(name).toUpperCase());
        if (!L) throw new Error('No layer ' + name);
        ['visible', 'locked', 'plot', 'color', 'lt', 'lw'].forEach(k => {
          if (props && props[k] !== undefined) L[k] = props[k];
        });
      }
    },

    /* ---------- 3D: solids by name, the same door the commands use ---------- */
    solid: {
      box: (x, y, z, w, d, h, name) => createSolid('box', [x, y, z, w, d, h], name).name,
      cylinder: (cx, cy, z, r, h, name) => createSolid('cylinder', [cx, cy, z, r, h], name).name,
      sphere: (cx, cy, z, r, name) => createSolid('sphere', [cx, cy, z, r], name).name,
      cone: (cx, cy, z, r, h, name) => createSolid('cone', [cx, cy, z, r, h], name).name,
      wedge: (x, y, z, w, d, h, name) => createSolid('wedge', [x, y, z, w, d, h], name).name,
      gable: (x, y, z, w, d, rise, name) => createSolid('gable', [x, y, z, w, d, rise], name).name,
      hip: (x, y, z, w, d, rise, name) => createSolid('hip', [x, y, z, w, d, rise], name).name,
      roof: (kind, pitch, overhang) => roofOverModel(kind, pitch, overhang).name,
      stack: (n, h) => stackStories(n, h).made.length,
      plans: () => storyPlans().plans.length,
      pushpull: (name, face, d) => { const r = pushPullSolid(name, face, d); return Math.abs(meshVolume(r.rec.mesh)); },
      extrude: (rings, h, name) => addSolid(extrudeRings(rings, NUMERIC(h)), name || 'EXTRUDE').name,
      union: (a, b, name) => { const r = booleanSolids('union', a, b, name); return r ? r.name : null; },
      subtract: (a, b, name) => { const r = booleanSolids('subtract', a, b, name); return r ? r.name : null; },
      intersect: (a, b, name) => { const r = booleanSolids('intersect', a, b, name); return r ? r.name : null; },
      move: (name, dx, dy, dz) => { moveSolid(name, NUMERIC(dx), NUMERIC(dy), Number(dz) || 0); },
      rotate: (name, axis, cx, cy, cz, deg) => { rotateSolid(name, axis, NUMERIC(cx), NUMERIC(cy), NUMERIC(cz), NUMERIC(deg)); },
      scale: (name, cx, cy, cz, k) => { scaleSolid(name, NUMERIC(cx), NUMERIC(cy), NUMERIC(cz), NUMERIC(k)); },
      slice: (name, z, layer) => sliceSolidToPlan(name, NUMERIC(z), layer).made.map(e => e.id),
      volume: name => { const r = solidByName(name); if (!r) throw new Error('No solid ' + name); return Math.abs(meshVolume(r.mesh)); },
      list: () => solidNames(),
      delete: name => removeSolid(name)
    },

    print,
    /* ids created during this run, whatever path created them */
    created: () => track.slice()
  };
  return sd;
}

/* Run a script transactionally: one undo record on success, no trace at all
 * on failure. Returns { ok, error?, output, created }. */
export function runScript(code, opts){
  const lines = [];
  const println = (...args) => {
    lines.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    if (lines.length > 500) throw new Error('Script printed more than 500 lines');
  };

  /* pushUndo clears the redo stack as every new operation must, but a run
   * that fails is not an operation: hold the redo stack aside so a failure
   * puts it back and the user's pending redo survives a broken script. */
  const savedRedo = state.redoStack;
  pushUndo();
  const sd = makeSd(println);
  try {
    /* Shadow the obvious globals. This keeps an honest script honest; it is
     * not a security boundary and does not claim to be. */
    const fn = new Function('sd', 'print', 'window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest',
      '"use strict";\n' + String(code || ''));
    fn(sd, println, undefined, undefined, undefined, undefined, undefined, undefined);
    afterChange();
    return { ok: true, output: lines, created: sd.created() };
  } catch (err){
    /* Roll back to the record taken above: the failed run never happened.
     * The record is popped rather than undone, so the redo stack stays
     * empty and the failure leaves no history at all. */
    const rec = state.undoStack.pop();
    if (rec) restoreRecord(rec);
    state.redoStack = savedRedo;
    afterChange();
    return { ok: false, error: err && err.message ? err.message : String(err), output: lines, created: [] };
  }
  void opts;
}

/* Restore a full snapshot record outside the undo/redo flow. Scripts always
 * push a full record, so only that shape needs handling here. */
function restoreRecord(rec){
  state.entities = rec.entities;
  state.layers = rec.layers;
  state.constraints = rec.constraints || [];
  state.solids = rec.solids || [];
  if (rec.dimStyles) state.dimStyles = rec.dimStyles;
  if (rec.textStyles) state.textStyles = rec.textStyles;
  if (rec.plotStyles) state.plotStyles = rec.plotStyles;
  if (rec.layerStates) state.layerStates = rec.layerStates;
  if (rec.layouts) state.layouts = rec.layouts;
  if (rec.annoPpf) state.annoPpf = rec.annoPpf;
}

/* ---------- saved scripts ---------- */
export function saveScript(name, code){
  const n = String(name || '').trim().toUpperCase().slice(0, 40);
  if (!n) throw new Error('Name the script');
  state.scripts = (state.scripts || []).filter(s => s.name !== n);
  state.scripts.push({ name: n, code: String(code || '') });
  state.scripts.sort((a, b) => a.name.localeCompare(b.name));
  return n;
}

export function scriptByName(name){
  const n = String(name || '').trim().toUpperCase();
  return (state.scripts || []).find(s => s.name === n) || null;
}

export function deleteScript(name){
  const n = String(name || '').trim().toUpperCase();
  const before = (state.scripts || []).length;
  state.scripts = (state.scripts || []).filter(s => s.name !== n);
  return state.scripts.length < before;
}

export function validateScripts(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list){
    if (!s || typeof s.name !== 'string' || typeof s.code !== 'string') continue;
    const n = s.name.toUpperCase().slice(0, 40);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push({ name: n, code: s.code });
  }
  return out;
}

export const EXAMPLE_SCRIPTS = [
  {
    name: 'NUMBER DOORS',
    code: [
      "// Tag every door with a sequential mark",
      "let n = 1;",
      "for (const id of sd.query.byType('insert')){",
      "  const e = sd.get(id);",
      "  if (e.def !== 'door') continue;",
      "  sd.add.text(e.x + 1, e.y + 1, 'D' + String(n++).padStart(2, '0'), { size: 0.8 });",
      "}",
      "print('numbered', n - 1, 'doors');"
    ].join('\n')
  },
  {
    name: 'AREA REPORT',
    code: [
      "// Net area of every closed region, by layer",
      "const byLayer = {};",
      "for (const id of sd.query.where(e => e.closed || e.type === 'circle')){",
      "  const e = sd.get(id);",
      "  byLayer[e.layer] = (byLayer[e.layer] || 0) + sd.measure.area(id);",
      "}",
      "for (const [layer, a] of Object.entries(byLayer)) print(layer, a.toFixed(1), 'SF');"
    ].join('\n')
  }
];
