import { describe, it, expect } from 'vitest';
import {
  polyBoolean, unionRings, intersectRings, differenceRings, xorRings,
  ringsArea, orient, insideSet, cleanRings, UNION, INTERSECT, DIFFERENCE
} from '../src/core/boolean.js';
import { polyArea } from '../src/core/geometry.js';
import { nestLoops, hatchWithIslands, hatchArea } from '../src/core/hatch.js';
import { lookupCommand } from '../src/core/command.js';

const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const A = () => [SQ(0, 0, 10, 10)];
const near = (a, b) => expect(a).toBeCloseTo(b, 6);

describe('the four operations on overlapping squares', () => {
  const B = () => [SQ(5, 5, 10, 10)];
  it('union is both minus the double count', () => near(ringsArea(unionRings(A(), B())), 175));
  it('intersection is only the shared part', () => near(ringsArea(intersectRings(A(), B())), 25));
  it('difference is the first without the second', () => near(ringsArea(differenceRings(A(), B())), 75));
  it('exclusive or is everything but the shared part', () => near(ringsArea(xorRings(A(), B())), 150));
  it('difference is not symmetric', () => near(ringsArea(differenceRings(B(), A())), 75));
});

describe('regions that do not overlap', () => {
  const far = () => [SQ(50, 50, 10, 10)];
  it('union keeps both as separate rings', () => {
    const u = unionRings(A(), far());
    expect(u.length).toBe(2);
    near(ringsArea(u), 200);
  });
  it('intersection is empty', () => {
    expect(intersectRings(A(), far())).toEqual([]);
    near(ringsArea(intersectRings(A(), far())), 0);
  });
  it('difference leaves the first alone', () => near(ringsArea(differenceRings(A(), far())), 100));
});

describe('one region inside another', () => {
  const outer = () => [SQ(0, 0, 20, 20)];
  const inner = () => [SQ(5, 5, 10, 10)];
  it('union is just the outer', () => near(ringsArea(unionRings(outer(), inner())), 400));
  it('intersection is just the inner', () => near(ringsArea(intersectRings(outer(), inner())), 100));
  it('difference punches a hole', () => {
    const d = differenceRings(outer(), inner());
    expect(d.length).toBe(2);
    near(ringsArea(d), 300);
    /* The hole must be nested inside the outline, or it is not a hole. */
    const n = nestLoops(d);
    expect(n.filter(x => x.hole).length).toBe(1);
  });
  it('the inner minus the outer is nothing', () => near(ringsArea(differenceRings(inner(), outer())), 0));
});

describe('shared boundaries, which is the normal case not the exception', () => {
  it('two rooms sharing a wall merge into one outline', () => {
    const u = unionRings(A(), [SQ(10, 0, 10, 10)]);
    expect(u.length).toBe(1);
    near(ringsArea(u), 200);
  });
  it('and share no area', () => near(ringsArea(intersectRings(A(), [SQ(10, 0, 10, 10)])), 0));
  it('a partial shared edge still merges cleanly', () => near(ringsArea(unionRings(A(), [SQ(10, 2, 10, 6)])), 160));
  it('identical regions collapse to one', () => {
    near(ringsArea(unionRings(A(), A())), 100);
    near(ringsArea(intersectRings(A(), A())), 100);
    near(ringsArea(differenceRings(A(), A())), 0);
    near(ringsArea(xorRings(A(), A())), 0);
  });
  it('touching at a single corner joins nothing and shares nothing', () => {
    near(ringsArea(unionRings(A(), [SQ(10, 10, 10, 10)])), 200);
    near(ringsArea(intersectRings(A(), [SQ(10, 10, 10, 10)])), 0);
  });
});

describe('operands that already have holes', () => {
  const frame = () => [SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)];
  it('a ring set with a hole reports its net area', () => near(ringsArea(frame()), 300));
  it('covering it fills the hole', () => near(ringsArea(unionRings(frame(), [SQ(0, 0, 20, 20)])), 400));
  it('intersecting inside the hole finds nothing', () => near(ringsArea(intersectRings(frame(), [SQ(6, 6, 8, 8)])), 0));
  it('intersecting a band across it counts only solid', () => near(ringsArea(intersectRings(frame(), [SQ(0, 0, 20, 3)])), 60));
  it('cutting it in half halves the net area', () => near(ringsArea(differenceRings(frame(), [SQ(0, 0, 10, 20)])), 150));
});

