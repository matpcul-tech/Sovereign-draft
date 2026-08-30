/* Entity rendering shared by the live canvas and PNG export. Callers supply
 * the world->surface transform toS(x,y)->[sx,sy] and the pixels-per-foot scl.
 */
import { arcPoints, dimGeom, ellipsePoints, cloudPoints, angularGeom } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { dashFor, lwToPx } from '../core/style.js';
import { hatchLines } from '../core/hatch.js';
import { flattenEnt, spanXline } from '../core/entities.js';
import { tableFrags } from '../core/schedule.js';
import { dimLabel } from '../core/dimStyle.js';
import { expandGrid } from '../core/grid.js';
import { roomAreaLabel } from '../core/rooms.js';

export function strokePathOn(c, toS, pts, close){
  if (!pts || !pts.length) return;
  c.beginPath();
  let s = toS(pts[0][0], pts[0][1]); c.moveTo(s[0], s[1]);
  for (let i = 1; i < pts.length; i++){ s = toS(pts[i][0], pts[i][1]); c.lineTo(s[0], s[1]); }
  if (close) c.closePath();
  c.stroke();
}

function applyStroke(c, e, color, sel, scl){
  c.strokeStyle = sel ? '#d4a843' : color;
  c.fillStyle = sel ? '#d4a843' : color;
  const base = e.layer === 'WALLS' || e.kind === 'wall' ? 2.4 : (e.layer === 'DIMS' ? 1 : 1.5);
  c.lineWidth = e.lw ? lwToPx(e.lw, scl) : base;
  if (sel){ c.setLineDash([6, 4]); return; }
  const dash = dashFor(e, scl);
  c.setLineDash(dash);
}

