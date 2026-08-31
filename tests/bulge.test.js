import { describe, it, expect } from 'vitest';
import {
  hasBulge, bulgeAt, bulgeArc, bulgeSegPoints, polyOutline, bulgeLength,
  bulgeArea, bulgeThrough, setBulge, arcToBulge, BULGE_MAX_STEPS
} from '../src/core/bulge.js';
import { entBBox, entHit, explodeForIO } from '../src/core/entities.js';
import { entityLength, entityArea, joinEntities, mirrorEntities } from '../src/core/modify.js';
import { buildDXF, parseDXF } from '../src/io/dxf.js';
import { lookupCommand } from '../src/core/command.js';

const LAYERS = [{ name: 'WALLS', aci: 2, visible: true }];
/* A 20 by 6 slot: two straight sides and two half round ends bulging out. */
const SLOT = () => ({ type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [20, 0], [20, 6], [0, 6]], bulge: [0, 1, 0, 1] });
const STRAIGHT = () => ({ type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [20, 0], [20, 6], [0, 6]] });

/* The centre of a bulged arc, from the standard construction rather than a
 * rearrangement of the code under test. */
function refCentre(p0, p1, b){
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const R = (chord / 2) * (1 + b * b) / (2 * b);
  const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + Math.PI / 2 - 2 * Math.atan(b);
  return [p0[0] + R * Math.cos(a), p0[1] + R * Math.sin(a)];
}

