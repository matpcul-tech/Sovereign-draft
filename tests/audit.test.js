import { describe, it, expect } from 'vitest';
import {
  rotateEntities, scaleEntities, mirrorEntities, entityLength, entityArea, moveEntities
} from '../src/core/modify.js';
import { gripPts } from '../src/core/entities.js';
import { stretchEntities } from '../src/core/stretch.js';
import { offsetEntity } from '../src/core/offset.js';
import { lineCutTs } from '../src/core/trimExtend.js';
import { makeSpline, splineAt, splineLength } from '../src/core/spline.js';
import { makeMText } from '../src/core/mtext.js';
import { buildSVG } from '../src/io/svg.js';
import { buildPDF } from '../src/io/pdf.js';
import { nearestOnEntity } from '../src/core/osnap.js';

/* Every operation, against every entity type it should touch.
 *
 * Twelve features landed close together, and the bugs found afterwards were
 * all in the seams between them, never inside them: JOIN filtered arcs out
 * before the kernel saw them, booleans read a curved polyline's chords, and
 * this file's first run found eleven more of the same shape. An operation
 * silently ignoring an entity type looks exactly like working code until a
 * user selects that entity.
 */

const SPLINE = () => Object.assign(makeSpline([[0, 0], [3, 8], [9, -4], [12, 4]], { layer: 'WALLS' }), { id: 1 });
const SLOT = () => ({ id: 2, type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [20, 0], [20, 6], [0, 6]], bulge: [0, 1, 0, 1] });
const MT = () => Object.assign(makeMText('NOTE', { size: 1, x: 5, y: 5, width: 8 }), { id: 3 });
const LAYERS = [{ name: 'WALLS', aci: 2, visible: true }];

describe('transforms reach splines', () => {
  it('rotate turns the control points and therefore the curve', () => {
    const r = rotateEntities([SPLINE()], 0, 0, 90)[0];
    expect(r.ctrl[3][0]).toBeCloseTo(-4, 9);
    expect(r.ctrl[3][1]).toBeCloseTo(12, 9);
  });

  it('scale scales the whole curve, not just its ends', () => {
    const sc = scaleEntities([SPLINE()], 0, 0, 2)[0];
    const mid = splineAt(sc, 0.5);
    const want = splineAt(SPLINE(), 0.5);
    expect(mid[0]).toBeCloseTo(want[0] * 2, 9);
    expect(mid[1]).toBeCloseTo(want[1] * 2, 9);
  });

  it('mirror reflects the control points', () => {
    const m = mirrorEntities([SPLINE()], 0, 0, 0, 1)[0];
    expect(m.ctrl[3][0]).toBeCloseTo(-12, 9);
    expect(m.ctrl[3][1]).toBeCloseTo(4, 9);
  });

  it('move still moves', () => {
    const mv = moveEntities([SPLINE()], 100, -1)[0];
    expect(mv.ctrl[0]).toEqual([100, -1]);
  });
});

describe('transforms reach paragraph text', () => {
  it('scale scales the size and the column together', () => {
    const sc = scaleEntities([MT()], 0, 0, 3)[0];
    expect(sc.size).toBe(3);
    expect(sc.width).toBe(24);
    expect(sc.x).toBe(15);
  });

  it('rotate carries the block rotation', () => {
    const r = rotateEntities([MT()], 0, 0, 90)[0];
    expect(r.rot).toBe(90);
    expect(r.x).toBeCloseTo(-5, 9);
    expect(r.y).toBeCloseTo(5, 9);
  });
});

describe('measurement reaches the new types', () => {
  it('a spline has its arc length, not zero', () => {
    expect(entityLength(SPLINE())).toBeCloseTo(splineLength(SPLINE()), 9);
    expect(entityLength(SPLINE())).toBeGreaterThan(12);
  });

  it('a closed spline encloses area', () => {
    const c = Object.assign(makeSpline([[0, 0], [10, 0], [10, 10], [0, 10]], { closed: true }), { id: 9 });
    const a = entityArea(c);
    expect(a).toBeGreaterThan(50);
    expect(a).toBeLessThan(100);
  });
});

