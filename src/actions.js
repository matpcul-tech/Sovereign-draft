/* Document-level actions shared by pointer input, keyboard shortcuts and the
 * chip/button UI. Everything that mutates the drawing goes through here so
 * undo, autosave and redraw stay consistent.
 */
import { state, layerByName, layerVisible, pushUndo, afterChange, selMembers, addEntity, deleteEntities, replaceEntity, replaceMany, GRID_SNAP, OFFSETS, POLAR_STEP, rememberVec, pushCmd, currentDimStyleObj } from './core/state.js';
import { deep, dist, polarSnap } from './core/geometry.js';
import { entPoints, entHit, translateEnt, membersBBox, entBBox, rotateMembers } from './core/entities.js';
import { offsetEntity } from './core/offset.js';
import { trimEntity, extendEntity } from './core/trimExtend.js';
import { SYMBOLS } from './core/symbols.js';
import { W2S, S2W } from './core/viewport.js';
import { ix } from './interaction.js';
import { toast } from './ui/toast.js';
import { fmtFtIn, parseLength, parsePoint } from './core/format.js';
import { allSnapCandidates, SNAP_KIND } from './core/osnap.js';
import { filletLines, chamferLines, arcFrom3, moveEntities, rotateEntities, scaleEntities, mirrorEntities, rectangularArray, joinEntities } from './core/modify.js';
import { wallFrags, WALL_THICKNESS } from './core/walls.js';
import { makeHatch, boundaryContaining, HATCH_PATTERNS } from './core/hatch.js';
import { alignedDim, continueDim, baselineDim, applyStyleToDim } from './core/dimStyle.js';
import { lookupCommand } from './core/command.js';
import {
  makeInsert, locateInsert, clFromMembers, syncHostWall, snapWidth,
  expandInsert, flipInsert, detachInsert, paramOnCl
} from './core/dynblock.js';

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
  if (dist(p1[0], p1[1], p2[0], p2[1]) < 0.05) return;
  pushUndo();
  if (tool === 'line') addEntity({ type: 'line', layer: state.currentLayer, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
  else if (tool === 'rect') addEntity({ type: 'poly', layer: state.currentLayer, closed: true, pts: [[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]] });
  else if (tool === 'circle') addEntity({ type: 'circle', layer: state.currentLayer, cx: p1[0], cy: p1[1], r: dist(p1[0], p1[1], p2[0], p2[1]) });
  else if (tool === 'dim' || tool === 'dimali'){
    const e = alignedDim(p1, p2, currentDimStyleObj().offset, currentDimStyleObj());
    addEntity(e);
    ix.dimLast = e; ix.dimBase = e;
  }
  else if (tool === 'wall' || (tool === 'line' && state.wallMode)){
    const g = 'g' + (state.gSeq++);
    wallFrags(p1[0], p1[1], p2[0], p2[1], state.wallTh, 'WALLS').forEach(f => { f.g = g; addEntity(f); });
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

void SNAP_KIND; void entPoints;
