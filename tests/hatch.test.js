import { describe, it, expect } from 'vitest';
import { makeHatch, hatchLines, boundaryContaining } from '../src/core/hatch.js';

describe('makeHatch', () => {
  it('builds an ANSI31 hatch from a rectangle', () => {
    const h = makeHatch([[0, 0], [10, 0], [10, 8], [0, 8]], { pattern: 'ANSI31' });
    expect(h.type).toBe('hatch');
    expect(h.pattern).toBe('ANSI31');
    const lines = hatchLines(h);
    expect(lines.length).toBeGreaterThan(4);
    lines.forEach(seg => {
      expect(seg[0][0]).toBeGreaterThanOrEqual(-0.05);
      expect(seg[0][0]).toBeLessThanOrEqual(10.05);
    });
  });
  it('returns null for a degenerate boundary', () => {
    expect(makeHatch([[0, 0], [1, 1]])).toBeNull();
  });
});

describe('boundaryContaining', () => {
  const outer = { type: 'poly', closed: true, pts: [[0, 0], [20, 0], [20, 10], [0, 10]] };
  const inner = { type: 'poly', closed: true, pts: [[4, 2], [8, 2], [8, 6], [4, 6]] };
  it('returns the smallest closed poly that contains the point', () => {
    const pts = boundaryContaining([outer, inner], 6, 4);
    expect(pts).toEqual(inner.pts);
  });
  it('falls back to the outer poly when the point is outside the inner one', () => {
    const pts = boundaryContaining([outer, inner], 1, 1);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.length).toBe(4);
  });
  it('returns null outside every boundary', () => {
    expect(boundaryContaining([outer, inner], 40, 40)).toBeNull();
  });
  it('hatches a circle as a closed polygon', () => {
    const pts = boundaryContaining([{ type: 'circle', cx: 0, cy: 0, r: 2 }], 0, 0);
    expect(pts.length).toBeGreaterThan(12);
    expect(pts[0][0]).toBeCloseTo(2);
  });
});