describe('the arc a bulge describes', () => {
  it('matches the standard construction across chords and bulges', () => {
    const chords = [[[0, 0], [10, 0]], [[3, 7], [-4, 2]], [[0, 0], [0, 9]], [[-6, -1], [5, 8]]];
    const bulges = [1, -1, 0.4142135623730951, -0.25, 2.5, 0.05];
    let worst = 0;
    for (const [p0, p1] of chords){
      for (const b of bulges){
        const got = bulgeArc(p0, p1, b), want = refCentre(p0, p1, b);
        worst = Math.max(worst, Math.hypot(got.cx - want[0], got.cy - want[1]));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('starts and ends exactly on the vertices it spans', () => {
    for (const b of [1, -1, 0.3, -2]){
      const a = bulgeArc([2, 3], [11, 8], b);
      const s = [a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)];
      const e = [a.cx + a.r * Math.cos(a.a0 + a.sweep), a.cy + a.r * Math.sin(a.a0 + a.sweep)];
      expect(Math.hypot(s[0] - 2, s[1] - 3)).toBeLessThan(1e-9);
      expect(Math.hypot(e[0] - 11, e[1] - 8)).toBeLessThan(1e-9);
    }
  });

  it('a bulge of 1 is a half circle on the chord', () => {
    const a = bulgeArc([0, 0], [10, 0], 1);
    expect(a.r).toBeCloseTo(5, 9);
    expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI, 9);
  });

  it('a flat bulge is not an arc at all', () => {
    expect(bulgeArc([0, 0], [10, 0], 0)).toBe(null);
    expect(bulgeArc([0, 0], [0, 0], 1)).toBe(null);
  });

  it('the sign decides which side the curve falls on', () => {
    const up = bulgeSegPoints([0, 0], [10, 0], -1);
    const down = bulgeSegPoints([0, 0], [10, 0], 1);
    expect(Math.max(...up.map(p => p[1]))).toBeCloseTo(5, 6);
    expect(Math.min(...down.map(p => p[1]))).toBeCloseTo(-5, 6);
  });
});

describe('tessellation', () => {
  it('every point lands on the true arc', () => {
    const pts = polyOutline({ pts: [[0, 0], [10, 0]], bulge: [1, 0], closed: false });
    pts.forEach(p => expect(Math.abs(Math.hypot(p[0] - 5, p[1]) - 5)).toBeLessThan(1e-9));
  });

  it('honours the tolerance it is given', () => {
    const e = { pts: [[0, 0], [10, 0]], bulge: [1, 0], closed: false };
    for (const tol of [0.1, 0.01, 0.001]){
      const p = polyOutline(e, tol);
      let sag = 0;
      for (let i = 1; i < p.length; i++){
        const mx = (p[i][0] + p[i - 1][0]) / 2, my = (p[i][1] + p[i - 1][1]) / 2;
        sag = Math.max(sag, 5 - Math.hypot(mx - 5, my));
      }
      expect(sag).toBeLessThanOrEqual(tol);
    }
  });

  it('stays bounded on an absurd tolerance', () => {
    expect(polyOutline({ pts: [[0, 0], [10, 0]], bulge: [1, 0], closed: false }, 1e-12).length)
      .toBeLessThanOrEqual(BULGE_MAX_STEPS + 2);
  });

  it('a polyline with no arcs is returned untouched', () => {
    const e = STRAIGHT();
    expect(polyOutline(e)).toBe(e.pts);
  });

  it('a closed outline does not repeat its first point', () => {
    const p = polyOutline(SLOT());
    expect(p[0]).not.toEqual(p[p.length - 1]);
  });
});

describe('measurement', () => {
  it('length follows the arc, not the chord', () => {
    expect(entityLength(SLOT())).toBeCloseTo(40 + 2 * Math.PI * 3, 9);
    expect(entityLength(STRAIGHT())).toBe(52);
  });

  it('area is exact, not a fine approximation', () => {
    expect(entityArea(SLOT())).toBeCloseTo(120 + Math.PI * 9, 9);
    const inward = { ...SLOT(), bulge: [0, -1, 0, -1] };
    expect(entityArea(inward)).toBeCloseTo(120 - Math.PI * 9, 9);
    expect(entityArea(STRAIGHT())).toBe(120);
  });

  it('two vertices and two bulges is a circle', () => {
    const c = { type: 'poly', closed: true, pts: [[0, 0], [10, 0]], bulge: [1, 1] };
    expect(entityArea(c)).toBeCloseTo(Math.PI * 25, 9);
    expect(entityLength(c)).toBeCloseTo(2 * Math.PI * 5, 9);
  });

  it('an open two point polyline still has no area', () => {
    expect(entityArea({ type: 'poly', closed: false, pts: [[0, 0], [10, 0]], bulge: [1, 0] })).toBe(0);
  });
});

describe('a bulged polyline behaves like any other entity', () => {
  it('the bounding box covers the arcs, which swing past the vertices', () => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    entBBox(SLOT(), bb);
    expect(bb[0]).toBeCloseTo(-3, 6);
    expect(bb[2]).toBeCloseTo(23, 6);
    expect(bb[1]).toBeCloseTo(0, 6);
    expect(bb[3]).toBeCloseTo(6, 6);
  });

  it('hit testing follows the curve and not the chord', () => {
    const e = SLOT();
    expect(entHit(e, [23, 3], 0.05)).toBe(true);
    expect(entHit(e, [20, 3], 0.05)).toBe(false);
  });

  it('explodes to line work that carries the arcs', () => {
    const f = explodeForIO(SLOT());
    expect(f.length).toBe(1);
    expect(f[0].type).toBe('poly');
    expect(f[0].bulge).toBeUndefined();
    expect(Math.max(...f[0].pts.map(p => p[0]))).toBeCloseTo(23, 3);
  });

  it('mirroring flips the sense of every arc', () => {
    const m = mirrorEntities([SLOT()], 0, 0, 0, 1)[0];
    expect(m.bulge).toEqual([0, -1, 0, -1]);
    /* Area is preserved by a reflection. */
    expect(entityArea(m)).toBeCloseTo(entityArea(SLOT()), 9);
  });
});

describe('authoring arcs', () => {
  it('bulgeThrough puts the target point on its own arc', () => {
    for (const mid of [[5, 5], [5, -5], [5, 2], [5, -0.5], [2, 3]]){
      const b = bulgeThrough([0, 0], [10, 0], mid);
      const arc = bulgeArc([0, 0], [10, 0], b);
      expect(Math.abs(Math.hypot(mid[0] - arc.cx, mid[1] - arc.cy) - arc.r)).toBeLessThan(1e-9);
    }
  });

  it('setBulge never leaves an all zero array behind', () => {
    const e = { type: 'poly', pts: [[0, 0], [1, 0], [2, 0]] };
    setBulge(e, 0, 0.5);
    expect(hasBulge(e)).toBe(true);
    setBulge(e, 0, 0);
    expect(e.bulge).toBeUndefined();
  });

  it('bulgeAt is zero for anything missing or junk', () => {
    expect(bulgeAt({ pts: [] }, 0)).toBe(0);
    expect(bulgeAt({ bulge: [NaN] }, 0)).toBe(0);
    expect(bulgeAt({ bulge: [0.5] }, 9)).toBe(0);
  });

  it('an arc becomes a two vertex bulged segment of the same length', () => {
    const arc = { type: 'arc', layer: 'WALLS', cx: 0, cy: 0, r: 5, a1: 0, a2: 90 };
    const p = arcToBulge(arc);
    expect(p.bulge[0]).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(bulgeLength(p)).toBeCloseTo(entityLength(arc), 9);
  });
});

describe('JOIN keeps the curves', () => {
  const parts = () => ([
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 20, y2: 0 },
    { type: 'arc', layer: 'WALLS', cx: 20, cy: 3, r: 3, a1: 270, a2: 90 },
    { type: 'line', layer: 'WALLS', x1: 20, y1: 6, x2: 0, y2: 6 },
    { type: 'arc', layer: 'WALLS', cx: 0, cy: 3, r: 3, a1: 90, a2: 270 }
  ]);

  it('four loose objects become one closed slot with its arcs intact', () => {
    const r = joinEntities(parts());
    expect(r.ok).toBe(true);
    expect(r.replace.length).toBe(1);
    const p = r.replace[0];
    expect(p.closed).toBe(true);
    expect(p.pts.length).toBe(4);
    expect(entityLength(p)).toBeCloseTo(40 + 2 * Math.PI * 3, 6);
    expect(entityArea(p)).toBeCloseTo(120 + Math.PI * 9, 6);
  });

  it('joining plain lines is unchanged and records no bulge', () => {
    const r = joinEntities([
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 5, y2: 0 },
      { type: 'line', layer: 'WALLS', x1: 5, y1: 0, x2: 5, y2: 5 }
    ]);
    expect(r.replace[0].pts).toEqual([[0, 0], [5, 0], [5, 5]]);
    expect(r.replace[0].bulge).toBeUndefined();
  });

  it('an arc joined backwards keeps the same curve', () => {
    const fwd = joinEntities(parts()).replace[0];
    const rev = joinEntities(parts().reverse()).replace[0];
    expect(entityLength(rev)).toBeCloseTo(entityLength(fwd), 6);
    expect(entityArea(rev)).toBeCloseTo(entityArea(fwd), 6);
  });

  it('one object alone is still not a join', () => {
    expect(joinEntities([{ type: 'arc', cx: 0, cy: 0, r: 5, a1: 0, a2: 90 }]).ok).toBe(false);
  });
});

