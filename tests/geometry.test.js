import { describe, it, expect } from 'vitest';
import { dist, clamp, arcSpan, arcPoints, angDeg, onArc, distToSeg, lineIntersect, segSegParam, lineCircleTs, dimGeom, fmtN } from '../src/core/geometry.js';

describe('basic helpers', () => {
  it('dist computes euclidean distance', () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
  });
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
  });
  it('fmtN trims float noise', () => {
    expect(fmtN(0.1 + 0.2)).toBe('0.3');
  });
});

describe('arcs', () => {
  it('arcSpan handles wraparound and full circles', () => {
    expect(arcSpan({ a1: 0, a2: 90 })).toBe(90);
    expect(arcSpan({ a1: 350, a2: 10 })).toBe(20);
    expect(arcSpan({ a1: 0, a2: 0 })).toBe(360);
  });
  it('arcPoints starts and ends on the arc endpoints', () => {
    const e = { cx: 0, cy: 0, r: 2, a1: 0, a2: 90 };
    const pts = arcPoints(e);
    expect(pts[0][0]).toBeCloseTo(2);
    expect(pts[0][1]).toBeCloseTo(0);
    expect(pts[pts.length - 1][0]).toBeCloseTo(0);
    expect(pts[pts.length - 1][1]).toBeCloseTo(2);
  });
  it('angDeg normalizes to [0,360)', () => {
    expect(angDeg(0, 0, 1, 0)).toBe(0);
    expect(angDeg(0, 0, 0, -1)).toBe(270);
  });
  it('onArc respects span including wraparound', () => {
    const e = { a1: 350, a2: 20 };
    expect(onArc(e, 0)).toBe(true);
    expect(onArc(e, 355)).toBe(true);
    expect(onArc(e, 180)).toBe(false);
  });
});

describe('segments and intersections', () => {
  it('distToSeg clamps to endpoints', () => {
    expect(distToSeg(5, 0, 0, 0, 2, 0)).toBe(3);
    expect(distToSeg(1, 1, 0, 0, 2, 0)).toBe(1);
  });
  it('lineIntersect finds the crossing point', () => {
    const p = lineIntersect([0, 0], [2, 2], [0, 2], [2, 0]);
    expect(p[0]).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(1);
  });
  it('segSegParam returns parameters on both segments', () => {
    const r = segSegParam(0, 0, 10, 0, 5, -5, 5, 5);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.u).toBeCloseTo(0.5);
  });
  it('segSegParam returns null for parallels', () => {
    expect(segSegParam(0, 0, 1, 0, 0, 1, 1, 1)).toBeNull();
  });
  it('lineCircleTs finds two crossings through the center', () => {
    const ts = lineCircleTs(-2, 0, 2, 0, 0, 0, 1).sort((a, b) => a - b);
    expect(ts.length).toBe(2);
    expect(ts[0]).toBeCloseTo(0.25);
    expect(ts[1]).toBeCloseTo(0.75);
  });
  it('lineCircleTs misses a distant circle', () => {
    expect(lineCircleTs(0, 5, 1, 5, 0, 0, 1)).toEqual([]);
  });
});

describe('dimGeom', () => {
  it('offsets the dimension line perpendicular to the measured span', () => {
    const g = dimGeom({ x1: 0, y1: 0, x2: 10, y2: 0, off: 2 });
    expect(g.len).toBeCloseTo(10);
    expect(g.d[0][1]).toBeCloseTo(2);
    expect(g.d[1][1]).toBeCloseTo(2);
    expect(g.mid[0]).toBeCloseTo(5);
    expect(g.mid[1]).toBeCloseTo(2);
  });
});
