/* Entity rendering shared by the live canvas and PNG export. Callers supply
 * the world->surface transform toS(x,y)->[sx,sy] and the pixels-per-foot scl.
 */
import { arcPoints, dimGeom } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { dashFor, lwToPx } from '../core/style.js';
import { hatchLines } from '../core/hatch.js';
import { flattenEnt } from '../core/entities.js';

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
  }
  c.setLineDash([]);
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
  const txt = fmtFtIn(g.len, e.precision);
  const flip = ang > Math.PI / 2 || ang < -Math.PI / 2;
  c.save();
  c.translate(m[0], m[1]);
  c.rotate(flip ? ang + Math.PI : ang);
  const px = Math.max(10, (e.textH || 0.8) * 12);
  c.font = px + 'px Outfit, system-ui'; c.textAlign = 'center'; c.textBaseline = 'bottom';
  const w = c.measureText(txt).width;
  c.fillStyle = bg || '#07101f'; c.fillRect(-w / 2 - 3, -14, w + 6, 13);
  c.fillStyle = color; c.fillText(txt, 0, -3);
  c.restore();
}
