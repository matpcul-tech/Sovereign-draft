/* Document-level actions shared by pointer input, keyboard shortcuts and the
 * chip/button UI. Everything that mutates the drawing goes through here so
 * undo, autosave and redraw stay consistent.
 */
import { state, layerByName, layerVisible, pushUndo, afterChange, selMembers, addEntity, deleteEntities, replaceEntity, GRID_SNAP, OFFSETS } from './core/state.js';
import { deep, dist } from './core/geometry.js';
import { entPoints, entHit, translateEnt, membersBBox, entBBox } from './core/entities.js';
import { offsetEntity } from './core/offset.js';
import { trimEntity, extendEntity } from './core/trimExtend.js';
import { SYMBOLS } from './core/symbols.js';
import { W2S, S2W } from './core/viewport.js';
import { ix } from './interaction.js';
import { toast } from './ui/toast.js';
import { fmtFtIn } from './core/format.js';

/* Snap a screen point: object snaps first (14 px pull), then the grid. */
export function snapPt(sx, sy){
  ix.snapMark = null;
  let best = null, bd = 14;
  if (state.snapOn){
    for (const e of state.entities){
      const L = layerByName(e.layer);
      if (L && !L.visible) continue;
      for (const cand of entPoints(e)){
        const s = W2S(cand[0], cand[1]);
        const d = dist(sx, sy, s[0], s[1]);
        if (d < bd){ bd = d; best = cand; }
      }
    }
  }
  if (best){ ix.snapMark = best; return [best[0], best[1]]; }
  const w = S2W(sx, sy);
  if (state.snapOn) return [Math.round(w[0] / GRID_SNAP) * GRID_SNAP, Math.round(w[1] / GRID_SNAP) * GRID_SNAP];
  return w;
}

export function applyOrtho(p1, p2){
  if (!state.orthoOn || !p1) return p2;
  return (Math.abs(p2[0] - p1[0]) > Math.abs(p2[1] - p1[1])) ? [p2[0], p1[1]] : [p1[0], p2[1]];
}

export function hitTest(sx, sy){
  const w = S2W(sx, sy), tol = 10 / state.view.scale;
  for (let k = state.entities.length - 1; k >= 0; k--){
    const e = state.entities[k], L = layerByName(e.layer);
    if (L && !L.visible) continue;
    if (entHit(e, w, tol)) return e;
  }
  return null;
}

export function cancelPoly(commit){
  if (commit && ix.polyPts.length > 1){
    pushUndo();
    addEntity({ type: 'poly', layer: state.currentLayer, closed: false, pts: deep(ix.polyPts) });
  }
  ix.polyPts = []; ix.hoverPt = null;
  afterChange();
}

export function closePoly(){
  if (ix.polyPts.length > 2){
    pushUndo();
    addEntity({ type: 'poly', layer: state.currentLayer, closed: true, pts: deep(ix.polyPts) });
    ix.polyPts = []; ix.hoverPt = null;
    afterChange();
  }
}

export function deleteSelection(){
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  deleteEntities(ms.map(e => e.id));
  state.selIds = [];
  afterChange();
}

export function duplicateSelection(){
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  const copies = deep(ms), gmap = {};
  copies.forEach(e => {
    translateEnt(e, 2, -2);
    e.id = state.idSeq++;
    if (e.g){
      if (!gmap[e.g]) gmap[e.g] = 'g' + (state.gSeq++);
      e.g = gmap[e.g];
    }
    state.entities.push(e);
  });
  state.selIds = copies.map(e => e.id);
  afterChange(); toast('Duplicated');
}

/* Stamp symbol/block fragments at a world point as one group. */
export function stampFrags(frags, wx, wy){
  const g = 'g' + (state.gSeq++);
  pushUndo();
  frags.forEach(f => {
    translateEnt(f, wx, wy);
    f.id = state.idSeq++; f.g = g;
    state.entities.push(f);
  });
  state.selIds = [frags[0].id];
  afterChange();
}

export function placeSymbolAt(sx, sy){
  const p = snapPt(sx, sy);
  const frags = state.activeSym.u
    ? deep(state.userBlocks[state.activeSym.i].frags)
    : SYMBOLS[state.activeSym.i].make();
  stampFrags(frags, p[0], p[1]);
}

export function offsetTap(sx, sy){
  const hit = hitTest(sx, sy);
  const w = S2W(sx, sy);
  if (!hit) return;
  if (hit.g){ toast('Explode the block first'); return; }
  const ne = offsetEntity(hit, OFFSETS[state.offIdx], w);
  if (ne){
    pushUndo(); addEntity(ne); afterChange();
    toast('Offset ' + fmtFtIn(OFFSETS[state.offIdx]));
  } else toast('Cannot offset that far inward');
}

export function trimTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  if (hit.g){ toast('Explode the block first'); return; }
  if (hit.type === 'dim' || hit.type === 'text'){ toast('Trim works on lines, polylines, circles and arcs'); return; }
  const res = trimEntity(state.entities, layerVisible, hit, S2W(sx, sy));
  if (!res.ok){ toast(res.msg); return; }
  replaceEntity(hit, res.replace);
  toast('Trimmed');
}

export function extendTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  if (hit.g){ toast('Explode the block first'); return; }
  const res = extendEntity(state.entities, layerVisible, hit, S2W(sx, sy));
  if (!res.ok){ toast(res.msg); return; }
  replaceEntity(hit, res.replace);
  toast('Extended');
}

export function eraseTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  pushUndo();
  const kill = hit.g ? state.entities.filter(e => e.g === hit.g) : [hit];
  deleteEntities(kill.map(e => e.id));
  toast(kill.length > 1 ? 'Erased block' : 'Erased');
  afterChange();
}

export function boxSelect(s0, s1){
  const wa = S2W(s0[0], s0[1]), wb = S2W(s1[0], s1[1]);
  const rx0 = Math.min(wa[0], wb[0]), rx1 = Math.max(wa[0], wb[0]);
  const ry0 = Math.min(wa[1], wb[1]), ry1 = Math.max(wa[1], wb[1]);
  const got = [];
  state.entities.forEach(e => {
    const L = layerByName(e.layer); if (L && !L.visible) return;
    const bb = [1e9, 1e9, -1e9, -1e9]; entBBox(e, bb);
    if (bb[0] <= rx1 && bb[2] >= rx0 && bb[1] <= ry1 && bb[3] >= ry0) got.push(e.id);
  });
  state.selIds = got;
  toast(got.length ? got.length + ' selected' : 'Nothing in the box');
}

export function saveBlockFromSelection(name){
  const ms = selMembers(); if (!ms.length) return false;
  const bb = membersBBox(ms), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const frags = deep(ms);
  frags.forEach(f => { delete f.id; delete f.g; translateEnt(f, -cx, -cy); });
  state.userBlocks.push({ name, frags });
  return true;
}