describe('DXF carries the arcs both ways', () => {
  const entsOf = dxf => dxf.slice(dxf.lastIndexOf('ENTITIES'));

  for (const ver of ['R2000', 'R12']){
    it(ver + ' writes group 42 and reads it back unchanged', () => {
      const dxf = buildDXF([SLOT()], LAYERS, { ver });
      expect((entsOf(dxf).match(/\r?\n42\r?\n/g) || []).length).toBe(2);
      const back = parseDXF(dxf, n => n || 'WALLS').find(e => e.type === 'poly');
      expect(back.bulge).toEqual([0, 1, 0, 1]);
      expect(back.closed).toBe(true);
      expect(entityArea(back)).toBeCloseTo(120 + Math.PI * 9, 6);
    });

    it(ver + ' leaves a straight polyline exactly as it was', () => {
      const dxf = buildDXF([STRAIGHT()], LAYERS, { ver });
      expect(entsOf(dxf)).not.toMatch(/\r?\n42\r?\n/);
      expect(parseDXF(dxf, n => n || 'WALLS')[0].bulge).toBeUndefined();
    });
  }

  it('a second round trip is stable', () => {
    const one = buildDXF([SLOT()], LAYERS, { ver: 'R2000' });
    expect(buildDXF(parseDXF(one, n => n || 'WALLS'), LAYERS, { ver: 'R2000' })).toBe(one);
  });

  it('a bulge on a middle vertex lands on the right segment', () => {
    const e = { type: 'poly', layer: 'WALLS', closed: false, pts: [[0, 0], [5, 0], [10, 0], [15, 0]], bulge: [0, 0.5, 0, 0] };
    const back = parseDXF(buildDXF([e], LAYERS, { ver: 'R2000' }), n => n || 'WALLS').find(x => x.type === 'poly');
    expect(back.bulge).toEqual([0, 0.5, 0, 0]);
  });
});

describe('the arc segment editor reaches the command line', () => {
  it('registers ARCSEG and its alias', () => {
    expect(lookupCommand('ARCSEG').tool).toBe('arcseg');
    expect(lookupCommand('PARC').tool).toBe('arcseg');
  });
});
