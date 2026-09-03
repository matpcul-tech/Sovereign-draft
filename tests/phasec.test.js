import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildPDF, buildAllSheetsPDF, buildLayoutPDF, wrapPDFPages } from '../src/io/pdf.js';
import { cabin24x36 } from '../src/core/demo.js';
import { makeLayout, makeViewport, SHEETS } from '../src/core/layout.js';
import {
  normalizeSheets, addSheet, removeSheet, addViewToSheet, findSheet,
  nextSheetNumber, sheetLabel
} from '../src/core/document.js';

const vis = () => true;
function hash(s){ return createHash('sha256').update(s).digest('hex').slice(0, 16); }
function sheets(){
  return normalizeSheets([
    makeLayout({ id: 'A1', name: 'A-1 Plan', sheet: 'archd', ppf: 18 }),
    makeLayout({ id: 'A2', name: 'A-2 Detail', sheet: 'letter', ppf: 36 }),
    makeLayout({ id: 'A3', name: 'A-3 Elevations', sheet: 'tabloid', ppf: 9 })
  ]);
}

describe('multiple sheets', () => {
  it('adds sheets with sequential numbers', () => {
    let list = normalizeSheets([makeLayout({ id: 'A1', name: 'A-1' })]);
    expect(list[0].sheetNumber).toBe('A-1');
    list = addSheet(list, makeLayout, {});
    list = addSheet(list, makeLayout, {});
    expect(list.map(s => s.sheetNumber)).toEqual(['A-1', 'A-2', 'A-3']);
    expect(new Set(list.map(s => s.id)).size).toBe(3);
  });
  it('nextSheetNumber skips numbers already taken', () => {
    expect(nextSheetNumber([{ sheetNumber: 'A-1' }, { sheetNumber: 'A-3' }])).toBe('A-2');
    expect(nextSheetNumber([])).toBe('A-1');
  });
  it('removes a sheet but never empties the document', () => {
    const list = sheets();
    expect(removeSheet(list, 'A2').length).toBe(2);
    const single = normalizeSheets([makeLayout({ id: 'A1' })]);
    expect(removeSheet(single, 'A1').length).toBe(1);
  });
  it('finds a sheet by id', () => {
    expect(findSheet(sheets(), 'A2').name).toBe('A-2 Detail');
    expect(findSheet(sheets(), 'nope')).toBeNull();
  });
});

describe('multiple views per sheet', () => {
  it('views number from one and keep their viewport geometry', () => {
    const sheet = normalizeSheets([makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 })])[0];
    const vp = makeViewport('archd', 36);
    const updated = addViewToSheet(sheet, vp, { drawingType: 'elevation', name: 'SOUTH' });
    expect(updated.viewports.length).toBe(2);
    expect(updated.viewports.map(v => v.id)).toEqual([1, 2]);
    const added = updated.viewports[1];
    expect(added.drawingType).toBe('elevation');
    expect(added.ppf).toBe(36);
    expect(added.pw).toBe(vp.pw);
  });
  it('each view can carry its own scale and drawing type', () => {
    let sheet = normalizeSheets([makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 })])[0];
    sheet = addViewToSheet(sheet, makeViewport('archd', 4.5), { drawingType: 'elevation' });
    sheet = addViewToSheet(sheet, makeViewport('archd', 36), { drawingType: 'section' });
    expect(sheet.viewports.map(v => v.ppf)).toEqual([18, 4.5, 36]);
    expect(sheet.viewports.map(v => v.drawingType)).toEqual(['plan', 'elevation', 'section']);
  });
  it('every view on a sheet is exported, not just the first', () => {
    let sheet = normalizeSheets([makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 })])[0];
    const one = buildLayoutPDF(cabin24x36(), { layout: sheet, layerVisible: vis, dateStr: '2026-01-01' }).pdf;
    sheet = addViewToSheet(sheet, makeViewport('archd', 9), { drawingType: 'plan' });
    const two = buildLayoutPDF(cabin24x36(), { layout: sheet, layerVisible: vis, dateStr: '2026-01-01' }).pdf;
    expect(two.length).toBeGreaterThan(one.length);
  });
});

