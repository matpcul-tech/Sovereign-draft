import { describe, it, expect } from 'vitest';
import {
  makeHatch, hatchLines, nestLoops, hatchWithIslands, hatchArea,
  insideWithHoles, closedLoops
} from '../src/core/hatch.js';
import { makeSpline } from '../src/core/spline.js';
import { lookupCommand } from '../src/core/command.js';

const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const OUTER = SQ(0, 0, 20, 20);
const HOLE = SQ(5, 5, 10, 10);
const INNER = SQ(8, 8, 4, 4);

describe('island nesting', () => {
  it('reads depth from containment, and odd depth is a hole', () => {
    const n = nestLoops([OUTER, HOLE, INNER]);
    expect(n.map(x => x.depth)).toEqual([0, 1, 2]);
    expect(n.map(x => x.hole)).toEqual([false, true, false]);
  });

  it('order of the loops does not matter', () => {
    const n = nestLoops([INNER, OUTER, HOLE]);
    const byDepth = n.slice().sort((a, b) => a.depth - b.depth);
    expect(byDepth.map(x => x.depth)).toEqual([0, 1, 2]);
  });

  it('disjoint loops are all solid', () => {
    const n = nestLoops([SQ(0, 0, 5, 5), SQ(50, 50, 5, 5)]);
    expect(n.every(x => x.depth === 0 && !x.hole)).toBe(true);
  });

  it('drops loops that are not loops', () => {
    expect(nestLoops([OUTER, [[0, 0], [1, 1]], null]).length).toBe(1);
  });
});

describe('hatch regions built from islands', () => {
  it('a courtyard becomes a hole, not another region', () => {
    const hs = hatchWithIslands([OUTER, HOLE], { layer: 'HATCH', pattern: 'ANSI31' });
    expect(hs.length).toBe(1);
    expect(hs[0].holes.length).toBe(1);
  });

  it('a solid inside a hole is its own region', () => {
    const hs = hatchWithIslands([OUTER, HOLE, INNER], { layer: 'HATCH', pattern: 'ANSI31' });
    expect(hs.length).toBe(2);
    const withHole = hs.find(h => h.holes);
    expect(withHole.holes.length).toBe(1);
  });

  it('a hole only attaches to the region directly around it', () => {
    const hs = hatchWithIslands([OUTER, HOLE, INNER, SQ(9, 9, 1, 1)], { layer: 'HATCH' });
    const outerRegion = hs.find(h => Math.abs(h.pts[0][0]) < 1e-9 && Math.abs(h.pts[0][1]) < 1e-9);
    expect(outerRegion.holes.length).toBe(1);
    expect(outerRegion.holes[0][0]).toEqual([5, 5]);
  });
});

describe('net area', () => {
  it('subtracts the islands', () => {
    const hs = hatchWithIslands([OUTER, HOLE], {});
    expect(hatchArea(hs[0])).toBeCloseTo(400 - 100, 9);
  });

  it('a plain hatch is just its area', () => {
    expect(hatchArea(makeHatch(OUTER, {}))).toBeCloseTo(400, 9);
  });

  it('holes bigger than the region never go negative', () => {
    const h = makeHatch(SQ(0, 0, 2, 2), {});
    h.holes = [SQ(-10, -10, 40, 40)];
    expect(hatchArea(h)).toBe(0);
  });

  it('a non region has no area', () => {
    expect(hatchArea(null)).toBe(0);
    expect(hatchArea({ type: 'hatch', pts: [[0, 0], [1, 1]] })).toBe(0);
  });
});

describe('the pattern respects the void', () => {
  it('inside means inside the region and outside every hole', () => {
    const h = makeHatch(OUTER, {}); h.holes = [HOLE];
    expect(insideWithHoles(2, 2, h.pts, h.holes)).toBe(true);
    expect(insideWithHoles(10, 10, h.pts, h.holes)).toBe(false);
    expect(insideWithHoles(-1, -1, h.pts, h.holes)).toBe(false);
  });

  it('no pattern line crosses a hole', () => {
    const h = hatchWithIslands([OUTER, HOLE], { pattern: 'ANSI31' })[0];
    const segs = hatchLines(h, 1);
    expect(segs.length).toBeGreaterThan(10);
    let crossings = 0;
    for (const [a, b] of segs){
      for (let t = 0.05; t < 1; t += 0.05){
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        if (x > 5.05 && x < 14.95 && y > 5.05 && y < 14.95) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it('the same region without holes does cross that area, so the test is not vacuous', () => {
    const plain = makeHatch(OUTER, { pattern: 'ANSI31' });
    let hits = 0;
    for (const [a, b] of hatchLines(plain, 1)){
      for (let t = 0.05; t < 1; t += 0.05){
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        if (x > 5.05 && x < 14.95 && y > 5.05 && y < 14.95) hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe('loops from entities', () => {
  it('takes closed polys, circles and closed splines and skips open work', () => {
    const loops = closedLoops([
      { type: 'poly', closed: true, pts: OUTER },
      { type: 'poly', closed: false, pts: OUTER },
      { type: 'circle', cx: 0, cy: 0, r: 5 },
      makeSpline(SQ(0, 0, 4, 4), { closed: true }),
      makeSpline(SQ(0, 0, 4, 4), {}),
      { type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }
    ]);
    expect(loops.length).toBe(3);
    loops.forEach(l => expect(l.length).toBeGreaterThanOrEqual(3));
  });

  it('an empty or junk selection yields nothing', () => {
    expect(closedLoops([])).toEqual([]);
    expect(closedLoops([null, undefined])).toEqual([]);
  });
});

describe('island hatching reaches the command line', () => {
  it('registers BHATCH and its alias', () => {
    expect(lookupCommand('BHATCH').action).toBe('bhatch');
    expect(lookupCommand('HATCHI').action).toBe('bhatch');
  });
});
