import { describe, it, expect } from 'vitest';
import {
  makeViewport, makeLayout, modelToPaper, paperToModel, inViewport,
  viewportRot, clipPoly, viewportBoundary, viewportModelBBox, fitViewport
} from '../src/core/layout.js';
import { normalizeSheets, normalizeView } from '../src/core/document.js';
import { buildPDF } from '../src/io/pdf.js';
import { lookupCommand } from '../src/core/command.js';

const VP = extra => Object.assign(makeViewport('archd', 18), { mx: 12, my: 8 }, extra || {});
const CENTRE = vp => [vp.px + vp.pw / 2, vp.py + vp.ph / 2];
const ANGLES = [0, 15, 30, 45, 90, 180, 270, -37.5, 359.5];

describe('viewport twist', () => {
  it('model to paper and back is exact at every angle', () => {
    let worst = 0;
    for (const rot of ANGLES){
      const vp = VP({ rot });
      for (const [x, y] of [[0, 0], [13, -7], [-40, 22], [100, 100], [12, 8]]){
        const p = modelToPaper(vp, x, y);
        const m = paperToModel(vp, p[0], p[1]);
        worst = Math.max(worst, Math.hypot(m[0] - x, m[1] - y));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('the view centre is the pivot and never moves', () => {
    for (const rot of ANGLES){
      const vp = VP({ rot });
      const p = modelToPaper(vp, vp.mx, vp.my);
      const c = CENTRE(vp);
      expect(p[0]).toBeCloseTo(c[0], 9);
      expect(p[1]).toBeCloseTo(c[1], 9);
    }
  });

  it('is a rigid rotation: distances from the centre are preserved', () => {
    const base = VP();
    const c = CENTRE(base);
    const d0 = Math.hypot(...modelToPaper(base, 30, 11).map((v, i) => v - c[i]));
    for (const rot of ANGLES){
      const p = modelToPaper(VP({ rot }), 30, 11);
      expect(Math.hypot(p[0] - c[0], p[1] - c[1])).toBeCloseTo(d0, 9);
    }
  });

  it('and preserves distances between any two points', () => {
    const a = [4, 9], b = [31, -6];
    const plain = modelToPaper(VP(), a[0], a[1]);
    const plainB = modelToPaper(VP(), b[0], b[1]);
    const want = Math.hypot(plain[0] - plainB[0], plain[1] - plainB[1]);
    for (const rot of ANGLES){
      const p = modelToPaper(VP({ rot }), a[0], a[1]);
      const q = modelToPaper(VP({ rot }), b[0], b[1]);
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeCloseTo(want, 9);
    }
  });

  it('90 degrees turns the model x axis into paper y', () => {
    const vp = VP({ rot: 90 });
    const c = CENTRE(vp);
    const p = modelToPaper(vp, vp.mx + 10, vp.my);
    expect(p[0]).toBeCloseTo(c[0], 9);
    expect(p[1]).toBeGreaterThan(c[1]);
  });

  it('a full turn is the same as none', () => {
    const a = modelToPaper(VP(), 7, 3);
    const b = modelToPaper(VP({ rot: 360 }), 7, 3);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
  });

  it('no twist behaves exactly as before it existed', () => {
    const vp = VP();
    expect(viewportRot(vp)).toBe(0);
    expect(viewportRot({})).toBe(0);
    expect(viewportRot({ rot: 'x' })).toBe(0);
    const ftPerIn = 72 / vp.ppf;
    const c = CENTRE(vp);
    expect(modelToPaper(vp, 20, 5)).toEqual([c[0] + (20 - vp.mx) / ftPerIn, c[1] + (5 - vp.my) / ftPerIn]);
  });

  it('a twisted view covers a larger model box, so culling cannot drop what belongs on the sheet', () => {
    const area = b => (b[2] - b[0]) * (b[3] - b[1]);
    const flat = viewportModelBBox(VP());
    expect(area(viewportModelBBox(VP({ rot: 45 })))).toBeGreaterThan(area(flat));
    /* And the box always contains the view centre. */
    for (const rot of ANGLES){
      const bb = viewportModelBBox(VP({ rot }));
      expect(bb[0]).toBeLessThanOrEqual(12);
      expect(bb[2]).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('viewport clipping', () => {
  const L_SHAPE = [[2, 4], [12, 4], [12, 14], [7, 14], [7, 9], [2, 9]];

  it('with no clip the boundary is the frame', () => {
    const vp = VP();
    expect(clipPoly(vp)).toBe(null);
    expect(viewportBoundary(vp)).toEqual([
      [vp.px, vp.py], [vp.px + vp.pw, vp.py],
      [vp.px + vp.pw, vp.py + vp.ph], [vp.px, vp.py + vp.ph]
    ]);
  });

  it('a clip becomes the boundary', () => {
    expect(viewportBoundary(VP({ clip: L_SHAPE }))).toEqual(L_SHAPE);
  });

  it('a point inside the clip is in, one outside it is out', () => {
    const vp = VP({ clip: L_SHAPE });
    expect(inViewport(vp, 4, 6)).toBe(true);    /* in the wide part */
    expect(inViewport(vp, 10, 12)).toBe(true);  /* in the tall part */
    expect(inViewport(vp, 4, 12)).toBe(false);  /* the notch */
  });

  it('a clip can only take area away, never add it', () => {
    const huge = VP({ clip: [[-99, -99], [99, -99], [99, 99], [-99, 99]] });
    expect(inViewport(huge, -50, -50)).toBe(false);
    expect(inViewport(huge, 4, 6)).toBe(true);
  });

  it('a degenerate clip is ignored rather than hiding everything', () => {
    expect(clipPoly({ clip: [] })).toBe(null);
    expect(clipPoly({ clip: [[0, 0], [1, 1]] })).toBe(null);
    expect(clipPoly({})).toBe(null);
    expect(inViewport(VP({ clip: [[0, 0], [1, 1]] }), 4, 6)).toBe(true);
  });

  it('without a clip the frame test is unchanged', () => {
    const vp = VP();
    expect(inViewport(vp, vp.px + 1, vp.py + 1)).toBe(true);
    expect(inViewport(vp, vp.px - 1, vp.py + 1)).toBe(false);
    expect(inViewport(vp, 999, 999)).toBe(false);
  });
});

describe('the plot honours both', () => {
  const ents = [
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 0, y2: 16 }
  ];
  const mk = extra => buildPDF(ents, {
    layout: makeLayout({ id: 'A1', sheet: 'archd', ppf: 18, viewports: [VP(extra)] }),
    projectName: 'T'
  }).pdf;

  it('a twist emits a rotation matrix, and none is emitted without one', () => {
    expect(mk({ rot: 30 })).toMatch(/0\.87 0\.5 -0\.5 0\.87 0 0 cm/);
    expect(mk({})).not.toMatch(/cm/);
  });

  it('a clip emits a path clip, a plain viewport a rectangle', () => {
    expect(mk({ clip: [[2, 4], [12, 4], [12, 14], [7, 14], [7, 9], [2, 9]] })).toMatch(/ l h W n/);
    expect(mk({})).toMatch(/ re W n/);
  });

  it('every combination is still a valid PDF and they all differ', () => {
    const outs = [mk({}), mk({ rot: 30 }), mk({ clip: [[2, 4], [12, 4], [12, 14], [7, 14], [7, 9], [2, 9]] }),
      mk({ rot: 30, clip: [[2, 4], [12, 4], [12, 14], [7, 14], [7, 9], [2, 9]] })];
    outs.forEach(p => {
      expect(p.startsWith('%PDF-1.4')).toBe(true);
      expect(p.trim().endsWith('%%EOF')).toBe(true);
    });
    expect(new Set(outs).size).toBe(4);
  });

  it('a layout with neither plots exactly as it did before either existed', () => {
    expect(mk({})).toBe(mk({ rot: 0 }));
  });
});

describe('both survive the document round trip', () => {
  it('normalizeView preserves twist and clip', () => {
    const v = normalizeView({ rot: 30, clip: [[1, 1], [2, 1], [2, 2]] }, 0, {});
    expect(v.rot).toBe(30);
    expect(v.clip.length).toBe(3);
  });

  it('and so does sheet normalisation', () => {
    const sheets = normalizeSheets([makeLayout({ id: 'A1', sheet: 'archd', ppf: 18, viewports: [VP({ rot: 45, clip: [[1, 1], [9, 1], [9, 9]] })] })]);
    const v = sheets[0].viewports[0];
    expect(v.rot).toBe(45);
    expect(v.clip.length).toBe(3);
  });

  it('fitting a viewport leaves the twist alone', () => {
    const vp = VP({ rot: 30 });
    fitViewport(vp, [0, 0, 40, 25]);
    expect(vp.rot).toBe(30);
  });
});

describe('the commands are registered', () => {
  it('twist and clip reach the command line', () => {
    expect(lookupCommand('VPTWIST').action).toBe('vptwist');
    expect(lookupCommand('TWIST').action).toBe('vptwist');
    expect(lookupCommand('VPROTATE').action).toBe('vptwist');
    expect(lookupCommand('VPCLIP').action).toBe('vpclip');
    expect(lookupCommand('CLIPVIEW').action).toBe('vpclip');
  });
});
