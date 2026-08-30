/* Pointer, wheel and keyboard input. Touch: one finger draws, two fingers pan
 * and zoom. Desktop: scroll wheel zooms, middle-drag pans, keys switch tools.
 */
import { state, pushUndo, doUndo, doRedo, afterChange, selMembers } from './core/state.js';
import { dist, clamp } from './core/geometry.js';
import { gripPts, translateEnt } from './core/entities.js';
import { fmtFtIn } from './core/format.js';
import { vp, W2S, S2W, zoomFit, zoomAt } from './core/viewport.js';
import { ix } from './interaction.js';
import { draw } from './render/draw.js';
import { snapPt, applyOrtho, hitTest, cancelPoly, deleteSelection, placeSymbolAt, offsetTap, trimTap, extendTap, eraseTap, boxSelect } from './actions.js';
import { syncCtx } from './ui/chips.js';
import { setTool } from './ui/tools.js';
import { openSheet, closeSheets, anySheetOpen } from './ui/sheets.js';
import { toast } from './ui/toast.js';

function findGrip(sx, sy){
  const ms = selMembers();
  if (ms.length !== 1 || ms[0].g) return null;
  const gs = gripPts(ms[0]);
  for (const g of gs){
    const s = W2S(g.x, g.y);
    if (dist(sx, sy, s[0], s[1]) < 15) return g;
  }
  return null;
}

