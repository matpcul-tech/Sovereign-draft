/* Named dimension styles. Default is architectural ticks at ½″ precision. */

import { dist } from './geometry.js';
import { fmtFtIn } from './format.js';

export function dimLabel(e){
  if (!e) return '';
  if (e.kind === 'angular'){
    const a1 = Math.atan2(e.y1 - e.y2, e.x1 - e.x2);
    const a2 = Math.atan2(e.y3 - e.y2, e.x3 - e.x2);
    let d = (a2 - a1) * 180 / Math.PI;
    d = ((d % 360) + 360) % 360;
    if (d > 180) d = 360 - d;
    return (Math.round(d * 10) / 10) + '°';
  }
  const L = dist(e.x1, e.y1, e.x2, e.y2);
  if (e.kind === 'radius') return 'R ' + fmtFtIn(L, e.precision);
  if (e.kind === 'diameter') return '⌀ ' + fmtFtIn(L * 2, e.precision);
  return fmtFtIn(L, e.precision);
}

export const DIM_PRECISIONS = ['1/2', '1/4', 'decimal'];

export function defaultDimStyle(){
  return {
    name: 'ARCH',
    textHeight: 0.8,
    offset: 2,
    ext: 0.3,
    arrow: 'tick',          /* tick | arrow | none */
    tickSize: 0.4,
    precision: '1/2',
    layer: 'DIMS',
    continueGap: 0          /* extra gap between continued dim lines */
  };
}

export function defaultDimStyles(){
  return [
    defaultDimStyle(),
    { name: 'ARROW', textHeight: 0.7, offset: 2, ext: 0.25, arrow: 'arrow', tickSize: 0.45, precision: '1/2', layer: 'DIMS', continueGap: 0 },
    { name: 'DECIMAL', textHeight: 0.7, offset: 2, ext: 0.25, arrow: 'arrow', tickSize: 0.4, precision: 'decimal', layer: 'DIMS', continueGap: 0 }
  ];
}

export function styleByName(styles, name){
  return (styles || []).find(s => s.name === name) || defaultDimStyle();
}

export function applyStyleToDim(e, style){
  e.dimStyle = style.name;
  e.arrow = style.arrow;
  e.textH = style.textHeight;
  e.precision = style.precision;
  e.layer = style.layer || e.layer || 'DIMS';
  if (e.off == null) e.off = style.offset;
  return e;
}

/* Continue: next dim shares the first origin of `prev` and the same offset / direction. */
export function continueDim(prev, nextPt, style){
  const e = {
    type: 'dim',
    layer: (style && style.layer) || 'DIMS',
    x1: prev.x2, y1: prev.y2,
    x2: nextPt[0], y2: nextPt[1],
    off: prev.off,
    kind: 'continue'
  };
  return applyStyleToDim(e, style || defaultDimStyle());
}

/* Baseline: next dim shares the first origin of `base` with stacked offset. */
export function baselineDim(base, nextPt, style){
  const step = (style && style.offset) || 2;
  const e = {
    type: 'dim',
    layer: (style && style.layer) || 'DIMS',
    x1: base.x1, y1: base.y1,
    x2: nextPt[0], y2: nextPt[1],
    off: base.off + Math.sign(base.off || 1) * step,
    kind: 'baseline'
  };
  return applyStyleToDim(e, style || defaultDimStyle());
}

export function alignedDim(p1, p2, off, style){
  const e = {
    type: 'dim',
    layer: (style && style.layer) || 'DIMS',
    x1: p1[0], y1: p1[1],
    x2: p2[0], y2: p2[1],
    off: off == null ? ((style && style.offset) || 2) : off,
    kind: 'aligned'
  };
  return applyStyleToDim(e, style || defaultDimStyle());
}

/* 3-point angular: vertex p2, rays through p1 and p3. */
export function angularDim(p1, vertex, p3, off, style){
  const e = {
    type: 'dim',
    kind: 'angular',
    layer: (style && style.layer) || 'DIMS',
    x1: p1[0], y1: p1[1],
    x2: vertex[0], y2: vertex[1],
    x3: p3[0], y3: p3[1],
    off: off == null ? 2 : off
  };
  return applyStyleToDim(e, style || defaultDimStyle());
}

export function radiusDim(cx, cy, rimX, rimY, style){
  const e = {
    type: 'dim',
    kind: 'radius',
    layer: (style && style.layer) || 'DIMS',
    x1: cx, y1: cy,
    x2: rimX, y2: rimY,
    off: 0
  };
  return applyStyleToDim(e, style || defaultDimStyle());
}

export function diameterDim(cx, cy, rimX, rimY, style){
  const e = radiusDim(cx, cy, rimX, rimY, style);
  e.kind = 'diameter';
  return e;
}

export function makeLeader(pts, content, style){
  return {
    type: 'leader',
    layer: (style && style.layer) || 'DIMS',
    pts: (pts || []).map(p => [p[0], p[1]]),
    content: content || '',
    textH: (style && style.textHeight) || 0.7
  };
}

export function angularValue(e){
  const a1 = Math.atan2(e.y1 - e.y2, e.x1 - e.x2);
  const a2 = Math.atan2(e.y3 - e.y2, e.x3 - e.x2);
  let d = (a2 - a1) * 180 / Math.PI;
  d = ((d % 360) + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

