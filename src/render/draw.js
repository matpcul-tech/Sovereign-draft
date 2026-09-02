/* Live canvas rendering: grid, entities, selection, grips, tool previews,
 * paper-space layouts.
 */
import { tableFrags } from '../core/schedule.js';
import { scaleLabel } from '../io/pdf.js';
import { detailBubbleText, viewportClearOfAnnotations, annotationRect } from '../core/sheetspace.js';
import { state, layerByName, selMembers, activeLayout } from '../core/state.js';
import { vp, W2S, S2W } from '../core/viewport.js';
import { membersBBox, gripPts } from '../core/entities.js';
import { dist, polarSnap, ellipsePoints, cloudPoints } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { drawEnt, strokePathOn } from './ent.js';
import { ix } from '../interaction.js';
import { sheetOf, modelToPaper, viewportBoundary } from '../core/layout.js';
import { titleBlockModel, drawingTitleOf, viewportClearOfTitle } from '../core/titleblock.js';
import { SNAP_KIND } from '../core/osnap.js';
import { hatchLines } from '../core/hatch.js';
import { splinePoints, makeSpline } from '../core/spline.js';
import { makeIndexCache, queryIndices, worthIndexing } from '../core/spatial.js';
import { entsInBBox } from '../core/legend.js';
import { refreshDerivedTables } from '../core/keynote.js';
import { arcFrom3 } from '../core/modify.js';
import { wallFrags } from '../core/walls.js';

let cv = null, ctx = null;

export function initCanvas(canvas){
  cv = canvas;
  ctx = canvas.getContext('2d');
}

export function resize(){
  if (!cv) return;
  vp.DPR = window.devicePixelRatio || 1;
  vp.CW = cv.clientWidth; vp.CH = cv.clientHeight;
  cv.width = Math.round(vp.CW * vp.DPR); cv.height = Math.round(vp.CH * vp.DPR);
  ctx.setTransform(vp.DPR, 0, 0, vp.DPR, 0, 0);
  draw();
}

function strokePath(pts, close){ strokePathOn(ctx, W2S, pts, close); }

export function draw(){
  if (!ctx) return;
  ctx.clearRect(0, 0, vp.CW, vp.CH);
  if (state.space !== 'model'){ drawPaper(); return; }
  drawGrid();
  drawModel();
}

const drawIndex = makeIndexCache();

/* Entities that can appear on screen. Below the index threshold, or when
 * drawing into a viewport with its own transform, everything is a candidate.
 *
 * Selected entities are always kept: a drag moves them without going through
 * afterChange, so the index does not know where they are until the drag ends
 * and culling them against a stale box would make the thing you are dragging
 * vanish. */
function visibleList(clipToS, only, selSet){
  const list = only || state.entities;
  if (clipToS || list !== state.entities || !worthIndexing(list)) return list;
  const pad = 40 / (state.view.scale || 1);
  const a = S2W(0, vp.CH), b = S2W(vp.CW, 0);
  const box = [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad,
               Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad];
  const idx = drawIndex.get(list, state.geomStamp);
  const keep = new Set(queryIndices(idx, box));
  for (let i = 0; i < list.length; i++) if (selSet[list[i].id]) keep.add(i);
  if (keep.size === list.length) return list;
  /* Index order is draw order, so the result paints in the same sequence. */
  return Array.from(keep).sort((x, y) => x - y).map(i => list[i]);
}