describe('results with a shape of their own', () => {
  it('four bars union into a frame with a hole in the middle', () => {
    let u = [SQ(0, 0, 20, 2)];
    u = unionRings(u, [SQ(0, 18, 20, 2)]);
    u = unionRings(u, [SQ(0, 0, 2, 20)]);
    u = unionRings(u, [SQ(18, 0, 2, 20)]);
    expect(u.length).toBe(2);
    near(ringsArea(u), 400 - 16 * 16);
    expect(nestLoops(u).filter(x => x.hole).length).toBe(1);
  });

  it('a bar cut across the middle becomes two separate pieces', () => {
    const cut = differenceRings([SQ(0, 0, 30, 5)], [SQ(10, -1, 10, 7)]);
    expect(cut.length).toBe(2);
    near(ringsArea(cut), 100);
    expect(nestLoops(cut).every(x => !x.hole)).toBe(true);
  });

  it('concave shapes work, not just boxes', () => {
    const L = [[[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]];
    near(ringsArea(L), 64);
    near(ringsArea(unionRings(L, [SQ(6, 6, 10, 10)])), 164);
    near(ringsArea(intersectRings(L, [SQ(6, 6, 10, 10)])), 0);
    near(ringsArea(intersectRings(L, [SQ(0, 0, 4, 4)])), 16);
  });
});

describe('empty and degenerate input', () => {
  it('an empty operand behaves like the empty set', () => {
    near(ringsArea(unionRings(A(), [])), 100);
    near(ringsArea(intersectRings(A(), [])), 0);
    near(ringsArea(differenceRings(A(), [])), 100);
    near(ringsArea(differenceRings([], A())), 0);
    near(ringsArea(unionRings([], A())), 100);
    expect(polyBoolean([], [], UNION)).toEqual([]);
  });

  it('zero area and too-short rings are discarded', () => {
    expect(cleanRings([[[0, 0], [1, 1]]])).toEqual([]);
    expect(cleanRings([[[0, 0], [5, 0], [10, 0]]])).toEqual([]);
    expect(cleanRings([null, undefined, []])).toEqual([]);
  });

  it('repeated and duplicated points are cleaned away', () => {
    const r = cleanRings([[[0, 0], [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);
    expect(r.length).toBe(1);
    expect(r[0].length).toBe(4);
  });

  it('a ring given the wrong way round still works', () => {
    const cw = [SQ(0, 0, 10, 10).slice().reverse()];
    near(ringsArea(cw), 100);
    near(ringsArea(unionRings(cw, [SQ(5, 5, 10, 10)])), 175);
  });
});

describe('orientation and containment', () => {
  it('outer rings come back counterclockwise and holes clockwise', () => {
    const o = orient([SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)]);
    expect(polyArea(o[0])).toBeGreaterThan(0);
    expect(polyArea(o[1])).toBeLessThan(0);
  });

  it('inside means inside the solid, not inside a hole', () => {
    const f = orient([SQ(0, 0, 20, 20), SQ(5, 5, 10, 10)]);
    expect(insideSet(f, 2, 2)).toBe(true);
    expect(insideSet(f, 10, 10)).toBe(false);
    expect(insideSet(f, 30, 30)).toBe(false);
  });
});

describe('the set identities hold over random input', () => {
  it('600 random pairs satisfy every identity', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const rect = () => { const x = rnd() * 20 - 5, y = rnd() * 20 - 5, w = rnd() * 14 + 1, h = rnd() * 14 + 1; return [SQ(x, y, w, h)]; };
    /* Star shaped, so it is simple by construction. */
    const star = n => {
      const cx = rnd() * 10, cy = rnd() * 10, pts = [];
      for (let i = 0; i < n; i++){ const a = i / n * 2 * Math.PI, r = 2 + rnd() * 6; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return [pts];
    };
    let tested = 0, worst = 0;
    for (let k = 0; k < 600; k++){
      const P = k % 3 === 0 ? rect() : star(3 + Math.floor(rnd() * 7));
      const Q = k % 2 === 0 ? rect() : star(3 + Math.floor(rnd() * 7));
      const aP = ringsArea(P), aQ = ringsArea(Q);
      if (aP < 1e-6 || aQ < 1e-6) continue;
      const I = ringsArea(intersectRings(P, Q));
      const U = ringsArea(unionRings(P, Q));
      const D = ringsArea(differenceRings(P, Q));
      const X = ringsArea(xorRings(P, Q));
      const tol = 1e-5 * Math.max(1, aP + aQ);
      worst = Math.max(worst,
        Math.abs(U - (aP + aQ - I)),
        Math.abs(D - (aP - I)),
        Math.abs(X - (U - I)));
      expect(Math.abs(U - (aP + aQ - I))).toBeLessThan(tol);
      expect(Math.abs(D - (aP - I))).toBeLessThan(tol);
      expect(Math.abs(X - (U - I))).toBeLessThan(tol);
      expect(I).toBeLessThanOrEqual(Math.min(aP, aQ) + tol);
      expect(U).toBeGreaterThanOrEqual(Math.max(aP, aQ) - tol);
      tested++;
    }
    expect(tested).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('booleans compose with island hatching', () => {
  it('a difference result hatches as a region with a void', () => {
    const d = differenceRings([SQ(0, 0, 20, 20)], [SQ(5, 5, 10, 10)]);
    const hs = hatchWithIslands(d, { layer: 'HATCH', pattern: 'ANSI31' });
    expect(hs.length).toBe(1);
    expect(hs[0].holes.length).toBe(1);
    near(hatchArea(hs[0]), 300);
  });
});

describe('the operations reach the command line', () => {
  it('registers each one and its alias', () => {
    expect(lookupCommand('UNION').action).toBe('bool:union');
    expect(lookupCommand('BUNION').action).toBe('bool:union');
    expect(lookupCommand('SUBTRACT').action).toBe('bool:difference');
    expect(lookupCommand('BSUB').action).toBe('bool:difference');
    expect(lookupCommand('INTERSECT').action).toBe('bool:intersect');
    expect(lookupCommand('BINT').action).toBe('bool:intersect');
    expect(lookupCommand('BXOR').action).toBe('bool:xor');
  });

  it('the action names match what the engine accepts', () => {
    expect(['union', 'difference', 'intersect', 'xor']).toContain(lookupCommand('UNION').action.slice(5));
    expect(ringsArea(polyBoolean(A(), [SQ(5, 5, 10, 10)], lookupCommand('SUBTRACT').action.slice(5)))).toBeCloseTo(75, 6);
    expect(ringsArea(polyBoolean(A(), [SQ(5, 5, 10, 10)], lookupCommand('INTERSECT').action.slice(5)))).toBeCloseTo(25, 6);
  });
});

void DIFFERENCE; void INTERSECT;