function onPointerDown(ev){
  const cv = ev.currentTarget;
  cv.setPointerCapture(ev.pointerId);
  // Middle mouse button always pans, whatever the active tool.
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

  const sx = ev.clientX, sy = ev.clientY;
  const tool = state.tool;
  if (tool === 'pan'){ ix.drag = { kind: 'pan', last: [sx, sy] }; return; }
  if (tool === 'select'){
    if (state.boxMode){ ix.drag = { kind: 'box', s0: [sx, sy], cur: null }; return; }
    const gp = findGrip(sx, sy);
    if (gp){ ix.drag = { kind: 'grip', gp, moved: false }; return; }
    const hit = hitTest(sx, sy);
    if (hit){ state.selIds = [hit.id]; ix.drag = { kind: 'move', last: S2W(sx, sy), moved: false, s0: [sx, sy] }; }
    else { ix.drag = { kind: 'panMaybe', last: [sx, sy], s0: [sx, sy], moved: false }; }
    syncCtx(); draw(); return;
  }
  if (tool === 'erase'){ ix.drag = { kind: 'erase', s0: [sx, sy] }; return; }
  if (tool === 'text'){ ix.drag = { kind: 'text', s0: [sx, sy] }; return; }
  if (tool === 'symbol'){ ix.drag = { kind: 'symtap', s0: [sx, sy] }; return; }
  if (tool === 'offset'){ ix.drag = { kind: 'offtap', s0: [sx, sy] }; return; }
  if (tool === 'trim'){ ix.drag = { kind: 'trimtap', s0: [sx, sy] }; return; }
  if (tool === 'extend'){ ix.drag = { kind: 'exttap', s0: [sx, sy] }; return; }
  if (tool === 'poly'){
    ix.drag = { kind: 'polytap', s0: [sx, sy] };
    ix.hoverPt = applyOrtho(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
    draw(); return;
  }
  ix.drag = { kind: 'draw', p1: snapPt(sx, sy), p2: null, s0: [sx, sy] };
  draw();
}

function onPointerMove(ev){
  if (!ix.pointers.has(ev.pointerId)){
    // Hover previews for mouse: rubber-band the next poly segment, and show
    // the snap marker for drawing tools.
    if (state.tool === 'poly' && ix.polyPts.length && ix.pointers.size === 0){
      ix.hoverPt = applyOrtho(ix.polyPts[ix.polyPts.length - 1], snapPt(ev.clientX, ev.clientY));
      draw();
    } else if (ev.pointerType === 'mouse' && ix.pointers.size === 0 &&
               ['line', 'rect', 'circle', 'dim', 'measure', 'symbol'].includes(state.tool)){
      snapPt(ev.clientX, ev.clientY);
      draw();
    }
    return;
  }
  ix.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
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
  const sx = ev.clientX, sy = ev.clientY;
  if (drag.kind === 'box'){ drag.cur = [sx, sy]; draw(); return; }
  if (drag.kind === 'pan' || drag.kind === 'panMaybe'){
    const dx = sx - drag.last[0], dy = sy - drag.last[1];
    if (drag.kind === 'panMaybe' && !drag.moved && dist(sx, sy, drag.s0[0], drag.s0[1]) < 6) return;
    drag.moved = true;
    state.view.x -= dx / state.view.scale; state.view.y += dy / state.view.scale;
    drag.last = [sx, sy]; draw(); return;
  }
  if (drag.kind === 'grip'){
    if (!drag.moved){ pushUndo(); drag.moved = true; }
    drag.gp.apply(snapPt(sx, sy));
    draw(); return;
  }
  if (drag.kind === 'move'){
    const w = S2W(sx, sy), ms = selMembers();
    if (!ms.length) return;
    if (!drag.moved){
      if (dist(sx, sy, drag.s0[0], drag.s0[1]) < 6) return;
      pushUndo(); drag.moved = true;
    }
    ms.forEach(e => translateEnt(e, w[0] - drag.last[0], w[1] - drag.last[1]));
    drag.last = w; draw(); return;
  }
  if (drag.kind === 'draw'){
    drag.p2 = applyOrtho(drag.p1, snapPt(sx, sy));
    draw(); return;
  }
  if (drag.kind === 'polytap'){
    ix.hoverPt = applyOrtho(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
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

  if (drag.kind === 'box'){
    const moved = drag.cur && dist(drag.cur[0], drag.cur[1], drag.s0[0], drag.s0[1]) > 6;
    if (moved){
      boxSelect(drag.s0, drag.cur);
    } else {
      const h = hitTest(sx, sy);
      state.selIds = h ? [h.id] : [];
    }
    state.boxMode = false; syncCtx();
  }
  else if (drag.kind === 'panMaybe' && !drag.moved){ state.selIds = []; syncCtx(); }
  else if (drag.kind === 'erase'){ eraseTap(sx, sy); }
  else if (drag.kind === 'text'){
    ix.pendingTextPt = snapPt(sx, sy); ix.editTextId = null;
    document.getElementById('txtval').value = '';
    openSheet('sheetText');
    setTimeout(() => document.getElementById('txtval').focus(), 300);
  }
  else if (drag.kind === 'symtap'){ placeSymbolAt(sx, sy); }
  else if (drag.kind === 'offtap'){ offsetTap(sx, sy); }
  else if (drag.kind === 'trimtap'){ trimTap(sx, sy); }
  else if (drag.kind === 'exttap'){ extendTap(sx, sy); }
  else if (drag.kind === 'polytap'){
    const p = applyOrtho(ix.polyPts[ix.polyPts.length - 1] || null, snapPt(sx, sy));
    ix.polyPts.push(p); ix.hoverPt = null; syncCtx();
  }
  else if (drag.kind === 'draw' && drag.p2){
    const p1 = drag.p1, p2 = drag.p2;
    if (state.tool === 'measure'){
      const d = dist(p1[0], p1[1], p2[0], p2[1]);
      toast(fmtFtIn(d) + '  (Δx ' + fmtFtIn(Math.abs(p2[0] - p1[0])) + ', Δy ' + fmtFtIn(Math.abs(p2[1] - p1[1])) + ')', 3500);
    }
    else if (dist(p1[0], p1[1], p2[0], p2[1]) > 0.05){
      pushUndo();
      if (state.tool === 'line') state.entities.push({ id: state.idSeq++, type: 'line', layer: state.currentLayer, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
      else if (state.tool === 'rect') state.entities.push({ id: state.idSeq++, type: 'poly', layer: state.currentLayer, closed: true, pts: [[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]] });
      else if (state.tool === 'circle') state.entities.push({ id: state.idSeq++, type: 'circle', layer: state.currentLayer, cx: p1[0], cy: p1[1], r: dist(p1[0], p1[1], p2[0], p2[1]) });
      else if (state.tool === 'dim') state.entities.push({ id: state.idSeq++, type: 'dim', layer: 'DIMS', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], off: 2 });
      afterChange();
    }
  }
  ix.drag = null; ix.snapMark = null; draw();
}

function onWheel(ev){
  ev.preventDefault();
  const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(ev.clientX, ev.clientY, f);
  draw();
}

const TOOL_KEYS = {
  v: 'select', h: 'pan', l: 'line', p: 'poly', r: 'rect', c: 'circle',
  s: 'symbol', o: 'offset', x: 'trim', e: 'extend', d: 'dim', m: 'measure',
  t: 'text', q: 'erase'
};

function onKeyDown(ev){
  if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey){ ev.preventDefault(); doUndo(); }
  else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))){ ev.preventDefault(); doRedo(); }
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selIds.length){ deleteSelection(); }
  else if (ev.key === 'Escape'){
    if (anySheetOpen()){ closeSheets(); return; }
    cancelPoly(false); state.selIds = []; state.boxMode = false; syncCtx(); draw();
  }
  else if (ev.key === 'Enter' && state.tool === 'poly' && ix.polyPts.length > 1){ cancelPoly(true); }
  else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey){
    if (k === 'f'){ zoomFit(); draw(); }
    else if (TOOL_KEYS[k]){ setTool(TOOL_KEYS[k]); }
  }
}

export function bindInput(cv){
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  document.addEventListener('keydown', onKeyDown);
}
