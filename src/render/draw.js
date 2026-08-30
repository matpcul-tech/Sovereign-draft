/* Live canvas rendering: grid, entities, selection, grips, tool previews,
 * paper-space layouts.
 */
import { tableFrags } from '../core/schedule.js';
import { scaleLabel } from '../io/pdf.js';
import { sheetLabel } from '../core/document.js';
import { state, layerByName, selMembers, activeLayout } from '../core/state.js';
import { vp, W2S, S2W } from '../core/viewport.js';
import { membersBBox, gripPts } from '../core/entities.js';
import { dist, polarSnap, ellipsePoints, cloudPoints } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { drawEnt, strokePathOn } from './ent.js';
import { ix } from '../interaction.js';
import { sheetOf, modelToPaper } from '../core/layout.js';
import { SNAP_KIND } from '../core/osnap.js';
import { hatchLines } from '../core/hatch.js';
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

function drawModel(clipToS, clipScl){
  const toS = clipToS || W2S;
  const scl = clipScl || state.view.scale;
  const ms = selMembers(), selSet = {};
  ms.forEach(e => { selSet[e.id] = 1; });
  for (const e of state.entities){
    const L = layerByName(e.layer);
    if (L && !L.visible) continue;
    drawEnt(ctx, e, L ? L.color : '#e8e4dd', !clipToS && !!selSet[e.id], toS, scl);
  }
  if (clipToS) return;
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
  /* Fit the sheet into the canvas with padding. */
  const pad = 36;
  const scl = Math.min((vp.CW - pad * 2) / sh.w, (vp.CH - pad * 2) / sh.h);
  const ox = (vp.CW - sh.w * scl) / 2;
  const oy = (vp.CH + sh.h * scl) / 2; /* paper Y-up → screen Y-down */
  return { L, sh, scl, ox, oy, p2s: (px, py) => [ox + px * scl, oy - py * scl] };
}

function drawPaper(){
  const m = paperMap(); if (!m) return;
  const { L, sh, scl, ox, oy, p2s } = m;
  ctx.fillStyle = '#050a14';
  ctx.fillRect(0, 0, vp.CW, vp.CH);
  /* Sheet */
  const a = p2s(0, sh.h), b = p2s(sh.w, 0);
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(a[0], a[1], sh.w * scl, sh.h * scl);
  ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 1;
  ctx.strokeRect(a[0], a[1], sh.w * scl, sh.h * scl);
  /* Viewports */
  for (const vp0 of L.viewports){
    const tl = p2s(vp0.px, vp0.py + vp0.ph), br = p2s(vp0.px + vp0.pw, vp0.py);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tl[0], tl[1], vp0.pw * scl, vp0.ph * scl);
    ctx.clip();
    ctx.fillStyle = '#07101f';
    ctx.fillRect(tl[0], tl[1], vp0.pw * scl, vp0.ph * scl);
    const ppf = vp0.ppf || L.ppf || 18;
    const pxPerFt = (ppf / 72) * scl; /* paper inches per foot * screen px per paper inch */
    const toS = (x, y) => {
      const p = modelToPaper(vp0, x, y);
      return p2s(p[0], p[1]);
    };
    drawModel(toS, pxPerFt);
    ctx.restore();
    ctx.strokeStyle = '#8fa3c0'; ctx.lineWidth = 1;
    ctx.strokeRect(tl[0], tl[1], vp0.pw * scl, vp0.ph * scl);
  }
  /* Sheet space annotations, drawn in paper inches through p2s. */
  (L.annotations || []).forEach(a => {
    if (!a) return;
    ctx.strokeStyle = '#43536f'; ctx.lineWidth = 1;
    ctx.fillStyle = '#07101f';
    if (a.kind === 'table' && a.table){
      const t = Object.assign({}, a.table, { x: a.x, y: a.y });
      const ts = (t.rowH || 0.22) / 0.85;
      tableFrags(t).forEach(f => {
        if (f.type === 'line'){
          const p0 = p2s(f.x1, f.y1), p1 = p2s(f.x2, f.y2);
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        } else if (f.type === 'text'){
          const q = p2s(f.x, f.y);
          ctx.font = Math.max(8, f.size * ts * scl) + 'px Outfit, system-ui';
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(f.content || '', q[0], q[1]);
        }
      });
      return;
    }
    if (a.leader && a.leader.length === 2){
      const p0 = p2s(a.leader[0][0], a.leader[0][1]), p1 = p2s(a.leader[1][0], a.leader[1][1]);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    const q = p2s(a.x, a.y);
    ctx.font = Math.max(8, (a.size || 0.12) * scl) + 'px Outfit, system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(a.text || '', q[0], q[1]);
  });

  if (L.titleBlock){
    const tbH = 0.9;
    const t0 = p2s(0.5, 0.5 + tbH), t1 = p2s(sh.w - 0.5, 0.5);
    ctx.strokeStyle = '#1b2c4a'; ctx.lineWidth = 1.2;
    ctx.strokeRect(t0[0], t0[1], (sh.w - 1) * scl, tbH * scl);
    ctx.fillStyle = '#07101f';
    ctx.font = '600 ' + Math.max(11, scl * 0.28) + 'px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const midY = (t0[1] + t1[1]) / 2;
    ctx.fillText((state.projectName || 'SOVEREIGN DRAFT').toUpperCase(), t0[0] + 10, midY - 6);
    ctx.font = Math.max(9, scl * 0.16) + 'px Outfit, system-ui';
    ctx.fillStyle = '#43536f';
    /* The full scale ladder, not three hardcoded cases, so 1/16 and 1/2 read
     * as architectural scales rather than as points per foot. */
    ctx.fillText(L.name + '   ·   SCALE ' + scaleLabel(L.viewports[0] ? (L.viewports[0].ppf || L.ppf) : L.ppf), t0[0] + 10, midY + 10);
    ctx.textAlign = 'right';
    /* The sheet number, not the first word of the sheet name. */
    ctx.fillText(sheetLabel(L.sheetNumber, 0, (state.layouts || []).length), t1[0] - 10, midY);
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
  if ((tool === 'poly' || tool === 'hatch' || tool === 'cloud' || tool === 'leader') && ix.polyPts.length){
    const pts = tool === 'cloud' && ix.polyPts.length > 2
      ? cloudPoints(ix.hoverPt ? ix.polyPts.concat([ix.hoverPt]) : ix.polyPts)
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
