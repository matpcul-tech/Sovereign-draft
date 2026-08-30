/* Central mutable application state plus undo/redo and layer management.
 * Core geometry modules stay pure; everything below is the single place that
 * owns the document.
 */
import { deep } from './geometry.js';
import { normalizeSheets } from './document.js';
import { defaultDimStyles } from './dimStyle.js';
import { defaultLayouts } from './layout.js';
import { refreshAssocDims } from './assoc.js';
import { syncAutoRooms } from './rooms.js';

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
    { name: 'DEFPOINTS', color: '#6b7c93', aci: 8, visible: true, plot: false }
  ];
}

export const state = {
  projectName: 'Untitled',
  layers: defaultLayers(),
  currentLayer: 'WALLS',
  entities: [],
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
  dxfVer: 'R12',
  dimStyles: defaultDimStyles(),
  currentDimStyle: 'ARCH',
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
  layerIsoPrev: null
};

let changeHandler = null;
export function onChange(fn){ changeHandler = fn; }
export function afterChange(){
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
    dimStyles: deep(state.dimStyles),
    layouts: deep(state.layouts),
    currentDimStyle: state.currentDimStyle,
    currentLayout: state.currentLayout,
    space: state.space
  };
}
function restore(s){
  state.entities = s.entities;
  state.layers = s.layers;
  if (s.dimStyles) state.dimStyles = s.dimStyles;
  if (s.layouts) state.layouts = s.layouts;
  if (s.currentDimStyle) state.currentDimStyle = s.currentDimStyle;
  if (s.currentLayout) state.currentLayout = s.currentLayout;
  if (s.space) state.space = s.space;
  if (!layerByName(state.currentLayer)) state.currentLayer = state.layers[0] ? state.layers[0].name : 'WALLS';
}

export function pushUndo(){
  state.undoStack.push(snapshot());
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}
export function doUndo(){
  if (!state.undoStack.length) return false;
  state.redoStack.push(snapshot());
  restore(state.undoStack.pop());
  state.selIds = [];
  afterChange();
  return true;
}
export function doRedo(){
  if (!state.redoStack.length) return false;
  state.undoStack.push(snapshot());
  restore(state.redoStack.pop());
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
