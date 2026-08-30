import { describe, it, expect } from 'vitest';
import { realizeDocument, realizeResponse, schemaToSheets, parseScale, schemaToEntities } from '../src/ai/draft.js';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { collectMarks } from '../src/core/keynote.js';
import { SHEETS } from '../src/core/layout.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

/* The rocket from the plan: one body, nine engines, three sheets. */
function rocketDoc(){
  return JSON.stringify({
    drawingType: 'elevation',
    profiles: [
      { pts: [[0, 0], [8, 0], [8, 44], [4, 60], [0, 44]], mark: 'S-1', attrs: { type: 'FIRST STAGE', label: 'FIRST STAGE BODY' } }
    ].concat(Array.from({ length: 9 }, (_, i) => ({
      pts: [[0.4 + i * 0.8, -2], [1.1 + i * 0.8, -2], [1.1 + i * 0.8, -0.2], [0.4 + i * 0.8, -0.2]],
      mark: 'E-' + (i + 1),
      attrs: { type: 'MERLIN 1D', label: 'MERLIN 1D ENGINE' }
    }))),
    centerlines: [{ pts: [[4, -3], [4, 62]] }],
    dims: [{ a: [-4, 0, -4, 20] }, { a: [-4, 20, -4, 40] }, { a: [-4, 40, -4, 60] }],
    sheets: [
      { number: 'A-1', name: 'OVERALL ELEVATION', size: 'archd', annotations: ['keynoteLegend'],
        views: [{ name: 'SOUTH ELEVATION', scale: '1/16', drawingType: 'elevation', extents: [-6, -4, 10, 62] }] },
      { number: 'A-2', name: 'ENGINE BAY', size: 'letter', annotations: ['schedule'],
        views: [{ name: 'ENGINE BAY', scale: '1/2', drawingType: 'part', extents: [0, -3, 8, 1] }] },
      { number: 'A-3', name: 'STAGE SECTIONS', size: 'tabloid',
        views: [{ name: 'LOWER', scale: '1/4', drawingType: 'section', extents: [0, 0, 8, 30] },
                { name: 'UPPER', scale: '1/4', drawingType: 'section', extents: [0, 30, 8, 60] }] }
    ]
  });
}

describe('scale parsing', () => {
  it('reads architectural fractions', () => {
    expect(parseScale('1/16')).toBe(4.5);
    expect(parseScale('1/8')).toBe(9);
    expect(parseScale('1/4')).toBe(18);
    expect(parseScale('1/2')).toBe(36);
    expect(parseScale('3/8')).toBe(27);
  });
  it('reads a full scale label', () => {
    expect(parseScale('1/4" = 1\'-0"')).toBe(18);
  });
  it('reads points per foot directly', () => {
    expect(parseScale(18)).toBe(18);
    expect(parseScale(4.5)).toBe(4.5);
  });
  it('snaps an odd value to the nearest standard scale', () => {
    expect(parseScale(17)).toBe(18);
    expect(parseScale('1/5')).toBe(13.5);
  });
  it('falls back to 1/4 for nonsense', () => {
    expect(parseScale('banana')).toBe(18);
    expect(parseScale(null)).toBe(18);
  });
});

