/* Project (de)serialization plus localStorage autosave. */
import { PROJECT_VERSION, defaultLayers } from '../core/state.js';
import { normalizeSheets, DOC_VERSION } from '../core/document.js';
import { defaultDimStyles } from '../core/dimStyle.js';
import { defaultLayouts } from '../core/layout.js';
import { setDisplayUnits } from '../core/format.js';
import { defaultTextStyles, validateTextStyles } from '../core/textstyle.js';
import { defaultPlotStyles, validatePlotStyles } from './plotstyle.js';
import { validateLayerStates } from '../core/layerstate.js';
import { validateScripts } from '../core/script.js';
import { serializeSolids, validateSolids } from '../core/model3d.js';

export const AUTOSAVE_KEY = 'sovereign-draft.autosave.v1';

/* The compact serialization (autosave, share links) cannot carry every
 * raster: localStorage has a quota and a URL has a length. Each image
 * may keep up to IMG_CAP characters of data URL, and all images
 * together up to IMG_BUDGET; past the budget the largest go first,
 * so a sheet of small details survives one oversized hero render.
 * A stripped image keeps its frame and is marked srcOmitted, which the
 * canvas labels and the restore path announces: the pixels are in the
 * saved project file, never silently gone. */
const IMG_CAP = 300000;
const IMG_BUDGET = 2500000;
function stripHeavy(entities){
  const list = (entities || []).slice();
  const omit = new Set();
  const imgs = [];
  list.forEach((e, i) => {
    if (e.type !== 'image' || !e.src) return;
    const len = String(e.src).length;
    if (len >= IMG_CAP) omit.add(i);
    else imgs.push({ i, len });
  });
  let total = imgs.reduce((a, b) => a + b.len, 0);
  imgs.sort((a, b) => b.len - a.len);
  for (const im of imgs){
    if (total <= IMG_BUDGET) break;
    omit.add(im.i);
    total -= im.len;
  }
  return list.map((e, i) => {
    if (!omit.has(i)) return e;
    const c = Object.assign({}, e);
    delete c.src;
    c.srcOmitted = true;
    return c;
  });
}

export function serializeProject(state, pretty){
  const entities = pretty ? state.entities : stripHeavy(state.entities);
  return JSON.stringify({
    app: 'sovereign-draft',
    v: PROJECT_VERSION,
    name: state.projectName || 'Untitled',
    firm: state.firm || { company: '', copyright: '', drawnBy: '' },
    idSeq: state.idSeq,
    gSeq: state.gSeq,
    layers: state.layers,
    entities,
    userBlocks: state.userBlocks,
    dimStyles: state.dimStyles,
    currentDimStyle: state.currentDimStyle,
    textStyles: state.textStyles || defaultTextStyles(),
    currentTextStyle: state.currentTextStyle || 'STANDARD',
    plotStyles: state.plotStyles || defaultPlotStyles(),
    currentPlotStyle: state.currentPlotStyle || 'ISO',
    layerStates: state.layerStates || [],
    annoPpf: state.annoPpf || 18,
    scripts: state.scripts || [],
    materials: state.materials || {},
    sun: state.sun || null,
    views3d: state.views3d || [],
    solids: serializeSolids(state.solids),
    layouts: state.layouts,
    currentLayout: state.currentLayout,
    space: state.space,
    constraints: state.constraints || [],
    dxfVer: state.dxfVer,
    units: state.units === 'mm' || state.units === 'm' ? state.units : 'ft',
    storyHeight: state.storyHeight > 0 ? state.storyHeight : 8,
    heightAssumed: state.heightAssumed !== false
  }, null, pretty ? 1 : 0);
}

export function validateProject(o){
  if (!o || typeof o !== 'object' || !Array.isArray(o.entities) || !Array.isArray(o.layers))
    throw new Error('Not a Sovereign Draft project');
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Untitled',
    layers: o.layers && o.layers.length ? o.layers : defaultLayers(),
    entities: o.entities,
    idSeq: Number(o.idSeq) || (o.entities.length + 1),
    gSeq: Number(o.gSeq) || 1,
    userBlocks: Array.isArray(o.userBlocks) ? o.userBlocks : [],
    dimStyles: Array.isArray(o.dimStyles) && o.dimStyles.length ? o.dimStyles : defaultDimStyles(),
    currentDimStyle: o.currentDimStyle || 'ARCH',
    /* A file written before styles existed loads with the defaults. */
    textStyles: validateTextStyles(o.textStyles),
    currentTextStyle: o.currentTextStyle || 'STANDARD',
    plotStyles: validatePlotStyles(o.plotStyles),
    currentPlotStyle: o.currentPlotStyle || 'ISO',
    layerStates: validateLayerStates(o.layerStates),
    annoPpf: Number(o.annoPpf) > 0 ? Number(o.annoPpf) : 18,
    scripts: validateScripts(o.scripts),
    materials: validateMaterials(o.materials),
    sun: validateSun(o.sun),
    views3d: validateViews3d(o.views3d),
    solids: validateSolids(o.solids),
    /* Structural migration only. Entities are already true size and are
     * passed through untouched. */
    schemaVersion: Number(o.v) || 1,
    layouts: normalizeSheets(Array.isArray(o.layouts) && o.layouts.length ? o.layouts : defaultLayouts()),
    currentLayout: o.currentLayout || 'A1',
    space: o.space === 'model' || o.space ? o.space : 'model',
    constraints: Array.isArray(o.constraints) ? o.constraints : [],
    dxfVer: o.dxfVer === 'R2000' ? 'R2000' : 'R12',
    units: o.units === 'mm' || o.units === 'm' ? o.units : 'ft',
    storyHeight: Number(o.storyHeight) > 0 ? Number(o.storyHeight) : 8,
    heightAssumed: o.heightAssumed !== false,
    firm: {
      company: String(o.firm && o.firm.company || '').slice(0, 80),
      copyright: String(o.firm && o.firm.copyright || '').slice(0, 160),
      drawnBy: String(o.firm && o.firm.drawnBy || '').slice(0, 40),
      /* A small JPEG as a data URL. Anything else, or anything huge, is
       * dropped rather than carried blindly into every save. */
      logo: /^data:image\/jpe?g;base64,/.test(String(o.firm && o.firm.logo || '')) && String(o.firm.logo).length < 400000
        ? String(o.firm.logo) : undefined
    }
  };
}

