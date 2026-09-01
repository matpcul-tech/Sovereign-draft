import { describe, it, expect } from 'vitest';
import { snapPoints, makeSnapIndex, inferMove } from '../src/core/snap3d.js';
import { makeBox, makeGable } from '../src/core/mesh.js';

describe('inference snapping is exact where exactness has a closed form', () => {
  it('a box offers exactly its 8 corners and 12 edge midpoints', () => {
    /* Triangulation diagonals lie inside flat faces and are not feature
     * edges, so the counts are the geometric ones. */
    const pts = snapPoints(makeBox(0, 0, 0, 10, 8, 6));
    const verts = pts.filter(p => p.kind === 'vertex');
    const mids = pts.filter(p => p.kind === 'midpoint');
    expect(verts.length).toBe(8);
    expect(mids.length).toBe(12);
    /* Corners are the vertices themselves, exactly. */
    expect(verts.some(v => v.p[0] === 10 && v.p[1] === 8 && v.p[2] === 6)).toBe(true);
    /* A midpoint is the exact average of its edge ends. */
    expect(mids.some(m => m.p[0] === 5 && m.p[1] === 0 && m.p[2] === 0)).toBe(true);
    expect(mids.some(m => m.p[0] === 10 && m.p[1] === 4 && m.p[2] === 6)).toBe(true);
  });

  it('a gable roof offers its ridge ends as vertices', () => {
    const pts = snapPoints(makeGable(0, 0, 4, 20, 12, 3));
    const verts = pts.filter(p => p.kind === 'vertex');
    /* w >= d puts the ridge along x at mid-depth, lifted by the rise. */
    const ridge = verts.filter(v => Math.abs(v.p[1] - 6) < 1e-9 && Math.abs(v.p[2] - 7) < 1e-9);
    expect(ridge.length).toBe(2);
  });

  it('plan inference lands a corner exactly on a corner and keeps the lift', () => {
    const self = snapPoints(makeBox(0, 0, 0, 4, 4, 4));
    const others = snapPoints(makeBox(10, 6, 0, 4, 4, 4));
    const idx = makeSnapIndex(others, 0.45);
    /* Raw drag puts the corner (4,4,z) at (9.7, 5.8, z); the target
     * corner (10,6,0) is 0.36 away in plan, inside tolerance. */
    const hit = inferMove(self, [5.7, 1.8, 0], idx, 0.45, 'plan');
    expect(hit).not.toBe(null);
    expect(hit.kind).toBe('vertex');
    expect(hit.delta).toEqual([6, 2, 0]);
  });

  it('lift inference corrects z only', () => {
    const self = snapPoints(makeBox(0, 0, 0, 4, 4, 4));
    const others = snapPoints(makeBox(0, 0, 9, 4, 4, 4));
    const idx = makeSnapIndex(others, 0.45);
    /* Lifting by 4.8 puts the top (z=4) at 8.8; the other box bottom is
     * at 9, correction 0.2. x and y pass through untouched. */
    const hit = inferMove(self, [0, 0, 4.8], idx, 0.45, 'lift');
    expect(hit).not.toBe(null);
    expect(hit.delta).toEqual([0, 0, 5]);
  });

  it('midpoint targets win when they are the nearest thing', () => {
    const others = snapPoints(makeBox(10, 0, 0, 8, 8, 8));
    const idx = makeSnapIndex(others, 0.45);
    /* Query near (14, 0, 0), the midpoint of the near bottom edge. */
    const hit = idx.best([14.1, 0.1, 0], 0.45, 'xy');
    expect(hit.point.kind).toBe('midpoint');
    expect(hit.point.p).toEqual([14, 0, 0]);
  });

  it('nothing within tolerance means no inference', () => {
    const self = snapPoints(makeBox(0, 0, 0, 4, 4, 4));
    const idx = makeSnapIndex(snapPoints(makeBox(20, 20, 0, 4, 4, 4)), 0.45);
    expect(inferMove(self, [1, 0, 0], idx, 0.45, 'plan')).toBe(null);
  });

  it('the grid index agrees with a brute force scan', () => {
    /* Deterministic pseudo-random cloud; the index must return the same
     * nearest point a linear scan does, for every query. */
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pts = [];
    for (let i = 0; i < 300; i++) pts.push({ p: [rand() * 40, rand() * 40, rand() * 12], kind: 'vertex' });
    const idx = makeSnapIndex(pts, 0.45);
    for (let i = 0; i < 60; i++){
      const q = [rand() * 40, rand() * 40, rand() * 12];
      const got = idx.best(q, 0.45, 'xyz');
      let bd = 0.45, bp = null;
      for (const pt of pts){
        const d = Math.hypot(pt.p[0] - q[0], pt.p[1] - q[1], pt.p[2] - q[2]);
        if (d < bd){ bd = d; bp = pt; }
      }
      if (bp == null) expect(got).toBe(null);
      else expect(got.point.p).toEqual(bp.p);
    }
  });
});
