import { describe, it, expect } from 'vitest';
import {
  collectMarks, keynoteRows, buildKeynoteLegend, markScheduleRows,
  buildMarkSchedule, attributeKeys, markScheduleCSV,
  entitiesInView, entitiesOnSheet, viewModelWindow
} from '../src/core/keynote.js';
import { schemaToEntities } from '../src/ai/draft.js';
import { normalizeSheets } from '../src/core/document.js';
import { makeLayout, makeViewport, fitViewport } from '../src/core/layout.js';
import { setMark, setAttributes } from '../src/core/document.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

function engine(i, x, y){
  const e = { id: 100 + i, type: 'circle', layer: 'FIXTURES', cx: x, cy: y, r: 1 };
  setMark(e, 'E-' + i);
  setAttributes(e, { type: 'MERLIN 1D', material: 'INCONEL', size: '4FT', label: 'MERLIN 1D ENGINE' });
  return e;
}

describe('nine engines become nine instances of one part', () => {
  const nine = Array.from({ length: 9 }, (_, i) => engine(i + 1, i * 3, 0));

  it('collects one row per mark', () => {
    const groups = collectMarks(nine);
    expect(groups.length).toBe(9);
    expect(groups.map(g => g.mark)).toEqual(['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'E-8', 'E-9']);
    expect(groups.every(g => g.qty === 1)).toBe(true);
  });

  it('one mark with qty 9 tabulates to the same total', () => {
    const one = { id: 1, type: 'circle', layer: 'FIXTURES', cx: 0, cy: 0, r: 1 };
    setMark(one, 'E');
    setAttributes(one, { type: 'MERLIN 1D', qty: 9 });
    const groups = collectMarks([one]);
    expect(groups.length).toBe(1);
    expect(groups[0].qty).toBe(9);
    expect(collectMarks(nine).reduce((n, g) => n + g.qty, 0)).toBe(9);
  });

  it('sorts marks naturally, so E-10 follows E-9', () => {
    const many = [engine(9, 0, 0), engine(10, 3, 0), engine(1, 6, 0)];
    expect(collectMarks(many).map(g => g.mark)).toEqual(['E-1', 'E-9', 'E-10']);
  });

  it('ignores unmarked entities entirely', () => {
    const mixed = nine.concat([{ id: 900, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(collectMarks(mixed).length).toBe(9);
  });
});

describe('a legend is derived, not authored', () => {
  const nine = Array.from({ length: 9 }, (_, i) => engine(i + 1, i * 3, 0));

  it('rows are mark and description', () => {
    const rows = keynoteRows(nine, null);
    expect(rows.length).toBe(9);
    expect(rows[0][0]).toBe('E-1');
    expect(rows[0][1]).toBe('MERLIN 1D ENGINE');
  });

  it('builds a table entity that can live on a sheet', () => {
    const t = buildKeynoteLegend(nine, null, [10, 10]);
    expect(t.type).toBe('table');
    expect(t.title).toBe('KEYNOTE LEGEND');
    expect(t.cells[0]).toEqual(['MARK', 'DESCRIPTION']);
    expect(t.cells.length).toBe(10);
    expect(t.x).toBe(10);
  });
});

describe('a legend is scoped to the sheet it sits on', () => {
  /* Two engines far apart. A view over one must not list the other. */
  const near = engine(1, 0, 0);
  const far = engine(2, 4000, 0);
  const ents = [near, far];

  function sheetOverOrigin(){
    const sheet = normalizeSheets([makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 })])[0];
    fitViewport(sheet.viewports[0], [-10, -10, 10, 10]);
    return sheet;
  }

  it('a view window is a real model rectangle', () => {
    const sheet = sheetOverOrigin();
    const win = viewModelWindow(sheet.viewports[0]);
    expect(win[0]).toBeLessThan(0);
    expect(win[2]).toBeGreaterThan(0);
    expect(win[2]).toBeLessThan(4000);
  });

  it('lists only what the sheet actually shows', () => {
    const sheet = sheetOverOrigin();
    const rows = keynoteRows(ents, sheet);
    expect(rows.map(r => r[0])).toEqual(['E-1']);
  });

  it('with no sheet it lists everything', () => {
    expect(keynoteRows(ents, null).map(r => r[0])).toEqual(['E-1', 'E-2']);
  });

  it('entitiesInView and entitiesOnSheet agree for a single view sheet', () => {
    const sheet = sheetOverOrigin();
    const a = entitiesInView(ents, sheet.viewports[0]).map(e => e.mark);
    const b = entitiesOnSheet(ents, sheet).map(e => e.mark);
    expect(a).toEqual(b);
  });

  it('a second view widens what the sheet lists', () => {
    const sheet = sheetOverOrigin();
    const vp = makeViewport('archd', 18);
    fitViewport(vp, [3990, -10, 4010, 10]);
    sheet.viewports.push(vp);
    expect(keynoteRows(ents, sheet).map(r => r[0])).toEqual(['E-1', 'E-2']);
  });
});

describe('a schedule tabulates mark, qty and attributes', () => {
  const nine = Array.from({ length: 9 }, (_, i) => engine(i + 1, i * 3, 0));

  it('discovers the attribute columns present', () => {
    expect(attributeKeys(nine)).toEqual(['label', 'material', 'size', 'type']);
  });

  it('rows carry mark, qty then the requested columns', () => {
    const rows = markScheduleRows(nine, null, ['type', 'material']);
    expect(rows[0]).toEqual(['E-1', '1', 'MERLIN 1D', 'INCONEL']);
  });

  it('builds a table entity', () => {
    const t = buildMarkSchedule(nine, null, [0, 0], { columns: ['type', 'material'] });
    expect(t.type).toBe('table');
    expect(t.cells[0]).toEqual(['MARK', 'QTY', 'TYPE', 'MATERIAL']);
    expect(t.cells.length).toBe(10);
  });

  it('exports CSV', () => {
    const csv = markScheduleCSV(nine, null, ['type']);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('MARK,QTY,TYPE');
    expect(lines[1]).toBe('E-1,1,MERLIN 1D');
    expect(lines.length).toBe(10);
  });

  it('quotes a value containing a comma', () => {
    const e = { id: 1, type: 'circle', cx: 0, cy: 0, r: 1 };
    setMark(e, 'X-1'); setAttributes(e, { type: 'A, B' });
    expect(markScheduleCSV([e], null, ['type'])).toContain('"A, B"');
  });
});

describe('the AI can mark parts', () => {
  it('marks and attributes survive realization', () => {
    const ents = schemaToEntities({
      drawingType: 'part',
      profiles: [
        { pts: [[0, 0], [4, 0], [4, 4], [0, 4]], mark: 'E-1', attrs: { type: 'MERLIN 1D', qty: 1 } },
        { pts: [[6, 0], [10, 0], [10, 4], [6, 4]], mark: 'E-2', attrs: { type: 'MERLIN 1D' } }
      ],
      callouts: [{ anchor: [2, 2], text: 'ENGINE', mark: 'N-1', attrs: { type: 'NOTE' } }]
    }, idLayer);
    const marked = ents.filter(e => e.mark);
    expect(marked.length).toBe(3);
    const groups = collectMarks(ents);
    expect(groups.map(g => g.mark)).toEqual(['E-1', 'E-2', 'N-1']);
    expect(groups[0].attributes.type).toBe('MERLIN 1D');
  });

  it('an unmarked entity gains no mark or attributes field', () => {
    const ents = schemaToEntities({
      drawingType: 'part',
      profiles: [{ pts: [[0, 0], [4, 0], [4, 4], [0, 4]] }]
    }, idLayer);
    const p = ents.find(e => e.type === 'profile');
    expect('mark' in p).toBe(false);
    expect('attributes' in p).toBe(false);
  });

  it('nine marked engines schedule as nine', () => {
    const ents = schemaToEntities({
      drawingType: 'part',
      profiles: Array.from({ length: 9 }, (_, i) => ({
        pts: [[i * 3, 0], [i * 3 + 2, 0], [i * 3 + 2, 2], [i * 3, 2]],
        mark: 'E-' + (i + 1),
        attrs: { type: 'MERLIN 1D', label: 'MERLIN 1D ENGINE' }
      }))
    }, idLayer);
    const groups = collectMarks(ents);
    expect(groups.length).toBe(9);
    expect(groups.reduce((n, g) => n + g.qty, 0)).toBe(9);
    expect(keynoteRows(ents, null)[0]).toEqual(['E-1', 'MERLIN 1D ENGINE']);
  });
});
