import { describe, it, expect } from 'vitest';
import {
  makeMesh, triangulateRings, extrudeRings, revolveProfile, loftRings,
  meshVolume, meshArea, meshBBox, isWatertight, meshToSTL, meshToOBJ, mergeMeshes
} from '../src/core/mesh.js';
import { ringsArea } from '../src/core/boolean.js';
import { triangulate, signedArea } from '../src/core/solid.js';
import { lookupCommand } from '../src/core/command.js';

const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const L_SHAPE = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
const DART = [[0, 0], [4, 0], [4, 4], [2, 1]];

const sArea = (p, q, r) => ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;

/* A correct triangulation covers the region exactly once: the absolute and
 * signed sums both equal the ring area, nothing is inverted, and no
 * triangle's centroid falls inside another. Signed area alone is not enough,
 * because an inverted triangle can cancel a stray one and still total right. */
function triQuality(rings){
  const { points, tris } = triangulateRings(rings);
  let abs = 0, signed = 0, inverted = 0;
  tris.forEach(t => {
    const a = sArea(points[t[0]], points[t[1]], points[t[2]]);
    abs += Math.abs(a); signed += a;
    if (a < -1e-9) inverted++;
  });
  const cen = t => [(points[t[0]][0] + points[t[1]][0] + points[t[2]][0]) / 3,
    (points[t[0]][1] + points[t[1]][1] + points[t[2]][1]) / 3];
  const inTri = (p, a, b, c) => {
    const d1 = sArea(p, a, b), d2 = sArea(p, b, c), d3 = sArea(p, c, a);
    return (d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12) || (d1 < -1e-12 && d2 < -1e-12 && d3 < -1e-12);
  };
  let overlaps = 0;
  tris.forEach((t, i) => {
    const c = cen(t);
    tris.forEach((u, j) => { if (i !== j && inTri(c, points[u[0]], points[u[1]], points[u[2]])) overlaps++; });
  });
  return { abs, signed, inverted, overlaps, count: tris.length };
}

describe('triangulation covers the region exactly once', () => {
  const cases = [
    ['a square', [SQ(0, 0, 20, 20)]],
    ['an L', [L_SHAPE]],
    ['a concave dart', [DART]],
    ['a ring with a hole', [SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)]],
    ['two holes', [SQ(0, 0, 30, 20), SQ(2, 2, 6, 6), SQ(20, 10, 5, 5)]],
    ['a hole inside an L', [[[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]], SQ(2, 2, 4, 4)]]
  ];
  for (const [name, rings] of cases){
    it(name, () => {
      const q = triQuality(rings);
      const want = ringsArea(rings);
      expect(q.abs).toBeCloseTo(want, 6);
      expect(q.signed).toBeCloseTo(want, 6);
      expect(q.inverted).toBe(0);
      expect(q.overlaps).toBe(0);
      expect(q.count).toBeGreaterThan(0);
    });
  }

  it('a ring with no area produces nothing', () => {
    expect(triangulateRings([]).tris).toEqual([]);
    expect(triangulateRings([[[0, 0], [1, 1]]]).tris).toEqual([]);
  });
});

describe('extrude', () => {
  it('volume is exactly area times height', () => {
    expect(meshVolume(extrudeRings([SQ(0, 0, 10, 6)], 3))).toBeCloseTo(180, 9);
    expect(meshVolume(extrudeRings([L_SHAPE], 2))).toBeCloseTo(128, 9);
    expect(meshVolume(extrudeRings([DART], 5))).toBeCloseTo(30, 9);
  });

  it('a hole is a real void, not a filled face', () => {
    const m = extrudeRings([SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)], 4);
    expect(meshVolume(m)).toBeCloseTo(1200, 9);
    expect(isWatertight(m)).toBe(true);
  });

  it('surface area counts both caps and every wall', () => {
    expect(meshArea(extrudeRings([SQ(0, 0, 10, 6)], 3)))
      .toBeCloseTo(2 * 60 + 2 * 30 + 2 * 18, 9);
  });

  it('is closed for every profile shape', () => {
    for (const rings of [[SQ(0, 0, 10, 10)], [L_SHAPE], [DART], [SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)]]){
      expect(isWatertight(extrudeRings(rings, 3))).toBe(true);
    }
  });

  it('a downward extrusion is still a positive solid', () => {
    const m = extrudeRings([SQ(0, 0, 10, 6)], -3);
    expect(meshVolume(m)).toBeCloseTo(180, 9);
    expect(isWatertight(m)).toBe(true);
    expect(meshBBox(m)[5]).toBeCloseTo(0, 9);
    expect(meshBBox(m)[2]).toBeCloseTo(-3, 9);
  });

  it('a base offset moves the solid without changing it', () => {
    const m = extrudeRings([SQ(0, 0, 10, 6)], 3, { base: 12 });
    expect(meshVolume(m)).toBeCloseTo(180, 9);
    expect(meshBBox(m)[2]).toBeCloseTo(12, 9);
    expect(meshBBox(m)[5]).toBeCloseTo(15, 9);
  });

  it('zero height and empty input make nothing', () => {
    expect(extrudeRings([SQ(0, 0, 10, 10)], 0).faces.length).toBe(0);
    expect(extrudeRings([], 5).faces.length).toBe(0);
  });
});

