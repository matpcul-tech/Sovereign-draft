import { describe, it, expect } from 'vitest';
import { buildDXF, openDXF } from '../src/io/dxf.js';
import { buildPDF } from '../src/io/pdf.js';
import { defaultLayers } from '../src/core/state.js';

/* One of every authorable entity type, and what the R2000 DXF round trip
 * is contracted to give back: the entity itself, or a specific explosion
 * into primitives. The DWG is this DXF in an AC1015 wrapper, so this
 * matrix is also the DWG self round trip. A change that silently demotes
 * a type (the way GD&T frames once round tripped to nothing at all)
 * fails here by name. */
const CASES = [
  ['line', { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 }, { line: 1 }],
  ['poly', { type: 'poly', layer: 'WALLS', closed: false, pts: [[0, 0], [5, 5], [10, 0]] }, { poly: 1 }],
  ['circle', { type: 'circle', layer: 'WALLS', cx: 5, cy: 5, r: 3 }, { circle: 1 }],
  ['arc', { type: 'arc', layer: 'WALLS', cx: 5, cy: 5, r: 3, a1: 0, a2: 90 }, { arc: 1 }],
  ['text', { type: 'text', layer: 'TEXT', x: 1, y: 1, size: 1, content: 'hello' }, { text: 1 }],
  ['mtext', { type: 'mtext', layer: 'TEXT', x: 1, y: 3, w: 10, size: 1, content: 'wrapped words here' }, { text: 1 }],
  ['dim', { type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }, { line: 5, text: 1 }],
  ['hatch', { type: 'hatch', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4], [0, 4]], pattern: 'ANSI31', scale: 1, angle: 0 }, { line: 8 }],
  ['ellipse', { type: 'ellipse', layer: 'WALLS', cx: 5, cy: 5, rx: 4, ry: 2, rot: 15 }, { poly: 1 }],
  ['leader', { type: 'leader', layer: 'TEXT', pts: [[0, 0], [4, 4]], content: 'note', textH: 1 }, { poly: 1, text: 1 }],
  ['cloud', { type: 'cloud', layer: 'TEXT', pts: [[0, 0], [6, 0], [6, 4], [0, 4]], amp: 0.7 }, { poly: 1 }],
  ['image', { type: 'image', layer: 'DETAIL', x: 0, y: 0, w: 8, h: 5, rot: 0, src: 'data:image/jpeg;base64,AAAA' }, { poly: 1 }],
  ['room', { type: 'room', layer: 'ROOMS', name: 'DEN', pts: [[0, 0], [8, 0], [8, 8], [0, 8]], cx: 4, cy: 4, area: 64 }, { poly: 1, text: 1 }],
  ['grid', { type: 'grid', layer: 'CENTER', x: 0, y: 0, cols: 3, rows: 2, cx: 10, ry: 8, rot: 0, bubble: 1 }, { line: 7, circle: 7, text: 7 }],
  ['xline', { type: 'xline', layer: 'CENTER', x1: 0, y1: 0, x2: 1, y2: 1 }, { line: 1 }],
  ['spline', { type: 'spline', layer: 'WALLS', ctrl: [[0, 0], [3, 6], [7, -2], [10, 3]], degree: 3 }, { poly: 1 }],
  ['profile', { type: 'profile', layer: 'WALLS', pts: [[0, 0], [6, 0], [6, 4], [0, 4]], fill: false }, { poly: 1 }],
  ['centerline', { type: 'centerline', layer: 'CENTER', pts: [[0, 0], [10, 10]] }, { poly: 1 }],
  ['callout', { type: 'callout', layer: 'TEXT', anchor: [0, 0], pts: [[0, 0], [4, 4]], content: 'CO', textH: 1 }, { poly: 2, text: 1 }],
  ['hatchRegion', { type: 'hatchRegion', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4], [0, 4]], pattern: 'ANSI31' }, { line: 8 }],
  ['fcf', { type: 'fcf', layer: 'DIMS', x: 0, y: 0, char: 'position', tol: '0.1', dia: true, datums: ['A', 'B'], h: 1 }, { poly: 4, text: 4 }],
  ['datum', { type: 'datum', layer: 'DIMS', x: 2, y: 0, letter: 'A', h: 1 }, { poly: 2, text: 1 }],
  ['finish', { type: 'finish', layer: 'DIMS', x: 4, y: 0, roughness: '3.2', h: 1 }, { poly: 1, text: 1 }],
  ['table', { type: 'table', layer: 'SCHEDULES', x: 0, y: 0, colW: [4, 4], rowH: 1, title: 'T', cells: [['a', 'b']] }, { text: 3, line: 5 }],
  ['insert', { type: 'insert', layer: 'DOORS', def: 'door', x: 5, y: 0, rot: 0, width: 3, swing: 1, flip: 1, scale: 1 }, { line: 1, arc: 1 }],
];

const layers = defaultLayers();
const roundTrip = ent => {
  const back = openDXF(buildDXF([ent], layers, { solid: false }), () => {});
  const types = {};
  (back.entities || []).forEach(e => { types[e.type] = (types[e.type] || 0) + 1; });
  return types;
};

describe('every entity type has a stated DXF and DWG round trip', () => {
  for (const [name, ent, expected] of CASES){
    it(name + ' round trips as ' + JSON.stringify(expected), () => {
      expect(roundTrip(ent)).toEqual(expected);
    });
  }

  it('nothing round trips to nothing', () => {
    for (const [name, ent] of CASES){
      const types = roundTrip(ent);
      expect(Object.keys(types).length, name + ' vanished from the DXF').toBeGreaterThan(0);
    }
  });

  it('GD&T marks reach the issued PDF as drawn geometry', () => {
    const line = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 };
    const gdt = CASES.filter(([n]) => n === 'fcf' || n === 'datum' || n === 'finish').map(([, e]) => e);
    const base = buildPDF([line], { ppf: 'fit', projectName: 'T' }).pdf;
    const withG = buildPDF([line, ...gdt], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(withG.length - base.length).toBeGreaterThan(500);
  });
});
