/* Document-level actions shared by pointer input, keyboard shortcuts and the
 * chip/button UI. Everything that mutates the drawing goes through here so
 * undo, autosave and redraw stay consistent.
 */
import { state, layerByName, layerVisible, layerLocked, pushUndo, afterChange, selMembers, addEntity, deleteEntities, replaceEntity, replaceMany, GRID_SNAP, OFFSETS, POLAR_STEP, rememberVec, pushCmd, currentDimStyleObj } from './core/state.js';
import { deep, dist, polarSnap } from './core/geometry.js';
import { entPoints, entHit, translateEnt, membersBBox, entBBox, rotateMembers, explodeForIO } from './core/entities.js';
import { offsetEntity } from './core/offset.js';
import { trimEntity, extendEntity } from './core/trimExtend.js';
import { SYMBOLS } from './core/symbols.js';
import { W2S, S2W } from './core/viewport.js';
import { ix } from './interaction.js';
import { toast } from './ui/toast.js';
import { fmtFtIn, parseLength, parsePoint } from './core/format.js';
import { allSnapCandidates, SNAP_KIND } from './core/osnap.js';
import { filletLines, chamferLines, arcFrom3, moveEntities, rotateEntities, scaleEntities, mirrorEntities, rectangularArray, polarArray, joinEntities } from './core/modify.js';
import { wallFrags, WALL_THICKNESS } from './core/walls.js';
import { makeHatch, boundaryContaining, HATCH_PATTERNS } from './core/hatch.js';
import { alignedDim, continueDim, baselineDim, applyStyleToDim, angularDim, radiusDim, diameterDim, makeLeader } from './core/dimStyle.js';
import { lookupCommand } from './core/command.js';
import {
  makeInsert, locateInsert, clFromMembers, syncHostWall, snapWidth,
  expandInsert, flipInsert, detachInsert, paramOnCl
} from './core/dynblock.js';
import { tagInserts, buildSchedule, scheduleCSV, tableFrags } from './core/schedule.js';
import { stretchEntities, boxFromScreen } from './core/stretch.js';
import { areaOf, listEntity, idPoint } from './core/inquiry.js';
import { healWalls } from './core/cleanup.js';
import { bindAlignedDim } from './core/assoc.js';
import { makeGridFromCorners, expandGrid } from './core/grid.js';
import { overkill } from './core/overkill.js';
import { buildTakeoffTable, takeoffSummary } from './core/takeoff.js';
import { syncAutoRooms } from './core/rooms.js';
import { generateSheetSet } from './core/sheetset.js';

export function applyConstraint(p1, p2){
  if (!p1 || !p2) return p2;
  if (state.orthoOn) return (Math.abs(p2[0] - p1[0]) > Math.abs(p2[1] - p1[1])) ? [p2[0], p1[1]] : [p1[0], p2[1]];
  if (state.polarOn) return polarSnap(p1, p2, POLAR_STEP);
  return p2;
}

/* Snap a screen point: object snaps first (14 px pull), then the grid. */
export function snapPt(sx, sy, fromPt){
  ix.snapMark = null;
  let best = null, bd = 14;
  if (state.snapOn){
    const w = S2W(sx, sy);
    const cands = allSnapCandidates(state.entities, layerVisible, w, fromPt || state.lastPt);
    for (const cand of cands){
      const s = W2S(cand[0], cand[1]);
      const d = dist(sx, sy, s[0], s[1]);
      /* Prefer end/int/perp over nearest when equally close. */
      const bias = cand[2] === 4 ? 2 : 0;
      if (d + bias < bd){ bd = d + bias; best = cand; }
    }
  }
  if (best){ ix.snapMark = best; return [best[0], best[1]]; }
  const w = S2W(sx, sy);
  if (state.snapOn) return [Math.round(w[0] / GRID_SNAP) * GRID_SNAP, Math.round(w[1] / GRID_SNAP) * GRID_SNAP];
  return w;
}

export function applyOrtho(p1, p2){ return applyConstraint(p1, p2); }

export function hitTest(sx, sy){
  const w = S2W(sx, sy), tol = 10 / state.view.scale;
  for (let k = state.entities.length - 1; k >= 0; k--){
    const e = state.entities[k], L = layerByName(e.layer);
    if (L && !L.visible) continue;
    if (L && L.locked) continue;
    if (entHit(e, w, tol)) return e;
  }
  return null;
}