describe('PDF exports all sheets', () => {
  const ents = cabin24x36();

  it('one page per sheet, in order', () => {
    const r = buildAllSheetsPDF(ents, { sheets: sheets(), layerVisible: vis, dateStr: '2026-01-01' });
    expect(r.pages).toBe(3);
    expect(/\/Count (\d+)/.exec(r.pdf)[1]).toBe('3');
    const kids = /\/Kids \[([^\]]*)\]/.exec(r.pdf)[1].trim().split(/\s+0 R\s*/).filter(Boolean);
    expect(kids.length).toBe(3);
  });

  it('each page carries its own sheet size', () => {
    const r = buildAllSheetsPDF(ents, { sheets: sheets(), layerVisible: vis, dateStr: '2026-01-01' });
    const boxes = [...r.pdf.matchAll(/MediaBox \[0 0 (\d+) (\d+)\]/g)].map(m => m[1] + 'x' + m[2]);
    expect(boxes).toEqual([
      Math.round(SHEETS.archd.w * 72) + 'x' + Math.round(SHEETS.archd.h * 72),
      Math.round(SHEETS.letter.w * 72) + 'x' + Math.round(SHEETS.letter.h * 72),
      Math.round(SHEETS.tabloid.w * 72) + 'x' + Math.round(SHEETS.tabloid.h * 72)
    ]);
  });

  it('title blocks carry the sheet count', () => {
    const r = buildAllSheetsPDF(ents, { sheets: sheets(), layerVisible: vis, dateStr: '2026-01-01' });
    expect(r.pdf).toContain('OF 3');
  });

  it('the document is structurally valid', () => {
    const r = buildAllSheetsPDF(ents, { sheets: sheets(), layerVisible: vis, dateStr: '2026-01-01' });
    expect(r.pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(r.pdf.trim().endsWith('%%EOF')).toBe(true);
    /* xref offsets must land on their own object headers. */
    const xref = r.pdf.slice(r.pdf.indexOf('xref'));
    const offsets = xref.split('\n').slice(2).filter(l => /^\d{10} 00000 n/.test(l)).map(l => parseInt(l, 10));
    offsets.forEach((off, i) => {
      expect(r.pdf.slice(off, off + 24)).toMatch(new RegExp('^' + (i + 1) + ' 0 obj'));
    });
    /* Both fonts are declared once and referenced by every page. */
    expect((r.pdf.match(/BaseFont \/Helvetica >>/g) || []).length).toBe(1);
    expect((r.pdf.match(/BaseFont \/Helvetica-Bold/g) || []).length).toBe(1);
  });

  it('falls back to the single page writer when there are no sheets', () => {
    const r = buildAllSheetsPDF(ents, { sheets: [], ppf: 18, layerVisible: vis, dateStr: '2026-01-01' });
    expect(/\/Count (\d+)/.exec(r.pdf)[1]).toBe('1');
  });
});

describe('single sheet output is unchanged by the multi page writer', () => {
  it('wrapPDFPages with one page equals the old single page layout', () => {
    const one = wrapPDFPages([{ stream: 'q Q', pageW: 792, pageH: 612 }]);
    expect(one).toContain('/Kids [3 0 R] /Count 1');
    expect(one).toContain('3 0 obj\n<< /Type /Page');
    expect(one).toContain('/F1 5 0 R /F2 6 0 R');
    expect(one).toContain('5 0 obj\n<< /Type /Font');
  });
  it('a one sheet document exports the same bytes as buildLayoutPDF', () => {
    const sheet = normalizeSheets([makeLayout({ id: 'A1', name: 'A-1 Plan', sheet: 'archd', ppf: 18 })]);
    const single = buildLayoutPDF(cabin24x36(), { layout: sheet[0], layerVisible: vis, dateStr: '2026-01-01' }).pdf;
    const all = buildAllSheetsPDF(cabin24x36(), { sheets: sheet, layerVisible: vis, dateStr: '2026-01-01' }).pdf;
    expect(hash(all)).toBe(hash(single));
  });
  it('model space export is untouched', () => {
    /* Hash regenerated with the corrected cabin (fillet keeps wall
     * identity, west wall restored); see the note in phaseb.test.js. */
    const r = buildPDF(cabin24x36(), { ppf: 18, layerVisible: vis, projectName: 'CABIN', dateStr: '2026-01-01' });
    /* Regenerated 2026-09-03 (third pass): the room schedule's FINISH
     * column stopped printing the internal marker LIVE. Matches the
     * phaseb cabin:18 baseline as it always has. */
    expect(hash(r.pdf)).toBe('c120d4f53ba57c31');
  });
});

describe('sheet labels', () => {
  it('gain a count only once there is more than one sheet', () => {
    expect(sheetLabel('A-1', 0, 1)).toBe('SHEET A-1');
    expect(sheetLabel('A-2', 1, 4)).toBe('SHEET A-2 OF 4');
  });
});
