import { describe, it, expect } from 'vitest';
import { trimEntity, extendEntity, lineCutTs, interiorSorted } from '../src/core/trimExtend.js';

const vis = () => true;

describe('lineCutTs / interiorSorted', () => {
  it('finds crossing parameters against other lines', () => {
    const ents = [
      { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 2, type: 'line', layer: 'WALLS', x1: 5, y1: -5, x2: 5, y2: 5 }
    ];
    const ts = lineCutTs(ents, vis, 0, 0, 10, 0, 1);
    expect(ts.length).toBe(1);
    expect(ts[0]).toBeCloseTo(0.5);
  });
  it('interiorSorted dedupes and drops endpoints', () => {
    expect(interiorSorted([0, 0.5, 0.5 + 1e-9, 1], 0, 1)).toEqual([0.5]);
  });
});

describe('trimEntity', () => {
  it('removes the tapped span of a line between two cutters', () => {
    const target = { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 12, y2: 0 };
    const ents = [
      target,
      { id: 2, type: 'line', layer: 'WALLS', x1: 4, y1: -5, x2: 4, y2: 5 },
      { id: 3, type: 'line', layer: 'WALLS', x1: 8, y1: -5, x2: 8, y2: 5 }
    ];
    const res = trimEntity(ents, vis, target, [6, 0]);
    expect(res.ok).toBe(true);
    expect(res.replace.length).toBe(2);
    const spans = res.replace.map(l => [l.x1, l.x2].sort((a, b) => a - b));
    expect(spans).toContainEqual([0, 4]);
    expect(spans).toContainEqual([8, 12]);
  });
  it('reports when there is nothing to trim to', () => {
    const target = { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 12, y2: 0 };
    const res = trimEntity([target], vis, target, [6, 0]);
    expect(res.ok).toBe(false);
  });
  it('ignores cutters on hidden layers', () => {
    const target = { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 12, y2: 0 };
    const ents = [target, { id: 2, type: 'line', layer: 'HIDDEN', x1: 6, y1: -5, x2: 6, y2: 5 }];
    const res = trimEntity(ents, name => name !== 'HIDDEN', target, [3, 0]);
    expect(res.ok).toBe(false);
  });
  it('turns a circle into an arc when cut by a crossing line', () => {
    const target = { id: 1, type: 'circle', layer: 'WALLS', cx: 0, cy: 0, r: 5 };
    const ents = [
      target,
      { id: 2, type: 'line', layer: 'WALLS', x1: -10, y1: 0, x2: 10, y2: 0 }
    ];
    // Tap the top half; the bottom half should remain.
    const res = trimEntity(ents, vis, target, [0, 5]);
    expect(res.ok).toBe(true);
    expect(res.replace.length).toBe(1);
    expect(res.replace[0].type).toBe('arc');
    const arc = res.replace[0];
    expect(arc.r).toBe(5);
    // Kept span covers 180..360 (the lower half).
    expect(arc.a1).toBeCloseTo(180, 0);
    expect(arc.a2 % 360).toBeCloseTo(0, 0);
  });
  it('rejects unsupported types', () => {
    const t = { id: 1, type: 'text', layer: 'TEXT', x: 0, y: 0, size: 1, content: 'A' };
    expect(trimEntity([t], vis, t, [0, 0]).ok).toBe(false);
  });
});

describe('extendEntity', () => {
  it('extends the nearer end of a line to the next boundary', () => {
    const target = { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 5, y2: 0 };
    const ents = [
      target,
      { id: 2, type: 'line', layer: 'WALLS', x1: 9, y1: -5, x2: 9, y2: 5 }
    ];
    const res = extendEntity(ents, vis, target, [5, 0]);
    expect(res.ok).toBe(true);
    expect(res.replace[0].x2).toBeCloseTo(9);
    expect(res.replace[0].x1).toBe(0);
  });
  it('fails when no boundary lies ahead', () => {
    const target = { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 5, y2: 0 };
    const res = extendEntity([target], vis, target, [5, 0]);
    expect(res.ok).toBe(false);
  });
  it('extends the tapped end of an open polyline', () => {
    const target = { id: 1, type: 'poly', layer: 'WALLS', closed: false, pts: [[0, 0], [5, 0]] };
    const ents = [
      target,
      { id: 2, type: 'line', layer: 'WALLS', x1: 8, y1: -5, x2: 8, y2: 5 }
    ];
    const res = extendEntity(ents, vis, target, [5, 0]);
    expect(res.ok).toBe(true);
    expect(res.replace[0].pts[1][0]).toBeCloseTo(8);
  });
  it('refuses closed polylines', () => {
    const target = { id: 1, type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [5, 0], [5, 5]] };
    expect(extendEntity([target], vis, target, [0, 0]).ok).toBe(false);
  });
});
