import { describe, it, expect } from 'vitest';
import {
  makeSpline, clampedKnots, knotsOf, splineAt, splinePoints, splineToPoly,
  splineLength, translateSpline, DEFAULT_DEGREE, SPLINE_MAX
} from '../src/core/spline.js';
import { entBBox, entPoints, entHit, explodeForIO, translateEnt } from '../src/core/entities.js';
import { buildDXF, parseDXF } from '../src/io/dxf.js';
import { lookupCommand } from '../src/core/command.js';

const LAYERS = [{ name: 'WALLS', aci: 2, visible: true }];
const S = ctrl => makeSpline(ctrl, { layer: 'WALLS' });

describe('B-spline evaluation', () => {
  it('clamps to its first and last control point', () => {
    const e = S([[0, 0], [3, 8], [9, -4], [12, 4]]);
    expect(splineAt(e, 0)[0]).toBeCloseTo(0, 9);
    expect(splineAt(e, 0)[1]).toBeCloseTo(0, 9);
    expect(splineAt(e, 1)[0]).toBeCloseTo(12, 9);
    expect(splineAt(e, 1)[1]).toBeCloseTo(4, 9);
  });

  it('builds a clamped uniform knot vector of the right length', () => {
    const k = clampedKnots(4, 3);
    expect(k.length).toBe(4 + 3 + 1);
    expect(k).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(knotsOf(S([[0, 0], [1, 1], [2, 0], [3, 1]]))).toEqual(k);
  });

  it('honours a supplied knot vector of the right length and ignores a wrong one', () => {
    const good = makeSpline([[0, 0], [1, 1], [2, 0], [3, 1]], { knots: [0, 0, 0, 0, 1, 1, 1, 1] });
    expect(knotsOf(good).length).toBe(8);
    const bad = makeSpline([[0, 0], [1, 1], [2, 0], [3, 1]], { knots: [0, 1] });
    expect(knotsOf(bad).length).toBe(8);
  });

  it('collinear control points give a straight curve', () => {
    const e = S([[0, 0], [4, 0], [8, 0], [12, 0]]);
    const worst = splinePoints(e).reduce((m, p) => Math.max(m, Math.abs(p[1])), 0);
    expect(worst).toBeLessThan(1e-9);
  });

  it('degree is capped by the control point count', () => {
    expect(makeSpline([[0, 0], [1, 1]], { degree: 3 }).degree).toBe(1);
    expect(makeSpline([[0, 0], [1, 1], [2, 0], [3, 3]]).degree).toBe(DEFAULT_DEGREE);
  });

  it('a closed spline returns to its start', () => {
    const e = makeSpline([[0, 0], [10, 0], [10, 10], [0, 10]], { closed: true });
    const pts = splinePoints(e);
    expect(pts[0][0]).toBeCloseTo(pts[pts.length - 1][0], 9);
    expect(pts[0][1]).toBeCloseTo(pts[pts.length - 1][1], 9);
  });

  it('a two point spline is just the segment', () => {
    expect(splinePoints(S([[0, 0], [5, 5]]))).toEqual([[0, 0], [5, 5]]);
  });

  it('degenerate input tessellates to nothing', () => {
    expect(splinePoints(S([[1, 1]]))).toEqual([]);
    expect(splinePoints(null)).toEqual([]);
  });

  it('a tighter tolerance never produces fewer points, and stays bounded', () => {
    const e = S([[0, 0], [3, 14], [9, -14], [12, 2]]);
    const coarse = splinePoints(e, 1).length;
    const fine = splinePoints(e, 0.001).length;
    expect(fine).toBeGreaterThanOrEqual(coarse);
    expect(fine).toBeLessThanOrEqual(SPLINE_MAX + 4);
  });

  it('length exceeds the straight line and stays under the control hull', () => {
    const ctrl = [[0, 0], [3, 8], [9, -4], [12, 4]];
    const e = S(ctrl);
    let hull = 0;
    for (let i = 1; i < ctrl.length; i++) hull += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
    const chord = Math.hypot(12, 4);
    const L = splineLength(e);
    expect(L).toBeGreaterThan(chord);
    expect(L).toBeLessThan(hull);
  });

  it('weights make it rational and pull the curve toward the weighted point', () => {
    const plain = splineAt(S([[0, 0], [6, 10], [12, 0]]), 0.5);
    const heavy = splineAt(makeSpline([[0, 0], [6, 10], [12, 0]], { weights: [1, 12, 1] }), 0.5);
    expect(heavy[1]).toBeGreaterThan(plain[1]);
    expect(heavy[1]).toBeLessThan(10);
  });

  it('translate moves the control points and therefore the curve', () => {
    const e = S([[0, 0], [3, 8], [9, -4], [12, 4]]);
    const before = splineAt(e, 0.5);
    translateSpline(e, 100, -20);
    const after = splineAt(e, 0.5);
    expect(after[0]).toBeCloseTo(before[0] + 100, 9);
    expect(after[1]).toBeCloseTo(before[1] - 20, 9);
  });
});