export function cancelPoly(commit){
  if (commit && ix.polyPts.length > 1){
    pushUndo();
    if (state.tool === 'hatch'){
      const h = makeHatch(ix.polyPts, { layer: 'HATCH', pattern: state.hatchPattern || 'ANSI31' });
      if (h) addEntity(h);
    } else if (state.tool === 'cloud'){
      addEntity({ type: 'cloud', layer: state.currentLayer, pts: deep(ix.polyPts), amp: 0.4 });
    } else if (state.tool === 'leader'){
      const e = makeLeader(ix.polyPts, '', currentDimStyleObj());
      addEntity(e);
      ix.pendingLeader = e;
    } else {
      addEntity({ type: 'poly', layer: state.currentLayer, closed: false, pts: deep(ix.polyPts) });
    }
  }
  ix.polyPts = []; ix.hoverPt = null; ix.arcPts = [];
  afterChange();
}

export function closePoly(){
  if (ix.polyPts.length > 2){
    pushUndo();
    if (state.tool === 'hatch'){
      const h = makeHatch(ix.polyPts, { layer: 'HATCH', pattern: state.hatchPattern || 'ANSI31' });
      if (h) addEntity(h);
    } else if (state.tool === 'cloud'){
      addEntity({ type: 'cloud', layer: state.currentLayer, pts: deep(ix.polyPts), amp: 0.4 });
    } else if (state.tool === 'leader'){
      const e = makeLeader(ix.polyPts, '', currentDimStyleObj());
      addEntity(e);
      ix.pendingLeader = e;
    } else {
      addEntity({ type: 'poly', layer: state.currentLayer, closed: true, pts: deep(ix.polyPts) });
    }
    ix.polyPts = []; ix.hoverPt = null;
    afterChange();
  }
}

export function deleteSelection(){
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  const hosts = new Set();
  ms.forEach(e => { if (e.type === 'insert' && e.host) hosts.add(e.host); });
  deleteEntities(ms.map(e => e.id));
  hosts.forEach(h => syncHostWall(state, h));
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
    if (e.type === 'insert') detachInsert(e);
    if (e.g){
      if (!gmap[e.g]) gmap[e.g] = 'g' + (state.gSeq++);
      e.g = gmap[e.g];
    }
    state.entities.push(e);
  });
  state.selIds = copies.map(e => e.id);
  afterChange(); toast('Duplicated');
}

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
  return g;
}

export function placeSymbolAt(sx, sy){
  const p = snapPt(sx, sy);
  const name = state.activeSym.u ? (state.userBlocks[state.activeSym.i] || {}).name : (SYMBOLS[state.activeSym.i] || {}).name;
  const user = state.activeSym.u ? state.userBlocks[state.activeSym.i] : null;
  const hit = hitTest(sx, sy);
  if (hit && hit.kind === 'wall' && hit.g && (name === 'Door' || name === 'Window')){
    placeHostedInsert(hit, name === 'Window' ? 'window' : 'door', p, name === 'Window' ? 3 : 3, 'L');
    return;
  }
  pushUndo();
  const ins = makeInsert({
    def: user ? 'user' : (name === 'Door' ? 'door' : (name === 'Window' ? 'window' : 'sym:' + name)),
    name: name || 'Block',
    layer: (name === 'Door' || name === 'Window') ? 'DOORS' : 'FIXTURES',
    x: p[0], y: p[1],
    width: (name === 'Door' || name === 'Window') ? 3 : undefined,
    swing: 'L',
    frags: user ? deep(user.frags) : null
  });
  addEntity(ins);
  state.selIds = [ins.id];
  afterChange();
}

function placeHostedInsert(hit, kind, p, width, swing){
  const host = hit.g;
  const members = state.entities.filter(e => e.g === host);
  const existing = state.entities.find(e => e.type === 'insert' && e.host === host);
  const cl = (existing && existing.cl) || clFromMembers(members);
  if (!cl){ toast('Not a wall'); return; }
  const t = paramOnCl(cl, p);
  const ins = makeInsert({
    def: kind,
    name: kind === 'window' ? 'Window' : 'Door',
    layer: 'DOORS',
    width: snapWidth(width || 3, kind),
    swing: swing || 'L',
    host, t, cl, th: cl.th
  });
  locateInsert(ins, cl);
  pushUndo();
  addEntity(ins);
  syncHostWall(state, host);
  state.selIds = [ins.id];
  afterChange();
  toast(kind === 'window' ? 'Window' : 'Door');
}

export function offsetTap(sx, sy){
  const hit = hitTest(sx, sy);
  const w = S2W(sx, sy);
  if (!hit) return;
  if (hit.type === 'insert' || (hit.g && hit.kind !== 'wall')){ toast('Explode the block first'); return; }
  const ne = offsetEntity(hit, state.offsetDist || OFFSETS[state.offIdx], w);
  if (ne){
    pushUndo(); addEntity(ne); afterChange();
    toast('Offset ' + fmtFtIn(state.offsetDist || OFFSETS[state.offIdx]));
  } else toast('Cannot offset that far inward');
}

