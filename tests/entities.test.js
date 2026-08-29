import { describe, it, expect } from 'vitest';
import { entPoints, entHit, entBBox, membersBBox, translateEnt, rotateMembers, gripPts } from '../src/core/entities.js';

describe('entPoints', () => {
  it('line has ends and midpoint', () => {
    const p = entPoints({ type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 });
    expect(p).toContainEqual([0, 0, 0]);
    expect(p).toContainEqual([4, 0, 0]);
    expect(p).toContainEqual([2, 0, 1]);
  });
  it('circle has center and quadrants', () => {
    const p = entPoints({ type: 'circle', cx: 1, cy: 1, r: 2 });
    expect(p[0]).toEqual([1, 1, 2]);
    expect(p).toContainEqual([3, 1, 0]);
  });
});

describe('entHit', () => {
  it('hits a line near it, misses far away', () => {
    const e = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    expect(entHit(e, [5, 0.2], 0.5)).toBe(true);
    expect(entHit(e, [5, 2], 0.5)).toBe(false);
  });
  it('hits only the rim of a circle', () => {
    const e = { type: 'circle', cx: 0, cy: 0, r: 5 };
    expect(entHit(e, [5.1, 0], 0.5)).toBe(true);
    expect(entHit(e, [0, 0], 0.5)).toBe(false);
  });
  it('closed poly hits its closing edge', () => {
    const e = { type: 'poly', closed: true, pts: [[0, 0], [4, 0], [4, 4], [0, 4]] };
    expect(entHit(e, [0, 2], 0.2)).toBe(true);
  });
});

describe('bbox and transforms', () => {
  it('entBBox covers a dim including its offset line', () => {
    const bb = [1e9, 1e9, -1e9, -1e9];
    entBBox({ type: 'dim', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }, bb);
    expect(bb[3]).toBeCloseTo(2);
  });
  it('translateEnt moves all entity kinds', () => {
    const l = { type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 };
    translateEnt(l, 5, 5);
    expect(l.x1).toBe(5); expect(l.y2).toBe(6);
    const c = { type: 'circle', cx: 0, cy: 0, r: 1 };
    translateEnt(c, -1, 2);
    expect(c.cx).toBe(-1); expect(c.cy).toBe(2);
  });
  it('rotateMembers turns 90° about the shared center', () => {
    const a = { type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 };
    rotateMembers([a]);
    // Horizontal line becomes vertical with the same center (2,0).
    expect(a.x1).toBeCloseTo(2); expect(a.y1).toBeCloseTo(-2);
    expect(a.x2).toBeCloseTo(2); expect(a.y2).toBeCloseTo(2);
  });
  it('membersBBox unions members', () => {
    const bb = membersBBox([
      { type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
      { type: 'circle', cx: 5, cy: 5, r: 1 }
    ]);
    expect(bb).toEqual([0, 0, 6, 6]);
  });
});

describe('gripPts', () => {
  it('line grips move endpoints', () => {
    const e = { type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 };
    const g = gripPts(e);
    expect(g.length).toBe(2);
    g[1].apply([8, 2]);
    expect(e.x2).toBe(8); expect(e.y2).toBe(2);
  });
  it('circle grip resizes with a minimum radius', () => {
    const e = { type: 'circle', cx: 0, cy: 0, r: 2 };
    gripPts(e)[0].apply([0, 0]);
    expect(e.r).toBe(0.05);
  });
  it('dim mid-grip changes offset and never collapses to zero', () => {
    const e = { type: 'dim', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 };
    const g = gripPts(e);
    g[2].apply([5, 0.01]);
    expect(Math.abs(e.off)).toBeGreaterThanOrEqual(0.3);
  });
});
