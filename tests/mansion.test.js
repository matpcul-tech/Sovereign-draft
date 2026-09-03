import { describe, it, expect } from 'vitest';
import { roomLabelSpec, explodeForIO } from '../src/core/entities.js';
import { boxWidth } from '../src/core/textmetrics.js';
import { buildLegend, legendToTable } from '../src/core/legend.js';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { generateSheetSet, visibleWindow } from '../src/core/sheetset.js';
import { defaultLayers } from '../src/core/state.js';

/* From a 12 sheet mansion set sent back from the field: room names half
 * an inch tall at 1/2" and unreadable at 1/16", a legend whose ROOMS rows
 * had a blank ITEM column, a scale bar drawn over hatched floor, and four
 * sheets of the same sports block with only the title moved. */
const room = (name, w, h) => ({ type: 'room', layer: 'ROOMS', name, area: w * h,
  pts: [[0, 0], [w, 0], [w, h], [0, h]], cx: w / 2, cy: h / 2 });

describe('room labels are a paper height on sheets', () => {
  it('prints 1/8 inch tall at 1/4 and at 1/2 inch scale alike', () => {
    for (const ppf of [18, 36]){
      const sp = roomLabelSpec(room('BEDROOM 1', 14, 12), ppf);
      expect(sp.content).toBe('BEDROOM 1  168 SF');
      expect(sp.size * ppf).toBeCloseTo(9, 9);
    }
  });

  it('at 1/8 inch scale the paper label is exactly the 1 ft it always was', () => {
    expect(roomLabelSpec(room('BEDROOM 1', 14, 12), 9).size).toBeCloseTo(1.0, 12);
  });

  it('a room too narrow for name and area keeps the name and drops the area', () => {
    const sp = roomLabelSpec(room('BEDROOM 1', 14, 12), 4.5);
    expect(sp.content).toBe('BEDROOM 1');
    expect(boxWidth(sp.content, sp.size)).toBeLessThanOrEqual(14 * 0.92);
  });

  it('a room narrower than its own name prints no label rather than one through the wall', () => {
    expect(roomLabelSpec(room('MECHANICAL CLOSET', 3, 3), 4.5)).toBe(null);
    const parts = explodeForIO(room('MECHANICAL CLOSET', 3, 3), { annoPpf: 4.5 });
    expect(parts.some(p => p.type === 'text')).toBe(false);
  });

  it('without a scale the label is the 1 ft model text, so DXF and screen do not move', () => {
    const sp = roomLabelSpec(room('BEDROOM 1', 14, 12));
    expect(sp.size).toBe(1.0);
    expect(explodeForIO(room('BEDROOM 1', 14, 12)).find(p => p.type === 'text').size).toBe(1.0);
  });

  it('the label never runs wider than the room on any sheet', () => {
    for (const ppf of [4.5, 9, 18, 36, 72]){
      for (const [n, w] of [['BEDROOM 1', 14], ['10-CAR GARAGE', 40], ['BATHROOM 2', 14], ['POOL', 30]]){
        const sp = roomLabelSpec(room(n, w, 12), ppf);
        if (sp) expect(boxWidth(sp.content, sp.size), n + ' at ' + ppf).toBeLessThanOrEqual(w * 0.92 + 1e-9);
      }
    }
  });
});

describe('the legend ROOMS rows read name then area', () => {
  it('puts the name in ITEM and the area in MEANING', () => {
    const lg = buildLegend([room('BEDROOM 1', 14, 12), room('POOL', 30, 28)]);
    const t = legendToTable(lg);
    const rows = t.cells.slice(1);
    const r = rows.find(c => c[0] === 'BEDROOM 1');
    expect(r).toBeTruthy();
    expect(r[1]).toBe('168 SF');
    /* No row has a blank item with the name jammed into the meaning. */
    expect(rows.some(c => c[0] === '' && /BEDROOM/.test(c[1]))).toBe(false);
  });
});

describe('the scale bar sits on a white card', () => {
  it('paints a backing before the bar segments', () => {
    const ents = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 30, y2: 0 },
      { type: 'hatch', layer: 'HATCH', pts: [[0, 0], [30, 0], [30, 20], [0, 20]], pattern: 'ANSI31', scale: 1, angle: 0 }];
    const sheets = generateSheetSet(ents, defaultLayers(), {});
    const pdf = buildAllSheetsPDF(ents, { sheets, layerVisible: () => true, projectName: 'T', dateStr: '2026-01-01' }).pdf;
    /* The backing is a white fill immediately followed by the first bar
     * segment; a bar over hatch used to start with the segment. */
    expect(/1 g\n[\d.\-]+ [\d.\-]+ [\d.\-]+ 18 re f\n0\.92 g/.test(pdf)).toBe(true);
  });
});