export function trimTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  if (hit.type === 'insert' || (hit.g && hit.kind !== 'wall')){ toast('Explode the block first'); return; }
  if (hit.type === 'dim' || hit.type === 'text' || hit.type === 'hatch'){ toast('Trim works on lines, polylines, circles and arcs'); return; }
  const res = trimEntity(state.entities, layerVisible, hit, S2W(sx, sy));
  if (!res.ok){ toast(res.msg); return; }
  replaceEntity(hit, res.replace);
  toast('Trimmed');
}

export function extendTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  if (hit.type === 'insert' || (hit.g && hit.kind !== 'wall')){ toast('Explode the block first'); return; }
  const res = extendEntity(state.entities, layerVisible, hit, S2W(sx, sy));
  if (!res.ok){ toast(res.msg); return; }
  replaceEntity(hit, res.replace);
  toast('Extended');
}

export function eraseTap(sx, sy){
  const hit = hitTest(sx, sy);
  if (!hit) return;
  pushUndo();
  if (hit.type === 'insert'){
    const host = hit.host;
    deleteEntities([hit.id]);
    if (host) syncHostWall(state, host);
    toast('Erased block');
    afterChange();
    return;
  }
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
    if (L && L.locked) return;
    const bb = [1e9, 1e9, -1e9, -1e9]; entBBox(e, bb);
    if (bb[0] <= rx1 && bb[2] >= rx0 && bb[1] <= ry1 && bb[3] >= ry0) got.push(e.id);
  });
  state.selIds = got;
  toast(got.length ? got.length + ' selected' : 'Nothing in the box');
}

export function saveBlockFromSelection(name){
  const ms = selMembers(); if (!ms.length) return false;
  const bb = membersBBox(ms), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const frags = [];
  ms.forEach(e => {
    if (e.type === 'insert') expandInsert(e).forEach(f => frags.push(f));
    else frags.push(deep(e));
  });
  frags.forEach(f => { delete f.id; delete f.g; translateEnt(f, -cx, -cy); });
  state.userBlocks.push({ name, frags });
  return true;
}

