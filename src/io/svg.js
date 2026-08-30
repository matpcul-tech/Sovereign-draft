/* SVG export for Illustrator / web. Explodes inserts, tables, ellipses. */
import { fmtN, dimGeom, arcPoints, ellipsePoints, cloudPoints } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { membersBBox, explodeForIO } from '../core/entities.js';
import { hatchLines } from '../core/hatch.js';
import { expandInsert } from '../core/dynblock.js';
import { tableFrags } from '../core/schedule.js';

function xml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

function flatten(entities){
  const out = [];
  (entities || []).forEach(e => {
    if (e.type === 'insert') out.push(...expandInsert(e));
    else if (e.type === 'table') out.push(...tableFrags(e));
    else if (e.type === 'ellipse') out.push({ type: 'poly', closed: true, pts: ellipsePoints(e), layer: e.layer, lt: e.lt });
    else if (e.type === 'cloud') out.push({ type: 'poly', closed: true, pts: cloudPoints(e.pts || []), layer: e.layer, lt: e.lt });
    else if (e.type === 'grid' || e.type === 'xline' || e.type === 'room'){
      explodeForIO(e).forEach(f => out.push(f));
    } else if (e.type === 'leader'){
      if (e.pts && e.pts.length > 1) out.push({ type: 'poly', closed: false, pts: e.pts, layer: e.layer });
      const last = e.pts && e.pts[e.pts.length - 1];
      if (last && e.content) out.push({ type: 'text', layer: e.layer, x: last[0] + 0.15, y: last[1], size: e.textH || 0.7, content: e.content });
    } else if (e.type === 'image'){
      /* Outline only — raster is browser-local. */
      const w = e.w || 1, h = e.h || 1;
      out.push({ type: 'poly', closed: true, pts: [[e.x, e.y], [e.x + w, e.y], [e.x + w, e.y + h], [e.x, e.y + h]], layer: e.layer, lt: 'DASHED' });
    } else out.push(e);
  });
  return out;
}

export function buildSVG(entities, layers, opts){
  opts = opts || {};
  const vis = flatten(entities || []).filter(e => {
    if (!layers) return true;
    const L = (layers || []).find(l => l.name === e.layer);
    return !L || (L.visible !== false && L.plot !== false);
  });
  const bb = membersBBox(vis.length ? vis : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
  const pad = 1;
  const x = bb[0] - pad, y = bb[1] - pad;
  const w = Math.max(bb[2] - bb[0] + pad * 2, 1);
  const h = Math.max(bb[3] - bb[1] + pad * 2, 1);
  /* SVG Y grows down; world Y grows up. */
  const tx = (px) => fmtN(px - x);
  const ty = (py) => fmtN((y + h) - py);
  const colorOf = (e) => {
    const L = (layers || []).find(l => l.name === e.layer);
    return (L && L.color) || '#111';
  };
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + fmtN(w) + ' ' + fmtN(h) + '" width="' + fmtN(w * 12) + '" height="' + fmtN(h * 12) + '">'
  ];
  vis.forEach(e => {
    const c = colorOf(e);
    if (e.type === 'line'){
      parts.push('<line x1="' + tx(e.x1) + '" y1="' + ty(e.y1) + '" x2="' + tx(e.x2) + '" y2="' + ty(e.y2) + '" stroke="' + c + '" fill="none" stroke-width="0.03"/>');
    } else if (e.type === 'poly'){
      const d = (e.pts || []).map((p, i) => (i ? 'L' : 'M') + tx(p[0]) + ' ' + ty(p[1])).join(' ') + (e.closed ? ' Z' : '');
      parts.push('<path d="' + d + '" stroke="' + c + '" fill="none" stroke-width="0.03"/>');
    } else if (e.type === 'circle'){
      parts.push('<circle cx="' + tx(e.cx) + '" cy="' + ty(e.cy) + '" r="' + fmtN(e.r) + '" stroke="' + c + '" fill="none" stroke-width="0.03"/>');
    } else if (e.type === 'arc'){
      const d = arcPoints(e).map((p, i) => (i ? 'L' : 'M') + tx(p[0]) + ' ' + ty(p[1])).join(' ');
      parts.push('<path d="' + d + '" stroke="' + c + '" fill="none" stroke-width="0.03"/>');
    } else if (e.type === 'hatch'){
      hatchLines(e).forEach(seg => {
        parts.push('<line x1="' + tx(seg[0][0]) + '" y1="' + ty(seg[0][1]) + '" x2="' + tx(seg[1][0]) + '" y2="' + ty(seg[1][1]) + '" stroke="' + c + '" fill="none" stroke-width="0.02"/>');
      });
    } else if (e.type === 'text'){
      parts.push('<text x="' + tx(e.x) + '" y="' + ty(e.y) + '" font-size="' + fmtN(e.size || 1) + '" fill="' + c + '" font-family="sans-serif">' + xml(e.content) + '</text>');
    } else if (e.type === 'dim'){
      const g = dimGeom(e);
      [g.e1, g.e2, g.d].forEach(seg => {
        parts.push('<line x1="' + tx(seg[0][0]) + '" y1="' + ty(seg[0][1]) + '" x2="' + tx(seg[1][0]) + '" y2="' + ty(seg[1][1]) + '" stroke="' + c + '" fill="none" stroke-width="0.02"/>');
      });
      parts.push('<text x="' + tx(g.mid[0]) + '" y="' + ty(g.mid[1]) + '" font-size="0.7" fill="' + c + '" font-family="sans-serif" text-anchor="middle">' + xml(fmtFtIn(g.len, e.precision)) + '</text>');
    }
  });
  parts.push('</svg>');
  return parts.join('\n');
}
