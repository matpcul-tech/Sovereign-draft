/* Live canvas rendering: grid, entities, selection, grips, tool previews. */
import { state, layerByName, selMembers } from '../core/state.js';
import { vp, W2S, S2W } from '../core/viewport.js';
import { membersBBox, gripPts } from '../core/entities.js';
import { dist } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { drawEnt, strokePathOn } from './ent.js';
import { ix } from '../interaction.js';

let cv = null, ctx = null;

export function initCanvas(canvas){
  cv = canvas;
  ctx = canvas.getContext('2d');
}

export function resize(){
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
  drawGrid();
  const ms = selMembers(), selSet = {};
  ms.forEach(e => { selSet[e.id] = 1; });
  for (const e of state.entities){
    const L = layerByName(e.layer);
    if (L && !L.visible) continue;
    drawEnt(ctx, e, L ? L.color : '#e8e4dd', !!selSet[e.id], W2S, state.view.scale);
  }
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
      ctx.fillStyle = '#00d4b8';
      ctx.fillRect(s[0] - 4.5, s[1] - 4.5, 9, 9);
      ctx.strokeStyle = '#07101f'; ctx.lineWidth = 1;
      ctx.strokeRect(s[0] - 4.5, s[1] - 4.5, 9, 9);
    });
  }
  drawPreview();
  if (ix.snapMark){
    const s = W2S(ix.snapMark[0], ix.snapMark[1]);
    ctx.strokeStyle = ix.snapMark[2] === 1 ? '#00d4b8' : '#d4a843';
    ctx.lineWidth = 1.5;
    if (ix.snapMark[2] === 2){ ctx.beginPath(); ctx.arc(s[0], s[1], 6, 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(s[0] - 5, s[1] - 5, 10, 10);
  }
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
  if (drag && drag.kind === 'draw' && drag.p2){
    const p1 = drag.p1, p2 = drag.p2;
    if (tool === 'line' || tool === 'dim'){
      strokePath([p1, p2]);
      previewLabel(p1, p2, fmtFtIn(dist(p1[0], p1[1], p2[0], p2[1])));
    } else if (tool === 'measure'){
      ctx.strokeStyle = '#00d4b8';
      strokePath([p1, p2]);
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
    }
  }
  if (tool === 'poly' && ix.polyPts.length){
    if (ix.polyPts.length > 1) strokePath(ix.polyPts);
    if (ix.hoverPt){
      strokePath([ix.polyPts[ix.polyPts.length - 1], ix.hoverPt]);
      previewLabel(ix.polyPts[ix.polyPts.length - 1], ix.hoverPt,
        fmtFtIn(dist(ix.polyPts[ix.polyPts.length - 1][0], ix.polyPts[ix.polyPts.length - 1][1], ix.hoverPt[0], ix.hoverPt[1])));
    }
    ctx.setLineDash([]);
    for (const p of ix.polyPts){ const s = W2S(p[0], p[1]); ctx.fillStyle = col; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
  }
  ctx.setLineDash([]);
}