describe('a spline behaves like every other entity', () => {
  const e = () => S([[0, 0], [3, 8], [9, -4], [12, 4]]);

  it('has a bounding box that contains the curve', () => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    entBBox(e(), bb);
    splinePoints(e()).forEach(p => {
      expect(p[0]).toBeGreaterThanOrEqual(bb[0] - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(bb[2] + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(bb[1] - 1e-9);
      expect(p[1]).toBeLessThanOrEqual(bb[3] + 1e-9);
    });
  });

  it('snaps to its control points and its ends', () => {
    const pts = entPoints(e());
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts.some(p => Math.hypot(p[0] - 3, p[1] - 8) < 1e-9)).toBe(true);
  });

  it('hit tests on the curve, not on the control hull', () => {
    const sp = e();
    const on = splineAt(sp, 0.5);
    expect(entHit(sp, on, 0.05)).toBe(true);
    expect(entHit(sp, [on[0], on[1] + 40], 0.05)).toBe(false);
  });

  it('explodes to a polyline for consumers that only know line work', () => {
    const f = explodeForIO(e());
    expect(f.length).toBe(1);
    expect(f[0].type).toBe('poly');
    expect(f[0].pts.length).toBeGreaterThan(4);
    expect(f[0].layer).toBe('WALLS');
  });

  it('translateEnt routes to the spline mover', () => {
    const sp = e();
    translateEnt(sp, 5, 5);
    expect(sp.ctrl[0]).toEqual([5, 5]);
  });

  it('splineToPoly carries style across', () => {
    const sp = makeSpline([[0, 0], [1, 4], [5, 0]], { layer: 'WALLS', lt: 'HIDDEN', lw: 0.5 });
    const poly = splineToPoly(sp);
    expect(poly.lt).toBe('HIDDEN');
    expect(poly.lw).toBe(0.5);
  });
});

describe('DXF keeps the spline a spline', () => {
  const sp = S([[0, 0], [3, 8], [9, -4], [12, 4]]);

  it('R2000 writes a real SPLINE record', () => {
    const dxf = buildDXF([sp], LAYERS, { ver: 'R2000' });
    expect(dxf).toContain('SPLINE');
    /* Group 71 is the degree, 73 the control point count. */
    expect(dxf).toMatch(/\r?\n71\r?\n3\r?\n/);
    expect(dxf).toMatch(/\r?\n73\r?\n4\r?\n/);
  });

  it('round trips without degrading to line work', () => {
    const back = parseDXF(buildDXF([sp], LAYERS, { ver: 'R2000' }), n => n || 'WALLS');
    const got = back.find(x => x.type === 'spline');
    expect(got).toBeTruthy();
    expect(got.degree).toBe(3);
    expect(got.ctrl.length).toBe(4);
    for (const u of [0, 0.17, 0.37, 0.5, 0.83, 1]){
      const a = splineAt(sp, u), b = splineAt(got, u);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  });

  it('a second trip is stable', () => {
    const one = buildDXF([sp], LAYERS, { ver: 'R2000' });
    const two = buildDXF(parseDXF(one, n => n || 'WALLS'), LAYERS, { ver: 'R2000' });
    expect(two).toBe(one);
  });

  it('a closed spline stays closed', () => {
    const c = makeSpline([[0, 0], [10, 0], [10, 10], [0, 10]], { layer: 'WALLS', closed: true });
    const back = parseDXF(buildDXF([c], LAYERS, { ver: 'R2000' }), n => n || 'WALLS');
    expect(back.find(x => x.type === 'spline').closed).toBe(true);
  });

  it('R12 has no SPLINE record so it tessellates instead of losing the curve', () => {
    const r12 = buildDXF([sp], LAYERS, { ver: 'R12' });
    expect(r12).not.toContain('SPLINE');
    expect(r12).toContain('POLYLINE');
    const back = parseDXF(r12, n => n || 'WALLS');
    const poly = back.find(x => x.type === 'poly');
    expect(poly.pts.length).toBeGreaterThan(4);
  });
});

describe('the spline reaches the toolbar', () => {
  it('registers the command and its alias', () => {
    expect(lookupCommand('SPLINE').tool).toBe('spline');
    expect(lookupCommand('SPL').tool).toBe('spline');
  });
});
