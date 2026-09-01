/* Central mutable application state plus undo/redo and layer management.
 * Core geometry modules stay pure; everything below is the single place that
 * owns the document.
 */
import { deep } from './geometry.js';
import { normalizeSheets } from './document.js';
import { defaultDimStyles } from './dimStyle.js';
import { defaultLayouts } from './layout.js';
import { refreshAssocDims, bindAllDims } from './assoc.js';
import { syncAutoRooms } from './rooms.js';
import { dropDanglingConstraints } from './constrain.js';
import { setDisplayUnits } from './format.js';
import { defaultTextStyles } from './textstyle.js';
import { defaultPlotStyles } from '../io/plotstyle.js';

export const LAYER_COLORS = ['#00d4b8', '#c45a3c', '#d4af37', '#8fa3c0', '#4ade80', '#e8e4dd'];
export const GRID_SNAP = 0.5;
export const OFFSETS = [0.5, 1, 2, 4];
export const UNDO_LIMIT = 50;
export const PROJECT_VERSION = 7;
export const POLAR_STEP = 15;

export function defaultLayers(){
  return [
    { name: 'WALLS',    color: '#d4a843', aci: 2, visible: true },
    { name: 'DOORS',    color: '#00d4b8', aci: 4, visible: true },
    { name: 'FIXTURES', color: '#c45a3c', aci: 1, visible: true },
    { name: 'DIMS',     color: '#8fa3c0', aci: 8, visible: true },
    { name: 'TEXT',     color: '#e8e4dd', aci: 7, visible: true },
    { name: 'HATCH',    color: '#6b7c93', aci: 8, visible: true },
    { name: 'CENTER',   color: '#c45a3c', aci: 1, visible: true, lt: 'CENTER' },
    { name: 'SCHEDULES', color: '#e8e4dd', aci: 7, visible: true },
    { name: 'UNDERLAY',  color: '#4a5a73', aci: 8, visible: true, plot: false },
    { name: 'ROOMS',     color: '#4ade80', aci: 3, visible: true },
    { name: 'GRID',      color: '#8fa3c0', aci: 8, visible: true, lt: 'CENTER' },
    { name: 'DEFPOINTS', color: '#6b7c93', aci: 8, visible: true, plot: false },
    { name: 'SECTION',   color: '#00d4b8', aci: 4, visible: true },
    { name: 'GDT',       color: '#e8e4dd', aci: 7, visible: true },
    { name: 'NOTES',     color: '#e8e4dd', aci: 7, visible: true }
  ];
}

export const state = {
  projectName: 'Untitled',
  firm: { company: '', copyright: '', drawnBy: '' },
  layers: defaultLayers(),
  currentLayer: 'WALLS',
  entities: [],
  geomStamp: 0,
  textStyles: defaultTextStyles(),
  currentTextStyle: 'STANDARD',
  plotStyles: defaultPlotStyles(),
  currentPlotStyle: 'ISO',
  layerStates: [],
  plotFont: null,
  solids: [],
  tool3d: 'orbit',
  annoPpf: 18,
  scripts: [],
  userBlocks: [],
  idSeq: 1,
  gSeq: 1,
  view: { x: 0, y: 0, scale: 26 },
  tool: 'select',
  snapOn: true,
  orthoOn: false,
  polarOn: false,
  wallMode: false,
  wallTh: 6 / 12,
  aiCtxOn: true,
  boxMode: false,
  selIds: [],
  undoStack: [],
  redoStack: [],
  offIdx: 0,
  offsetDist: 0.5,
  filletR: 0.5,
  chamferD: 0.5,
  scaleFactor: 1,
  rotateAngle: 90,
  arrayCols: 3,
  arrayRows: 2,
  arrayColDist: 4,
  arrayRowDist: 4,
  activeSym: { u: false, i: 0 },
  pdfPPF: 'fit',
  dxfVer: 'R2000',
  units: 'ft',
  dimStyles: defaultDimStyles(),
  currentDimStyle: 'ARCH',
  constraints: [],
  layouts: normalizeSheets(defaultLayouts()),
  currentLayout: 'A1',
  space: 'model',          /* 'model' or a layout id */
  lastLen: 0,
  lastAng: 0,
  lastPt: null,
  cmdHistory: [],
  hatchPattern: 'ANSI31',
  currentLt: 'CONTINUOUS',
  currentLw: 0,
  lastTool: 'line',
  autoRooms: false,
  arrayCount: 6,
  arrayFill: 360,
  layerIsoPrev: null,
  storyHeight: 8,
  heightAssumed: true,
  view3d: false
};

