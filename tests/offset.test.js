import { describe, it, expect } from 'vitest';
import { offsetEntity } from '../src/core/offset.js';

describe('offsetEntity', () => {
  it('offsets a line toward the tap side', () => {
    const e = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 };
    const up = offsetEntity(e, 1, [5, 3]);
    expect(up.y1).toBeCloseTo(1); expect(up.y2).toBeCloseTo(1);
    const down = offsetEntity(e, 1, [5, -3]);
    expect(down.y1).toBeCloseTo(-1);
  });
  it('offsets a circle outward or inward by tap position', () => {
    const e = { type: 'circle', layer: 'WALLS', cx: 0, cy: 0, r: 2 };
    expect(offsetEntity(e, 1, [5, 0]).r).toBeCloseTo(3);
    expect(offsetEntity(e, 1, [0.1, 0]).r).toBeCloseTo(1);
  });
  it('refuses to collapse a circle', () => {
    const e = { type: 'circle', layer: 'WALLS', cx: 0, cy: 0, r: 0.5 };
    expect(offsetEntity(e, 1, [0, 0])).toBeNull();
  });
  it('offsets a closed rectangle outward on all sides', () => {
    const e = { type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [10, 0], [10, 10], [0, 10]] };
    const out = offsetEntity(e, 1, [5, -5]);
    expect(out.closed).toBe(true);
    expect(out.pts.length).toBe(4);
    const xs = out.pts.map(p => p[0]), ys = out.pts.map(p => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-1);
    expect(Math.max(...xs)).toBeCloseTo(11);
    expect(Math.min(...ys)).toBeCloseTo(-1);
    expect(Math.max(...ys)).toBeCloseTo(11);
  });
  it('offsets an open polyline keeping endpoints count + preserving layer', () => {
    const e = { type: 'poly', layer: 'DOORS', closed: false, pts: [[0, 0], [5, 0], [5, 5]] };
    const out = offsetEntity(e, 0.5, [2, 1]);
    expect(out.pts.length).toBe(3);
    expect(out.layer).toBe('DOORS');
  });
});
