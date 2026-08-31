import { describe, it, expect } from 'vitest';
import {
  buildIndex, queryIndices, queryBox, queryPoint, entityBox,
  makeIndexCache, worthIndexing, INDEX_MIN
} from '../src/core/spatial.js';
import { entBBox } from '../src/core/entities.js';

function grid(n){
  const ents = [];
  for (let i = 0; i < n; i++){
    const x = (i % 50) * 5, y = Math.floor(i / 50) * 5;
    ents.push(i % 3 === 0 ? { id: i, type: 'line', layer: 'W', x1: x, y1: y, x2: x + 4, y2: y + 3 }
      : i % 3 === 1 ? { id: i, type: 'circle', layer: 'W', cx: x + 2, cy: y + 2, r: 1.5 }
        : { id: i, type: 'poly', layer: 'W', closed: true, pts: [[x, y], [x + 4, y], [x + 4, y + 4], [x, y + 4]] });
  }
  return ents;
}

/* The scan the index replaces, kept here as the oracle. */
function brute(ents, box){
  const out = [];
  ents.forEach((e, i) => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    entBBox(e, bb);
    if (bb[0] <= box[2] && bb[2] >= box[0] && bb[1] <= box[3] && bb[3] >= box[1]) out.push(i);
  });
  return out;
}

