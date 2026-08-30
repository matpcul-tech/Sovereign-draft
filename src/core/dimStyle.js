/* Named dimension styles. Default is architectural ticks at ½″ precision. */

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