let changeHandler = null;
export function onChange(fn){ changeHandler = fn; }
export function afterChange(){
  /* Anything cached off the geometry keys on this. Bumping it here means a
   * cache can never serve a view of the drawing that no longer exists. */
  state.geomStamp = (state.geomStamp || 0) + 1;
  setDisplayUnits(state.units || 'ft');
  bindAllDims(state.entities);
  refreshAssocDims(state.entities);
  if (state.autoRooms) syncAutoRooms(state);
  if (changeHandler) changeHandler();
}

export function layerByName(n){ return state.layers.find(l => l.name === n) || null; }
export function entById(id){ return state.entities.find(e => e.id === id) || null; }
export function layerVisible(name){ const L = layerByName(name); return !L || L.visible; }
export function layerLocked(name){ const L = layerByName(name); return !!(L && L.locked); }
export function layerPlottable(name){ const L = layerByName(name); return !L || L.plot !== false; }
export function layerEditable(name){ return layerVisible(name) && !layerLocked(name); }

export function activeLayout(){
  return state.layouts.find(l => l.id === state.currentLayout) || state.layouts[0] || null;
}

export function currentDimStyleObj(){
  return state.dimStyles.find(s => s.name === state.currentDimStyle) || state.dimStyles[0];
}

/* Selection expanded to whole blocks: selecting one member selects the group. */
export function selMembers(){
  const seen = {}, out = [];
  for (const id of state.selIds){
    const e = entById(id); if (!e) continue;
    const group = e.g ? state.entities.filter(x => x.g === e.g) : [e];
    for (const m of group){
      if (!seen[m.id]){ seen[m.id] = 1; out.push(m); }
    }
  }
  return out;
}

function snapshot(){
  return {
    entities: deep(state.entities),
    layers: deep(state.layers),
    constraints: deep(state.constraints || []),
    solids: deep(state.solids || []),
    dimStyles: deep(state.dimStyles),
    textStyles: deep(state.textStyles || []),
    plotStyles: deep(state.plotStyles || []),
    layerStates: deep(state.layerStates || []),
    currentPlotStyle: state.currentPlotStyle,
    annoPpf: state.annoPpf,
    layouts: deep(state.layouts),
    currentDimStyle: state.currentDimStyle,
    currentLayout: state.currentLayout,
    space: state.space
  };
}
function restore(s){
  state.entities = s.entities;
  state.layers = s.layers;
  state.constraints = s.constraints || [];
  state.solids = s.solids || [];
  if (s.dimStyles) state.dimStyles = s.dimStyles;
  if (s.textStyles) state.textStyles = s.textStyles;
  if (s.plotStyles) state.plotStyles = s.plotStyles;
  if (s.layerStates) state.layerStates = s.layerStates;
  if (s.currentPlotStyle) state.currentPlotStyle = s.currentPlotStyle;
  if (s.annoPpf) state.annoPpf = s.annoPpf;
  if (s.layouts) state.layouts = s.layouts;
  if (s.currentDimStyle) state.currentDimStyle = s.currentDimStyle;
  if (s.currentLayout) state.currentLayout = s.currentLayout;
  if (s.space) state.space = s.space;
  if (!layerByName(state.currentLayer)) state.currentLayer = state.layers[0] ? state.layers[0].name : 'WALLS';
}

/* ---------- scoped undo ----------
 *
 * A full snapshot deep copies the whole drawing: at 200,000 entities that is
 * half a second and 16 MB on every single edit, and fifty of them is most of
 * a gigabyte of undo stack. Every feature works at any drawing size except
 * this one, which fails at a fixed size regardless of features.
 *
 * A sparse record instead stores only the entities an operation can touch,
 * each with its position in the draw order, plus the id counter. Ids are
 * monotonic and never reused, so anything with an id at or past the recorded
 * counter was created after the record and undo removes it without ever
 * having been told about it. Entities in the record are put back exactly
 * where they were; everything else is untouched by construction.
 *
 * The contract: a caller passing a scope asserts the operation touches only
 * those entities, entities it creates, the constraint list and the scalars
 * below. Layers, styles and layouts are out of bounds for a scoped push;
 * an operation that can reach them takes the full snapshot as always. The
 * differential test in tests/undo.test.js holds this contract against a
 * full snapshot oracle over randomised operation sequences.
 */