function drawModel(clipToS, clipScl, only){
  const toS = clipToS || W2S;
  const scl = clipScl || state.view.scale;
  const ms = selMembers(), selSet = {};
  ms.forEach(e => { selSet[e.id] = 1; });
  const list = visibleList(clipToS, only, selSet);
  for (const e of list){
    const L = layerByName(e.layer);
    if (L && !L.visible) continue;
    drawEnt(ctx, e, L ? L.color : '#e8e4dd', !clipToS && !!selSet[e.id], toS, scl, undefined, state.textStyles, state.annoPpf);
  }
  if (clipToS) return;
  drawConstraintGlyphs();
  if (ms.length > 1){
    const bb = membersBBox(ms);
    const a = W2S(bb[0], bb[3]), b = W2S(bb[2], bb[1]);
    ctx.strokeStyle = '#d4a843'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(a[0] - 6, a[1] - 6, b[0] - a[0] + 12, b[1] - a[1] + 12);
    ctx.setLineDash([]);
  }
  if (ms.length === 1 && !ms[0].g){
    gripPts(ms[0]).forEach(gp => {
      const s = W2S(gp.x, gp.y);
      drawGrip(ctx, s, gp.kind || 'move');
    });
  }
  drawPreview();
  if (ix.snapMark){
    const s = W2S(ix.snapMark[0], ix.snapMark[1]);
    const kind = ix.snapMark[2];
    ctx.strokeStyle = kind === 1 ? '#00d4b8' : (kind === 3 ? '#e8e4dd' : (kind === 5 ? '#c45a3c' : (kind === 6 ? '#4ade80' : '#d4a843')));
    ctx.lineWidth = 1.5;
    if (kind === 2){ ctx.beginPath(); ctx.arc(s[0], s[1], 6, 0, Math.PI * 2); ctx.stroke(); }
    else if (kind === 3){
      ctx.beginPath();
      ctx.moveTo(s[0] - 6, s[1] - 6); ctx.lineTo(s[0] + 6, s[1] + 6);
      ctx.moveTo(s[0] + 6, s[1] - 6); ctx.lineTo(s[0] - 6, s[1] + 6);
      ctx.stroke();
    } else if (kind === 6){
      ctx.beginPath();
      ctx.moveTo(s[0], s[1] - 7); ctx.lineTo(s[0] + 6, s[1] + 4); ctx.lineTo(s[0] - 6, s[1] + 4);
      ctx.closePath(); ctx.stroke();
    } else ctx.strokeRect(s[0] - 5, s[1] - 5, 10, 10);
    const label = SNAP_KIND[kind] || '';
    if (label){
      ctx.font = '10px Outfit, system-ui'; ctx.fillStyle = '#d4a843';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, s[0] + 8, s[1] - 6);
    }
  }
}

function drawGrip(c, s, kind){
  c.fillStyle = kind === 'flip' ? '#d4a843' : (kind === 'rotate' ? '#c45a3c' : '#00d4b8');
  c.strokeStyle = '#07101f';
  c.lineWidth = 1;
  c.beginPath();
  if (kind === 'stretch' || kind === 'rotate'){
    c.arc(s[0], s[1], 5.2, 0, Math.PI * 2);
  } else if (kind === 'flip'){
    c.moveTo(s[0], s[1] - 6);
    c.lineTo(s[0] + 6, s[1]);
    c.lineTo(s[0], s[1] + 6);
    c.lineTo(s[0] - 6, s[1]);
    c.closePath();
  } else {
    c.rect(s[0] - 4.5, s[1] - 4.5, 9, 9);
  }
  c.fill();
  c.stroke();
}

function paperMap(){
  const L = activeLayout(); if (!L) return null;
  const sh = sheetOf(L.sheet);
  /* Fit the sheet into the part of the canvas the chrome leaves free:
   * the top bar hides ~96px and the tool panel ~210px, and a sheet
   * centred in the full window parked its title block under them. */
  const padX = 36, top = 100, bot = 214;
  const scl = Math.min((vp.CW - padX * 2) / sh.w, Math.max(120, vp.CH - top - bot) / sh.h);
  const ox = (vp.CW - sh.w * scl) / 2;
  const cy = top + Math.max(120, vp.CH - top - bot) / 2;
  const oy = cy + sh.h * scl / 2; /* paper Y-up -> screen Y-down */
  return { L, sh, scl, ox, oy, p2s: (px, py) => [ox + px * scl, oy - py * scl] };
}