describe('every exporter draws a spline', () => {
  it('SVG emits a path for it', () => {
    const svg = buildSVG([SPLINE()], LAYERS);
    expect(svg).toMatch(/<path d="M[^"]{40,}/);
  });

  it('the plotted PDF has the curve, which it silently dropped before', () => {
    const base = buildPDF([{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }], { ppf: 'fit', projectName: 'T' }).pdf;
    const withSp = buildPDF([{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }, SPLINE()], { ppf: 'fit', projectName: 'T' }).pdf;
    const segs = s => (s.match(/ l/g) || []).length;
    expect(segs(withSp)).toBeGreaterThan(segs(base) + 5);
  });
});

describe('editing tools follow the curves', () => {
  it('trim and extend cut against a bulged polyline at its arcs', () => {
    /* The slot's right arc reaches x = 23; the stored chord stops at 20. */
    const ts = lineCutTs([SLOT()], () => true, 21, 3, 25, 3, 99, null, -1);
    const xs = ts.map(t => 21 + 4 * t).filter(x => x > 21 && x < 25);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeCloseTo(23, 1);
  });

  it('a spline is a cutter', () => {
    const sp = Object.assign(makeSpline([[0, 10], [5, -10], [10, 10]], { layer: 'WALLS' }), { id: 7 });
    const ts = lineCutTs([sp], () => true, -5, 0, 15, 0, 99, null, -1);
    expect(ts.length).toBe(2);
  });

  it('offset of a bulged slot follows the arcs', () => {
    const out = offsetEntity(SLOT(), 1, [10, 10]);
    /* Outward by 1: perimeter grows by 2 pi. Chord offsetting gives ~54. */
    expect(entityLength(out)).toBeCloseTo(2 * 20 + 2 * Math.PI * 4, 0);
  });

  it('offset of a spline is a parallel polyline', () => {
    const out = offsetEntity(SPLINE(), 0.5, [6, 5]);
    expect(out.type).toBe('poly');
    expect(out.pts.length).toBeGreaterThan(10);
  });

  it('stretch moves spline control points inside the window', () => {
    const sp = SPLINE();
    const n = stretchEntities([sp], [2, -6, 10, 10], 5, 0);
    expect(n).toBeGreaterThan(0);
    expect(sp.ctrl[1][0]).toBe(8);
    expect(sp.ctrl[0][0]).toBe(0);
  });

  it('stretch moves an mtext anchor inside the window', () => {
    const mt = MT();
    stretchEntities([mt], [0, 0, 10, 10], 2, 3);
    expect(mt.x).toBe(7);
    expect(mt.y).toBe(8);
  });
});

describe('direct manipulation reaches the new types', () => {
  it('a spline offers a grip per control point, and dragging one reshapes the curve', () => {
    const sp = SPLINE();
    const g = gripPts(sp);
    expect(g.length).toBe(4);
    g[1].apply([3, 20]);
    expect(splineAt(sp, 0.25)[1]).toBeGreaterThan(5);
  });

  it('an mtext offers its anchor as a grip', () => {
    const mt = MT();
    const g = gripPts(mt);
    expect(g.length).toBe(1);
    g[0].apply([9, 9]);
    expect([mt.x, mt.y]).toEqual([9, 9]);
  });
});

describe('object snap sees the real geometry', () => {
  it('a bulged polyline snaps along its arcs', () => {
    /* Ask for the nearest point from just right of the slot's arc apex. The
     * chords stop at x = 20; the arc reaches 23. */
    const hit = nearestOnEntity(SLOT(), [24, 3]);
    expect(hit[0]).toBeCloseTo(23, 1);
    expect(hit[3]).toBeLessThan(1.2);
  });

  it('a spline snaps to the curve, not the control hull', () => {
    const sp = SPLINE();
    const hit = nearestOnEntity(sp, [3, 8]);
    /* [3,8] is a control point well off the curve, so the snap must land
     * meaningfully below it. */
    expect(hit[1]).toBeLessThan(6);
    expect(hit[3]).toBeGreaterThan(2);
  });
});