function sparseSnapshot(ids){
  const idSet = new Set(ids);
  const copies = [];
  /* A plain loop, because this runs on every edit and a closure per entity
   * is a third of the pass at two hundred thousand of them. */
  const es = state.entities;
  for (let i = 0; i < es.length; i++){
    if (idSet.has(es[i].id)) copies.push({ i, e: deep(es[i]) });
  }
  return {
    sparse: true,
    ids: [...idSet],
    copies,
    idSeq: state.idSeq,
    gSeq: state.gSeq,
    selIds: state.selIds.slice(),
    currentLayer: state.currentLayer,
    constraints: deep(state.constraints || []),
    /* Meshes are only ever appended or cleared, never edited in place, so
     * holding references restores them without copying megabytes of
     * triangles into every record. */
    solids: (state.solids || []).slice()
  };
}

function sparseRestore(rec){
  const idSet = new Set(rec.ids);
  /* Everything the operation declared, plus everything it created. */
  state.entities = state.entities.filter(e => !idSet.has(e.id) && e.id < rec.idSeq);
  /* Reinsert at the recorded positions, ascending, which reconstructs the
   * original interleaving because nothing reorders untouched entities. */
  const sorted = rec.copies.slice().sort((a, b) => a.i - b.i);
  for (const c of sorted){
    state.entities.splice(Math.min(c.i, state.entities.length), 0, deep(c.e));
  }
  state.idSeq = rec.idSeq;
  state.gSeq = rec.gSeq;
  state.constraints = deep(rec.constraints || []);
  state.solids = (rec.solids || []).slice();
  if (rec.currentLayer && layerByName(rec.currentLayer)) state.currentLayer = rec.currentLayer;
}

/* The record that reverses restoring `rec` from the current state: the same
 * declared scope, plus whatever the operation created since the record was
 * taken. Cheap in both directions, which is what keeps redo from paying the
 * full snapshot cost undo just avoided. */
function counterpart(rec){
  if (!rec || !rec.sparse) return snapshot();
  const ids = new Set(rec.ids);
  state.entities.forEach(e => { if (e.id >= rec.idSeq) ids.add(e.id); });
  return sparseSnapshot([...ids]);
}

function restoreAny(rec){
  if (rec && rec.sparse) sparseRestore(rec);
  else restore(rec);
}

/* The entities an edit to `seedIds` can actually reach. Wider than the
 * selection on purpose:
 *  - group members move together;
 *  - a door or window drag regenerates its host wall, deleting and
 *    recreating every member of that group;
 *  - dims associated to anything in scope follow it, and a dim with no
 *    binding yet can gain one from geometry arriving at its endpoints;
 *  - the constraint solver can move any entity in the constraint network,
 *    so when constraints exist at all, every constrained entity is in scope.
 * Returns null when the blast radius is not computable (auto rooms
 * regenerate globally), which tells the caller to take a full snapshot.
 */
export function undoScope(seedIds){
  if (state.autoRooms) return null;

  /* Ids wanted before looking at any entity: the seeds, and every entity a
   * constraint names, since the solver can move any of them. Both sets are
   * small; the entity list is not, so it is walked once, not indexed. An
   * id-to-entity Map over 200,000 entities costs forty milliseconds to
   * build, which is most of what this rewrite exists to remove. */
  const want = new Set(seedIds || []);
  if (state.constraints && state.constraints.length){
    for (const k of state.constraints){
      if (k.a != null) want.add(k.a);
      if (k.b != null) want.add(k.b);
    }
  }

  const idSet = new Set();
  const groups = new Set();
  const hosts = new Set();
  const dims = [];
  let expand = false;
  const grab = e => {
    if (e.id == null || idSet.has(e.id)) return;
    idSet.add(e.id);
    if (e.g){ groups.add(e.g); expand = true; }
    if (e.type === 'insert' && e.host){ hosts.add(e.host); expand = true; }
  };

  for (const e of state.entities){
    if (e.type === 'dim') dims.push(e);
    if (want.has(e.id)) grab(e);
  }

  /* Group and host expansion costs extra passes, so it runs only when
   * something grabbed actually has a group or a host. */
  if (expand){
    let size = -1;
    while (size !== idSet.size){
      size = idSet.size;
      for (const e of state.entities){
        if (e.g && (groups.has(e.g) || hosts.has(e.g))) grab(e);
        else if (e.type === 'insert' && e.host && hosts.has(e.host)) grab(e);
      }
    }
  }

  for (const e of dims){
    if (idSet.has(e.id)) continue;
    if (!e.assoc){ grab(e); continue; }
    if (e.assoc.some(a => a && idSet.has(a.id))) grab(e);
  }
  return [...idSet];
}