function drawPaper(){
  const m = paperMap(); if (!m) return;
  const { L, sh, scl, ox, oy, p2s } = m;
  refreshDerivedTables(L, state.entities);
  ctx.fillStyle = '#050a14';
  ctx.fillRect(0, 0, vp.CW, vp.CH);
  /* Sheet */
  const a = p2s(0, sh.h), b = p2s(sh.w, 0);
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(a[0], a[1], sh.w * scl, sh.h * scl);
  ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 1;
  ctx.strokeRect(a[0], a[1], sh.w * scl, sh.h * scl);
  /* Viewports — lifted above the issued title block so geometry never sits on the stamp. */
  for (const vpRaw of L.viewports){
    const vp0 = viewportClearOfAnnotations(viewportClearOfTitle(vpRaw), L.annotations);
    /* The boundary is the clip polygon when the viewport has one and the
     * frame otherwise, so a keyed enlarged plan clips to its real shape
     * rather than to the rectangle around it. */
    const bound = viewportBoundary(vp0);
    const tracePath = () => {
      ctx.beginPath();
      bound.forEach((pt, i) => {
        const q = p2s(pt[0], pt[1]);
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      });
      ctx.closePath();
    };
    ctx.save();
    tracePath();
    ctx.clip();
    ctx.fillStyle = '#07101f';
    ctx.fill();
    const ppf = vp0.ppf || L.ppf || 18;
    const pxPerFt = (ppf / 72) * scl; /* paper inches per foot * screen px per paper inch */
    const toS = (x, y) => {
      const p = modelToPaper(vp0, x, y);
      return p2s(p[0], p[1]);
    };
    const scopedEnts = state.entities.filter(e => !e.visibleIn || e.visibleIn.indexOf(L.id) >= 0);
    const secBox = L.section && L.section.bbox
      ? (L.section.geo
        ? [Math.min(L.section.bbox[0], L.section.geo[0]), Math.min(L.section.bbox[1], L.section.geo[1]),
           Math.max(L.section.bbox[2], L.section.geo[2]), Math.max(L.section.bbox[3], L.section.geo[3])]
        : L.section.bbox)
      : null;
    drawModel(toS, pxPerFt, secBox ? entsInBBox(scopedEnts, secBox, 0.4) : scopedEnts);
    ctx.restore();
    ctx.strokeStyle = '#8fa3c0'; ctx.lineWidth = 1;
    tracePath();
    ctx.stroke();
  }
  /* Sheet space annotations, drawn in paper inches through p2s. */
  (L.annotations || []).forEach(a => {
    if (!a) return;
    ctx.strokeStyle = '#43536f'; ctx.lineWidth = 1;
    ctx.fillStyle = '#07101f';
    if (a.kind === 'table' && a.table){
      const t = Object.assign({}, a.table, { x: a.x, y: a.y, fromTop: true });
      const paper = (t.rowH || 0.85) < 0.4;
      const ts = paper ? 1 : ((t.rowH || 0.22) / 0.85);
      const r = annotationRect(a);
      const rowPx = (paper ? (t.rowH || 0.22) : 0.85 * ts) * scl;
      if (r && rowPx < 9){
        /* Rows this small on screen are mush: an 8px font floor above a
         * 6px row was text piled on text. The screen shows a clean
         * titled panel; the readable rows live in the issued PDF, which
         * is the artifact. */
        const tl = p2s(r[0], r[3]), br = p2s(r[2], r[1]);
        ctx.fillStyle = '#f4efe4';
        ctx.fillRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
        ctx.strokeStyle = '#8b7f66';
        ctx.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
        const panelW = br[0] - tl[0];
        const title = String(t.title || 'TABLE');
        /* Sized and clipped to the panel: a fixed 11px title overran a
         * phone-width card and bled past the sheet edge. */
        const tf = Math.max(7, Math.min(11, panelW / (title.length * 0.68)));
        ctx.save();
        ctx.beginPath(); ctx.rect(tl[0], tl[1], panelW, br[1] - tl[1]); ctx.clip();
        ctx.fillStyle = '#07101f';
        ctx.font = '600 ' + tf.toFixed(1) + 'px Outfit, system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const rows = (t.cells || []).length - 1;
        ctx.fillText(title, (tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2 - tf * 0.65);
        if (panelW > 58){
          ctx.font = Math.max(6, tf - 1.5).toFixed(1) + 'px Outfit, system-ui';
          ctx.fillStyle = '#5a5344';
          ctx.fillText(rows > 0 ? rows + ' rows - prints in full' : 'prints in full', (tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2 + tf * 0.75);
        }
        ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        return;
      }
      if (r){
        const tl = p2s(r[0], r[3]), br = p2s(r[2], r[1]);
        ctx.fillStyle = '#f4efe4';
        ctx.fillRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      }
      tableFrags(t).forEach(f => {
        if (f.type === 'line'){
          const p0 = p2s(f.x1, f.y1), p1 = p2s(f.x2, f.y2);
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        } else if (f.type === 'text'){
          const q = p2s(f.x, f.y);
          /* Sized to the row, never past it: the old 8px floor overran
           * small rows and piled the schedule onto itself. */
          ctx.font = Math.min(Math.max(7, rowPx * 0.62), Math.max(7, f.size * ts * scl)) + 'px Outfit, system-ui';
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = '#07101f';
          ctx.fillText(f.content || '', q[0], q[1]);
        }
      });
      return;
    }
    if (a.leader && a.leader.length === 2){
      const p0 = p2s(a.leader[0][0], a.leader[0][1]), p1 = p2s(a.leader[1][0], a.leader[1][1]);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    if (a.kind === 'mark'){
      const c = p2s(a.x, a.y);
      const r = (a.r || 0.18) * scl;
      ctx.fillStyle = '#e8e4dd';
      ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#07101f'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#07101f';
      ctx.font = '600 ' + Math.max(7, (a.size || 0.09) * scl) + 'px Outfit, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.text || '', c[0], c[1]);
      return;
    }
    if (a.kind === 'detail'){
      const c = p2s(a.x, a.y);
      const r = (a.r || 0.28) * scl;
      ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c[0] - r, c[1]); ctx.lineTo(c[0] + r, c[1]); ctx.stroke();
      const t = detailBubbleText(state.layouts || [], a);
      ctx.font = '600 ' + Math.max(7, (a.size || 0.12) * scl) + 'px Outfit, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom'; ctx.fillText(t.top, c[0], c[1] - r * 0.12);
      ctx.textBaseline = 'top'; ctx.fillText(t.bottom, c[0], c[1] + r * 0.12);
      return;
    }
    const q = p2s(a.x, a.y);
    ctx.font = Math.max(8, (a.size || 0.12) * scl) + 'px Outfit, system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(a.text || '', q[0], q[1]);
  });

  if (L.titleBlock){
    const inner = p2s(0.38, sh.h - 0.38);
    ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 1.2;
    ctx.strokeRect(inner[0], inner[1], (sh.w - 0.76) * scl, (sh.h - 0.76) * scl);
    const model = titleBlockModel(L.sheet, {
      firm: state.firm,
      projectName: state.projectName,
      drawingTitle: drawingTitleOf(L),
      sheetNumber: L.sheetNumber || '',
      sheetCount: (state.layouts || []).length,
      scale: scaleLabel(L.viewports[0] ? (L.viewports[0].ppf || L.ppf) : L.ppf),
      dateStr: new Date().toLocaleDateString()
    });
    const tb = p2s(model.x, model.y + model.h);
    ctx.fillStyle = '#f4efe4';
    ctx.fillRect(tb[0], tb[1], model.w * scl, model.h * scl);
    ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 1.1;
    ctx.strokeRect(tb[0], tb[1], model.w * scl, model.h * scl);
    (model.cells || []).forEach(c => {
      const q = p2s(c.x, c.y + c.h);
      ctx.strokeRect(q[0], q[1], c.w * scl, c.h * scl);
    });
    (model.labels || []).forEach(lab => {
      const q = p2s(lab.x, lab.y);
      ctx.fillStyle = lab.gray > 0.3 ? '#6b7c93' : '#07101f';
      const px = Math.max(8, lab.size * scl);
      ctx.font = (lab.bold ? '600 ' : '400 ') + px + 'px Outfit, system-ui';
      ctx.textAlign = lab.align === 'center' ? 'center' : (lab.align === 'right' ? 'right' : 'left');
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(lab.text || '', q[0], q[1]);
    });
  }
  void ox; void oy;
}

function drawGrid(){
  let minor = 1; if (state.view.scale < 9) minor = 5; if (state.view.scale < 2.2) minor = 25;
  const major = minor * 5;
  const tl = S2W(0, 0), br = S2W(vp.CW, vp.CH);
  const x0 = Math.floor(tl[0] / minor) * minor, x1 = br[0], y0 = Math.floor(br[1] / minor) * minor, y1 = tl[1];
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += minor){
    const sx = W2S(x, 0)[0];
    ctx.strokeStyle = Math.abs(x / major - Math.round(x / major)) < 1e-4 ? 'rgba(143,163,192,.16)' : 'rgba(143,163,192,.07)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, vp.CH); ctx.stroke();
  }
  for (let y = y0; y <= y1; y += minor){
    const sy = W2S(0, y)[1];
    ctx.strokeStyle = Math.abs(y / major - Math.round(y / major)) < 1e-4 ? 'rgba(143,163,192,.16)' : 'rgba(143,163,192,.07)';
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(vp.CW, sy); ctx.stroke();
  }
  const o = W2S(0, 0);
  ctx.strokeStyle = 'rgba(212,168,67,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(o[0], 0); ctx.lineTo(o[0], vp.CH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, o[1]); ctx.lineTo(vp.CW, o[1]); ctx.stroke();
}

function previewLabel(p1, p2, txt){
  const m = W2S((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
  ctx.font = '11px Outfit, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(7,16,31,.9)'; ctx.fillRect(m[0] - w / 2 - 4, m[1] - 20, w + 8, 15);
  ctx.fillStyle = '#00d4b8'; ctx.fillText(txt, m[0], m[1] - 13);
}

function drawPreview(){
  const L = layerByName(state.currentLayer), col = L ? L.color : '#d4a843';
  const tool = state.tool, drag = ix.drag;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  if (drag && drag.kind === 'box' && drag.cur){
    ctx.strokeStyle = '#d4a843';
    ctx.strokeRect(Math.min(drag.s0[0], drag.cur[0]), Math.min(drag.s0[1], drag.cur[1]),
      Math.abs(drag.cur[0] - drag.s0[0]), Math.abs(drag.cur[1] - drag.s0[1]));
  }
  if (drag && drag.kind === 'stretchbox' && drag.cur){
    ctx.strokeStyle = '#00d4b8';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(drag.s0[0], drag.cur[0]), Math.min(drag.s0[1], drag.cur[1]),
      Math.abs(drag.cur[0] - drag.s0[0]), Math.abs(drag.cur[1] - drag.s0[1]));
  }
  if (drag && drag.kind === 'draw' && drag.p2){
    const p1 = drag.p1, p2 = drag.p2;
    if (tool === 'line' || tool === 'dim' || tool === 'dimali' || tool === 'measure' || tool === 'wall' || tool === 'xline'){
      if (tool === 'wall'){
        ctx.setLineDash([]);
        const fr = wallFrags(p1[0], p1[1], p2[0], p2[1], state.wallTh, state.currentLayer);
        fr.forEach(f => strokePath([[f.x1, f.y1], [f.x2, f.y2]]));
      } else {
        if (tool === 'measure') ctx.strokeStyle = '#00d4b8';
        if (tool === 'xline'){
          const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;
          strokePath([[p1[0] - ux * 80, p1[1] - uy * 80], [p1[0] + ux * 80, p1[1] + uy * 80]]);
        } else {
          strokePath([p1, p2]);
        }
      }
      const d = dist(p1[0], p1[1], p2[0], p2[1]);
      let a = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;
      if (a < 0) a += 360;
      previewLabel(p1, p2, fmtFtIn(d) + ' · ' + Math.round(a) + '°');
    } else if (tool === 'rect'){
      strokePath([[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]], true);
      previewLabel(p1, p2, fmtFtIn(Math.abs(p2[0] - p1[0])) + ' × ' + fmtFtIn(Math.abs(p2[1] - p1[1])));
    } else if (tool === 'circle'){
      const c = W2S(p1[0], p1[1]), r = dist(p1[0], p1[1], p2[0], p2[1]) * state.view.scale;
      ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
      previewLabel(p1, p2, 'R ' + fmtFtIn(dist(p1[0], p1[1], p2[0], p2[1])));
    } else if (tool === 'ellipse'){
      const ell = { cx: p1[0], cy: p1[1], rx: Math.abs(p2[0] - p1[0]), ry: Math.abs(p2[1] - p1[1]), rot: 0 };
      strokePath(ellipsePoints(ell), true);
      previewLabel(p1, p2, fmtFtIn(ell.rx) + ' × ' + fmtFtIn(ell.ry));
    } else if (tool === 'image'){
      strokePath([[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]], true);
      previewLabel(p1, p2, fmtFtIn(Math.abs(p2[0] - p1[0])) + ' × ' + fmtFtIn(Math.abs(p2[1] - p1[1])));
    } else if (tool === 'grid'){
      strokePath([[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]], true);
      previewLabel(p1, p2, fmtFtIn(Math.abs(p2[0] - p1[0])) + ' × ' + fmtFtIn(Math.abs(p2[1] - p1[1])) + ' grid');
    } else if (tool === 'arraypolar'){
      strokePath([p1, p2]);
      const c = W2S(p1[0], p1[1]);
      ctx.beginPath(); ctx.arc(c[0], c[1], 6, 0, Math.PI * 2); ctx.stroke();
      previewLabel(p1, p2, (state.arrayCount || 6) + ' @ ' + (state.arrayFill || 360) + '°');
    } else if (tool === 'stretch' || tool === 'calibrate'){
      strokePath([p1, p2]);
    } else if (tool === 'mirror' || tool === 'move' || tool === 'copy' || tool === 'rotate' || tool === 'scale'){
      strokePath([p1, p2]);
    }
  }
  if ((tool === 'arc' || tool === 'dimang') && ix.arcPts && ix.arcPts.length){
    if (ix.arcPts.length === 1 && ix.hoverPt) strokePath([ix.arcPts[0], ix.hoverPt]);
    if (ix.arcPts.length === 2){
      const p3 = ix.hoverPt || ix.arcPts[1];
      const arc = arcFrom3(ix.arcPts[0], ix.arcPts[1], p3);
      if (arc){
        const { arcPoints } = requireArc();
        strokePath(arcPoints(arc));
      } else strokePath([ix.arcPts[0], ix.arcPts[1], p3]);
    }
    ctx.setLineDash([]);
    for (const p of ix.arcPts){ const s = W2S(p[0], p[1]); ctx.fillStyle = col; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
  }
  if ((tool === 'poly' || tool === 'hatch' || tool === 'cloud' || tool === 'leader' || tool === 'spline') && ix.polyPts.length){
    /* A spline previews as the curve those control points actually make, so
     * you are placing the shape you can see rather than a guide polygon. */
    const live = ix.hoverPt ? ix.polyPts.concat([ix.hoverPt]) : ix.polyPts;
    const pts = tool === 'cloud' && ix.polyPts.length > 2
      ? cloudPoints(live)
      : tool === 'spline' && live.length > 2
        ? splinePoints(makeSpline(live, {}))
        : ix.polyPts;
    if (pts.length > 1) strokePath(pts, tool === 'cloud');
    if (ix.hoverPt && tool !== 'cloud'){
      strokePath([ix.polyPts[ix.polyPts.length - 1], ix.hoverPt]);
      previewLabel(ix.polyPts[ix.polyPts.length - 1], ix.hoverPt,
        fmtFtIn(dist(ix.polyPts[ix.polyPts.length - 1][0], ix.polyPts[ix.polyPts.length - 1][1], ix.hoverPt[0], ix.hoverPt[1])));
    }
    ctx.setLineDash([]);
    for (const p of ix.polyPts){ const s = W2S(p[0], p[1]); ctx.fillStyle = col; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
  }
  if (state.polarOn && ix.hoverPt && state.lastPt){
    const p = polarSnap(state.lastPt, ix.hoverPt, 15);
    const s0 = W2S(state.lastPt[0], state.lastPt[1]), s1 = W2S(p[0], p[1]);
    ctx.strokeStyle = 'rgba(0,212,184,.35)'; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.setLineDash([]);
  void hatchLines;
}

function requireArc(){
  return { arcPoints: (e) => {
    const span = ((e.a2 - e.a1) % 360 + 360) % 360 || 360;
    const steps = Math.max(2, Math.ceil(span / 6)), pts = [];
    for (let i = 0; i <= steps; i++){
      const a = (e.a1 + span * i / steps) * Math.PI / 180;
      pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]);
    }
    return pts;
  } };
}

export { paperMap };

/* Small gold markers so a constrained line says so at a glance: H, V, PAR,
 * PERP, EQ, a ring for coincident, a pin for fix, the driven length. */
function drawConstraintGlyphs(){
  const ks = state.constraints || [];
  if (!ks.length) return;
  const byId = {};
  state.entities.forEach(e => { if (e.id != null) byId[e.id] = e; });
  ctx.font = '600 9px Outfit, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const at = (e, dyRow) => {
    if (!e) return null;
    const mx = e.type === 'circle' ? e.cx : (e.x1 + e.x2) / 2;
    const my = e.type === 'circle' ? e.cy + e.r : (e.y1 + e.y2) / 2;
    const p = W2S(mx, my);
    return [p[0], p[1] - 10 - dyRow * 11];
  };
  const rows = {};
  ks.forEach(k => {
    const e = byId[k.a]; if (!e) return;
    const row = rows[k.a] = (rows[k.a] || 0) + 1;
    const p = at(e, row - 1); if (!p) return;
    let label = null;
    if (k.type === 'horizontal') label = 'H';
    else if (k.type === 'vertical') label = 'V';
    else if (k.type === 'parallel') label = '//';
    else if (k.type === 'perpendicular') label = '\u22A5';
    else if (k.type === 'equal') label = '=';
    else if (k.type === 'tangent') label = 'T';
    else if (k.type === 'distance' || k.type === 'radius') label = fmtFtIn(k.value || 0);
    else if (k.type === 'fix') label = '\u2693';
    else if (k.type === 'coincident') label = '\u25CB';
    if (!label) return;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(7,16,31,.85)';
    ctx.fillRect(p[0] - w / 2, p[1] - 7, w, 14);
    ctx.strokeStyle = '#d4a843'; ctx.lineWidth = 1;
    ctx.strokeRect(p[0] - w / 2, p[1] - 7, w, 14);
    ctx.fillStyle = '#d4a843';
    ctx.fillText(label, p[0], p[1]);
  });
}