describe('a sheet that already shows a room in full is not printed again with a new title', () => {
  const room = (name, x, y, w, h) => ({ type: 'room', layer: 'ROOMS', name, area: w * h,
    pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], cx: x + w / 2, cy: y + h / 2 });
  const wall = (x1, y1, x2, y2) => ({ type: 'line', layer: 'WALLS', x1, y1, x2, y2 });
  const box = (n, x, y, w, h) => [room(n, x, y, w, h), wall(x, y, x + w, y), wall(x + w, y, x + w, y + h), wall(x + w, y + h, x, y + h), wall(x, y + h, x, y)];
  /* The field set: six bedrooms, two baths, a living room, a garage and
   * a sports block of pool, tennis, movie theater and archery range,
   * at the sizes on the room schedule that came back. */
  const mansion = () => [].concat(
    ...[['BEDROOM 1', 0, 0], ['BEDROOM 2', 14, 0], ['BEDROOM 3', 29, 0], ['BEDROOM 4', 0, 12], ['BEDROOM 5', 14, 12], ['BEDROOM 6', 29, 12]]
      .map(([n, x, y]) => box(n, x, y, x ? 15 : 14, 12)),
    box('BATHROOM 1', -14, 0, 14, 12), box('BATHROOM 2', -14, 12, 14, 12),
    box('LIVING 2', -14, 24, 22, 24), box('10-CAR GARAGE', 44, 0, 40, 23.5),
    box('POOL', 100, 0, 30, 28), box('TENNIS COURT', 130, 0, 30, 28),
    box('MOVIE THEATER', 100, 28, 30, 60), box('ARCHERY RANGE', 130, 28, 30, 60));

  it('a room an earlier sheet already shows in full gets no sheet of its own', () => {
    /* A pool and the corridor under it. The pool sheet at 1/2" prints a
     * window 62 ft by 44 ft; the corridor sits inside it whole, so a
     * second sheet of the same window titled CORRIDOR is waste. */
    const ents = [].concat(box('POOL', 0, 28, 30, 28), box('CORRIDOR', 0, 20, 30, 8));
    const sections = generateSheetSet(ents, defaultLayers(), {}).filter(L => L.kind === 'section');
    expect(sections.length).toBe(1);
    expect(sections[0].name).toMatch(/POOL/);
    expect(sections[0].name).toMatch(/CORRIDOR/);
    expect(sections[0].sheetNumber).toBe('A-102');
  });

  it('the field set of fifteen rooms folds below the cap and every name survives', () => {
    const sheets = generateSheetSet(mansion(), defaultLayers(), {});
    const sections = sheets.filter(L => L.kind === 'section');
    expect(sections.length).toBeLessThan(10);
    /* Numbers stay sequential after the fold. */
    sections.forEach((L, i) => expect(L.sheetNumber).toBe('A-' + (102 + i)));
    const names = sections.map(L => L.name.toUpperCase()).join(' | ');
    for (const n of ['POOL', 'TENNIS', 'MOVIE', 'ARCHERY', 'GARAGE', 'LIVING', 'BATHROOM', 'BEDROOM'])
      expect(names, n + ' fell off the set').toContain(n);
  });

  it('no section sheet repeats a room an earlier sheet already shows in full', () => {
    const sections = generateSheetSet(mansion(), defaultLayers(), {}).filter(L => L.kind === 'section');
    sections.forEach((L, i) => {
      const bb = L.section.bbox;
      const shownBefore = sections.slice(0, i).some(K => {
        const w = visibleWindow(K);
        return bb[0] >= w[0] - 0.5 && bb[1] >= w[1] - 0.5 && bb[2] <= w[2] + 0.5 && bb[3] <= w[3] + 0.5;
      });
      expect(shownBefore, L.name + ' repeats an earlier sheet').toBe(false);
    });
  });

  it('every room is printed in full on some section sheet', () => {
    const ents = mansion();
    const sheets = generateSheetSet(ents, defaultLayers(), {});
    const wins = sheets.filter(L => L.kind === 'section').map(visibleWindow);
    for (const r of ents.filter(e => e.type === 'room')){
      const bb = [Math.min(...r.pts.map(p => p[0])), Math.min(...r.pts.map(p => p[1])), Math.max(...r.pts.map(p => p[0])), Math.max(...r.pts.map(p => p[1]))];
      const shown = wins.some(w => bb[0] >= w[0] - 0.5 && bb[1] >= w[1] - 0.5 && bb[2] <= w[2] + 0.5 && bb[3] <= w[3] + 0.5);
      expect(shown, r.name + ' is on no sheet in full').toBe(true);
    }
  });

  it('two rooms that need different scales keep their own sheets', () => {
    const ents = [].concat(box('CLOSET', 0, 0, 4, 4), box('HANGAR', 200, 0, 300, 200));
    const sections = generateSheetSet(ents, defaultLayers(), {}).filter(L => L.kind === 'section');
    expect(sections.length).toBe(2);
  });
});

describe('a room the frame cuts through prints its walls and not half a label', () => {
  it('the label of a room straddling the viewport edge is left off', async () => {
    const { makeLayout, makeViewport, fitViewport } = await import('../src/core/layout.js');
    const { buildLayoutPDF } = await import('../src/io/pdf.js');
    const room = (name, x, y, w, h) => ({ type: 'room', layer: 'ROOMS', name, area: w * h,
      pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], cx: x + w / 2, cy: y + h / 2 });
    /* A 1/2" viewport on Arch D shows about 70 by 43 ft. INSIDE sits at
     * the centre; STRADDLE starts inside and runs 40 ft past the edge. */
    const vp = makeViewport('archd', 36);
    vp.mx = 0; vp.my = 0;
    const layout = makeLayout({ id: 'T1', name: 'T-1', sheet: 'archd', ppf: 36, viewports: [vp] });
    const ents = [room('INSIDE', -7, -6, 14, 12), room('STRADDLE', 20, -6, 60, 12)];
    const pdf = buildLayoutPDF(ents, { layout, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(pdf).toContain('INSIDE');
    expect(pdf).not.toContain('STRADDLE');
    /* The straddling room walls still print: two closed polygons
     * reach the page, not one. */
    expect((pdf.match(/ h S\n/g) || []).length).toBeGreaterThanOrEqual(2);
    void fitViewport;
  });
});
