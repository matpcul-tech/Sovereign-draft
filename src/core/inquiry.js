/* AREA / LIST inquiry. Pure over entities. */
import { polyArea, dist } from './geometry.js';
import { fmtFtIn } from './format.js';
import { entityLength, entityArea } from './modify.js';
import { expandInsert } from './dynblock.js';

export function areaOf(e){
  if (!e) return 0;
  if (e.type === 'insert'){
    return expandInsert(e).reduce((s, f) => s + areaOf(f), 0);
  }
  if (e.type === 'ellipse') return Math.PI * (e.rx || 0) * (e.ry || 0);
  if (e.type === 'cloud' && e.pts) return Math.abs(polyArea(e.pts));
  return entityArea(e);
}

export function listEntity(e){
  if (!e) return 'Nothing';
  const bits = [e.type.toUpperCase(), 'layer ' + (e.layer || '0')];
  if (e.lt) bits.push('lt ' + e.lt);
  if (e.mark) bits.push('mark ' + e.mark);
  const L = entityLength(e);
  if (L) bits.push('len ' + fmtFtIn(L));
  const A = areaOf(e);
  if (A) bits.push('area ' + A.toFixed(2) + ' SF');
  if (e.type === 'line') bits.push(fmtFtIn(e.x1) + ',' + fmtFtIn(e.y1) + ' → ' + fmtFtIn(e.x2) + ',' + fmtFtIn(e.y2));
  if (e.type === 'circle') bits.push('R ' + fmtFtIn(e.r));
  if (e.type === 'insert') bits.push((e.def || 'block') + (e.width ? ' ' + fmtFtIn(e.width) : ''));
  if (e.type === 'text') bits.push('"' + (e.content || '') + '"');
  if (e.type === 'dim') bits.push(e.kind || 'aligned');
  if (e.type === 'room') bits.push(e.name || 'ROOM', Math.round(e.area || 0) + ' SF');
  if (e.type === 'grid') bits.push((e.cols || 0) + '×' + (e.rows || 0) + ' bays');
  if (e.type === 'xline') bits.push('construction');
  return bits.join('  ·  ');
}

export function idPoint(p){
  if (!p) return 'ID —';
  return 'X ' + fmtFtIn(p[0]) + '   Y ' + fmtFtIn(p[1]);
}

void dist;
