import { describe, it, expect } from 'vitest';
import { filletLines, chamferLines, arcFrom3, moveEntities, rotateEntities, scaleEntities, mirrorEntities, rectangularArray, polarArray, joinEntities, entityLength, entityArea } from '../src/core/modify.js';
import { dist } from '../src/core/geometry.js';

describe('filletLines', () => {
  it('r=0 trims two lines to a sharp corner', () => {
    const a = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 };
    const b = { type: 'line', layer: 'WALLS', x1: 10, y1: -2, x2: 10, y2: 8 };
    const res = filletLines(a, b, 0, [5, 0], [10, 4]);
    expect(res.ok).toBe(true);
    const l1 = res.replace[0].ents[0];
    const l2 = res.replace[1].ents[0];
    const ends = [[l1.x1, l1.y1], [l1.x2, l1.y2], [l2.x1, l2.y1], [l2.x2, l2.y2]];
    expect(ends.some(p => Math.abs(p[0] - 10) < 1e-6 && Math.abs(p[1] - 0) < 1e-6)).toBe(true);
  });
  it('positive radius inserts an arc and shortens both lines', () => {
    const a = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 };
    const b = { type: 'line', layer: 'WALLS', x1: 10, y1: 0, x2: 10, y2: 10 };
    const res = filletLines(a, b, 2, [0, 0], [10, 10]);
    expect(res.ok).toBe(true);
    expect(res.extra[0].type).toBe('arc');
    expect(res.extra[0].r).toBeCloseTo(2);
    const l1 = res.replace[0].ents[0];
    expect(dist(l1.x1, l1.y1, l1.x2, l1.y2)).toBeLessThan(10);
  });
  it('rejects parallel lines', () => {
    const a = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 };
    const b = { type: 'line', layer: 'WALLS', x1: 0, y1: 2, x2: 10, y2: 2 };
    expect(filletLines(a, b, 1).ok).toBe(false);
  });
});

describe('chamferLines', () => {
  it('cuts both lines and adds a connecting segment', () => {
    const a = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 };
    const b = { type: 'line', layer: 'WALLS', x1: 10, y1: 0, x2: 10, y2: 10 };
    const res = chamferLines(a, b, 1, 1, [0, 0], [10, 10]);
    expect(res.ok).toBe(true);
    expect(res.extra[0].type).toBe('line');
    expect(dist(res.extra[0].x1, res.extra[0].y1, res.extra[0].x2, res.extra[0].y2)).toBeCloseTo(Math.sqrt(2));
  });
});

describe('arcFrom3', () => {
  it('builds a quarter-circle through three points', () => {
    const e = arcFrom3([1, 0], [0, 1], [-1, 0]);
    expect(e).toBeTruthy();
    expect(e.r).toBeCloseTo(1);
    expect(e.cx).toBeCloseTo(0);
    expect(e.cy).toBeCloseTo(0);
  });
  it('returns null for collinear points', () => {
    expect(arcFrom3([0, 0], [1, 0], [2, 0])).toBeNull();
  });
});

describe('transforms', () => {
  it('moveEntities translates a line', () => {
    const out = moveEntities([{ type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 }], 3, 4);
    expect(out[0].x1).toBe(3); expect(out[0].y2).toBe(4);
  });
  it('rotateEntities 90° about origin', () => {
    const out = rotateEntities([{ type: 'line', x1: 2, y1: 0, x2: 2, y2: 0 }], 0, 0, 90);
    expect(out[0].x1).toBeCloseTo(0); expect(out[0].y1).toBeCloseTo(2);
  });
  it('scaleEntities about a base point', () => {
    const out = scaleEntities([{ type: 'circle', cx: 4, cy: 0, r: 1 }], 0, 0, 2);
    expect(out[0].cx).toBeCloseTo(8); expect(out[0].r).toBeCloseTo(2);
  });
  it('mirrorEntities across the Y axis', () => {
    const out = mirrorEntities([{ type: 'line', x1: 2, y1: 1, x2: 3, y2: 1 }], 0, 0, 0, 1);
    expect(out[0].x1).toBeCloseTo(-2); expect(out[0].y1).toBeCloseTo(1);
  });
  it('rectangularArray emits (cols*rows-1) copies', () => {
    const src = [{ type: 'circle', cx: 0, cy: 0, r: 0.5 }];
    const out = rectangularArray(src, 3, 2, 4, 5);
    expect(out.length).toBe(5);
    expect(out.some(e => Math.abs(e.cx - 8) < 1e-6 && Math.abs(e.cy - 0) < 1e-6)).toBe(true);
    expect(out.some(e => Math.abs(e.cy - 5) < 1e-6)).toBe(true);
  });
  it('polarArray rotates copies about a center', () => {
    const src = [{ type: 'circle', cx: 2, cy: 0, r: 0.25 }];
    const out = polarArray(src, 0, 0, 4, 360);
    expect(out.length).toBe(3);
  });
});

describe('joinEntities', () => {
  it('chains two touching lines into a polyline', () => {
    const res = joinEntities([
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: 'line', layer: 'WALLS', x1: 4, y1: 0, x2: 4, y2: 3 }
    ]);
    expect(res.ok).toBe(true);
    expect(res.replace[0].type).toBe('poly');
    expect(res.replace[0].pts.length).toBe(3);
  });
});

describe('metrics', () => {
  it('entityLength of a 10 ft line is 10', () => {
    expect(entityLength({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 })).toBeCloseTo(10);
  });
  it('entityArea of a 4×3 closed rect is 12', () => {
    expect(entityArea({ type: 'poly', closed: true, pts: [[0, 0], [4, 0], [4, 3], [0, 3]] })).toBeCloseTo(12);
  });
});