describe('the index agrees with the scan it replaces', () => {
  const ents = grid(2000);
  const idx = buildIndex(ents);

  it('returns exactly the same set for boxes of every size', () => {
    let checked = 0;
    for (let k = 0; k < 60; k++){
      const x = (k * 37) % 250, y = (k * 53) % 200, w = [0.5, 3, 20, 120][k % 4];
      const box = [x, y, x + w, y + w];
      /* No sort here: draw order is part of the contract, so a raw compare
       * against the scan is also the ordering test. */
      expect(queryIndices(idx, box)).toEqual(brute(ents, box));
      checked++;
    }
    expect(checked).toBe(60);
  });

  it('a box covering the extents returns everything', () => {
    expect(queryIndices(idx, [-1e6, -1e6, 1e6, 1e6]).length).toBe(ents.length);
  });

  it('a box outside the extents returns nothing', () => {
    expect(queryIndices(idx, [1e6, 1e6, 1e6 + 1, 1e6 + 1])).toEqual([]);
    expect(queryIndices(idx, [-1e6, -1e6, -999999, -999999])).toEqual([]);
  });

  it('reports an entity spanning many cells exactly once', () => {
    const big = grid(500).concat([{ id: 9999, type: 'line', layer: 'W', x1: -10, y1: -10, x2: 300, y2: 300 }]);
    const bi = buildIndex(big);
    const hits = queryIndices(bi, [-20, -20, 400, 400]).filter(i => big[i].id === 9999);
    expect(hits.length).toBe(1);
  });

  it('results come back in draw order, so the topmost hit is the last one', () => {
    /* A single cell query and a multi cell query must both be ascending. */
    for (const box of [[0, 0, 2, 2], [0, 0, 60, 60], [-1e6, -1e6, 1e6, 1e6]]){
      const r = queryIndices(idx, box);
      for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
  });

  it('queryBox hands back the entities themselves', () => {
    const got = queryBox(idx, [0, 0, 6, 6]);
    expect(got.length).toBeGreaterThan(0);
    got.forEach(e => expect(ents).toContain(e));
  });

  it('queryPoint is a box query around the point', () => {
    expect(queryPoint(idx, 12, 12, 1)).toEqual(brute(ents, [11, 11, 13, 13]));
  });
});

describe('degenerate drawings', () => {
  it('an empty drawing indexes to empty and answers nothing', () => {
    const idx = buildIndex([]);
    expect(idx.empty).toBe(true);
    expect(queryIndices(idx, [0, 0, 1, 1])).toEqual([]);
    expect(queryBox(idx, [0, 0, 1, 1])).toEqual([]);
  });

  it('entities with no finite box are skipped, not crashed on', () => {
    const idx = buildIndex([{ type: 'text', layer: 'W' }, { type: 'line', layer: 'W', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(idx.empty).toBe(false);
    expect(queryIndices(idx, [-1, -1, 2, 2])).toEqual([1]);
  });

  it('everything stacked on one point still works', () => {
    const same = [];
    for (let i = 0; i < 200; i++) same.push({ id: i, type: 'line', layer: 'W', x1: 5, y1: 5, x2: 5, y2: 5 });
    const idx = buildIndex(same);
    expect(queryIndices(idx, [4, 4, 6, 6]).length).toBe(200);
    expect(queryIndices(idx, [10, 10, 11, 11]).length).toBe(0);
  });

  it('a single entity indexes and is found', () => {
    const idx = buildIndex([{ type: 'circle', layer: 'W', cx: 0, cy: 0, r: 1 }]);
    expect(queryIndices(idx, [-2, -2, 2, 2])).toEqual([0]);
  });

  it('entityBox is null for something with no geometry', () => {
    expect(entityBox({ type: 'text', layer: 'W' })).toBe(null);
    expect(entityBox({ type: 'line', layer: 'W', x1: 0, y1: 0, x2: 3, y2: 4 })).toEqual([0, 0, 3, 4]);
  });
});

describe('the cache only rebuilds when the drawing changed', () => {
  it('serves the same index for the same stamp', () => {
    const c = makeIndexCache();
    const ents = grid(100);
    const a = c.get(ents, 1);
    expect(c.get(ents, 1)).toBe(a);
  });

  it('rebuilds when the stamp moves', () => {
    const c = makeIndexCache();
    const ents = grid(100);
    const a = c.get(ents, 1);
    expect(c.get(ents, 2)).not.toBe(a);
  });

  it('rebuilds when the array identity changes even at the same stamp', () => {
    const c = makeIndexCache();
    const a = c.get(grid(100), 1);
    expect(c.get(grid(100), 1)).not.toBe(a);
  });

  it('rebuilds when the length changes even at the same stamp', () => {
    const c = makeIndexCache();
    const ents = grid(100);
    const a = c.get(ents, 1);
    ents.push({ type: 'line', layer: 'W', x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(c.get(ents, 1)).not.toBe(a);
  });

  it('a stale index still answers correctly after a clear', () => {
    const c = makeIndexCache();
    const ents = grid(100);
    c.get(ents, 1);
    c.clear();
    const fresh = c.get(ents, 1);
    expect(queryIndices(fresh, [-1e6, -1e6, 1e6, 1e6]).length).toBe(ents.length);
  });
});

describe('the threshold', () => {
  it('small drawings are left to the plain scan', () => {
    expect(worthIndexing(grid(10))).toBe(false);
    expect(worthIndexing(grid(INDEX_MIN))).toBe(true);
    expect(worthIndexing(null)).toBe(false);
  });
});

describe('it is actually faster', () => {
  it('a pick touches a small fraction of a large drawing', () => {
    const ents = grid(20000);
    const idx = buildIndex(ents);
    let worst = 0;
    for (let k = 0; k < 50; k++){
      const x = (k * 91) % 240, y = (k * 61) % 1990;
      worst = Math.max(worst, queryPoint(idx, x, y, 0.2).length);
    }
    /* The whole point: a pick considers a handful of entities, not 20000. */
    expect(worst).toBeLessThan(60);
  });
});

/* The wiring, not just the module: picking through the real hitTest must give
 * the same answer indexed as it did with the full scan. */
describe('picking is unchanged by the index', () => {
  it('agrees with the plain scan on every pick, either side of the threshold', async () => {
    const { state, defaultLayers } = await import('../src/core/state.js');
    const { vp, W2S } = await import('../src/core/viewport.js');
    const { hitTest } = await import('../src/actions.js');
    const { entHit } = await import('../src/core/entities.js');
    const { S2W } = await import('../src/core/viewport.js');

    vp.CW = 1200; vp.CH = 800;
    state.view = { x: 100, y: 100, scale: 4 };
    state.layers = defaultLayers();
    state.selIds = [];

    /* The scan hitTest used before the index existed. */
    const scanHit = (sx, sy) => {
      const w = S2W(sx, sy), tol = 10 / state.view.scale;
      for (let k = state.entities.length - 1; k >= 0; k--){
        const e = state.entities[k];
        if (entHit(e, w, tol)) return e;
      }
      return null;
    };

    for (const n of [INDEX_MIN - 1, INDEX_MIN + 600]){
      state.entities = grid(n).map((e, i) => ({ ...e, id: i + 1, layer: 'WALLS' }));
      state.geomStamp = n;
      let compared = 0, hitsFound = 0;
      for (let k = 0; k < 300; k++){
        /* Aim at real geometry as well as empty space. */
        const target = state.entities[(k * 7) % state.entities.length];
        const p = target.type === 'circle' ? [target.cx, target.cy + target.r]
          : target.type === 'line' ? [target.x1, target.y1] : target.pts[0];
        const s = k % 2 ? W2S(p[0], p[1]) : [Math.random() * vp.CW, Math.random() * vp.CH];
        const a = hitTest(s[0], s[1]);
        const b = scanHit(s[0], s[1]);
        expect(a === b || (a && b && a.id === b.id)).toBe(true);
        if (b) hitsFound++;
        compared++;
      }
      expect(compared).toBe(300);
      /* If nothing were ever hit the comparison would prove nothing. */
      expect(hitsFound).toBeGreaterThan(50);
    }
  });
});
