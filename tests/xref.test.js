import { describe, it, expect } from 'vitest';
import { attachXref, expandXref, bindXref } from '../src/core/xref.js';
import { flattenEnt, membersBBox } from '../src/core/entities.js';
import { attach, createDocument, sampleCabin, toDXF, toSVG } from '../src/api.js';

describe('xref', () => {
  it('places a snapshot as one object and expands it at the insertion', () => {
    const xref = attachXref([], {
      name: 'bit',
      entities: [
        { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'circle', layer: 'WALLS', cx: 5, cy: 0, r: 1 }
      ]
    }, { x: 100, y: 50, scale: 2, name: 'bit' });
    expect(xref.type).toBe('xref');
    expect(xref.entities).toHaveLength(2);
    const frags = expandXref(xref);
    expect(frags).toHaveLength(2);
    expect(frags[0].x1).toBeCloseTo(100);
    expect(frags[0].x2).toBeCloseTo(120);
    expect(frags[1].cx).toBeCloseTo(110);
    expect(frags[1].r).toBeCloseTo(2);
  });

  it('bind returns ordinary entities', () => {
    const xref = attachXref([], { entities: [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 0 }] }, { x: 3, y: 4 });
    const bound = bindXref(xref);
    expect(bound[0].type).toBe('line');
    expect(bound[0].x1).toBeCloseTo(3);
    expect(bound[0].y1).toBeCloseTo(4);
  });

  it('flattenEnt / bbox see through an xref', () => {
    const xref = attachXref([], { entities: [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 8, y2: 0 }] }, { x: 0, y: 0 });
    const bb = membersBBox(flattenEnt(xref));
    expect(bb[2] - bb[0]).toBeCloseTo(8);
  });

  it('api.attach + DXF/SVG explode the reference', () => {
    const cabin = sampleCabin();
    const host = createDocument({ name: 'site', entities: [{ type: 'line', layer: 'WALLS', x1: -5, y1: -5, x2: 0, y2: 0 }] });
    attach(host, cabin, { name: 'cabin', x: 40, y: 0 });
    expect(host.entities.some(e => e.type === 'xref')).toBe(true);
    const dxf = toDXF(host);
    expect(dxf).toContain('EOF');
    const svg = toSVG(host);
    expect(svg).toContain('<line');
  });
});