export function drawEnt(c, e, color, sel, toS, scl, bg){
  applyStroke(c, e, color, sel, scl);
  if (e.type === 'line') strokePathOn(c, toS, [[e.x1, e.y1], [e.x2, e.y2]]);
  else if (e.type === 'poly') strokePathOn(c, toS, e.pts, e.closed);
  else if (e.type === 'circle'){
    const p = toS(e.cx, e.cy);
    c.beginPath(); c.arc(p[0], p[1], e.r * scl, 0, Math.PI * 2); c.stroke();
  }
  else if (e.type === 'arc') strokePathOn(c, toS, arcPoints(e));
  else if (e.type === 'hatch'){
    const solid = e.pattern === 'SOLID';
    if (solid){
      c.save();
      c.beginPath();
      let s = toS(e.pts[0][0], e.pts[0][1]); c.moveTo(s[0], s[1]);
      for (let i = 1; i < e.pts.length; i++){ s = toS(e.pts[i][0], e.pts[i][1]); c.lineTo(s[0], s[1]); }
      c.closePath();
      c.globalAlpha = 0.22;
      c.fillStyle = sel ? '#d4a843' : color;
      c.fill();
      c.globalAlpha = 1;
      c.restore();
    } else {
      c.lineWidth = 1;
      for (const seg of hatchLines(e)) strokePathOn(c, toS, seg);
    }
    if (sel){
      c.setLineDash([4, 3]);
      strokePathOn(c, toS, e.pts, true);
    }
  }
  else if (e.type === 'text'){
    const q = toS(e.x, e.y);
    c.setLineDash([]);
    c.font = Math.max(e.size * scl, 6) + 'px Outfit, system-ui';
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillText(e.content || '', q[0], q[1]);
  }
  else if (e.type === 'dim') drawDim(c, e, sel ? '#d4a843' : color, toS, bg);
  else if (e.type === 'insert'){
    flattenEnt(e).forEach(f => drawEnt(c, f, color, sel, toS, scl, bg));
    if (e.mark){
      const q = toS(e.x, e.y);
      c.setLineDash([]);
      c.font = '600 ' + Math.max(10, 0.55 * scl) + 'px Outfit, system-ui';
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillStyle = sel ? '#d4a843' : color;
      c.fillText(e.mark, q[0], q[1] - 6);
    }
  }
  else if (e.type === 'ellipse') strokePathOn(c, toS, ellipsePoints(e), true);
  else if (e.type === 'cloud') strokePathOn(c, toS, cloudPoints(e.pts || [], e.amp), true);
  else if (e.type === 'leader'){
    strokePathOn(c, toS, e.pts || []);
    if (e.pts && e.pts.length > 1){
      const a = e.pts[e.pts.length - 2], b = e.pts[e.pts.length - 1];
      const ang = Math.atan2(toS(b[0], b[1])[1] - toS(a[0], a[1])[1], toS(b[0], b[1])[0] - toS(a[0], a[1])[0]);
      drawArrow(c, toS(b[0], b[1]), ang + Math.PI, 8);
    }
    if (e.content && e.pts && e.pts.length){
      const last = e.pts[e.pts.length - 1];
      const q = toS(last[0] + 0.2, last[1]);
      c.setLineDash([]);
      c.font = Math.max((e.textH || 0.7) * scl, 9) + 'px Outfit, system-ui';
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(e.content, q[0], q[1]);
    }
  }
  else if (e.type === 'table'){
    tableFrags(e).forEach(f => drawEnt(c, f, color, sel, toS, scl, bg));
  }
  else if (e.type === 'image'){
    const im = imageOf(e.src);
    const o = toS(e.x, e.y);
    const rot = (e.rot || 0) * Math.PI / 180;
    const w = (e.w || 1) * scl, h = (e.h || 1) * scl;
    c.save();
    c.translate(o[0], o[1]);
    c.rotate(-rot);
    if (im){
      c.globalAlpha = 0.72;
      c.drawImage(im, 0, -h, w, h);
      c.globalAlpha = 1;
    }
    c.strokeStyle = sel ? '#d4a843' : color;
    c.setLineDash([6, 4]);
    c.strokeRect(0, -h, w, h);
    c.restore();
  }
  else if (e.type === 'grid'){
    expandGrid(e).forEach(f => drawEnt(c, f, color, sel, toS, scl, bg));
  }
  else if (e.type === 'xline'){
    const sp = spanXline(e);
    c.setLineDash(sel ? [6, 4] : [10, 6]);
    c.lineWidth = sel ? 2 : 1;
    strokePathOn(c, toS, [[sp.x1, sp.y1], [sp.x2, sp.y2]]);
  }
  else if (e.type === 'room'){
    if (e.pts && e.pts.length > 2){
      c.save();
      c.beginPath();
      let s = toS(e.pts[0][0], e.pts[0][1]); c.moveTo(s[0], s[1]);
      for (let i = 1; i < e.pts.length; i++){ s = toS(e.pts[i][0], e.pts[i][1]); c.lineTo(s[0], s[1]); }
      c.closePath();
      c.globalAlpha = sel ? 0.28 : 0.1;
      c.fillStyle = sel ? '#d4a843' : color;
      c.fill();
      c.globalAlpha = 1;
      if (sel){ c.setLineDash([4, 3]); c.strokeStyle = sel ? '#d4a843' : color; c.stroke(); }
      c.restore();
    }
    const q = toS(e.cx || 0, e.cy || 0);
    c.setLineDash([]);
    c.fillStyle = sel ? '#d4a843' : color;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 ' + Math.max(11, 0.95 * scl) + 'px Outfit, system-ui';
    c.fillText(e.name || 'ROOM', q[0], q[1] - Math.max(8, 0.45 * scl));
    c.font = Math.max(10, 0.65 * scl) + 'px Outfit, system-ui';
    c.fillText(roomAreaLabel(e), q[0], q[1] + Math.max(8, 0.4 * scl));
  }
  c.setLineDash([]);
}