describe('the rocket comes back as a sheet set', () => {
  const doc = realizeDocument(rocketDoc(), idLayer);

  it('returns geometry and sheets together', () => {
    expect(doc.entities.length).toBeGreaterThan(0);
    expect(doc.sheets.length).toBe(3);
    expect(doc.drawingType).toBe('elevation');
  });

  it('matches the sheet set from the plan', () => {
    const [a1, a2, a3] = doc.sheets;
    expect(a1.sheetNumber).toBe('A-1');
    expect(a1.viewports[0].ppf).toBe(4.5);        /* 1/16" */
    expect(a1.annotations.length).toBe(1);        /* keynote legend */

    expect(a2.sheetNumber).toBe('A-2');
    expect(a2.viewports[0].ppf).toBe(36);         /* 1/2" */
    expect(a2.annotations.length).toBe(1);        /* engine schedule */

    expect(a3.sheetNumber).toBe('A-3');
    expect(a3.viewports.length).toBe(2);          /* stage sections */
    expect(a3.viewports.every(v => v.ppf === 18)).toBe(true);
  });

  it('geometry is drawn once, not once per sheet', () => {
    /* Ten marked parts plus a centerline plus three dims. Three sheets do not
     * multiply that. */
    expect(doc.entities.length).toBe(14);
    expect(collectMarks(doc.entities).length).toBe(10);
  });

  it('each sheet carries its own size', () => {
    expect(doc.sheets.map(s => s.sheet)).toEqual(['archd', 'letter', 'tabloid']);
  });

  it('each view carries its own drawing type', () => {
    expect(doc.sheets[0].viewports[0].drawingType).toBe('elevation');
    expect(doc.sheets[1].viewports[0].drawingType).toBe('part');
    expect(doc.sheets[2].viewports.map(v => v.drawingType)).toEqual(['section', 'section']);
  });

  it('views are windowed on the extents they were given', () => {
    const engineView = doc.sheets[1].viewports[0];
    /* Centre of [0,-3,8,1] is (4,-1). */
    expect(engineView.mx).toBeCloseTo(4, 6);
    expect(engineView.my).toBeCloseTo(-1, 6);
  });

  it('views stack rather than overlap when a sheet has several', () => {
    const [v1, v2] = doc.sheets[2].viewports;
    const a = [v1.px, v1.py, v1.px + v1.pw, v1.py + v1.ph];
    const b = [v2.px, v2.py, v2.px + v2.pw, v2.py + v2.ph];
    const overlap = !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
    expect(overlap).toBe(false);
  });

  it('exports as one PDF, one page per sheet, each at its own size', () => {
    const r = buildAllSheetsPDF(doc.entities, {
      sheets: doc.sheets, layerVisible: () => true, dateStr: '2026-01-01'
    });
    expect(r.pages).toBe(3);
    const boxes = [...r.pdf.matchAll(/MediaBox \[0 0 (\d+) (\d+)\]/g)].map(m => m[1] + 'x' + m[2]);
    expect(boxes).toEqual([
      Math.round(SHEETS.archd.w * 72) + 'x' + Math.round(SHEETS.archd.h * 72),
      Math.round(SHEETS.letter.w * 72) + 'x' + Math.round(SHEETS.letter.h * 72),
      Math.round(SHEETS.tabloid.w * 72) + 'x' + Math.round(SHEETS.tabloid.h * 72)
    ]);
    expect(r.pdf).toContain('OF 3');
    expect(r.pdf).toContain('KEYNOTE LEGEND');
  });

  it('the legend on A-1 lists the marked parts', () => {
    const legend = doc.sheets[0].annotations[0];
    expect(legend.kind).toBe('table');
    expect(legend.table.title).toBe('KEYNOTE LEGEND');
    const marks = legend.table.cells.slice(1).map(r => r[0]);
    expect(marks).toContain('E-1');
    expect(marks).toContain('S-1');
  });
});

describe('the old contract still works', () => {
  it('a response with no sheets returns none, and entities are unchanged', () => {
    const noSheets = JSON.stringify({
      drawingType: 'elevation',
      profiles: [{ pts: [[0, 0], [8, 0], [8, 44], [4, 60], [0, 44]] }]
    });
    const doc = realizeDocument(noSheets, idLayer);
    expect(doc.sheets).toEqual([]);
    const viaOld = realizeResponse(noSheets, idLayer);
    expect(doc.entities.length).toBe(viaOld.length);
  });

  it('legacy raw items still realize', () => {
    const doc = realizeDocument('{"e":[{"t":"l","ly":"WALLS","a":[0,0,10,0]}]}', idLayer);
    expect(doc.entities[0].type).toBe('line');
    expect(doc.sheets).toEqual([]);
    expect(doc.drawingType).toBe('plan');
  });

  it('a cabin plan is untouched by the sheet code', () => {
    const cabin = { walls: [{ a: [0, 0, 24, 0], th: 0.5 }], rooms: [{ name: 'KITCHEN', pts: [[1, 1], [10, 1], [10, 10], [1, 10]] }] };
    const direct = schemaToEntities(cabin, idLayer);
    const doc = realizeDocument(JSON.stringify(cabin), idLayer);
    expect(doc.entities.length).toBe(direct.length);
    expect(doc.sheets).toEqual([]);
  });
});

describe('malformed sheet proposals do not break realization', () => {
  it('a sheet with no views still yields one view', () => {
    const sheets = schemaToSheets({ sheets: [{ number: 'A-1' }] }, [{ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }]);
    expect(sheets.length).toBe(1);
    expect(sheets[0].viewports.length).toBe(1);
  });
  it('an unknown sheet size falls back to arch D', () => {
    const sheets = schemaToSheets({ sheets: [{ number: 'A-1', size: 'poster' }] }, [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(sheets[0].sheet).toBe('archd');
  });
  it('missing numbers are filled in sequence', () => {
    const sheets = schemaToSheets({ sheets: [{}, {}] }, [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(sheets.map(s => s.sheetNumber)).toEqual(['A-1', 'A-2']);
  });
  it('a legend is skipped when nothing is marked', () => {
    const sheets = schemaToSheets(
      { sheets: [{ number: 'A-1', annotations: ['keynoteLegend'] }] },
      [{ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }]
    );
    expect(sheets[0].annotations.length).toBe(0);
  });
  it('caps a runaway sheet count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ number: 'A-' + (i + 1) }));
    const sheets = schemaToSheets({ sheets: many }, [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(sheets.length).toBeLessThanOrEqual(12);
  });
});
