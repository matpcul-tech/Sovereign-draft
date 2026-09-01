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

function stripHeavy(entities){
  return (entities || []).map(e => {
    if (e.type !== 'image' || !e.src || String(e.src).length < 120000) return e;
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
