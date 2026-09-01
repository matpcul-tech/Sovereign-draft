import { describe, it, expect } from 'vitest';
import { samplePath, easeInOut } from '../src/core/campath.js';

const V = (pos, target, fov) => ({ pos, target, fov });

describe('camera paths are exact where exactness has a closed form', () => {
  const tour = [
    V([0, 0, 10], [10, 10, 5], 50),
    V([40, 0, 12], [20, 10, 5], 50),
    V([40, 30, 20], [20, 15, 8], 35),
    V([0, 30, 6], [10, 15, 4], 65),
  ];

  it('the path passes through every saved view exactly at its knot', () => {
    const n = tour.length;
    for (let k = 0; k < n; k++){
      const s = samplePath(tour, k / (n - 1));
      for (let i = 0; i < 3; i++){
        expect(s.pos[i]).toBeCloseTo(tour[k].pos[i], 12);
        expect(s.target[i]).toBeCloseTo(tour[k].target[i], 12);
      }
      expect(s.fov).toBeCloseTo(tour[k].fov, 12);
    }
  });

  it('collinear equally spaced views give exactly the straight line', () => {
    /* Catmull-Rom reproduces linear functions: on a straight dolly the
     * midpoint of a middle segment is the exact midpoint in space. */
    const dolly = [
      V([0, 0, 6], [0, 100, 6], 50),
      V([0, 10, 6], [0, 110, 6], 50),
      V([0, 20, 6], [0, 120, 6], 50),
      V([0, 30, 6], [0, 130, 6], 50),
    ];
    const mid = samplePath(dolly, 0.5); /* middle of segment 1-2 */
    expect(mid.pos[1]).toBeCloseTo(15, 12);
    expect(mid.pos[0]).toBeCloseTo(0, 12);
    expect(mid.pos[2]).toBeCloseTo(6, 12);
    expect(mid.target[1]).toBeCloseTo(115, 12);
    /* And anywhere else along it. */
    const q = samplePath(dolly, 0.75);
    expect(q.pos[1]).toBeCloseTo(22.5, 12);
  });

  it('two views make one exactly linear segment', () => {
    /* Reflected phantom ends make a two stop path a straight dolly. */
    const pair = [V([0, 0, 5], [10, 0, 5], 50), V([20, 20, 5], [10, 10, 5], 30)];
    const a = samplePath(pair, 0), b = samplePath(pair, 1);
    expect(a.pos).toEqual([0, 0, 5]);
    expect(b.pos[0]).toBeCloseTo(20, 12);
    expect(b.pos[1]).toBeCloseTo(20, 12);
    expect(b.fov).toBeCloseTo(30, 12);
    const mid = samplePath(pair, 0.5);
    expect(mid.pos[0]).toBeCloseTo(10, 12);
    expect(mid.pos[1]).toBeCloseTo(10, 12);
    expect(mid.target[1]).toBeCloseTo(5, 12);
    /* fov blends linearly inside a segment. */
    expect(mid.fov).toBeCloseTo(40, 12);
  });

  it('u is clamped and degenerate inputs are honest', () => {
    expect(samplePath([], 0.5)).toBe(null);
    const one = samplePath([V([1, 2, 3], [4, 5, 6], 45)], 0.9);
    expect(one.pos).toEqual([1, 2, 3]);
    const s = samplePath([V([0, 0, 0], [1, 0, 0], 50), V([10, 0, 0], [11, 0, 0], 50)], 2.5);
    expect(s.pos[0]).toBeCloseTo(10, 12);
  });

  it('easing is exact at the ends and symmetric about the middle', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 12);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(9)).toBe(1);
  });

  it('the WALK command exists', async () => {
    const { lookupCommand } = await import('../src/core/command.js');
    expect(lookupCommand('WALK').action).toBe('walk');
    expect(lookupCommand('FLYTHROUGH').action).toBe('walk');
  });
});
