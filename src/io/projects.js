/* Named projects on this device.
 *
 * A drawing is a job with a name, not an anonymous tab. The store keeps
 * an index plus one record per project, so the app can open Tuesday's
 * work by name instead of resurrecting a single unnamed autosave slot.
 *
 * Storage is injectable so the whole thing is testable without a
 * browser; in the app it is localStorage. Every write is best effort:
 * a full or unavailable store must never take the drawing down.
 */
import { serializeProject, validateProject, AUTOSAVE_KEY } from './project.js';

export const INDEX_KEY = 'sovereign-draft.projects.v1';
export const LAST_KEY = 'sovereign-draft.last.v1';
export const RECORD_PREFIX = 'sovereign-draft.project.';

function store(s){
  if (s) return s;
  try { return localStorage; } catch (e){ return null; }
}

function readJSON(s, key, fallback){
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e){ return fallback; }
}

function writeJSON(s, key, value){
  try { s.setItem(key, JSON.stringify(value)); return true; }
  catch (e){ return false; }
}

/* A file name someone can recognise in a downloads folder. */
export function slugify(name){
  return String(name || 'untitled').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
}

/* Ids are derived from the name so the store stays readable, with a
 * counter only when two jobs really do share a name. */
export function newId(name, taken){
  const base = slugify(name);
  if (!taken || !taken.includes(base)) return base;
  for (let i = 2; i < 999; i++){
    const c = base + '-' + i;
    if (!taken.includes(c)) return c;
  }
  return base + '-' + Date.now();
}

export function listProjects(s){
  const st = store(s);
  if (!st) return [];
  const idx = readJSON(st, INDEX_KEY, []);
  if (!Array.isArray(idx)) return [];
  return idx
    .filter(e => e && typeof e.id === 'string')
    .map(e => ({
      id: e.id,
      name: typeof e.name === 'string' && e.name.trim() ? e.name : e.id,
      updated: Number(e.updated) || 0,
      entities: Number(e.entities) || 0,
    }))
    .sort((a, b) => b.updated - a.updated);
}

function putIndex(st, list){ return writeJSON(st, INDEX_KEY, list); }

/* Write the drawing into its own slot and touch the index. Returns the
 * id written, or null when the store refused it. */
export function saveProject(state, s, now){
  const st = store(s);
  if (!st) return null;
  const stamp = now || Date.now();
  const list = listProjects(st);
  let id = state.projectId;
  const name = (state.projectName || 'Untitled').trim() || 'Untitled';
  if (!id){
    id = newId(name, list.map(e => e.id));
    state.projectId = id;
  }
  let body;
  try { body = serializeProject(state, false); }
  catch (e){ return null; }
  try { st.setItem(RECORD_PREFIX + id, body); }
  catch (e){ return null; }
  const rest = list.filter(e => e.id !== id);
  rest.unshift({ id, name, updated: stamp, entities: (state.entities || []).length });
  putIndex(st, rest);
  try { st.setItem(LAST_KEY, id); } catch (e){ /* preference only */ }
  return id;
}

export function openProject(id, s){
  const st = store(s);
  if (!st || !id) return null;
  try {
    const raw = st.getItem(RECORD_PREFIX + id);
    if (!raw) return null;
    const p = validateProject(JSON.parse(raw));
    p.projectId = id;
    return p;
  } catch (e){ return null; }
}

export function lastProjectId(s){
  const st = store(s);
  if (!st) return null;
  let id = null;
  try { id = st.getItem(LAST_KEY); } catch (e){ return null; }
  if (!id) return null;
  return listProjects(st).some(e => e.id === id) ? id : null;
}

export function renameProject(id, name, s){
  const st = store(s);
  if (!st) return false;
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return false;
  const list = listProjects(st);
  const hit = list.find(e => e.id === id);
  if (!hit) return false;
  hit.name = clean;
  /* The stored document carries its own name too, so a file exported
   * later says what the list says. */
  try {
    const raw = st.getItem(RECORD_PREFIX + id);
    if (raw){
      const o = JSON.parse(raw);
      o.name = clean;
      st.setItem(RECORD_PREFIX + id, JSON.stringify(o));
    }
  } catch (e){ /* the index rename still stands */ }
  return putIndex(st, list);
}

export function deleteProject(id, s){
  const st = store(s);
  if (!st) return false;
  try { st.removeItem(RECORD_PREFIX + id); } catch (e){ /* ignore */ }
  const list = listProjects(st).filter(e => e.id !== id);
  try { if (st.getItem(LAST_KEY) === id) st.removeItem(LAST_KEY); } catch (e){ /* ignore */ }
  return putIndex(st, list);
}

export function duplicateProject(id, s, now){
  const st = store(s);
  if (!st) return null;
  let raw;
  try { raw = st.getItem(RECORD_PREFIX + id); } catch (e){ return null; }
  if (!raw) return null;
  const list = listProjects(st);
  const src = list.find(e => e.id === id);
  const name = ((src && src.name) || id) + ' copy';
  const nid = newId(name, list.map(e => e.id));
  let count = 0;
  try {
    const o = JSON.parse(raw);
    o.name = name;
    count = (o.entities || []).length;
    st.setItem(RECORD_PREFIX + nid, JSON.stringify(o));
  } catch (e){ return null; }
  list.unshift({ id: nid, name, updated: now || Date.now(), entities: count });
  putIndex(st, list);
  return nid;
}

/* The single unnamed autosave slot every earlier build wrote to. Moved
 * into a named project once, so nobody's last session disappears the
 * day named projects arrive. */
export function migrateLegacyAutosave(s, now){
  const st = store(s);
  if (!st) return null;
  let raw;
  try { raw = st.getItem(AUTOSAVE_KEY); } catch (e){ return null; }
  if (!raw) return null;
  if (listProjects(st).length) return null;
  let o;
  try { o = JSON.parse(raw); } catch (e){ return null; }
  const name = (o && typeof o.name === 'string' && o.name.trim() && o.name !== 'Untitled')
    ? o.name : 'Recovered drawing';
  const id = newId(name, []);
  o.name = name;
  try { st.setItem(RECORD_PREFIX + id, JSON.stringify(o)); }
  catch (e){ return null; }
  putIndex(st, [{ id, name, updated: now || Date.now(), entities: (o.entities || []).length }]);
  try { st.setItem(LAST_KEY, id); } catch (e){ /* preference only */ }
  return id;
}

/* The launch decision, in one place so it can be argued with in a test.
 * The sample cabin is a first-run gesture: it fills an empty first paint
 * for somebody who has never drawn here. A named job on this device means
 * this launch is a return, and a return opens the job, empty or not. */
export function shouldOfferSample({ embedded, share, restored } = {}){
  if (embedded || share) return false;
  if (!restored) return true;
  if (restored.projectId) return false;
  return !(restored.entities && restored.entities.length);
}
