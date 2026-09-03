/* Pointer, wheel and keyboard input. Touch: one finger draws, two fingers pan
 * and zoom. Desktop: scroll wheel zooms, middle-drag pans, keys switch tools.
 */
import { state, pushUndo, undoScope, doUndo, doRedo, afterChange, selMembers, currentDimStyleObj } from './core/state.js';
import { dist, clamp } from './core/geometry.js';
import { gripPts, translateEnt } from './core/entities.js';
import { fmtFtIn } from './core/format.js';
import { vp, W2S, S2W, zoomFit, zoomAt } from './core/viewport.js';
import { ix } from './interaction.js';
import { draw , paperZoomAt, paperPan, paperResetView} from './render/draw.js';
import {
  snapPt, applyConstraint, hitTest, cancelPoly, deleteSelection, placeSymbolAt,
  offsetTap, trimTap, extendTap, eraseTap, boxSelect, finishDraw, applyFillet,
  applyChamfer, applyJoin, hatchTap, transformSelection, applyArray, placeDoorOnWall,
  finishArc, commitTyped, closePoly, explodeSelection, flipSelection,
  applyStretchBox, matchTap, areaTap, listTap, idTap, dimRadTap, finishDimAng,
  placeScheduleAt, applyCleanup, applyOverkill, applyRooms, applyTakeoff,
  applySheetSet, layerIsolate, layerUnisolate, bindSelection,
  placeDatumAt, placeFinishAt, applyStoryHeight, beginHeightPrompt,
  addConstraint, solveConstraintsNow, deleteConstraintsOnSelection, solveAfterEdit,
  hatchIslandsFromSelection, arcSegTap, booleanOnSelection,
  saveLayerState, restoreLayerState, deleteLayerState, setPlotStyle,
  twistViewport, clipViewport,
  extrudeSelection, revolveSelection, loftSelection, clearSolids,
  toggleAnnotative, setAnnoScale, openScriptSheet, runSavedScript,
  makePrimitive, makeRoof, makeDrawings, makeStack, makePlans, makeRoofPlan, makeTakeoff3d, makeDormer,
  setSunStudy, setMaterial, requestRender, manageView3dCam, requestTurntable, requestWalk,
  sweepSelection, boolean3d, sliceSolid, listSolids, deleteSolid,
  makeElevation, modelPlan
} from './actions.js';
import { syncCtx, updateStatus, setPrompt } from './ui/chips.js';
import { setTool } from './ui/tools.js';
import { openSheet, closeSheets, anySheetOpen } from './ui/sheets.js';
import { toast } from './ui/toast.js';
import { lookupCommand, defaultPrompt, setKeymap, getKeymap } from './core/command.js';
import { continueDim, baselineDim } from './core/dimStyle.js';
import { addEntity } from './core/state.js';
import { paramOnCl, locateInsert, syncHostWall } from './core/dynblock.js';
import { bindAlignedDim } from './core/assoc.js';

function findGrip(sx, sy){
  const ms = selMembers();
  if (ms.length !== 1 || (ms[0].g && ms[0].type !== 'insert')) return null;
  const gs = gripPts(ms[0]);
  for (const g of gs){
    const s = W2S(g.x, g.y);
    if (dist(sx, sy, s[0], s[1]) < 15) return { gp: g, ent: ms[0] };
  }
  return null;
}

const DRAW_TOOLS = ['line', 'rect', 'circle', 'dim', 'dimali', 'measure', 'wall', 'ellipse', 'image', 'calibrate', 'xline', 'grid', 'arraypolar', 'section', 'detail', 'fcf', 'mtext'];
const TAP_TOOLS = ['erase', 'text', 'symbol', 'offset', 'trim', 'extend', 'match', 'area', 'list', 'id', 'dimrad', 'dimdia', 'schedule', 'datum', 'finish', 'arcseg', 'dormer'];
const TWO_PICK = ['fillet', 'chamfer', 'mirror', 'move', 'copy', 'rotate', 'scale'];
const POLY_TOOLS = ['poly', 'hatch', 'cloud', 'leader', 'spline'];

