import { describe, it, expect } from 'vitest';
import { buildDXF, openDXF } from '../src/io/dxf.js';
import { buildPDF } from '../src/io/pdf.js';
import { defaultLayers } from '../src/core/state.js';

/* One of every authorable entity type, and what the DXF round trip is
 * contracted to give back under each writer: the R2000 path (the app's
 * default, and the payload of the DWG, so this is also the DWG self
 * round trip) and the legacy R12 path. R2000 keeps mtext, dim and
 * spline as themselves; R12 explodes them. A change that silently
 * demotes a type (the way GD&T frames once round tripped to nothing at
 * all) fails here by name. Each case is [name, entity, r12, r2000?];
 * a missing r2000 column means both writers agree. */
const CASES = [
  ['line', { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 }, { line: 1 }],
  ['poly', { type: 'poly', layer: 'WALLS', closed: false, pts: [[0, 0], [5, 5], [10, 0]] }, { poly: 1 }],
  ['circle', { type: 'circle', layer: 'WALLS', cx: 5, cy: 5, r: 3 }, { circle: 1 }],
  ['arc', { type: 'arc', layer: 'WALLS', cx: 5, cy: 5, r: 3, a1: 0, a2: 90 }, { arc: 1 }],
  ['text', { type: 'text', layer: 'TEXT', x: 1, y: 1, size: 1, content: 'hello' }, { text: 1 }],
  ['mtext', { type: 'mtext', layer: 'TEXT', x: 1, y: 3, w: 10, size: 1, content: 'wrapped words here' }, { text: 1 }, { mtext: 1 }],
  ['dim', { type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }, { line: 5, text: 1 }, { dim: 1 }],
  ['hatch', { type: 'hatch', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4], [0, 4]], pattern: 'ANSI31', scale: 1, angle: 0 }, { line: 8 }, { hatch: 1 }],
  ['ellipse', { type: 'ellipse', layer: 'WALLS', cx: 5, cy: 5, rx: 4, ry: 2, rot: 15 }, { poly: 1 }],
  ['leader', { type: 'leader', layer: 'TEXT', pts: [[0, 0], [4, 4]], content: 'note', textH: 1 }, { poly: 1, text: 1 }],
  ['cloud', { type: 'cloud', layer: 'TEXT', pts: [[0, 0], [6, 0], [6, 4], [0, 4]], amp: 0.7 }, { poly: 1 }],
  ['image', { type: 'image', layer: 'DETAIL', x: 0, y: 0, w: 8, h: 5, rot: 0, src: 'data:image/jpeg;base64,AAAA' }, { poly: 1 }],
  ['room', { type: 'room', layer: 'ROOMS', name: 'DEN', pts: [[0, 0], [8, 0], [8, 8], [0, 8]], cx: 4, cy: 4, area: 64 }, { poly: 1, text: 1 }],
  ['grid', { type: 'grid', layer: 'CENTER', x: 0, y: 0, cols: 3, rows: 2, cx: 10, ry: 8, rot: 0, bubble: 1 }, { line: 7, circle: 7, text: 7 }],
  ['xline', { type: 'xline', layer: 'CENTER', x1: 0, y1: 0, x2: 1, y2: 1 }, { line: 1 }],
  ['spline', { type: 'spline', layer: 'WALLS', ctrl: [[0, 0], [3, 6], [7, -2], [10, 3]], degree: 3 }, { poly: 1 }, { spline: 1 }],
  ['profile', { type: 'profile', layer: 'WALLS', pts: [[0, 0], [6, 0], [6, 4], [0, 4]], fill: false }, { poly: 1 }],
  ['centerline', { type: 'centerline', layer: 'CENTER', pts: [[0, 0], [10, 10]] }, { poly: 1 }],
  ['callout', { type: 'callout', layer: 'TEXT', anchor: [0, 0], pts: [[0, 0], [4, 4]], content: 'CO', textH: 1 }, { poly: 2, text: 1 }],
  ['hatchRegion', { type: 'hatchRegion', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4], [0, 4]], pattern: 'ANSI31' }, { line: 8 }, { hatch: 1 }],
  ['fcf', { type: 'fcf', layer: 'DIMS', x: 0, y: 0, char: 'position', tol: '0.1', dia: true, datums: ['A', 'B'], h: 1 }, { poly: 4, text: 4 }],
  ['datum', { type: 'datum', layer: 'DIMS', x: 2, y: 0, letter: 'A', h: 1 }, { poly: 2, text: 1 }],
  ['finish', { type: 'finish', layer: 'DIMS', x: 4, y: 0, roughness: '3.2', h: 1 }, { poly: 1, text: 1 }],
  ['table', { type: 'table', layer: 'SCHEDULES', x: 0, y: 0, colW: [4, 4], rowH: 1, title: 'T', cells: [['a', 'b']] }, { text: 3, line: 5 }],
  ['insert', { type: 'insert', layer: 'DOORS', def: 'door', x: 5, y: 0, rot: 0, width: 3, swing: 1, flip: 1, scale: 1 }, { line: 1, arc: 1 }],
];

const layers = defaultLayers();
const roundTrip = (ent, ver) => {
  const back = openDXF(buildDXF([ent], layers, { solid: false, ver }), () => {});
  const types = {};
  (back.entities || []).forEach(e => { types[e.type] = (types[e.type] || 0) + 1; });
  return types;
};