export function finishDraw(p1, p2, tool){
  if (!p1 || !p2) return;
  rememberVec(p1, p2);
  if (tool === 'measure'){
    toast(fmtFtIn(dist(p1[0], p1[1], p2[0], p2[1])) + '  (Δx ' + fmtFtIn(Math.abs(p2[0] - p1[0])) + ', Δy ' + fmtFtIn(Math.abs(p2[1] - p1[1])) + ')', 3500);
    return;
  }
  if (tool === 'arraypolar'){
    applyPolarArray(p1[0], p1[1]);
    return;
  }
  if (tool === 'image' && !ix.imageSrc){ toast('Pick an image file first'); return; }
  if (dist(p1[0], p1[1], p2[0], p2[1]) < 0.05 && tool !== 'stretch') return;
  pushUndo();
  if (tool === 'line') addEntity({ type: 'line', layer: state.currentLayer, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
  else if (tool === 'rect') addEntity({ type: 'poly', layer: state.currentLayer, closed: true, pts: [[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]] });
  else if (tool === 'circle') addEntity({ type: 'circle', layer: state.currentLayer, cx: p1[0], cy: p1[1], r: dist(p1[0], p1[1], p2[0], p2[1]) });
  else if (tool === 'dim' || tool === 'dimali'){
    const e = alignedDim(p1, p2, currentDimStyleObj().offset, currentDimStyleObj());
    bindAlignedDim(e, state.entities);
    addEntity(e);
    ix.dimLast = e; ix.dimBase = e;
  }
  else if (tool === 'wall' || (tool === 'line' && state.wallMode)){
    const g = 'g' + (state.gSeq++);
    wallFrags(p1[0], p1[1], p2[0], p2[1], state.wallTh, 'WALLS').forEach(f => { f.g = g; addEntity(f); });
    const res = healWalls(state.entities);
    if (res.ok) state.entities = res.entities;
  }
  else if (tool === 'xline'){
    addEntity({ type: 'xline', layer: state.currentLayer, lt: 'DASHED', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
  }
  else if (tool === 'grid'){
    addEntity(makeGridFromCorners(p1, p2));
  }
  else if (tool === 'ellipse'){
    addEntity({ type: 'ellipse', layer: state.currentLayer, cx: p1[0], cy: p1[1], rx: Math.abs(p2[0] - p1[0]) || 0.5, ry: Math.abs(p2[1] - p1[1]) || 0.5, rot: 0 });
  }
  else if (tool === 'image'){
    if (!ix.imageSrc){ toast('Pick an image file first'); return; }
    addEntity({
      type: 'image',
      layer: 'UNDERLAY',
      x: Math.min(p1[0], p2[0]),
      y: Math.min(p1[1], p2[1]),
      w: Math.abs(p2[0] - p1[0]) || 1,
      h: Math.abs(p2[1] - p1[1]) || 1,
      rot: 0,
      src: ix.imageSrc
    });
  }
  else if (tool === 'stretch'){
    applyStretchDisplacement(p1, p2);
    return;
  }
  else if (tool === 'calibrate'){
    ix.calibratePts = [p1, p2];
    toast('Type the true length of that span');
    return;
  }
  afterChange();
}

export function applyFillet(e1, e2, p1, p2){
  const res = filletLines(e1, e2, state.filletR, p1, p2);
  if (!res.ok){ toast(res.msg); return; }
  replaceMany(res.replace, res.extra || []);
  toast(state.filletR ? ('Fillet ' + fmtFtIn(state.filletR)) : 'Sharp corner');
}

export function applyChamfer(e1, e2, p1, p2){
  const res = chamferLines(e1, e2, state.chamferD, state.chamferD, p1, p2);
  if (!res.ok){ toast(res.msg); return; }
  replaceMany(res.replace, res.extra || []);
  toast('Chamfer ' + fmtFtIn(state.chamferD));
}

export function applyJoin(){
  const ms = selMembers().filter(e => e.type === 'line' || e.type === 'poly');
  const res = joinEntities(ms);
  if (!res.ok){ toast(res.msg); return; }
  pushUndo();
  deleteEntities(res.orig.map(e => e.id));
  res.replace.forEach(e => addEntity(e));
  afterChange();
  toast('Joined into ' + res.replace.length + ' polyline' + (res.replace.length === 1 ? '' : 's'));
}

export function hatchTap(sx, sy){
  const w = S2W(sx, sy);
  const hit = hitTest(sx, sy);
  const names = Object.keys(HATCH_PATTERNS);
  if (hit && hit.type === 'hatch'){
    const i = Math.max(0, names.indexOf(hit.pattern || 'ANSI31'));
    pushUndo();
    hit.pattern = names[(i + 1) % names.length];
    afterChange();
    toast('Hatch ' + hit.pattern);
    return;
  }
  if (hit && hit.type === 'poly' && hit.closed){
    const h = makeHatch(deep(hit.pts), { layer: 'HATCH', pattern: state.hatchPattern || 'ANSI31' });
    if (h){ pushUndo(); addEntity(h); afterChange(); toast('Hatch ' + h.pattern); }
    return;
  }
  const visible = state.entities.filter(e => layerVisible(e.layer));
  const pts = boundaryContaining(visible, w[0], w[1]);
  if (pts){
    const h = makeHatch(pts, { layer: 'HATCH', pattern: state.hatchPattern || 'ANSI31' });
    if (h){ pushUndo(); addEntity(h); afterChange(); toast('Hatch ' + h.pattern); }
    return;
  }
  const p = applyConstraint(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
  ix.polyPts.push(p);
}

export function applyProps(patch){
  const ms = selMembers();
  if (!ms.length || !patch) return false;
  pushUndo();
  const hosts = new Set();
  ms.forEach(e => {
    if (patch.layer != null) e.layer = patch.layer;
    if (patch.lt != null){
      if (!patch.lt || patch.lt === 'CONTINUOUS') delete e.lt;
      else e.lt = patch.lt;
    }
    if (patch.lw != null){
      if (!patch.lw) delete e.lw;
      else e.lw = Number(patch.lw);
    }
    if (patch.dimStyle != null && e.type === 'dim'){
      const st = (state.dimStyles || []).find(s => s.name === patch.dimStyle);
      if (st) applyStyleToDim(e, st);
    }
    if (e.type === 'insert'){
      if (patch.width != null){
        e.width = snapWidth(Number(patch.width), e.def);
        if (e.host && e.cl) locateInsert(e, e.cl);
      }
      if (patch.swing) e.swing = patch.swing === 'R' ? 'R' : 'L';
      if (e.host) hosts.add(e.host);
    }
  });
  hosts.forEach(h => syncHostWall(state, h));
  afterChange();
  return true;
}

export function transformSelection(kind, p1, p2){
  const ms = selMembers(); if (!ms.length || !p1 || !p2) return;
  pushUndo();
  let copies;
  const hosts = new Set();
  const takeHost = e => { if (e.type === 'insert' && e.host) hosts.add(e.host); };
  if (kind === 'move'){
    copies = moveEntities(ms, p2[0] - p1[0], p2[1] - p1[1]);
    ms.forEach((e, i) => {
      takeHost(e);
      Object.assign(e, copies[i], { id: e.id, g: e.g });
      if (e.type === 'insert') detachInsert(e);
    });
  } else if (kind === 'copy'){
    copies = moveEntities(ms, p2[0] - p1[0], p2[1] - p1[1]);
    const gmap = {};
    copies.forEach(e => {
      if (e.type === 'insert') detachInsert(e);
      if (e.g){ if (!gmap[e.g]) gmap[e.g] = 'g' + (state.gSeq++); e.g = gmap[e.g]; }
      addEntity(e);
    });
    state.selIds = copies.map(e => e.id);
  } else if (kind === 'mirror'){
    copies = mirrorEntities(ms, p1[0], p1[1], p2[0], p2[1]);
    ms.forEach((e, i) => {
      takeHost(e);
      Object.assign(e, copies[i], { id: e.id, g: e.g });
      if (e.type === 'insert') detachInsert(e);
    });
  } else if (kind === 'rotate'){
    copies = rotateEntities(ms, p1[0], p1[1], state.rotateAngle);
    ms.forEach((e, i) => {
      takeHost(e);
      Object.assign(e, copies[i], { id: e.id, g: e.g });
      if (e.type === 'insert') detachInsert(e);
    });
  } else if (kind === 'scale'){
    const f = state.scaleFactor || (dist(p1[0], p1[1], p2[0], p2[1]) || 1);
    copies = scaleEntities(ms, p1[0], p1[1], f);
    ms.forEach((e, i) => {
      takeHost(e);
      Object.assign(e, copies[i], { id: e.id, g: e.g });
      if (e.type === 'insert') detachInsert(e);
    });
  }
  hosts.forEach(h => syncHostWall(state, h));
  rememberVec(p1, p2);
  afterChange();
}

export function applyArray(){
  const ms = selMembers(); if (!ms.length){ toast('Select objects first'); return; }
  const copies = rectangularArray(ms, state.arrayCols, state.arrayRows, state.arrayColDist, state.arrayRowDist, 0);
  pushUndo();
  const gmap = {};
  copies.forEach(e => {
    if (e.type === 'insert') detachInsert(e);
    if (e.g){ if (!gmap[e.g]) gmap[e.g] = 'g' + (state.gSeq++); e.g = gmap[e.g]; }
    addEntity(e);
  });
  afterChange();
  toast('Array ' + state.arrayCols + '×' + state.arrayRows);
}

export function applyPolarArray(cx, cy){
  const ms = selMembers(); if (!ms.length){ toast('Select objects first'); return; }
  const copies = polarArray(ms, cx, cy, state.arrayCount || 6, state.arrayFill == null ? 360 : state.arrayFill);
  pushUndo();
  const gmap = {};
  copies.forEach(e => {
    if (e.type === 'insert') detachInsert(e);
    if (e.g){ if (!gmap[e.g]) gmap[e.g] = 'g' + (state.gSeq++); e.g = gmap[e.g]; }
    addEntity(e);
  });
  afterChange();
  toast('Polar array ×' + (state.arrayCount || 6));
}

export function placeDoorOnWall(sx, sy, kind){
  const hit = hitTest(sx, sy);
  if (!hit || hit.kind !== 'wall' || !hit.g){ toast('Tap a wall'); return; }
  placeHostedInsert(hit, kind || 'door', S2W(sx, sy), 3, 'L');
}

export function explodeSelection(){
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  const add = [];
  const kill = [];
  ms.forEach(e => {
    if (e.type === 'insert'){
      expandInsert(e).forEach(f => add.push(f));
      kill.push(e.id);
    } else if (e.type === 'table'){
      tableFrags(e).forEach(f => add.push(f));
      kill.push(e.id);
    } else if (e.type === 'grid'){
      expandGrid(e).forEach(f => add.push(f));
      kill.push(e.id);
    } else if (e.type === 'room' || e.type === 'xline'){
      explodeForIO(e).forEach(f => add.push(f));
      kill.push(e.id);
    } else {
      delete e.g; delete e.kind; delete e.role;
    }
  });
  if (kill.length) deleteEntities(kill);
  add.forEach(f => addEntity(f));
  state.selIds = add.length ? add.map(f => f.id) : ms.filter(e => !kill.includes(e.id)).map(e => e.id);
  afterChange();
  toast('Exploded');
}

export function flipSelection(){
  const ms = selMembers();
  if (ms.length === 1 && ms[0].type === 'dim'){
    pushUndo(); ms[0].off = -ms[0].off; afterChange(); return;
  }
  const ins = ms.filter(e => e.type === 'insert');
  if (!ins.length) return;
  pushUndo();
  const hosts = new Set();
  ins.forEach(e => { flipInsert(e); if (e.host) hosts.add(e.host); });
  hosts.forEach(h => syncHostWall(state, h));
  afterChange();
}

export function rotateSelection90(){
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  const hosts = new Set();
  ms.forEach(e => { if (e.type === 'insert' && e.host) hosts.add(e.host); });
  rotateMembers(ms);
  hosts.forEach(h => syncHostWall(state, h));
  afterChange();
}

export function finishArc(){
  if (ix.arcPts.length < 3) return;
  const a = arcFrom3(ix.arcPts[0], ix.arcPts[1], ix.arcPts[2]);
  ix.arcPts = [];
  if (!a){ toast('Points are collinear'); return; }
  a.layer = state.currentLayer;
  pushUndo(); addEntity(a); afterChange();
}

/* Command-line commit: command alias, or numeric input for the live tool. */
export function commitTyped(text){
  const raw = String(text || '').trim();
  if (!raw) return false;
  pushCmd(raw);
  const cmd = lookupCommand(raw.split(/\s+/)[0]);
  if (cmd && cmd.tool){
    const rest = raw.slice(raw.indexOf(' ') + 1).trim();
    return { command: cmd.tool, rest: rest === raw ? '' : rest };
  }
  if (cmd && cmd.action) return { action: cmd.action };

  const tool = state.tool;
  /* Width of a selected door/window insert. */
  if (tool === 'select'){
    const ms = selMembers();
    if (ms.length === 1 && ms[0].type === 'insert' && (ms[0].def === 'door' || ms[0].def === 'window')){
      if (!raw.includes(',') && raw[0] !== '@' && raw[0] !== '#'){
        const n = parseLength(raw);
        if (isFinite(n) && n > 0){
          pushUndo();
          ms[0].width = snapWidth(n, ms[0].def);
          if (ms[0].host && ms[0].cl){ locateInsert(ms[0], ms[0].cl); syncHostWall(state, ms[0].host); }
          afterChange();
          toast('Width ' + fmtFtIn(ms[0].width));
          return { numeric: n };
        }
      }
    }
  }
  /* Numeric for fillet / chamfer / offset / scale / rotate / array */
  if (tool === 'fillet'){
    const n = parseLength(raw); if (isFinite(n) && n >= 0){ state.filletR = n; toast('Fillet radius ' + fmtFtIn(n)); return { numeric: n }; }
  }
  if (tool === 'chamfer'){
    const n = parseLength(raw); if (isFinite(n) && n >= 0){ state.chamferD = n; toast('Chamfer ' + fmtFtIn(n)); return { numeric: n }; }
  }
  if (tool === 'offset'){
    const n = parseLength(raw);
    if (isFinite(n) && n > 0){
      state.offsetDist = n;
      const i = OFFSETS.findIndex(x => Math.abs(x - n) < 1e-6);
      if (i >= 0) state.offIdx = i;
      toast('Offset ' + fmtFtIn(n));
      return { numeric: n };
    }
  }
  if (tool === 'scale'){
    const n = parseFloat(raw); if (isFinite(n) && n > 0){ state.scaleFactor = n; toast('Scale ×' + n); return { numeric: n }; }
  }
  if (tool === 'rotate'){
    const n = parseFloat(raw); if (isFinite(n)){ state.rotateAngle = n; toast('Rotate ' + n + '°'); return { numeric: n }; }
  }
  if (tool === 'array'){
    const parts = raw.split(/[,\s]+/).map(Number);
    if (parts.length >= 4 && parts.every(isFinite)){
      state.arrayCols = parts[0]; state.arrayRows = parts[1];
      state.arrayColDist = parts[2]; state.arrayRowDist = parts[3];
      applyArray();
      return { numeric: true };
    }
  }
  if (tool === 'arraypolar'){
    const parts = raw.split(/[,\s]+/).map(Number);
    if (parts.length >= 1 && isFinite(parts[0])){
      state.arrayCount = Math.max(2, parts[0] | 0);
      if (parts[1] != null && isFinite(parts[1])) state.arrayFill = parts[1];
      toast('Polar array ' + state.arrayCount + ' @ ' + (state.arrayFill || 360) + '°');
      return { numeric: true };
    }
  }
  if (tool === 'calibrate' && ix.calibratePts && ix.calibratePts.length === 2){
    const n = parseLength(raw);
    if (isFinite(n) && n > 0){
      applyCalibrate(n);
      return { numeric: n };
    }
  }

  const last = state.lastPt || (ix.drag && ix.drag.p1) || (ix.polyPts[ix.polyPts.length - 1]) || [0, 0];
  let rubber = null;
  if (ix.hoverPt && last) rubber = [ix.hoverPt[0] - last[0], ix.hoverPt[1] - last[1]];
  else if (ix.drag && ix.drag.p1 && ix.drag.p2) rubber = [ix.drag.p2[0] - ix.drag.p1[0], ix.drag.p2[1] - ix.drag.p1[1]];
  const pt = parsePoint(raw, last, rubber);
  if (pt) return { point: pt };
  toast('Cannot parse: ' + raw);
  return false;
}

export function cycleWallTh(){
  const cur = WALL_THICKNESS.findIndex(t => Math.abs(t.th - state.wallTh) < 1e-6);
  const next = WALL_THICKNESS[(cur + 1) % WALL_THICKNESS.length];
  state.wallTh = next.th;
  return next.label;
}

void SNAP_KIND; void entPoints; void layerLocked; void boxFromScreen; void continueDim;

export function applyStretchBox(s0, s1){
  ix.stretchBox = boxFromScreen(s0, s1, S2W);
  toast('Specify displacement base then destination');
}

export function applyStretchDisplacement(p1, p2){
  const box = ix.stretchBox;
  if (!box){ toast('Crossing-window the stretch box first'); return; }
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const pool = selMembers().length ? selMembers() : state.entities.filter(e => layerVisible(e.layer) && !layerLocked(e.layer));
  const n = stretchEntities(pool, box, dx, dy);
  ix.stretchBox = null;
  afterChange();
  toast(n ? ('Stretched ' + n + ' vertices') : 'Nothing in the stretch box');
}

export function matchTap(sx, sy){
  const h = hitTest(sx, sy);
  if (!h){ toast('Nothing there'); return; }
  if (!ix.matchSrc){
    ix.matchSrc = { layer: h.layer, lt: h.lt || 'CONTINUOUS', lw: h.lw || 0 };
    toast('Source: ' + h.layer + ' · tap objects to paint');
    return;
  }
  pushUndo();
  h.layer = ix.matchSrc.layer;
  if (!ix.matchSrc.lt || ix.matchSrc.lt === 'CONTINUOUS') delete h.lt;
  else h.lt = ix.matchSrc.lt;
  if (!ix.matchSrc.lw) delete h.lw;
  else h.lw = ix.matchSrc.lw;
  afterChange();
  toast('Matched ' + h.type);
}

export function areaTap(sx, sy){
  const h = hitTest(sx, sy);
  if (!h){ toast('Tap a hatch, polyline, circle or ellipse'); return; }
  const A = areaOf(h);
  toast(A ? (listEntity(h) + '  ·  ' + A.toFixed(2) + ' SF') : 'No area on ' + h.type, 4000);
}

export function listTap(sx, sy){
  const h = hitTest(sx, sy);
  toast(h ? listEntity(h) : 'Nothing', 4000);
}

export function idTap(sx, sy){
  const p = snapPt(sx, sy);
  toast(idPoint(p), 3500);
}

export function dimRadTap(sx, sy, diameter){
  const h = hitTest(sx, sy);
  if (!h || (h.type !== 'circle' && h.type !== 'arc' && h.type !== 'ellipse')){
    toast('Tap a circle, arc or ellipse');
    return;
  }
  const w = S2W(sx, sy);
  let cx = h.cx, cy = h.cy, rx, ry;
  if (h.type === 'ellipse'){ rx = h.rx || 1; ry = h.ry || 1; }
  else { rx = h.r; ry = h.r; }
  const dx = w[0] - cx, dy = w[1] - cy;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const rimX = cx + dx / L * rx, rimY = cy + dy / L * ry;
  pushUndo();
  const e = diameter
    ? diameterDim(cx, cy, rimX, rimY, currentDimStyleObj())
    : radiusDim(cx, cy, rimX, rimY, currentDimStyleObj());
  addEntity(e);
  afterChange();
}

export function finishDimAng(){
  if (ix.arcPts.length < 3) return;
  const [p1, v, p3] = ix.arcPts;
  ix.arcPts = [];
  pushUndo();
  addEntity(angularDim(p1, v, p3, 2.5, currentDimStyleObj()));
  afterChange();
}

export function placeScheduleAt(p, kind){
  kind = kind || ix.schedKind || 'door';
  tagInserts(state.entities);
  const e = buildSchedule(state.entities, kind, p);
  e.layer = 'SCHEDULES';
  pushUndo();
  addEntity(e);
  afterChange();
  toast(e.title + ' · ' + Math.max(0, (e.cells || []).length - 1) + ' rows');
}

export function placeAllSchedules(){
  tagInserts(state.entities);
  const bb = membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
  const x = bb[2] + 2;
  pushUndo();
  addEntity(Object.assign(buildSchedule(state.entities, 'door', [x, bb[3] - 1]), { layer: 'SCHEDULES' }));
  addEntity(Object.assign(buildSchedule(state.entities, 'window', [x, bb[3] - 10]), { layer: 'SCHEDULES' }));
  addEntity(Object.assign(buildSchedule(state.entities, 'room', [x, bb[1]]), { layer: 'SCHEDULES' }));
  afterChange();
  toast('Door, window and room schedules placed');
}

export function exportScheduleCSV(kind){
  tagInserts(state.entities);
  return scheduleCSV(state.entities, kind || 'door');
}

export function applyCleanup(){
  pushUndo();
  const res = healWalls(state.entities);
  if (!res.ok){
    toast('No wall joints to heal');
    return;
  }
  state.entities = res.entities;
  afterChange();
  toast('Healed ' + res.count + ' wall joint' + (res.count === 1 ? '' : 's'));
}

export function applyOverkill(){
  pushUndo();
  const res = overkill(state.entities);
  state.entities = res.entities;
  afterChange();
  toast(res.dropped ? ('OVERKILL dropped ' + res.dropped) : 'Nothing to drop');
}

export function applyRooms(){
  pushUndo();
  state.autoRooms = true;
  syncAutoRooms(state);
  afterChange();
  const n = state.entities.filter(e => e.type === 'room').length;
  toast(n ? (n + ' live room' + (n === 1 ? '' : 's') + ' — areas follow walls') : 'No closed wall loops yet');
}

export function applyTakeoff(){
  const bb = membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
  pushUndo();
  addEntity(Object.assign(buildTakeoffTable(state.entities, [bb[2] + 2, bb[3]]), { layer: 'SCHEDULES' }));
  afterChange();
  toast(takeoffSummary(state.entities));
}

export function applySheetSet(){
  if (!state.entities.length){ toast('Nothing to sheet yet'); return 0; }
  pushUndo();
  const layouts = generateSheetSet(state.entities, state.layers, { projectName: state.projectName });
  state.layouts = layouts;
  state.currentLayout = layouts[0].id;
  state.space = layouts[0].id;
  afterChange();
  try { document.dispatchEvent(new Event('sd-sheets-changed')); } catch (e){ /* node */ }
  toast(layouts.length + ' sheets — cover, overall, one page per section');
  return layouts.length;
}

export function layerIsolate(){
  const ms = selMembers();
  if (!ms.length){ toast('Select objects first'); return; }
  const keep = new Set(ms.map(e => e.layer));
  state.layerIsoPrev = state.layers.map(L => ({ name: L.name, visible: !!L.visible }));
  state.layers.forEach(L => { L.visible = keep.has(L.name); });
  afterChange();
  toast('Isolated ' + keep.size + ' layer' + (keep.size === 1 ? '' : 's'));
}

export function layerUnisolate(){
  if (!state.layerIsoPrev){ toast('Nothing isolated'); return; }
  const prev = {};
  state.layerIsoPrev.forEach(p => { prev[p.name] = p.visible; });
  state.layers.forEach(L => { if (L.name in prev) L.visible = prev[L.name]; });
  state.layerIsoPrev = null;
  afterChange();
  toast('Layers restored');
}

export function applyCalibrate(trueLen){
  const pts = ix.calibratePts;
  if (!pts || pts.length !== 2){ toast('Pick two points on the underlay first'); return; }
  const d = dist(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
  if (!d) return;
  const f = trueLen / d;
  const imgs = selMembers().filter(e => e.type === 'image');
  const pool = imgs.length ? imgs : state.entities.filter(e => e.type === 'image');
  if (!pool.length){ toast('No image underlay'); return; }
  pushUndo();
  pool.forEach(e => { e.w = (e.w || 1) * f; e.h = (e.h || 1) * f; });
  ix.calibratePts = [];
  afterChange();
  toast('Scaled ×' + f.toFixed(3));
}

void SNAP_KIND; void entPoints;

