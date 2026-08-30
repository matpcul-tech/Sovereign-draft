/* Sheet space annotations and margin slots.
 *
 * Everything here is in paper inches, measured from the lower left of the
 * sheet. That is the whole point: a legend, a general note and a label pushed
 * out of a crowded view all belong to the sheet, not to the model, so they
 * keep their size and position no matter what scale the views are drawn at.
 *
 * Margin slots are the free paper left over once the viewports and the title
 * block have taken their space. Label placement that gives up on fitting
 * inside a view falls back to a slot and runs a leader across.
 */
import { modelToPaper } from './layout.js';
import { boxWidth } from './textmetrics.js';
import { sheetOf } from './layout.js';

export const SHEET_MARGIN = 0.5;      /* inches of clear edge */
export const TITLE_BLOCK_H = 0.9;     /* inches along the bottom */
export const SLOT_GAP = 0.12;

/* Paper rectangle a viewport occupies, as [x0, y0, x1, y1] in inches. */
export function viewportRect(v){
  return [v.px, v.py, v.px + v.pw, v.py + v.ph];
}

function rectsOverlap(a, b, pad){
  const p = pad || 0;
  return !(a[2] + p < b[0] || b[2] + p < a[0] || a[3] + p < b[1] || b[3] + p < a[1]);
}

/* Everything already occupying paper on this sheet.
 * `hard` are things an annotation may never sit on: the title block and other
 * annotations. `soft` is the viewport area, which a legend is allowed to
 * overlap when the sheet has no clear margin left, which is the usual case
 * because a default viewport fills the sheet inside its margins.
 */
export function occupiedRects(sheet, extra, opts){
  const o = opts || {};
  const out = [];
  if (!o.hardOnly) (sheet && sheet.viewports || []).forEach(v => out.push(viewportRect(v)));
  (sheet && sheet.annotations || []).forEach(a => { const r = annotationRect(a); if (r) out.push(r); });
  (extra || []).forEach(r => out.push(r));
  if (!sheet || sheet.titleBlock !== false){
    const sh = sheetOf(sheet && sheet.sheet);
    out.push([SHEET_MARGIN, SHEET_MARGIN, sh.w - SHEET_MARGIN, SHEET_MARGIN + TITLE_BLOCK_H]);
  }
  return out;
}

export function annotationRect(a){
  if (!a) return null;
  const w = a.w != null ? a.w : estimateWidth(a);
  const h = a.h != null ? a.h : estimateHeight(a);
  return [a.x, a.y, a.x + w, a.y + h];
}

function estimateWidth(a){
  if (a.kind === 'table' && a.table) return (a.table.colW || []).reduce((s, c) => s + c, 0);
  return boxWidth(a.text || '', a.size || 0.12);
}
function estimateHeight(a){
  if (a.kind === 'table' && a.table) return (a.table.cells || []).length * (a.table.rowH || 0.22) + (a.table.title ? (a.table.rowH || 0.22) : 0);
  return (a.size || 0.12) * 1.4;
}

/* Free rectangles down the right margin, then the left, then the top strip.
 * Ordered so a legend lands where a drafter would put one. */