const imgCache = new Map();
function imageOf(src){
  if (!src || typeof Image === 'undefined') return null;
  let im = imgCache.get(src);
  if (im) return im.complete ? im : null;
  im = new Image();
  im.onload = () => { try { document.dispatchEvent(new Event('sd-redraw')); } catch (err){ /* node */ } };
  im.src = src;
  imgCache.set(src, im);
  return null;
}

function drawArrow(c, p, ang, size){
  const a = ang + Math.PI, s = size || 8;
  c.beginPath();
  c.moveTo(p[0], p[1]);
  c.lineTo(p[0] + s * Math.cos(a - 0.32), p[1] + s * Math.sin(a - 0.32));
  c.lineTo(p[0] + s * Math.cos(a + 0.32), p[1] + s * Math.sin(a + 0.32));
  c.closePath();
  c.fill();
}

export function drawDim(c, e, color, toS, bg){
  if (e.kind === 'angular'){
    const g = angularGeom(e);
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1; c.setLineDash([]);
    strokePathOn(c, toS, [[e.x2, e.y2], g.pA]);
    strokePathOn(c, toS, [[e.x2, e.y2], g.pB]);
    strokePathOn(c, toS, g.arc);
    const m = toS(g.mid[0], g.mid[1]);
    const txt = dimLabel(e);
    paintDimText(c, m, 0, txt, color, bg, e.textH);
    return;
  }
  if (e.kind === 'radius' || e.kind === 'diameter'){
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1; c.setLineDash([]);
    let a = [e.x1, e.y1], b = [e.x2, e.y2];
    if (e.kind === 'diameter'){
      a = [e.x1 - (e.x2 - e.x1), e.y1 - (e.y2 - e.y1)];
    }
    strokePathOn(c, toS, [a, b]);
    const sa = toS(a[0], a[1]), sb = toS(b[0], b[1]);
    const ang = Math.atan2(sb[1] - sa[1], sb[0] - sa[0]);
    drawArrow(c, sb, ang, 9);
    if (e.kind === 'diameter') drawArrow(c, sa, ang + Math.PI, 9);
    const m = toS((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    paintDimText(c, m, ang, dimLabel(e), color, bg, e.textH);
    return;
  }
  const g = dimGeom(e);
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1; c.setLineDash([]);
  strokePathOn(c, toS, g.e1); strokePathOn(c, toS, g.e2); strokePathOn(c, toS, g.d);
  const a = toS(g.d[0][0], g.d[0][1]), b = toS(g.d[1][0], g.d[1][1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const style = e.arrow || 'tick';
  if (style === 'arrow'){
    drawArrow(c, a, ang, 9);
    drawArrow(c, b, ang + Math.PI, 9);
  } else if (style !== 'none'){
    const t = 5;
    [a, b].forEach(p => {
      c.beginPath();
      c.moveTo(p[0] - t * Math.cos(ang - Math.PI / 4), p[1] - t * Math.sin(ang - Math.PI / 4));
      c.lineTo(p[0] + t * Math.cos(ang - Math.PI / 4), p[1] + t * Math.sin(ang - Math.PI / 4));
      c.stroke();
    });
  }
  const m = toS(g.mid[0], g.mid[1]);
  paintDimText(c, m, ang, fmtFtIn(g.len, e.precision), color, bg, e.textH);
}

function paintDimText(c, m, ang, txt, color, bg, textH){
  const flip = ang > Math.PI / 2 || ang < -Math.PI / 2;
  c.save();
  c.translate(m[0], m[1]);
  c.rotate(flip ? ang + Math.PI : ang);
  const px = Math.max(10, (textH || 0.8) * 12);
  c.font = px + 'px Outfit, system-ui'; c.textAlign = 'center'; c.textBaseline = 'bottom';
  const w = c.measureText(txt).width;
  c.fillStyle = bg || '#07101f'; c.fillRect(-w / 2 - 3, -14, w + 6, 13);
  c.fillStyle = color; c.fillText(txt, 0, -3);
  c.restore();
}