export function applyProject(state, p){
  state.constraints = p.constraints || [];
  state.projectName = p.name;
  state.layers = p.layers;
  state.entities = p.entities;
  state.idSeq = p.idSeq;
  state.gSeq = p.gSeq;
  state.userBlocks = p.userBlocks;
  if (p.dimStyles) state.dimStyles = p.dimStyles;
  if (p.currentDimStyle) state.currentDimStyle = p.currentDimStyle;
  if (p.textStyles) state.textStyles = p.textStyles;
  if (p.currentTextStyle) state.currentTextStyle = p.currentTextStyle;
  if (p.plotStyles) state.plotStyles = p.plotStyles;
  if (p.currentPlotStyle) state.currentPlotStyle = p.currentPlotStyle;
  state.layerStates = p.layerStates || [];
  state.annoPpf = p.annoPpf || 18;
  state.materials = p.materials || {};
  state.sun = p.sun || null;
  state.views3d = p.views3d || [];
  state.scripts = p.scripts || [];
  state.solids = p.solids || [];
  if (p.layouts) state.layouts = p.layouts;
  if (p.currentLayout) state.currentLayout = p.currentLayout;
  if (p.space) state.space = p.space;
  if (p.dxfVer) state.dxfVer = p.dxfVer;
  if (p.units) state.units = p.units;
  if (p.storyHeight > 0) state.storyHeight = p.storyHeight;
  state.heightAssumed = p.heightAssumed !== false;
  setDisplayUnits(state.units || 'ft');
  if (p.firm) state.firm = p.firm;
  ['SCHEDULES', 'UNDERLAY'].forEach(n => {
    if (!state.layers.find(l => l.name === n)){
      const d = defaultLayers().find(l => l.name === n);
      if (d) state.layers.push(Object.assign({}, d));
    }
  });
  if (!state.layers.find(l => l.name === state.currentLayer))
    state.currentLayer = state.layers[0] ? state.layers[0].name : 'WALLS';
  state.selIds = [];
}

export function autosave(state){
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(state, false));
  } catch (e){ /* storage full or unavailable — losing autosave is acceptable */ }
}

export function loadAutosave(){
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return validateProject(JSON.parse(raw));
  } catch (e){
    return null;
  }
}

export function clearAutosave(){
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e){ /* ignore */ }
}

/* ---------- appearance ---------- */
export function validateMaterials(m){
  const out = {};
  if (!m || typeof m !== 'object') return out;
  for (const k of Object.keys(m).slice(0, 200)){
    const v = m[k];
    if (!v || typeof v !== 'object') continue;
    const color = typeof v.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.color) ? v.color : null;
    if (!color) continue;
    const clamp01 = x => Math.max(0, Math.min(1, Number(x)));
    out[String(k).toUpperCase().slice(0, 32)] = {
      color,
      rough: Number.isFinite(Number(v.rough)) ? clamp01(v.rough) : 0.7,
      metal: Number.isFinite(Number(v.metal)) ? clamp01(v.metal) : 0
    };
  }
  return out;
}

export function validateSun(sun){
  if (!sun || typeof sun !== 'object') return null;
  const m = Number(sun.month), d = Number(sun.day), h = Number(sun.hour), lat = Number(sun.lat);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  return {
    month: Math.round(m),
    day: Number.isFinite(d) ? Math.max(1, Math.min(31, Math.round(d))) : 21,
    hour: Number.isFinite(h) ? Math.max(0, Math.min(24, h)) : 12,
    lat: Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 40
  };
}

export function validateViews3d(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const v of list.slice(0, 50)){
    if (!v || typeof v !== 'object') continue;
    const name = String(v.name || '').toUpperCase().slice(0, 24);
    if (!name || seen.has(name)) continue;
    const num3 = a => Array.isArray(a) && a.length === 3 && a.every(x => Number.isFinite(Number(x)));
    if (!num3(v.pos) || !num3(v.target)) continue;
    seen.add(name);
    out.push({
      name,
      pos: v.pos.map(Number),
      target: v.target.map(Number),
      fov: Number.isFinite(Number(v.fov)) ? Math.max(10, Math.min(120, Number(v.fov))) : 50
    });
  }
  return out;
}