describe('revolve, checked against Pappus', () => {
  /* A plane region revolved about an external axis sweeps 2 pi R A, where R
   * is the centroid's distance from the axis. It is an exact identity, so it
   * is the right oracle for a lathe. */
  const cases = [
    ['a rectangle at r 3 to 5', [[3, 0], [5, 0], [5, 1], [3, 1]], 2, 4],
    ['a tall rectangle', [[1, 0], [2, 0], [2, 4], [1, 4]], 4, 1.5],
    ['a triangle', [[2, 0], [4, 0], [2, 3]], 3, 2 + 2 / 3]
  ];
  for (const [name, prof, A, R] of cases){
    it(name + ' matches 2 pi R A', () => {
      const v = meshVolume(revolveProfile(prof, { segments: 2048 }));
      expect(Math.abs(v - 2 * Math.PI * R * A) / (2 * Math.PI * R * A)).toBeLessThan(1e-5);
    });
  }

  it('converges as the segment count rises', () => {
    const prof = [[3, 0], [5, 0], [5, 1], [3, 1]];
    const want = 2 * Math.PI * 4 * 2;
    const err = s => Math.abs(meshVolume(revolveProfile(prof, { segments: s })) - want) / want;
    const e = [24, 90, 360, 1440].map(err);
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThan(e[i - 1]);
    expect(e[3]).toBeLessThan(1e-5);
  });

  it('closes on itself for a full turn and is capped for a partial one', () => {
    const prof = [[3, 0], [5, 0], [5, 1], [3, 1]];
    for (const angle of [360, 270, 180, 90, 45]){
      const m = revolveProfile(prof, { segments: 720, angle });
      expect(isWatertight(m)).toBe(true);
      expect(meshVolume(m)).toBeCloseTo(angle / 360 * 2 * Math.PI * 4 * 2, 2);
    }
  });

  it('does not care whether the caller closed the profile', () => {
    const open = revolveProfile([[3, 0], [5, 0], [5, 1], [3, 1]], { segments: 360 });
    const closed = revolveProfile([[3, 0], [5, 0], [5, 1], [3, 1], [3, 0]], { segments: 360 });
    expect(meshVolume(closed)).toBeCloseTo(meshVolume(open), 12);
  });

  it('a profile given the wrong way round still makes a positive solid', () => {
    const rev = revolveProfile([[3, 1], [5, 1], [5, 0], [3, 0]], { segments: 360 });
    expect(meshVolume(rev)).toBeGreaterThan(0);
  });

  it('too few points makes nothing', () => {
    expect(revolveProfile([[1, 0], [2, 0]], {}).faces.length).toBe(0);
    expect(revolveProfile([], {}).faces.length).toBe(0);
  });
});

describe('loft', () => {
  it('a frustum matches the exact formula', () => {
    const m = loftRings([{ ring: SQ(0, 0, 10, 10), z: 0 }, { ring: SQ(2, 2, 6, 6), z: 5 }]);
    expect(meshVolume(m)).toBeCloseTo(5 / 3 * (100 + 36 + 60), 9);
    expect(isWatertight(m)).toBe(true);
  });

  it('lofting a shape to itself is a prism', () => {
    const m = loftRings([{ ring: SQ(0, 0, 10, 6), z: 0 }, { ring: SQ(0, 0, 10, 6), z: 3 }]);
    expect(meshVolume(m)).toBeCloseTo(180, 9);
    expect(meshVolume(m)).toBeCloseTo(meshVolume(extrudeRings([SQ(0, 0, 10, 6)], 3)), 9);
  });

  it('handles more than two sections', () => {
    const m = loftRings([
      { ring: SQ(0, 0, 10, 10), z: 0 },
      { ring: SQ(1, 1, 8, 8), z: 2 },
      { ring: SQ(3, 3, 4, 4), z: 6 }
    ]);
    expect(meshVolume(m)).toBeGreaterThan(0);
    expect(isWatertight(m)).toBe(true);
  });

  it('refuses mismatched sections rather than guessing a correspondence', () => {
    expect(() => loftRings([
      { ring: SQ(0, 0, 10, 10), z: 0 },
      { ring: [[0, 0], [5, 0], [5, 5], [2, 6], [0, 5]], z: 4 }
    ])).toThrow(/same number/);
  });

  it('one section is not a loft', () => {
    expect(loftRings([{ ring: SQ(0, 0, 10, 10), z: 0 }]).faces.length).toBe(0);
    expect(loftRings([]).faces.length).toBe(0);
  });
});