function onPointerDown(ev){
  const cv = ev.currentTarget;
  cv.setPointerCapture(ev.pointerId);
  if (ev.pointerType === 'mouse' && ev.button === 1){
    ix.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    ix.drag = { kind: 'pan', last: [ev.clientX, ev.clientY] };
    ev.preventDefault();
    return;
  }
  ix.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (ix.pointers.size === 2){
    ix.drag = null; ix.hoverPt = null; ix.snapMark = null;
    const pts = Array.from(ix.pointers.values());
    ix.gesture = {
      d0: dist(pts[0][0], pts[0][1], pts[1][0], pts[1][1]),
      c0: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2],
      scale0: state.view.scale
    };
    ix.gesture.w0 = S2W(ix.gesture.c0[0], ix.gesture.c0[1]);
    draw(); return;
  }
  if (ix.pointers.size > 2 || ix.gesture) return;
  if (state.space !== 'model'){
    /* A second tap in quick succession refits the sheet. */
    const now = Date.now();
    if (ix.paperTapAt && now - ix.paperTapAt < 320){ paperResetView(); draw(); ix.paperTapAt = 0; return; }
    ix.paperTapAt = now;
    ix.drag = { kind: 'paperpan', last: [ev.clientX, ev.clientY] };
    return;
  }

  const sx = ev.clientX, sy = ev.clientY;
  const tool = state.tool;
  if (tool === 'pan'){ ix.drag = { kind: 'pan', last: [sx, sy] }; return; }
  if (tool === 'select'){
    if (state.boxMode){ ix.drag = { kind: 'box', s0: [sx, sy], cur: null }; return; }
    const hitGrip = findGrip(sx, sy);
    if (hitGrip){
      if (hitGrip.gp.once){
        pushUndo();
        hitGrip.gp.apply();
        if (hitGrip.ent && hitGrip.ent.host) syncHostWall(state, hitGrip.ent.host);
        afterChange();
        return;
      }
      ix.drag = { kind: 'grip', gp: hitGrip.gp, ent: hitGrip.ent, moved: false };
      return;
    }
    const hit = hitTest(sx, sy);
    if (hit){ state.selIds = [hit.id]; ix.drag = { kind: 'move', last: S2W(sx, sy), moved: false, s0: [sx, sy] }; }
    else { ix.drag = { kind: 'panMaybe', last: [sx, sy], s0: [sx, sy], moved: false }; }
    syncCtx(); draw(); return;
  }
  if (tool === 'opening-door' || tool === 'opening-window'){
    ix.drag = { kind: 'opentap', s0: [sx, sy], opening: tool === 'opening-window' ? 'window' : 'door' };
    return;
  }
  if (TAP_TOOLS.includes(tool)){ ix.drag = { kind: tool + 'tap', s0: [sx, sy] }; return; }
  if (tool === 'join'){ ix.drag = { kind: 'jointap', s0: [sx, sy] }; return; }
  if (tool === 'hatch'){ ix.drag = { kind: 'hatchtap', s0: [sx, sy] }; return; }
  if (tool === 'array'){ ix.drag = { kind: 'arraytap', s0: [sx, sy] }; return; }
  if (tool === 'dimcont' || tool === 'dimbase'){ ix.drag = { kind: 'dimmore', s0: [sx, sy] }; return; }
  if (POLY_TOOLS.includes(tool)){
    ix.drag = { kind: 'polytap', s0: [sx, sy] };
    ix.hoverPt = applyConstraint(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
    draw(); return;
  }
  if (tool === 'arc' || tool === 'dimang'){
    ix.drag = { kind: 'arctap', s0: [sx, sy] };
    draw(); return;
  }
  if (tool === 'stretch'){
    if (ix.stretchBox){
      ix.drag = { kind: 'draw', p1: snapPt(sx, sy, state.lastPt), p2: null, s0: [sx, sy] };
    } else {
      ix.drag = { kind: 'stretchbox', s0: [sx, sy], cur: null };
    }
    draw(); return;
  }
  if (TWO_PICK.includes(tool)){
    if (tool === 'fillet' || tool === 'chamfer'){
      ix.drag = { kind: 'modpick', s0: [sx, sy] };
      return;
    }
    ix.drag = { kind: 'draw', p1: snapPt(sx, sy, state.lastPt), p2: null, s0: [sx, sy] };
    draw(); return;
  }
  ix.drag = { kind: 'draw', p1: snapPt(sx, sy, state.lastPt), p2: null, s0: [sx, sy] };
  draw();
}