export function marginSlots(sheet, size, extra){
  const sh = sheetOf(sheet && sheet.sheet);
  const w = size && size[0] || 1.5;
  const h = size && size[1] || 1;
  const taken = occupiedRects(sheet, extra);
  const slots = [];
  const step = Math.max(0.2, h / 2);

  const columns = [
    { x: sh.w - SHEET_MARGIN - w, dir: 'right' },
    { x: SHEET_MARGIN, dir: 'left' }
  ];
  columns.forEach(col => {
    for (let y = sh.h - SHEET_MARGIN - h; y >= SHEET_MARGIN; y -= step){
      slots.push({ x: col.x, y, w, h, side: col.dir });
    }
  });
  for (let x = SHEET_MARGIN; x + w <= sh.w - SHEET_MARGIN; x += Math.max(0.3, w / 2)){
    slots.push({ x, y: sh.h - SHEET_MARGIN - h, w, h, side: 'top' });
  }

  const onSheet = s => {
    const r = [s.x, s.y, s.x + s.w, s.y + s.h];
    if (r[0] < SHEET_MARGIN - 1e-9 || r[1] < SHEET_MARGIN - 1e-9) return false;
    return r[2] <= sh.w - SHEET_MARGIN + 1e-9 && r[3] <= sh.h - SHEET_MARGIN + 1e-9;
  };
  const clear = slots.filter(s => onSheet(s) &&
    !taken.some(t => rectsOverlap([s.x, s.y, s.x + s.w, s.y + s.h], t, SLOT_GAP)));
  if (clear.length) return clear;

  /* No clear margin. Fall back to slots that may sit over a viewport but never
   * over the title block or another annotation, and say so. */
  const hard = occupiedRects(sheet, extra, { hardOnly: true });
  return slots.filter(s => onSheet(s) &&
    !hard.some(t => rectsOverlap([s.x, s.y, s.x + s.w, s.y + s.h], t, SLOT_GAP)))
    .map(s => Object.assign({}, s, { overViewport: true }));
}

/* First free slot that fits, or null when the sheet is full. */
export function placeInMargin(sheet, size, extra){
  const free = marginSlots(sheet, size, extra);
  return free.length ? free[0] : null;
}

/* ---------- sheet space annotations ---------- */

export function makeNote(x, y, text, opts){
  const o = opts || {};
  return { kind: 'note', x, y, text: String(text || ''), size: o.size || 0.12, layer: o.layer || 'NOTES' };
}

export function makeTableAnnotation(x, y, table, opts){
  const o = opts || {};
  return { kind: 'table', x, y, table, layer: o.layer || 'SCHEDULES' };
}

export function makeLabel(x, y, text, opts){
  const o = opts || {};
  return {
    kind: 'label', x, y,
    text: String(text || ''),
    size: o.size || 0.11,
    leader: o.leader || null,
    layer: o.layer || 'NOTES'
  };
}

export function addAnnotation(sheet, ann){
  if (!sheet || !ann) return sheet;
  const list = Array.isArray(sheet.annotations) ? sheet.annotations.slice() : [];
  list.push(ann);
  return Object.assign({}, sheet, { annotations: list });
}

/* ---------- label placement in sheet space ----------
 * A label that will not fit inside its view is pushed to a margin slot and
 * given a leader back to the anchor. The anchor is a model point, so it is
 * converted through the view it belongs to; the label itself stays a paper
 * value and does not change size with the view scale.
 */
export function placeLabelOnSheet(sheet, view, modelAnchor, text, opts){
  const o = opts || {};
  const size = o.size || 0.11;
  const w = boxWidth(text, size);
  const h = size * 1.4;
  const anchorPaper = view ? modelToPaper(view, modelAnchor[0], modelAnchor[1]) : [modelAnchor[0], modelAnchor[1]];

  const slot = placeInMargin(sheet, [w, h], o.extra);
  if (!slot) return null;
  /* Draw the leader from the side of the label nearest the anchor. */
  const tip = slot.side === 'left' ? [slot.x + w, slot.y + h / 2] : [slot.x, slot.y + h / 2];
  return makeLabel(slot.x, slot.y, text, {
    size,
    layer: o.layer,
    leader: [[anchorPaper[0], anchorPaper[1]], tip]
  });
}

/* Whether a paper rectangle is clear of everything already on the sheet. */
export function slotIsFree(sheet, rect, extra){
  return !occupiedRects(sheet, extra).some(t => rectsOverlap(rect, t, SLOT_GAP));
}

/* Clear of the things an annotation may never cover. */
export function slotIsPlaceable(sheet, rect, extra){
  return !occupiedRects(sheet, extra, { hardOnly: true }).some(t => rectsOverlap(rect, t, SLOT_GAP));
}
