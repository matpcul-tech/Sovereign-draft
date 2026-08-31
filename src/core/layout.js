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
  letter:  { name: 'Letter',           w: 11, h: 8.5,  code: 'LETTER' },
  tabloid: { name: 'Tabloid',          w: 17, h: 11,   code: 'TABLOID' },
  archd:   { name: 'Arch D',           w: 36, h: 24,   code: 'ARCHD' },
  archdp:  { name: 'Arch D Portrait',  w: 24, h: 36,   code: 'ARCHDP' }
};

/* Tall skinny elevations (rockets, stacks, towers) go on portrait paper so
 * the drawing is a column, not a hairline on a landscape sheet. Floor plans
 * stay landscape Arch D. */
export function pickSheetForBBox(bbox){
  if (!bbox || bbox[0] > 1e8) return 'archd';
  const w = Math.max(bbox[2] - bbox[0], 0.01);
  const h = Math.max(bbox[3] - bbox[1], 0.01);
  if (h / w > 2.2) return 'archdp';
  return 'archd';
}

/* Points-per-foot for architectural scales (same ladder as PDF). */
export const PLOT_SCALES = [
  { ppf: 864,  lbl: '1:1' },
  { ppf: 432,  lbl: '6" = 1\'-0"' },
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

/* ---------- viewport twist ----------
 * A viewport can be turned within its frame, which is what puts a wing that
 * runs at an angle to the site grid square on the sheet. The frame and the
 * title block stay where they are; only the view inside rotates, so the
 * drawing reads upright while the model keeps its true north.
 *
 * The angle is degrees counterclockwise, about the view centre.
 */
export function viewportRot(vp){ return Number(vp && vp.rot) || 0; }

function spin(dx, dy, deg){
  if (!deg) return [dx, dy];
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [dx * c - dy * s, dx * s + dy * c];
}

export function paperToModel(vp, paperX, paperY){
  /* paper inches → model feet. Viewport origin is lower-left. */
  let dx = paperX - (vp.px + vp.pw / 2);
  let dy = paperY - (vp.py + vp.ph / 2);
  /* Undo the twist to get back to model axes. */
  const u = spin(dx, dy, -viewportRot(vp));
  const ftPerIn = 72 / vp.ppf;
  return [vp.mx + u[0] * ftPerIn, vp.my + u[1] * ftPerIn];
}

export function modelToPaper(vp, x, y){
  const ftPerIn = 72 / vp.ppf;
  const d = spin((x - vp.mx) / ftPerIn, (y - vp.my) / ftPerIn, viewportRot(vp));
  return [vp.px + vp.pw / 2 + d[0], vp.py + vp.ph / 2 + d[1]];
}

/* ---------- viewport clipping ----------
 * A clip is a polygon in paper inches. It is what lets a keyed enlarged plan
 * show an L shaped area, or a detail show a round bubble, instead of every
 * view being the same rectangle. With no clip the frame itself is the
 * boundary, which is the behaviour every existing layout already has.
 */
export function clipPoly(vp){
  const c = vp && vp.clip;
  if (!c || !c.length || c.length < 3) return null;
  return c.map(p => [Number(p[0]) || 0, Number(p[1]) || 0]);
}

/* The frame as a polygon, so callers have one shape to work with whether or
 * not a clip is set. */
export function viewportBoundary(vp){
  return clipPoly(vp) || [
    [vp.px, vp.py], [vp.px + vp.pw, vp.py],
    [vp.px + vp.pw, vp.py + vp.ph], [vp.px, vp.py + vp.ph]
  ];
}

function inPoly(x, y, pts){
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function inViewport(vp, paperX, paperY){
  /* A clip can only ever take area away: a point outside the frame is
   * outside the viewport whatever the clip says. */
  const inFrame = paperX >= vp.px && paperX <= vp.px + vp.pw && paperY >= vp.py && paperY <= vp.py + vp.ph;
  if (!inFrame) return false;
  const c = clipPoly(vp);
  return c ? inPoly(paperX, paperY, c) : true;
}

/* The model space box a viewport can show, twist included. A rotated view
 * covers a larger model rectangle than its frame suggests, so culling that
 * used the unrotated box would drop geometry that belongs on the sheet. */
export function viewportModelBBox(vp, pad){
  const b = viewportBoundary(vp);
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  b.forEach(p => {
    const m = paperToModel(vp, p[0], p[1]);
    if (m[0] < bb[0]) bb[0] = m[0];
    if (m[1] < bb[1]) bb[1] = m[1];
    if (m[0] > bb[2]) bb[2] = m[0];
    if (m[1] > bb[3]) bb[3] = m[1];
  });
  const k = pad || 0;
  return [bb[0] - k, bb[1] - k, bb[2] + k, bb[3] + k];
}