function onPointerMove(ev){
  const sx = ev.clientX, sy = ev.clientY;
  if (!ix.pointers.has(ev.pointerId)){
    if (state.space === 'model'){
      const from = ix.polyPts[ix.polyPts.length - 1] || (ix.drag && ix.drag.p1) || state.lastPt;
      const p = applyConstraint(from || null, snapPt(sx, sy, from));
      ix.hoverPt = p;
      updateStatus(p);
      if (POLY_TOOLS.indexOf(state.tool) >= 0 && ix.polyPts.length) draw();
      else if (ev.pointerType === 'mouse' && ['line', 'rect', 'circle', 'dim', 'dimali', 'measure', 'symbol', 'wall', 'arc', 'mirror', 'move', 'copy', 'ellipse', 'image', 'stretch', 'dimang', 'xline', 'grid', 'arraypolar', 'section', 'detail', 'fcf'].includes(state.tool)) draw();
    }
    return;
  }
  ix.pointers.set(ev.pointerId, [sx, sy]);
  if (ix.gesture && ix.pointers.size >= 2 && state.space !== 'model'){
    const pts = Array.from(ix.pointers.values());
    const d = dist(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    const c = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const f = d / (ix.gesture.dPrev || ix.gesture.d0);
    ix.gesture.dPrev = d;
    paperZoomAt(c[0], c[1], f);
    if (ix.gesture.cPrev) paperPan(c[0] - ix.gesture.cPrev[0], c[1] - ix.gesture.cPrev[1]);
    ix.gesture.cPrev = c;
    draw(); return;
  }
  if (ix.gesture && ix.pointers.size >= 2){
    const pts = Array.from(ix.pointers.values());
    const d = dist(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    const c = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    state.view.scale = clamp(ix.gesture.scale0 * (d / ix.gesture.d0), 1.2, 400);
    state.view.x = ix.gesture.w0[0] - (c[0] - vp.CW / 2) / state.view.scale;
    state.view.y = ix.gesture.w0[1] - (vp.CH / 2 - c[1]) / state.view.scale;
    draw(); return;
  }
  if (!ix.drag) return;
  const drag = ix.drag;
  if (drag.kind === 'box'){ drag.cur = [sx, sy]; draw(); return; }
  if (drag.kind === 'stretchbox'){ drag.cur = [sx, sy]; draw(); return; }
  if (drag.kind === 'paperpan'){
    paperPan(sx - drag.last[0], sy - drag.last[1]);
    drag.last = [sx, sy]; draw(); return;
  }
  if (drag.kind === 'pan' || drag.kind === 'panMaybe'){
    const dx = sx - drag.last[0], dy = sy - drag.last[1];
    if (drag.kind === 'panMaybe' && !drag.moved && dist(sx, sy, drag.s0[0], drag.s0[1]) < 6) return;
    drag.moved = true;
    state.view.x -= dx / state.view.scale; state.view.y += dy / state.view.scale;
    drag.last = [sx, sy]; draw(); return;
  }
  if (drag.kind === 'grip'){
    if (!drag.moved){ pushUndo(undoScope(drag.ent ? [drag.ent.id] : [])); drag.moved = true; }
    drag.gp.apply(snapPt(sx, sy));
    if (drag.ent && drag.ent.host) syncHostWall(state, drag.ent.host);
    draw(); return;
  }
  if (drag.kind === 'move' && state.tool === 'select'){
    const w = S2W(sx, sy), ms = selMembers();
    if (!ms.length) return;
    if (!drag.moved){
      if (dist(sx, sy, drag.s0[0], drag.s0[1]) < 6) return;
      /* The scope is computed once, before anything moves, so the record
       * holds the pre edit copies of everything the drag can reach. */
      pushUndo(undoScope(ms.map(e => e.id))); drag.moved = true;
    }
    const hosted = ms.length === 1 && ms[0].type === 'insert' && ms[0].host && ms[0].cl;
    if (hosted){
      ms[0].t = paramOnCl(ms[0].cl, w);
      locateInsert(ms[0], ms[0].cl);
      syncHostWall(state, ms[0].host);
    } else {
      ms.forEach(e => translateEnt(e, w[0] - drag.last[0], w[1] - drag.last[1]));
    }
    drag.last = w; draw(); return;
  }
  if (drag.kind === 'draw'){
    drag.p2 = applyConstraint(drag.p1, snapPt(sx, sy, drag.p1));
    updateStatus(drag.p2, drag.p1);
    draw(); return;
  }
  if (drag.kind === 'polytap' || drag.kind === 'arctap'){
    ix.hoverPt = applyConstraint(ix.polyPts[ix.polyPts.length - 1] || ix.arcPts[ix.arcPts.length - 1] || null, snapPt(sx, sy));
    draw(); return;
  }
}

function endPointer(ev){
  const was = ix.pointers.has(ev.pointerId);
  ix.pointers.delete(ev.pointerId);
  if (ix.gesture){ if (ix.pointers.size === 0) ix.gesture = null; ix.drag = null; return; }
  if (!was || !ix.drag){ ix.drag = null; return; }
  const drag = ix.drag;
  const sx = ev.clientX, sy = ev.clientY;
  const tool = state.tool;

  if (drag.kind === 'box'){
    const moved = drag.cur && dist(drag.cur[0], drag.cur[1], drag.s0[0], drag.s0[1]) > 6;
    if (moved) boxSelect(drag.s0, drag.cur);
    else {
      const h = hitTest(sx, sy);
      state.selIds = h ? [h.id] : [];
    }
    state.boxMode = false; syncCtx();
  }
  else if (drag.kind === 'stretchbox'){
    const moved = drag.cur && dist(drag.cur[0], drag.cur[1], drag.s0[0], drag.s0[1]) > 6;
    if (moved) applyStretchBox(drag.s0, drag.cur);
    else toast('Drag a crossing box');
  }
  else if (drag.kind === 'panMaybe' && !drag.moved){ state.selIds = []; syncCtx(); }
  else if (drag.kind === 'opentap'){
    placeDoorOnWall(sx, sy, drag.opening);
    state.tool = 'select';
    syncCtx();
  }
  else if (drag.kind === 'erasetap'){ eraseTap(sx, sy); }
  else if (drag.kind === 'matchtap'){ matchTap(sx, sy); }
  else if (drag.kind === 'areatap'){ areaTap(sx, sy); }
  else if (drag.kind === 'arcsegtap'){ arcSegTap(sx, sy); }
  else if (drag.kind === 'listtap'){ listTap(sx, sy); }
  else if (drag.kind === 'idtap'){ idTap(sx, sy); }
  else if (drag.kind === 'dimradtap'){ dimRadTap(sx, sy, false); }
  else if (drag.kind === 'dimdiatap'){ dimRadTap(sx, sy, true); }
  else if (drag.kind === 'scheduletap'){ placeScheduleAt(snapPt(sx, sy), ix.schedKind); }
  else if (drag.kind === 'texttap'){
    const p = snapPt(sx, sy);
    ix.pendingText = p;
    ix.pendingTextPt = p;
    ix.editTextId = null;
    const el = document.getElementById('txtval'); if (el) el.value = '';
    openSheet('sheetText');
    setTimeout(() => { const t = document.getElementById('txtval'); if (t) t.focus(); }, 200);
  }
  else if (drag.kind === 'dormertap'){
    /* The tap is the point on the roof, in plan; width defaults to 6 ft
     * and DORMER x y w on the command line still takes exact numbers. */
    const p = snapPt(sx, sy);
    makeDormer(p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ' 6');
  }
  else if (drag.kind === 'datumtap'){ placeDatumAt(snapPt(sx, sy)); }
  else if (drag.kind === 'finishtap'){ placeFinishAt(snapPt(sx, sy)); }
  else if (drag.kind === 'symboltap'){ placeSymbolAt(sx, sy); }
  else if (drag.kind === 'offsettap'){ offsetTap(sx, sy); }
  else if (drag.kind === 'trimtap'){ trimTap(sx, sy); }
  else if (drag.kind === 'extendtap'){ extendTap(sx, sy); }
  else if (drag.kind === 'jointap'){
    const h = hitTest(sx, sy);
    if (h){ state.selIds = state.selIds.concat([h.id]); syncCtx(); toast('Added to join set — Enter to join'); }
  }
  else if (drag.kind === 'hatchtap'){ hatchTap(sx, sy); syncCtx(); }
  else if (drag.kind === 'arraytap'){
    const h = hitTest(sx, sy);
    if (h){ state.selIds = [h.id]; applyArray(); }
  }
  else if (drag.kind === 'dimmore'){
    const p = snapPt(sx, sy);
    const style = currentDimStyleObj();
    if (tool === 'dimcont' && ix.dimLast){
      pushUndo(undoScope([])); const e = continueDim(ix.dimLast, p, style); bindAlignedDim(e, state.entities); addEntity(e); ix.dimLast = e; afterChange();
    } else if (tool === 'dimbase' && ix.dimBase){
      pushUndo(undoScope([])); const e = baselineDim(ix.dimBase, p, style); bindAlignedDim(e, state.entities); addEntity(e); afterChange();
    } else toast('Place a linear dimension first');
  }
  else if (drag.kind === 'modpick'){
    const h = hitTest(sx, sy);
    if (!h || h.type !== 'line'){ toast('Pick a line'); }
    else if (!ix.modA){ ix.modA = h; ix.modP1 = S2W(sx, sy); toast('Pick second line'); }
    else {
      if (tool === 'fillet') applyFillet(ix.modA, h, ix.modP1, S2W(sx, sy));
      else applyChamfer(ix.modA, h, ix.modP1, S2W(sx, sy));
      ix.modA = null; ix.modP1 = null;
    }
  }
  else if (drag.kind === 'polytap'){
    const p = applyConstraint(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
    ix.polyPts.push(p); ix.hoverPt = null; state.lastPt = p; syncCtx();
  }
  else if (drag.kind === 'arctap'){
    const p = applyConstraint(ix.arcPts[ix.arcPts.length - 1] || null, snapPt(sx, sy));
    ix.arcPts.push(p); state.lastPt = p;
    if (ix.arcPts.length >= 3){
      if (tool === 'dimang') finishDimAng();
      else finishArc();
    } else setPrompt(ix.arcPts.length === 1
      ? (tool === 'dimang' ? 'DIMANGULAR Specify vertex:' : 'ARC Specify second point:')
      : (tool === 'dimang' ? 'DIMANGULAR Specify second endpoint:' : 'ARC Specify end point:'));
  }
  else if (drag.kind === 'draw' && drag.p2){
    if (TWO_PICK.includes(tool) && tool !== 'fillet' && tool !== 'chamfer'){
      transformSelection(tool, drag.p1, drag.p2);
    } else {
      const t = (tool === 'line' && state.wallMode) ? 'wall' : tool;
      finishDraw(drag.p1, drag.p2, t);
      /* A paragraph column is picked before its words exist, so the text
       * prompt comes up as soon as the drag lands. */
      if (t === 'mtext' && ix.pendingMText){
        const el = document.getElementById('txtval'); if (el) el.value = '';
        openSheet('sheetText');
        setTimeout(() => { const f = document.getElementById('txtval'); if (f) f.focus(); }, 200);
      }
    }
  }
  else if (drag.kind === 'grip' && drag.moved){
    if (drag.ent && drag.ent.host) syncHostWall(state, drag.ent.host);
    /* Constrained geometry keeps its rules through a grip edit. */
    solveAfterEdit(drag.ent ? [drag.ent.id] : null);
    afterChange();
  }
  else if (drag.kind === 'move' && drag.moved){
    solveAfterEdit(selMembers().map(e => e.id));
    afterChange();
  }
  ix.drag = null; ix.snapMark = null; draw();
}

function onWheel(ev){
  ev.preventDefault();
  const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
  if (state.space !== 'model') paperZoomAt(ev.clientX, ev.clientY, f);
  else zoomAt(ev.clientX, ev.clientY, f);
  draw();
}

/* Under KEYMAP ACAD the four letters an AutoCAD hand types without
 * thinking do what that hand expects; every other key is shared. */
const ACAD_KEYS = {
  e: () => setTool('erase'),
  m: () => setTool('move'),
  u: () => doUndo(),
  x: () => handleCommand('EXPLODE'),
};

const TOOL_KEYS = {
  v: 'select', h: 'pan', l: 'line', p: 'poly', r: 'rect', c: 'circle',
  a: 'arc', s: 'symbol', o: 'offset', x: 'trim', e: 'extend', d: 'dim', m: 'measure',
  t: 'text', q: 'erase', b: 'fillet', n: 'chamfer', i: 'mirror', g: 'scale',
  w: 'move', u: 'copy', y: 'array', j: 'join', k: 'hatch'
};

function cmdFocused(){
  const el = document.getElementById('cmdinput');
  return el && document.activeElement === el;
}

function onKeyDown(ev){
  if (ev.target.tagName === 'TEXTAREA' || (ev.target.tagName === 'INPUT' && ev.target.id !== 'cmdinput') || ev.target.tagName === 'SELECT') return;
  if (ev.key === '/' && !cmdFocused() && !ev.ctrlKey && !ev.metaKey){
    ev.preventDefault();
    const el = document.getElementById('cmdinput');
    if (el){ el.focus(); el.select(); }
    return;
  }
  if (cmdFocused()){
    if (ev.key === 'Escape'){ ev.target.blur(); cancelLive(); return; }
    if (ev.key === 'Enter'){ ev.preventDefault(); handleCommand(ev.target.value); ev.target.value = ''; }
    /* Undo and redo work with an empty command line focused. Running a
     * command leaves the input focused, and swallowing ctrl-z there
     * means the undo a user reaches for right after a command silently
     * does nothing. With text in the box the browser's own text undo
     * keeps the keys. */
    const ck = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && (ck === 'z' || ck === 'y') && !ev.target.value){
      ev.preventDefault();
      if (ck === 'z' && !ev.shiftKey) doUndo();
      else doRedo();
    }
    return;
  }
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey){ ev.preventDefault(); doUndo(); }
  else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))){ ev.preventDefault(); doRedo(); }
  else if ((ev.ctrlKey || ev.metaKey) && k === 'o'){
    ev.preventDefault();
    const el = document.getElementById('fileOpen');
    if (el) el.click();
  }
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selIds.length){ deleteSelection(); }
  else if (ev.key === 'Escape'){
    if (anySheetOpen()){ closeSheets(); return; }
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('view3d')){
      try { document.dispatchEvent(new Event('sd-view2d')); } catch (e){ /* node */ }
      return;
    }
    cancelLive();
  }
  else if (ev.key === 'Enter'){
    if (state.tool === 'select' && state.lastTool){ setTool(state.lastTool); }
    else if ((state.tool === 'poly' || state.tool === 'spline') && ix.polyPts.length > 1) cancelPoly(true);
    else if ((state.tool === 'cloud' || state.tool === 'leader') && ix.polyPts.length > 1){
      if (state.tool === 'cloud') closePoly();
      else cancelPoly(true);
      if (state.tool === 'leader' && ix.pendingLeader){
        const el = document.getElementById('txtval'); if (el) el.value = '';
        openSheet('sheetText');
        setTimeout(() => { const t = document.getElementById('txtval'); if (t) t.focus(); }, 200);
      }
    }
    else if ((state.tool === 'hatch' || state.tool === 'spline') && ix.polyPts.length > 2 && ev.shiftKey){ closePoly(); }
    else if (state.tool === 'hatch' && ix.polyPts.length > 2){ closePoly(); }
    else if (state.tool === 'join') applyJoin();
    else if (state.tool === 'array') applyArray();
  }
  else if (ev.key === 'F3'){ ev.preventDefault(); state.snapOn = !state.snapOn; syncCtx(); toast(state.snapOn ? 'SNAP on' : 'SNAP off'); }
  else if (ev.key === 'F8'){ ev.preventDefault(); state.orthoOn = !state.orthoOn; if (state.orthoOn) state.polarOn = false; syncCtx(); toast(state.orthoOn ? 'ORTHO on' : 'ORTHO off'); }
  else if (ev.key === 'F10'){ ev.preventDefault(); state.polarOn = !state.polarOn; if (state.polarOn) state.orthoOn = false; syncCtx(); toast(state.polarOn ? 'POLAR 15° on' : 'POLAR off'); }
  else if (ev.key === 'PageDown' || ev.key === 'PageUp'){
    ev.preventDefault();
    const layouts = state.layouts || [];
    if (!layouts.length) return;
    if (state.space === 'model'){
      if (ev.key === 'PageDown'){
        state.currentLayout = layouts[0].id;
        state.space = layouts[0].id;
      }
    } else {
      const i = layouts.findIndex(L => L.id === state.currentLayout);
      const next = ev.key === 'PageDown' ? Math.min(layouts.length - 1, i + 1) : (i <= 0 ? -1 : i - 1);
      if (next < 0) state.space = 'model';
      else {
        state.currentLayout = layouts[next].id;
        state.space = layouts[next].id;
      }
    }
    try { document.dispatchEvent(new Event('sd-sheets-changed')); } catch (e){ /* node */ }
    syncCtx(); draw();
  }
  else if ((ev.key === ' ' || ev.code === 'Space') && (state.tool === 'select' || state.tool === 'pan') && state.lastTool){
    ev.preventDefault();
    setTool(state.lastTool);
  }
  else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey){
    if (k === 'f'){ zoomFit(); draw(); }
    else if (isNumericStart(ev.key) && isLiveCommand()){
      const el = document.getElementById('cmdinput');
      if (el){ el.value = ev.key; el.focus(); }
      ev.preventDefault();
    }
    else if (getKeymap() === 'acad' && ACAD_KEYS[k]){ ACAD_KEYS[k](); }
    else if (TOOL_KEYS[k]){ setTool(TOOL_KEYS[k]); }
  }
}

