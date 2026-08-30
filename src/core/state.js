/* Central mutable application state plus undo/redo and layer management.
 * Core geometry modules stay pure; everything below is the single place that
 * owns the document.
 */
import { deep } from './geometry.js';

export const LAYER_COLORS = ['#00d4b8', '#c45a3c', '#d4af37', '#8fa3c0', '#4ade80', '#e8e4dd'];
export const GRID_SNAP = 0.5;
export const OFFSETS = [0.5, 1, 2, 4];
export const UNDO_LIMIT = 50;
export const PROJECT_VERSION = 4;

export function defaultLayers(){
  return [
    { name: 'WALLS',    color: '#d4a843', aci: 2, visible: true },
    { name: 'DOORS',    color: '#00d4b8', aci: 4, visible: true },
    { name: 'FIXTURES', color: '#c45a3c', aci: 1, visible: true },
    { name: 'DIMS',     color: '#8fa3c0', aci: 8, visible: true },
    { name: 'TEXT',     color: '#e8e4dd', aci: 7, visible: true }
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
  aiCtxOn: true,
  boxMode: false,
  selIds: [],
  undoStack: [],
  redoStack: [],
  offIdx: 0,
  activeSym: { u: false, i: 0 },
  pdfPPF: 'fit'
};

let changeHandler = null;
export function onChange(fn){ changeHandler = fn; }
export function afterChange(){ if (changeHandler) changeHandler(); }

export function layerByName(n){ return state.layers.find(l => l.name === n) || null; }
export function entById(id){ return state.entities.find(e => e.id === id) || null; }
export function layerVisible(name){ const L = layerByName(name); return !L || L.visible; }

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
  return { entities: deep(state.entities), layers: deep(state.layers) };
}
function restore(s){
  state.entities = s.entities;
  state.layers = s.layers;
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

export function addEntity(e){ e.id = state.idSeq++; state.entities.push(e); return e; }

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