export function pushUndo(scopeIds){
  state.undoStack.push(Array.isArray(scopeIds) ? sparseSnapshot(scopeIds) : snapshot());
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}
export function doUndo(){
  if (!state.undoStack.length) return false;
  const rec = state.undoStack.pop();
  state.redoStack.push(counterpart(rec));
  restoreAny(rec);
  state.selIds = [];
  afterChange();
  return true;
}
export function doRedo(){
  if (!state.redoStack.length) return false;
  const rec = state.redoStack.pop();
  state.undoStack.push(counterpart(rec));
  restoreAny(rec);
  state.selIds = [];
  afterChange();
  return true;
}

export function ensureLayer(name){
  if (!name) return 'WALLS';
  name = String(name).toUpperCase().slice(0, 24);
  if (!layerByName(name)){
    state.layers.push({ name, color: LAYER_COLORS[state.layers.length % LAYER_COLORS.length], aci: 3, visible: true });
  }
  return name;
}

export function addLayer(){
  const n = 'LAYER-' + (state.layers.length + 1);
  state.layers.push({ name: n, color: LAYER_COLORS[state.layers.length % LAYER_COLORS.length], aci: 3, visible: true });
  state.currentLayer = n;
  return n;
}

export function addEntity(e){
  if (!e.lt && e.type !== 'dim' && e.type !== 'text' && e.type !== 'hatch' && e.type !== 'insert'){
    if (state.currentLt && state.currentLt !== 'CONTINUOUS') e.lt = state.currentLt;
    else {
      const L = layerByName(e.layer || state.currentLayer);
      if (L && L.lt && L.lt !== 'CONTINUOUS') e.lt = L.lt;
    }
  }
  if (state.currentLw && e.lw == null && e.type !== 'dim' && e.type !== 'text' && e.type !== 'hatch' && e.type !== 'insert') e.lw = state.currentLw;
  e.id = state.idSeq++;
  state.entities.push(e);
  return e;
}

export function deleteEntities(ids){
  const kill = {}; ids.forEach(id => { kill[id] = 1; });
  state.entities = state.entities.filter(e => !kill[e.id]);
  state.selIds = state.selIds.filter(id => !kill[id]);
  /* A constraint on a deleted entity is meaningless; drop it with the entity. */
  if (state.constraints && state.constraints.length){
    state.constraints = dropDanglingConstraints(state.entities, state.constraints);
  }
}

/* Swap one entity for a set of replacements (trim/extend results). */
export function replaceEntity(orig, newOnes){
  pushUndo();
  state.entities = state.entities.filter(x => x.id !== orig.id);
  newOnes.forEach(ne => { ne.id = state.idSeq++; state.entities.push(ne); });
  state.selIds = [];
  afterChange();
}

export function replaceMany(pairs, extra){
  pushUndo();
  const kill = {};
  pairs.forEach(p => { kill[p.orig.id] = 1; });
  state.entities = state.entities.filter(x => !kill[x.id]);
  pairs.forEach(p => p.ents.forEach(ne => { ne.id = state.idSeq++; state.entities.push(ne); }));
  (extra || []).forEach(ne => { ne.id = state.idSeq++; state.entities.push(ne); });
  state.selIds = [];
  afterChange();
}

export function pushCmd(line){
  state.cmdHistory.push(line);
  if (state.cmdHistory.length > 40) state.cmdHistory.shift();
}

export function rememberVec(p1, p2){
  if (!p1 || !p2) return;
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  state.lastLen = Math.sqrt(dx * dx + dy * dy);
  let a = Math.atan2(dy, dx) * 180 / Math.PI;
  if (a < 0) a += 360;
  state.lastAng = a;
  state.lastPt = [p2[0], p2[1]];
}
