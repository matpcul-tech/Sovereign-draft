/* Project (de)serialization plus localStorage autosave. The on-disk format is
 * the same JSON the original prototype used, with a version bump and an
 * optional project name; v3 files still open.
 */
import { PROJECT_VERSION } from '../core/state.js';

export const AUTOSAVE_KEY = 'sovereign-draft.autosave.v1';

export function serializeProject(state, pretty){
  return JSON.stringify({
    app: 'sovereign-draft',
    v: PROJECT_VERSION,
    name: state.projectName || 'Untitled',
    idSeq: state.idSeq,
    gSeq: state.gSeq,
    layers: state.layers,
    entities: state.entities,
    userBlocks: state.userBlocks
  }, null, pretty ? 1 : 0);
}

/* Validate a parsed project object; throws with a friendly message. */
export function validateProject(o){
  if (!o || typeof o !== 'object' || !Array.isArray(o.entities) || !Array.isArray(o.layers))
    throw new Error('Not a Sovereign Draft project');
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Untitled',
    layers: o.layers,
    entities: o.entities,
    idSeq: Number(o.idSeq) || (o.entities.length + 1),
    gSeq: Number(o.gSeq) || 1,
    userBlocks: Array.isArray(o.userBlocks) ? o.userBlocks : []
  };
}

export function applyProject(state, p){
  state.projectName = p.name;
  state.layers = p.layers;
  state.entities = p.entities;
  state.idSeq = p.idSeq;
  state.gSeq = p.gSeq;
  state.userBlocks = p.userBlocks;
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