function isNumericStart(k){
  return k === '@' || k === '#' || k === '-' || k === '.' || (k >= '0' && k <= '9');
}
function isLiveCommand(){
  if (state.tool === 'select'){
    const ms = selMembers();
    if (ms.length === 1 && ms[0].type === 'insert' && (ms[0].def === 'door' || ms[0].def === 'window')) return true;
  }
  return DRAW_TOOLS.includes(state.tool) || TWO_PICK.includes(state.tool) || POLY_TOOLS.includes(state.tool) || state.tool === 'arc' || state.tool === 'offset' || state.tool === 'fillet' || state.tool === 'chamfer' || state.tool === 'scale' || state.tool === 'rotate' || state.tool === 'stretch' || state.tool === 'calibrate' || state.tool === 'dimang';
}

function cancelLive(){
  cancelPoly(false); ix.arcPts = []; ix.modA = null; state.selIds = []; state.boxMode = false;
  ix.drag = null; ix.stretchBox = null; ix.matchSrc = null; ix.calibratePts = [];
  syncCtx(); setPrompt('Command:'); draw();
}

export function handleCommand(text){
  const res = commitTyped(text);
  if (!res) return;
  if (res.command){
    if (res.command === 'schedule'){
      if (res.rest){
        const k = res.rest.toLowerCase();
        ix.schedKind = k.indexOf('win') >= 0 ? 'window' : (k.indexOf('room') >= 0 ? 'room' : 'door');
      }
      setTool('schedule');
      return;
    }
    setTool(res.command);
    if (res.rest) handleCommand(res.rest);
    return;
  }
  if (res.action && res.action.indexOf('con:') === 0){ addConstraint(res.action.slice(4), res.rest); return; }
  if (res.action === 'csolve'){ solveConstraintsNow(); return; }
  if (res.action === 'cdel'){ deleteConstraintsOnSelection(); return; }
  if (res.action === 'bhatch'){ hatchIslandsFromSelection(); return; }
  if (res.action && res.action.indexOf('bool:') === 0){ booleanOnSelection(res.action.slice(5)); return; }
  if (res.action === 'laysave'){ saveLayerState(res.rest); return; }
  if (res.action === 'layrest'){ restoreLayerState(res.rest); return; }
  if (res.action === 'laydel'){ deleteLayerState(res.rest); return; }
  if (res.action === 'plotstyle'){ setPlotStyle(res.rest); return; }
  if (res.action === 'vptwist'){ twistViewport(res.rest); return; }
  if (res.action === 'vpclip'){ clipViewport(res.rest); return; }
  if (res.action === 'extrude3d'){ extrudeSelection(res.rest); return; }
  if (res.action === 'revolve3d'){ revolveSelection(res.rest); return; }
  if (res.action === 'loft3d'){ loftSelection(); return; }
  if (res.action === 'clearsolids'){ clearSolids(); return; }
  if (res.action === 'anno'){ toggleAnnotative(); return; }
  if (res.action === 'annoscale'){ setAnnoScale(res.rest); return; }
  if (res.action === 'script'){ openScriptSheet(); return; }
  if (res.action === 'runscript'){ runSavedScript(res.rest); return; }
  if (res.action && res.action.indexOf('prim:') === 0){ makePrimitive(res.action.slice(5), res.rest); return; }
  if (res.action === 'roof'){ makeRoof(res.rest); return; }
  if (res.action === 'drawings'){ makeDrawings(res.rest); return; }
  if (res.action === 'stack'){ makeStack(res.rest); return; }
  if (res.action === 'plans'){ makePlans(); return; }
  if (res.action === 'roofplan'){ makeRoofPlan(); return; }
  if (res.action === 'takeoff3d'){ makeTakeoff3d(); return; }
  if (res.action === 'dormer'){
    if (String(res.rest || '').trim()) makeDormer(res.rest);
    else setTool('dormer');
    return;
  }
  if (res.action === 'sun'){ setSunStudy(res.rest); return; }
  if (res.action === 'mat'){ setMaterial(res.rest); return; }
  if (res.action === 'render'){ requestRender(res.rest); return; }
  if (res.action === 'view3dcam'){ manageView3dCam(res.rest); return; }
  if (res.action === 'turntable'){ requestTurntable(res.rest); return; }
  if (res.action === 'walk'){ requestWalk(res.rest); return; }
  if (res.action === 'sweep3d'){ sweepSelection(res.rest); return; }
  if (res.action && res.action.indexOf('bool3d:') === 0){ boolean3d(res.action.slice(7), res.rest); return; }
  if (res.action === 'slice3d'){ sliceSolid(res.rest); return; }
  if (res.action === 'solids'){ listSolids(); return; }
  if (res.action === 'soliddel'){ deleteSolid(res.rest); return; }
  if (res.action === 'elev'){ makeElevation(res.rest); return; }
  if (res.action === 'modelplan'){ modelPlan(); return; }
  if (res.action === 'zoomfit'){ zoomFit(); draw(); return; }
  if (res.action === 'guide'){
    try { window.open('guide.html', '_blank'); } catch (e){ toast('The guide lives at guide.html'); }
    return;
  }
  if (res.action === 'undo'){ doUndo(); return; }
  if (res.action === 'redo'){ doRedo(); return; }
  if (res.action === 'keymap'){
    const want = /ACAD/i.test(res.rest || '') ? 'acad' : (/SD|SOVEREIGN|DEFAULT/i.test(res.rest || '') ? 'sd' : null);
    if (!want){ toast('KEYMAP ACAD for AutoCAD keys (E erase, M move, U undo, X explode) · KEYMAP SD restores'); return; }
    setKeymap(want);
    try { localStorage.setItem('sd-keymap', want); } catch (e){ /* private mode */ }
    toast(want === 'acad' ? 'ACAD keymap: E erase · M move · U undo · X explode' : 'Sovereign keymap restored');
    return;
  }
  if (res.action === 'explode'){ explodeSelection(); return; }
  if (res.action === 'flip'){ flipSelection(); return; }
  if (res.action === 'cleanup'){ applyCleanup(); return; }
  if (res.action === 'overkill'){ applyOverkill(); return; }
  if (res.action === 'rooms'){ applyRooms(); return; }
  if (res.action === 'takeoff'){ applyTakeoff(); return; }
  if (res.action === 'sheetset'){ applySheetSet(); return; }
  if (res.action === 'xref'){
    const el = document.getElementById('fileXref');
    if (el) el.click();
    return;
  }
  if (res.action === 'bind'){ bindSelection(); return; }
  if (res.action === 'layiso'){ layerIsolate(); return; }
  if (res.action === 'layuniso'){ layerUnisolate(); return; }
  if (res.action === 'open'){
    const el = document.getElementById('fileOpen');
    if (el) el.click();
    return;
  }
  if (res.action === 'dxfin'){
    const el = document.getElementById('fileDXF');
    if (el) el.click();
    return;
  }
  if (res.action === 'svg'){
    try { document.dispatchEvent(new Event('sd-export-svg')); } catch (e){ /* node */ }
    return;
  }
  if (res.action === 'view3d'){
    try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ }
    return;
  }
  if (res.action === 'view2d'){
    try { document.dispatchEvent(new Event('sd-view2d')); } catch (e){ /* node */ }
    return;
  }
  if (res.action === 'height'){
    if (res.rest) applyStoryHeight(res.rest);
    else {
      beginHeightPrompt();
      setPrompt('HEIGHT Specify story height <' + fmtFtIn(state.storyHeight || 8) + '>:');
    }
    return;
  }
  if (res.action === 'dwgout'){
    try { document.dispatchEvent(new Event('sd-export-dwg')); } catch (e){ /* node */ }
    return;
  }
  if (res.numeric != null){ syncCtx(); setPrompt(defaultPrompt(state.tool, state)); return; }
  if (res.point){
    const p = applyConstraint(state.lastPt, res.point);
    if (POLY_TOOLS.includes(state.tool) || state.tool === 'hatch'){
      ix.polyPts.push(p); state.lastPt = p; syncCtx(); draw(); return;
    }
    if (state.tool === 'arc' || state.tool === 'dimang'){
      ix.arcPts.push(p); state.lastPt = p;
      if (ix.arcPts.length >= 3){
        if (state.tool === 'dimang') finishDimAng();
        else finishArc();
      }
      draw(); return;
    }
    if (ix.drag && ix.drag.kind === 'draw' && ix.drag.p1){
      finishDraw(ix.drag.p1, p, state.tool === 'line' && state.wallMode ? 'wall' : state.tool);
      ix.drag = null; draw(); return;
    }
    if (state.lastPt && DRAW_TOOLS.includes(state.tool)){
      finishDraw(state.lastPt, p, state.tool === 'line' && state.wallMode ? 'wall' : state.tool);
      draw(); return;
    }
    state.lastPt = p;
    ix.drag = { kind: 'draw', p1: p, p2: null, s0: [0, 0] };
    setPrompt(defaultPrompt(state.tool, state));
    draw();
  }
}

function preventMenu(ev){ ev.preventDefault(); }

export function bindInput(cv){
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', preventMenu);
  try {
    const savedMap = localStorage.getItem('sd-keymap');
    if (savedMap) setKeymap(savedMap);
  } catch (e){ /* private mode */ }
  document.addEventListener('keydown', onKeyDown);
  return function unbind(){
    cv.removeEventListener('pointerdown', onPointerDown);
    cv.removeEventListener('pointermove', onPointerMove);
    cv.removeEventListener('pointerup', endPointer);
    cv.removeEventListener('pointercancel', endPointer);
    cv.removeEventListener('wheel', onWheel);
    cv.removeEventListener('contextmenu', preventMenu);
    document.removeEventListener('keydown', onKeyDown);
  };
}
