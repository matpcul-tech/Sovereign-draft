import { describe, it, expect } from 'vitest';
import {
  marginSlots, placeInMargin, occupiedRects, viewportRect, annotationRect,
  makeNote, makeLabel, makeTableAnnotation, addAnnotation, placeLabelOnSheet,
  viewportClearOfAnnotations,
  slotIsFree, slotIsPlaceable, SHEET_MARGIN, TITLE_BLOCK_H
} from '../src/core/sheetspace.js';
import { normalizeSheets } from '../src/core/document.js';
import { makeLayout, makeViewport, sheetOf, modelToPaper, fitViewport } from '../src/core/layout.js';
import { buildLayoutPDF } from '../src/io/pdf.js';
import { buildKeynoteLegend } from '../src/core/keynote.js';
import { setMark, setAttributes } from '../src/core/document.js';
import { cabin24x36 } from '../src/core/demo.js';

function sheet(size){
  return normalizeSheets([makeLayout({ id: 'A1', name: 'A-1', sheet: size || 'archd', ppf: 18 })])[0];
}
function overlaps(a, b){
  return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
}

describe('margin slots are real paper space', () => {
  it('every slot sits inside the sheet margin', () => {
    const s = sheet();
    const sh = sheetOf(s.sheet);
    const slots = marginSlots(s, [1.5, 1]);
    expect(slots.length).toBeGreaterThan(0);
    slots.forEach(sl => {
      expect(sl.x).toBeGreaterThanOrEqual(SHEET_MARGIN - 1e-9);
      expect(sl.y).toBeGreaterThanOrEqual(SHEET_MARGIN - 1e-9);
      expect(sl.x + sl.w).toBeLessThanOrEqual(sh.w - SHEET_MARGIN + 1e-9);
      expect(sl.y + sl.h).toBeLessThanOrEqual(sh.h - SHEET_MARGIN + 1e-9);
    });
  });

  it('a slot over a viewport is flagged as such', () => {
    /* A default viewport fills the sheet inside its margins, so there is no
     * clear margin and the fallback is used. It must say so rather than
     * pretending the paper was empty. */
    const s = sheet();
    const vpRects = s.viewports.map(viewportRect);
    const slots = marginSlots(s, [1.5, 1]);
    expect(slots.length).toBeGreaterThan(0);
    slots.forEach(sl => {
      const r = [sl.x, sl.y, sl.x + sl.w, sl.y + sl.h];
      const hits = vpRects.some(v => overlaps(r, v));
      if (hits) expect(sl.overViewport).toBe(true);
    });
  });

  it('a sheet with a smaller viewport offers genuinely clear slots', () => {
    const s = sheet();
    s.viewports[0].pw = 10; s.viewports[0].ph = 10;
    const slots = marginSlots(s, [1.5, 1]);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every(sl => !sl.overViewport)).toBe(true);
    const vpRects = s.viewports.map(viewportRect);
    slots.forEach(sl => {
      const r = [sl.x, sl.y, sl.x + sl.w, sl.y + sl.h];
      vpRects.forEach(v => expect(overlaps(r, v)).toBe(false));
    });
  });

  it('no slot overlaps the title block', () => {
    const s = sheet();
    const sh = sheetOf(s.sheet);
    const tb = [SHEET_MARGIN, SHEET_MARGIN, sh.w - SHEET_MARGIN, SHEET_MARGIN + TITLE_BLOCK_H];
    marginSlots(s, [1.5, 1]).forEach(sl => {
      expect(overlaps([sl.x, sl.y, sl.x + sl.w, sl.y + sl.h], tb)).toBe(false);
    });
  });

  it('the title block counts as occupied', () => {
    const rects = occupiedRects(sheet());
    expect(rects.length).toBe(2); /* one viewport plus the title block */
  });

  it('a sheet too full offers nothing', () => {
    const s = sheet('letter');
    /* A slot wider than the sheet cannot be placed. */
    expect(placeInMargin(s, [99, 1])).toBeNull();
  });
});

