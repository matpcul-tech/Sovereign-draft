/* Named layer states.
 *
 *   { name, note, layers: { WALLS: { visible, locked, plot, color, lt, lw } } }
 *
 * A layer state is a saved answer to "which layers am I looking at". Real
 * work needs several of them on the same model: the structural layers alone
 * for a framing check, everything but the furniture for a coordination
 * print, the demolition set for an as-built. Doing that by hand means
 * clicking through a long layer list and getting it slightly wrong each
 * time, which is how a sheet goes out with the wrong layers showing.
 *
 * A state records only the fields it manages, and restoring one touches only
 * the layers it names. A layer added after the state was saved keeps whatever
 * it has rather than being reset to a default the state never knew about.
 */

export const STATE_FIELDS = ['visible', 'locked', 'plot', 'color', 'lt', 'lw'];

export function captureLayerState(name, layers, note){
  const rec = { name: String(name || 'STATE').toUpperCase(), layers: {} };
  if (note) rec.note = String(note);
  (layers || []).forEach(L => {
    if (!L || !L.name) return;
    const out = {};
    STATE_FIELDS.forEach(f => { if (L[f] !== undefined) out[f] = L[f]; });
    rec.layers[L.name] = out;
  });
  return rec;
}

/* Apply a state in place. Returns how many layers it actually changed, so a
 * caller can say what happened instead of claiming a restore that was a
 * no-op. */
export function applyLayerState(rec, layers){
  if (!rec || !rec.layers) return 0;
  let changed = 0;
  (layers || []).forEach(L => {
    const want = rec.layers[L.name];
    if (!want) return;                    /* not in the state, so not touched */
    let touched = false;
    STATE_FIELDS.forEach(f => {
      if (want[f] === undefined) return;
      if (L[f] === want[f]) return;
      L[f] = want[f];
      touched = true;
    });
    if (touched) changed++;
  });
  return changed;
}

/* Layers the state has nothing to say about. Worth surfacing: a state saved
 * before a layer existed will leave it however it is, and the drafter should
 * know that rather than assume it was set. */
export function unmanagedLayers(rec, layers){
  if (!rec || !rec.layers) return (layers || []).map(L => L.name);
  return (layers || []).filter(L => !rec.layers[L.name]).map(L => L.name);
}

export function layerStateByName(states, name){
  const want = String(name || '').toUpperCase();
  return (states || []).find(s => s.name === want) || null;
}

export function upsertLayerState(states, rec){
  const list = (states || []).filter(s => s.name !== rec.name);
  list.push(rec);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function removeLayerState(states, name){
  const want = String(name || '').toUpperCase();
  return (states || []).filter(s => s.name !== want);
}

export function validateLayerStates(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list){
    if (!s || !s.name || typeof s.layers !== 'object' || !s.layers) continue;
    const name = String(s.name).toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const layers = {};
    Object.keys(s.layers).forEach(k => {
      const src = s.layers[k] || {};
      const rec = {};
      STATE_FIELDS.forEach(f => { if (src[f] !== undefined) rec[f] = src[f]; });
      layers[k] = rec;
    });
    const rec = { name, layers };
    if (s.note) rec.note = String(s.note);
    out.push(rec);
  }
  return out;
}
