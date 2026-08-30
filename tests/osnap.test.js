import { describe, it, expect } from 'vitest';
import { intersectionSnaps, nearestOnEntity, perpSnap } from '../src/core/osnap.js';

const vis = () => true;

describe('osnaps', () => {
  it('finds the intersection of two segments', () => {
    const ents = [
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: 'line', layer: 'WALLS', x1: 4, y1: -4, x2: 4, y2: 4 }
    ];
    const hits = intersectionSnaps(ents, vis);
    expect(hits.some(p => Math.abs(p[0] - 4) < 1e-6 && Math.abs(p[1] - 0) < 1e-6 && p[2] === 3)).toBe(true);
  });
  it('nearest is on the segment', () => {
    const e = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const n = nearestOnEntity(e, [3, 2]);
    expect(n[0]).toBeCloseTo(3); expect(n[1]).toBeCloseTo(0); expect(n[2]).toBe(4);
  });
  it('perp from a point onto a line', () => {
    const e = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const p = perpSnap(e, [4, 3]);
    expect(p[0]).toBeCloseTo(4); expect(p[1]).toBeCloseTo(0); expect(p[2]).toBe(5);
  });
});
