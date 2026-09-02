import { describe, it, expect } from 'vitest';
import { grabTarget, moveMeshPoints } from '../src/core/snap3d.js';
import { makeBox, meshVolume, isWatertight } from '../src/core/mesh.js';

describe('edit mode grabs and moves mesh features exactly', () => {
  const box = () => makeBox(0, 0, 0, 10, 8, 6);

  it('a click near a corner grabs exactly that vertex', () => {
    const g = grabTarget(box(), [9.8, 8.2, 5.9], 0.6);
    expect(g.kind).toBe('vertex');
    expect(g.points).toEqual([[10, 8, 6]]);
  });

  it('a click near an edge midpoint grabs the edge, both endpoints', () => {
    const g = grabTarget(box(), [5.1, 0.1, 6.1], 0.6);
    expect(g.kind).toBe('edge');
    const ends = g.points.map(p => p.join(',')).sort();
    expect(ends).toEqual(['0,0,6', '10,0,6']);
  });

  it('a click in the middle of nowhere grabs nothing', () => {
    expect(grabTarget(box(), [5, 4, 30], 0.6)).toBe(null);
  });

  it('moving one corner moves exactly that vertex and keeps the mesh watertight', () => {
    const m = box();
    const before = m.verts.map(v => v.join(','));
    const out = moveMeshPoints(m, [[10, 8, 6]], [1.5, -0.5, 2]);
    expect(isWatertight(out)).toBe(true);
    /* Every vertex slot holding the grabbed corner moves (a mesh may
     * store a corner more than once, and all copies must travel
     * together or the mesh tears); every other slot is untouched. */
    out.verts.forEach((v, i) => {
      const was = m.verts[i];
      if (was[0] === 10 && was[1] === 8 && was[2] === 6){
        expect(v).toEqual([11.5, 7.5, 8]);
      } else {
        expect(v.join(',')).toBe(before[i]);
      }
    });
    expect(out.verts.some(v => v[0] === 11.5 && v[1] === 7.5 && v[2] === 8)).toBe(true);
    /* The source mesh is untouched. */
    expect(m.verts.map(v => v.join(','))).toEqual(before);
  });

  it('lifting a whole top edge adds exactly the wedge volume', () => {
    /* Raise the top edge at y=0 by 2: the top face tilts to the plane
     * z = 6 + 2(1 - y/8), which is linear in y, so the tilted face is
     * planar and the enclosed volume has a closed form:
     * 10 x 8 x 6 plus the wedge 10 x 8 x 2 / 2 = 560. */
    const out = moveMeshPoints(box(), [[0, 0, 6], [10, 0, 6]], [0, 0, 2]);
    expect(isWatertight(out)).toBe(true);
    expect(Math.abs(meshVolume(out))).toBeCloseTo(560, 9);
  });

  it('a roof ridge is grabbable and slides exactly', async () => {
    const { makeGable } = await import('../src/core/mesh.js');
    const g = makeGable(0, 0, 0, 20, 12, 3);
    const ridgeEnd = grabTarget(g, [0.2, 6.1, 3.1], 0.6);
    expect(ridgeEnd.kind).toBe('vertex');
    expect(ridgeEnd.points).toEqual([[0, 6, 3]]);
    /* Slide the whole ridge sideways: an asymmetric gable, same volume
     * (shearing a cross-section keeps its area, prism volume holds). */
    const out = moveMeshPoints(g, [[0, 6, 3], [20, 6, 3]], [0, 2, 0]);
    expect(isWatertight(out)).toBe(true);
    expect(Math.abs(meshVolume(out))).toBeCloseTo(Math.abs(meshVolume(g)), 9);
  });
});
