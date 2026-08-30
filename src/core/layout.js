/* Paper-space lite: one model space + N layouts. Each layout has a sheet size,
 * plot scale (architectural ppf), a title block, and one or more viewports
 * that clip + scale model geometry.
 *
 * Sheet sizes are stored in inches. Viewports live in paper inches, origin at
 * the lower-left of the sheet.
 */

export const SHEET_MARGIN = 0.5;
export const TITLE_BLOCK_H = 1.65;

export const SHEETS = {
  letter:  { name: 'Letter',  w: 11,  h: 8.5,  code: 'LETTER' },
  tabloid: { name: 'Tabloid', w: 17,  h: 11,   code: 'TABLOID' },
  archd:   { name: 'Arch D',  w: 36,  h: 24,   code: 'ARCHD' }
};

/* Points-per-foot for architectural scales (same ladder as PDF). */
export const PLOT_SCALES = [
  { ppf: 72,   lbl: '1" = 1\'-0"' },
  { ppf: 54,   lbl: '3/4" = 1\'-0"' },
  { ppf: 36,   lbl: '1/2" = 1\'-0"' },
  { ppf: 27,   lbl: '3/8" = 1\'-0"' },
  { ppf: 18,   lbl: '1/4" = 1\'-0"' },
  { ppf: 13.5, lbl: '3/16" = 1\'-0"' },
  { ppf: 9,    lbl: '1/8" = 1\'-0"' },
  { ppf: 6.75, lbl: '3/32" = 1\'-0"' },
  { ppf: 4.5,  lbl: '1/16" = 1\'-0"' }
];

export function sheetOf(key){ return SHEETS[key] || SHEETS.letter; }

export function makeViewport(sheetKey, ppf){
  const s = sheetOf(sheetKey);
  const m = SHEET_MARGIN, tb = TITLE_BLOCK_H;
  return {
    px: m, py: m + tb, pw: s.w - m * 2, ph: s.h - m * 2 - tb,
    mx: 0, my: 0, ppf: ppf || 18
  };
}

export function makeLayout(opts){
  opts = opts || {};
  const sheet = opts.sheet || 'archd';
  const ppf = opts.ppf || 18;
  return {
    id: opts.id || ('L' + Math.random().toString(36).slice(2, 7)),
    name: opts.name || 'A-1 Floor Plan',
    sheet,
    ppf,
    titleBlock: opts.titleBlock !== false,
    viewports: opts.viewports || [makeViewport(sheet, ppf)]
  };
}

export function defaultLayouts(){
  return [makeLayout({ id: 'A1', name: 'A-1 Floor Plan', sheet: 'archd', ppf: 18 })];
}

/* Fit a viewport's model center/scale so `bbox` fills the viewport with padding. */
export function fitViewport(vp, bbox, pad){
  pad = pad == null ? 0.9 : pad;
  const w = Math.max(bbox[2] - bbox[0], 0.5);
  const h = Math.max(bbox[3] - bbox[1], 0.5);
  vp.mx = (bbox[0] + bbox[2]) / 2;
  vp.my = (bbox[1] + bbox[3]) / 2;
  /* ppf is points per foot; paper inches * 72 = points, so model feet shown = paperInches * 72 / ppf */
  const fitPpf = Math.min(vp.pw * 72 * pad / w, vp.ph * 72 * pad / h);
  /* Snap down to the next standard architectural scale so the printed scale is honest. */
  let chosen = PLOT_SCALES[PLOT_SCALES.length - 1].ppf;
  for (const s of PLOT_SCALES){
    if (s.ppf <= fitPpf + 0.01){ chosen = s.ppf; break; }
  }
  vp.ppf = chosen;
  return vp;
}

export function paperToModel(vp, paperX, paperY){
  /* paper inches → model feet. Viewport origin is lower-left. */
  const dx = paperX - (vp.px + vp.pw / 2);
  const dy = paperY - (vp.py + vp.ph / 2);
  const ftPerIn = 72 / vp.ppf;
  return [vp.mx + dx * ftPerIn, vp.my + dy * ftPerIn];
}

export function modelToPaper(vp, x, y){
  const ftPerIn = 72 / vp.ppf;
  return [
    vp.px + vp.pw / 2 + (x - vp.mx) / ftPerIn,
    vp.py + vp.ph / 2 + (y - vp.my) / ftPerIn
  ];
}

export function inViewport(vp, paperX, paperY){
  return paperX >= vp.px && paperX <= vp.px + vp.pw && paperY >= vp.py && paperY <= vp.py + vp.ph;
}