describe('measurement and merging', () => {
  it('an empty mesh measures zero', () => {
    expect(meshVolume(makeMesh([], []))).toBe(0);
    expect(meshArea(makeMesh([], []))).toBe(0);
  });

  it('the bounding box covers every vertex', () => {
    const m = extrudeRings([SQ(-4, -2, 10, 6)], 3);
    expect(meshBBox(m)).toEqual([-4, -2, 0, 6, 4, 3]);
  });

  it('merging keeps every solid and adds their volumes', () => {
    const a = extrudeRings([SQ(0, 0, 10, 6)], 3);
    const b = extrudeRings([SQ(100, 0, 4, 4)], 2);
    const m = mergeMeshes([a, b]);
    expect(m.faces.length).toBe(a.faces.length + b.faces.length);
    expect(meshVolume(m)).toBeCloseTo(180 + 32, 9);
    expect(isWatertight(m)).toBe(true);
  });

  it('merging nothing is an empty mesh', () => {
    expect(mergeMeshes([]).faces.length).toBe(0);
    expect(mergeMeshes([null, undefined]).faces.length).toBe(0);
  });

  it('an open shell is reported as not watertight', () => {
    const m = extrudeRings([SQ(0, 0, 10, 6)], 3);
    m.faces.pop();
    expect(isWatertight(m)).toBe(false);
  });
});

describe('3D export', () => {
  const m = () => extrudeRings([SQ(0, 0, 10, 6)], 3);

  it('STL is well formed and has one facet per triangle', () => {
    const stl = meshToSTL(m(), 'test');
    expect(stl.startsWith('solid test')).toBe(true);
    expect(stl.trim().endsWith('endsolid test')).toBe(true);
    expect((stl.match(/facet normal/g) || []).length).toBe(m().faces.length);
    expect((stl.match(/vertex /g) || []).length).toBe(m().faces.length * 3);
  });

  it('STL normals are unit length', () => {
    const stl = meshToSTL(m(), 't');
    for (const line of stl.split('\n')){
      const g = line.match(/facet normal (\S+) (\S+) (\S+)/);
      if (!g) continue;
      expect(Math.hypot(Number(g[1]), Number(g[2]), Number(g[3]))).toBeCloseTo(1, 6);
    }
  });

  it('OBJ indices are one based and in range', () => {
    const mesh = m();
    const obj = meshToOBJ(mesh, 't');
    const vs = (obj.match(/^v /gm) || []).length;
    expect(vs).toBe(mesh.verts.length);
    for (const line of obj.split('\n')){
      if (!line.startsWith('f ')) continue;
      line.slice(2).split(' ').forEach(i => {
        expect(Number(i)).toBeGreaterThanOrEqual(1);
        expect(Number(i)).toBeLessThanOrEqual(vs);
      });
    }
  });
});

describe('the existing plan triangulator no longer covers area it should not', () => {
  const area = (p, q, r) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
  const sum = pts => {
    const t = triangulate(pts);
    let s = 0;
    for (let i = 0; i < t.length; i += 3) s += area(pts[t[i]], pts[t[i + 1]], pts[t[i + 2]]);
    return s;
  };
  it('a concave quad triangulates to its own area, not the hull', () => {
    /* The quad fast path split on the 0-2 diagonal unconditionally, which
     * leaves a concave quad and reported 10 for a shape of area 6. */
    expect(sum(DART)).toBeCloseTo(Math.abs(signedArea(DART)), 9);
    expect(sum(DART)).toBeCloseTo(6, 9);
  });
  it('convex quads are unchanged', () => {
    for (const q of [SQ(0, 0, 4, 4), [[0, 0], [6, 0], [4, 3], [1, 3]]]){
      expect(sum(q)).toBeCloseTo(Math.abs(signedArea(q)), 9);
    }
  });
});

describe('the commands are registered', () => {
  it('the 3D operations reach the command line', () => {
    expect(lookupCommand('EXTRUDE').action).toBe('extrude3d');
    expect(lookupCommand('EXT').action).toBe('extrude3d');
    expect(lookupCommand('REVOLVE').action).toBe('revolve3d');
    expect(lookupCommand('LOFT').action).toBe('loft3d');
    expect(lookupCommand('SOLIDCLR').action).toBe('clearsolids');
  });
});
