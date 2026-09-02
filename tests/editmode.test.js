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

describe('callouts stay on the sheet holding what they point at', () => {
  it('a callout leaks onto a sheet only when its anchor is inside the window', async () => {
    const { entsInBBox } = await import('../src/core/legend.js');
    /* An engine callout: anchor at the engine (y=2), label parked far
     * above (y=88). Its bbox crosses every station of a 90 ft rocket. */
    const engine = { type: 'callout', layer: 'NOTES', anchor: [10, 2], pts: [[10, 2], [28, 88]], content: 'ENGINE', textH: 1 };
    const nose = { type: 'callout', layer: 'NOTES', anchor: [12, 85], pts: [[12, 85], [30, 86]], content: 'NOSE', textH: 1 };
    const lead = { type: 'leader', layer: 'NOTES', pts: [[11, 3], [26, 70]], content: 'note', textH: 1 };
    const noseBox = [0, 78, 34, 92];
    const kept = entsInBBox([engine, nose, lead], noseBox, 0.4);
    expect(kept.map(e => e.content)).toEqual(['NOSE']);
    const engineBox = [0, 0, 34, 12];
    const keptE = entsInBBox([engine, nose, lead], engineBox, 0.4);
    expect(keptE.map(e => e.content).sort()).toEqual(['ENGINE', 'note']);
  });
});

describe('a forbidden fill is stripped from a draft, not fatal to it', () => {
  it('stripImpliedFill removes what the assert would have died on', async () => {
    const { stripImpliedFill, assertNoImpliedFill } = await import('../src/core/annotate.js');
    const ents = [
      { type: 'profile', layer: 'PROFILE', pts: [[0, 0], [4, 0], [4, 4]], fill: 'ANSI31' },
      { type: 'hatch', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4]] },
      { type: 'hatchRegion', layer: 'HATCH', pts: [[0, 0], [4, 0], [4, 4]], pattern: 'ANSI31' },
      { type: 'line', layer: 'PROFILE', x1: 0, y1: 0, x2: 4, y2: 0 },
    ];
    expect(() => assertNoImpliedFill(ents, 'elevation')).toThrow(/implied fill/);
    const out = stripImpliedFill(ents, 'elevation');
    expect(out.stripped).toBe(2);
    /* The profile survives unfilled, the implied hatch is gone, the
     * explicit hatchRegion and the line pass untouched. */
    expect(out.entities.length).toBe(3);
    expect(out.entities[0].fill).toBe(false);
    expect(() => assertNoImpliedFill(out.entities, 'elevation')).not.toThrow();
    /* A plan allows implied hatch: nothing stripped there. */
    expect(stripImpliedFill(ents, 'plan').stripped).toBe(0);
  });
});

describe('the ACAD keymap gives four letters back to AutoCAD hands', () => {
  it('E, M, U, X resolve per keymap; full words never change', async () => {
    const { lookupCommand, setKeymap, getKeymap } = await import('../src/core/command.js');
    setKeymap('sd');
    expect(lookupCommand('E').name).toBe('EXTEND');
    expect(lookupCommand('M').name).toBe('MEASURE');
    expect(lookupCommand('U').name).toBe('COPY');
    expect(lookupCommand('X').name).toBe('TRIM');
    setKeymap('acad');
    expect(getKeymap()).toBe('acad');
    expect(lookupCommand('E').name).toBe('ERASE');
    expect(lookupCommand('M').name).toBe('MOVE');
    expect(lookupCommand('U').name).toBe('UNDO');
    expect(lookupCommand('X').name).toBe('EXPLODE');
    /* Full spellings are identical in both maps. */
    expect(lookupCommand('TRIM').name).toBe('TRIM');
    expect(lookupCommand('EXTEND').name).toBe('EXTEND');
    expect(lookupCommand('COPY').name).toBe('COPY');
    setKeymap('sd');
    expect(lookupCommand('E').name).toBe('EXTEND');
  });
});

describe('face grab moves the whole coplanar patch', () => {
  it('the top face of a box is its four corners, and lifting it is exact', async () => {
    const { facePoints, moveMeshPoints } = await import('../src/core/snap3d.js');
    const { makeBox, meshVolume, isWatertight } = await import('../src/core/mesh.js');
    const m = makeBox(0, 0, 0, 10, 8, 6);
    /* Find a triangle on the top plane z = 6. */
    const seed = m.faces.findIndex(f => f.every(vi => m.verts[vi][2] === 6));
    expect(seed).toBeGreaterThanOrEqual(0);
    const pts = facePoints(m, seed);
    expect(pts.length).toBe(4);
    pts.forEach(p => expect(p[2]).toBe(6));
    /* Lifting the whole face by 2 is a pure prism: 10 x 8 x 2 more. */
    const out = moveMeshPoints(m, pts, [0, 0, 2]);
    expect(isWatertight(out)).toBe(true);
    expect(Math.abs(meshVolume(out))).toBeCloseTo(640, 9);
  });
});

describe('CSG output is combinatorially watertight, not just closed', () => {
  it('a dormer union heals its T-junctions with the volume untouched', async () => {
    const { makeGable, makeBox, isWatertight, meshVolume } = await import('../src/core/mesh.js');
    const { csg } = await import('../src/core/csg.js');
    const roof = makeGable(6, 4, 8, 36, 24, 6);
    const dormer = csg('union', makeBox(20, 8, 10.5, 6, 7.5, 4), makeGable(20, 8, 14.5, 6, 7.5, 1.5));
    expect(isWatertight(dormer)).toBe(true);
    const out = csg('union', roof, dormer);
    expect(isWatertight(out)).toBe(true);
    /* The union adds the dormer's above-roof volume; whatever it is, it
     * is the same closed solid the unhealed mesh enclosed. */
    expect(Math.abs(meshVolume(out))).toBeGreaterThan(Math.abs(meshVolume(roof)));
  });

  it('the drill stays watertight and exact through the healed pipeline', async () => {
    const { makeBox, makeCylinder, isWatertight, meshVolume } = await import('../src/core/mesh.js');
    const { csg } = await import('../src/core/csg.js');
    const box = makeBox(0, 0, 0, 10, 10, 4);
    const cyl = makeCylinder(5, 5, -1, 2, 6, 64);
    const out = csg('subtract', box, cyl);
    expect(isWatertight(out)).toBe(true);
    /* Volume: 400 minus the prism through the slab, pi r^2 h with the
     * 64-gon's exact area standing in for pi r^2. */
    const segArea = 0.5 * 64 * 2 * 2 * Math.sin(2 * Math.PI / 64);
    expect(Math.abs(meshVolume(out))).toBeCloseTo(400 - segArea * 4, 6);
  });
});