describe('annotations occupy space and push later ones aside', () => {
  it('a placed annotation blocks its own slot', () => {
    let s = sheet();
    const first = placeInMargin(s, [1.5, 1]);
    expect(first).toBeTruthy();
    s = addAnnotation(s, makeNote(first.x, first.y, 'GENERAL NOTES', { size: 0.12 }));
    /* Give the note a real footprint so the next slot must avoid it. */
    s.annotations[0].w = 1.5; s.annotations[0].h = 1;
    const second = placeInMargin(s, [1.5, 1]);
    expect(second).toBeTruthy();
    const a = [first.x, first.y, first.x + 1.5, first.y + 1];
    const b = [second.x, second.y, second.x + 1.5, second.y + 1];
    expect(overlaps(a, b)).toBe(false);
  });

  it('annotationRect measures a table from its columns and rows', () => {
    const t = { colW: [0.5, 2], rowH: 0.22, cells: [['A', 'B'], ['C', 'D']], title: 'X' };
    const r = annotationRect(makeTableAnnotation(1, 2, t));
    expect(r[2] - r[0]).toBeCloseTo(2.5, 9);
    expect(r[3] - r[1]).toBeCloseTo(0.66, 9);
  });

  it('viewportClearOfAnnotations insets a view that a table covers', () => {
    const s = sheet();
    const vp = s.viewports[0];
    const rows = Array.from({ length: 40 }, () => ['A', 'B']);
    const table = makeTableAnnotation(vp.px, vp.py, {
      colW: [3, 3], rowH: Math.max(0.2, vp.ph / 42), cells: [['MARK', 'DESC']].concat(rows), title: 'SCHEDULE'
    });
    const cleared = viewportClearOfAnnotations(vp, [table]);
    expect(cleared.pw * cleared.ph).toBeLessThan(vp.pw * vp.ph);
    expect(cleared.pw).toBeLessThanOrEqual(vp.pw);
  });

  it('placeInMargin never returns a slot on the title block', () => {
    const s = sheet();
    const slot = placeInMargin(s, [1.2, 0.8]);
    expect(slot).toBeTruthy();
    expect(slotIsPlaceable(s, [slot.x, slot.y, slot.x + 1.2, slot.y + 0.8])).toBe(true);
    const sh = sheetOf(s.sheet);
    const tb = [SHEET_MARGIN, SHEET_MARGIN, sh.w - SHEET_MARGIN, SHEET_MARGIN + TITLE_BLOCK_H];
    expect(overlaps([slot.x, slot.y, slot.x + 1.2, slot.y + 0.8], tb)).toBe(false);
  });

  it('slotIsFree still means clear of everything, viewports included', () => {
    const s = sheet();
    const vp = s.viewports[0];
    expect(slotIsFree(s, [vp.px + 0.1, vp.py + 0.1, vp.px + 1, vp.py + 1])).toBe(false);
  });
});

describe('a label pushed to the margin keeps a leader to its anchor', () => {
  it('places in the margin and runs a leader from the model point', () => {
    const s = sheet();
    fitViewport(s.viewports[0], [0, 0, 40, 30]);
    const anchor = [20, 15];
    const lab = placeLabelOnSheet(s, s.viewports[0], anchor, 'PAYLOAD FAIRING');
    expect(lab).toBeTruthy();
    expect(lab.kind).toBe('label');
    expect(lab.leader).toBeTruthy();
    /* The leader starts where that model point actually lands on paper. */
    const expected = modelToPaper(s.viewports[0], anchor[0], anchor[1]);
    expect(lab.leader[0][0]).toBeCloseTo(expected[0], 9);
    expect(lab.leader[0][1]).toBeCloseTo(expected[1], 9);
    /* And ends on the label. */
    expect(lab.leader[1][1]).toBeCloseTo(lab.y + lab.size * 1.4 / 2, 9);
  });

  it('the label size is a paper value, unchanged by view scale', () => {
    const a = sheet(); fitViewport(a.viewports[0], [0, 0, 40, 30]);
    const b = sheet(); b.viewports[0].ppf = 4.5; fitViewport(b.viewports[0], [0, 0, 400, 300]);
    const la = placeLabelOnSheet(a, a.viewports[0], [20, 15], 'NOSE CONE');
    const lb = placeLabelOnSheet(b, b.viewports[0], [200, 150], 'NOSE CONE');
    expect(la.size).toBe(lb.size);
  });

  it('returns null rather than stacking labels off the sheet', () => {
    const s = sheet('letter');
    expect(placeLabelOnSheet(s, s.viewports[0], [0, 0], 'X'.repeat(400))).toBeNull();
  });
});

describe('sheet annotations render and export', () => {
  const marked = (() => {
    const ents = cabin24x36();
    const e = ents.find(x => x.type === 'insert') || ents[0];
    setMark(e, 'D-1'); setAttributes(e, { type: 'DOOR', label: 'ENTRY DOOR' });
    return ents;
  })();

  it('a legend annotation reaches the exported PDF', () => {
    let s = sheet();
    fitViewport(s.viewports[0], [0, 0, 40, 30]);
    const t = buildKeynoteLegend(marked, null, [0, 0], { colW: [0.55, 2.1] });
    t.rowH = 0.22;
    const slot = placeInMargin(s, [2.65, (t.cells.length + 1) * 0.22]);
    s = addAnnotation(s, makeTableAnnotation(slot.x, slot.y, t));

    const withAnn = buildLayoutPDF(marked, { layout: s, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    const without = buildLayoutPDF(marked, { layout: sheet(), layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(withAnn.length).toBeGreaterThan(without.length);
    expect(withAnn).toContain('KEYNOTE LEGEND');
    expect(withAnn).toContain('ENTRY DOOR');
  });

  it('a note annotation reaches the exported PDF', () => {
    let s = sheet();
    s = addAnnotation(s, makeNote(1, 20, 'GENERAL NOTES', { size: 0.14 }));
    const pdf = buildLayoutPDF(marked, { layout: s, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(pdf).toContain('GENERAL NOTES');
  });

  it('a sheet with no annotations exports exactly as before', () => {
    const plain = sheet();
    const a = buildLayoutPDF(marked, { layout: plain, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    const b = buildLayoutPDF(marked, { layout: Object.assign({}, plain, { annotations: [] }), layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(a).toBe(b);
  });

  it('annotation coordinates are paper inches, not model feet', () => {
    let s = sheet();
    s = addAnnotation(s, makeNote(2, 20, 'EDGE NOTE', { size: 0.12 }));
    const pdf = buildLayoutPDF(marked, { layout: s, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    /* 2 inches from the left is 144 points, and the text matrix must say so. */
    expect(pdf).toMatch(/144 1440 Tm \(EDGE NOTE\)/);
  });
});