describe('every entity type has a stated DXF and DWG round trip', () => {
  for (const [name, ent, r12, r2000] of CASES){
    it(name + ' round trips as ' + JSON.stringify(r2000 || r12) + ' (R2000)' , () => {
      expect(roundTrip(ent, 'R2000')).toEqual(r2000 || r12);
    });
    it(name + ' round trips as ' + JSON.stringify(r12) + ' (R12)', () => {
      expect(roundTrip(ent)).toEqual(r12);
    });
  }

  it('nothing round trips to nothing, in either version', () => {
    for (const [name, ent] of CASES){
      expect(Object.keys(roundTrip(ent, 'R2000')).length, name + ' vanished from the R2000 DXF').toBeGreaterThan(0);
      expect(Object.keys(roundTrip(ent)).length, name + ' vanished from the R12 DXF').toBeGreaterThan(0);
    }
  });

  it('an island hatch round trips as one hatch, semantics intact', () => {
    const h = { type: 'hatch', layer: 'HATCH', pts: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]], pattern: 'ANSI31', scale: 2, angle: 15 };
    const back = openDXF(buildDXF([h], layers, { solid: false, ver: 'R2000' }), () => {}).entities;
    expect(back.length).toBe(1);
    expect(back[0].type).toBe('hatch');
    expect(back[0].holes.length).toBe(1);
    expect(back[0].holes[0].length).toBe(4);
    expect(back[0].pattern).toBe('ANSI31');
    expect(back[0].scale).toBeCloseTo(2, 9);
    expect(back[0].angle).toBeCloseTo(15, 9);
  });

  it('a dimension round trips with its exact geometry, offset included', () => {
    /* The reader used to guess off: 2, which moved every reopened
     * dimension line. The offset is recovered from the dimension line
     * point, sign included, to the file's own coordinate precision. */
    const dim = { type: 'dim', layer: 'DIMS', x1: 1.25, y1: 2.5, x2: 13.75, y2: 8.5, off: -6.25 };
    const back = openDXF(buildDXF([dim], layers, { solid: false, ver: 'R2000' }), () => {}).entities;
    expect(back.length).toBe(1);
    expect(back[0].x1).toBeCloseTo(1.25, 9);
    expect(back[0].y1).toBeCloseTo(2.5, 9);
    expect(back[0].x2).toBeCloseTo(13.75, 9);
    expect(back[0].y2).toBeCloseTo(8.5, 9);
    expect(back[0].off).toBeCloseTo(-6.25, 4);
  });

  it('GD&T marks reach the issued PDF as drawn geometry', () => {
    const line = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 };
    const gdt = CASES.filter(([n]) => n === 'fcf' || n === 'datum' || n === 'finish').map(([, e]) => e);
    const base = buildPDF([line], { ppf: 'fit', projectName: 'T' }).pdf;
    const withG = buildPDF([line, ...gdt], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(withG.length - base.length).toBeGreaterThan(500);
  });
});

describe('sheet fixes from the field: schedule units and room labels', () => {
  it('the room schedule AREA column is plan dimensions, never feet-inches of an area', async () => {
    const { roomRows } = await import('../src/core/schedule.js');
    const room = { type: 'room', name: 'BEDROOM 1', area: 86.3,
      pts: [[0, 0], [12.33, 0], [12.33, 7], [0, 7]], cx: 6, cy: 3.5 };
    const rows = roomRows([room]);
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('BEDROOM 1');
    expect(rows[0][1]).toBe('12\'-4" x 7\'-0"');
    expect(rows[0][2]).toBe('86.3 SF');
    /* The old bug: 86.3 SF through the length formatter read 86'-3 5/8". */
    expect(rows[0][1]).not.toContain('86');
  });

  it('the exploded room label is centered on its label point', async () => {
    const { explodeForIO } = await import('../src/core/entities.js');
    const { boxWidth } = await import('../src/core/textmetrics.js');
    const room = { type: 'room', name: 'BEDROOM 1', area: 86.3,
      pts: [[0, 0], [12, 0], [12, 7], [0, 7]], cx: 6, cy: 3.5 };
    const txt = explodeForIO(room).find(f => f.type === 'text');
    const w = boxWidth(txt.content, 1.0);
    expect(txt.x + w / 2).toBeCloseTo(6, 9);
  });

  it('room extents include the printed label so the sheet fit cannot cut it', async () => {
    const { entBBox } = await import('../src/core/entities.js');
    /* A small room with a long name: the label is wider than the loop. */
    const room = { type: 'room', name: 'MECHANICAL CLOSET', area: 9,
      pts: [[0, 0], [3, 0], [3, 3], [0, 3]], cx: 1.5, cy: 1.5 };
    const bb = [1e9, 1e9, -1e9, -1e9];
    entBBox(room, bb);
    expect(bb[0]).toBeLessThan(-2);
    expect(bb[2]).toBeGreaterThan(5);
  });
});

describe('a room named by its text prints one name, not two', () => {
  it('dedupeRoomLabels marks the room and its explode keeps only the SF', async () => {
    const { dedupeRoomLabels, explodeForIO } = await import('../src/core/entities.js');
    const room = { type: 'room', layer: 'ROOMS', name: 'KITCHEN', area: 182.3,
      pts: [[0, 0], [14, 0], [14, 13], [0, 13]], cx: 7, cy: 6.5 };
    const label = { type: 'text', layer: 'TEXT', x: 5.5, y: 6.5, size: 1, content: 'KITCHEN' };
    const out = dedupeRoomLabels([room, label]);
    expect(out[0].sfOnly).toBe(true);
    const txt = explodeForIO(out[0]).find(f => f.type === 'text');
    expect(txt.content).toBe('182 SF');
    /* Without a matching text the full label stays. */
    const alone = dedupeRoomLabels([room]);
    expect(alone[0].sfOnly).toBeUndefined();
    expect(explodeForIO(alone[0]).find(f => f.type === 'text').content).toBe('KITCHEN  182 SF');
    /* A text with a different name does not steal the label. */
    const other = dedupeRoomLabels([room, { ...label, content: 'PANTRY' }]);
    expect(other[0].sfOnly).toBeUndefined();
  });
});
