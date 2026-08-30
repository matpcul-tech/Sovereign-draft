import { describe, it, expect } from 'vitest';
import { schemaToEntities } from '../src/ai/draft.js';
import { explodeForIO } from '../src/core/entities.js';
import { assertNoImpliedFill, impliedFillAllowed } from '../src/core/annotate.js';
import {
  hatchLines, hatchPlan, ppfToScaleFactor, pxPerFootToScaleFactor,
  MIN_PAPER_SPACING, HATCH_PATTERNS, paperToModelSpacing
} from '../src/core/hatch.js';
import { helveticaWidth, textWidth, boxWidth, composeFont } from '../src/core/textmetrics.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

/* Every architectural scale the PDF exporter offers, as points per model foot. */
const SCALE_LADDER = [72, 54, 36, 27, 18, 13.5, 9, 6.75, 4.5];

describe('elevation export produces zero implied hatch', () => {
  const elevation = {
    drawingType: 'elevation',
    /* The model is being adversarial: it asks for a filled profile. */
    profiles: [{ pts: [[0, 0], [8, 0], [8, 44], [4, 60], [0, 44]], fill: 'ANSI31' }],
    centerlines: [{ pts: [[4, -2], [4, 62]] }],
    dims: [{ a: [-4, 0, -4, 60] }]
  };

  it('drops the fill the model asked for', () => {
    const ents = schemaToEntities(elevation, idLayer);
    const profile = ents.find(e => e.type === 'profile');
    expect(profile).toBeTruthy();
    expect(profile.fill).toBeNull();
  });
  it('emits no hatch entity at all once expanded', () => {
    const ents = schemaToEntities(elevation, idLayer);
    const hatches = [];
    ents.forEach(e => explodeForIO(e).forEach(f => { if (f.type === 'hatch') hatches.push(f); }));
    expect(hatches.length).toBe(0);
  });
  it('passes the implied fill assertion', () => {
    const ents = schemaToEntities(elevation, idLayer);
    expect(() => assertNoImpliedFill(ents, 'elevation')).not.toThrow();
  });
  it('the assertion actually catches a fill that slips through', () => {
    const sneaky = [{ type: 'profile', layer: 'PROFILE', pts: [[0, 0], [1, 0], [1, 1]], fill: 'ANSI31' }];
    expect(() => assertNoImpliedFill(sneaky, 'elevation')).toThrow(/implied fill/);
    expect(() => assertNoImpliedFill(sneaky, 'part')).toThrow(/implied fill/);
    expect(() => assertNoImpliedFill(sneaky, 'plan')).not.toThrow();
  });
  it('an explicit hatchRegion is still honored on an elevation', () => {
    const ents = schemaToEntities({
      drawingType: 'elevation',
      profiles: [{ pts: [[0, 0], [8, 0], [8, 10], [0, 10]] }],
      hatchRegions: [{ pts: [[1, 1], [7, 1], [7, 4], [1, 4]], pattern: 'ANSI31' }]
    }, idLayer);
    const region = ents.find(e => e.type === 'hatchRegion');
    expect(region).toBeTruthy();
    expect(() => assertNoImpliedFill(ents, 'elevation')).not.toThrow();
    const fills = [];
    ents.forEach(e => explodeForIO(e).forEach(f => { if (f.type === 'hatch') fills.push(f); }));
    expect(fills.length).toBe(1);
    expect(fills[0].explicit).toBe(true);
  });
  it('plan and section still allow their fills', () => {
    expect(impliedFillAllowed('plan')).toBe(true);
    ['elevation', 'part', 'diagram'].forEach(t => expect(impliedFillAllowed(t)).toBe(false));
  });
});

describe('hatch spacing is a paper value', () => {
  const h = { type: 'hatch', pattern: 'ANSI31', pts: [[0, 0], [40, 0], [40, 40], [0, 40]] };

  it('converts paper spacing to model spacing by the scale factor', () => {
    /* 1/16" = 1'-0" is 4.5 points per foot. 1/8" on paper is 24" in model. */
    const sf = ppfToScaleFactor(4.5);
    expect(hatchPlan(h, sf).spacing).toBeCloseTo(2, 9);
    /* 1/4" reproduces the historical fixed model spacing exactly. */
    expect(hatchPlan(h, ppfToScaleFactor(18)).spacing).toBeCloseTo(0.5, 9);
  });

  it('on paper spacing never falls below 1/32 inch at any supported scale', () => {
    Object.keys(HATCH_PATTERNS).forEach(name => {
      if (HATCH_PATTERNS[name].solid) return;
      SCALE_LADDER.forEach(ppf => {
        const plan = hatchPlan({ type: 'hatch', pattern: name, pts: h.pts }, ppfToScaleFactor(ppf));
        if (plan.mode === 'lines'){
          expect(plan.paper).toBeGreaterThanOrEqual(MIN_PAPER_SPACING);
          /* And the drawn spacing really is that paper value at this scale. */
          const onPaper = plan.spacing * ppfToScaleFactor(ppf);
          expect(onPaper).toBeCloseTo(plan.paper, 9);
        } else {
          expect(plan.mode).toBe('tone');
        }
      });
    });
  });

  it('drops to a tone rather than a smear when a user scale shrinks it', () => {
    const fine = { type: 'hatch', pattern: 'ANSI31', pts: h.pts, scale: 0.2 };
    const plan = hatchPlan(fine, ppfToScaleFactor(4.5));
    expect(plan.paper).toBeLessThan(MIN_PAPER_SPACING);
    expect(plan.mode).toBe('tone');
    expect(hatchLines(fine, ppfToScaleFactor(4.5)).length).toBe(0);
  });

  it('a small scale produces fewer, wider spaced lines, not a smear', () => {
    const coarse = hatchLines(h, ppfToScaleFactor(4.5));
    const fineScale = hatchLines(h, ppfToScaleFactor(72));
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThan(fineScale.length);
  });

  it('canvas pixels per foot convert the same way', () => {
    /* 96 px per foot is one inch of paper per model foot. */
    expect(pxPerFootToScaleFactor(96)).toBeCloseTo(1, 9);
    expect(paperToModelSpacing(0.125, pxPerFootToScaleFactor(96))).toBeCloseTo(0.125, 9);
  });
});

describe('label box is never narrower than the text', () => {
  const CORPUS = [
    'PAYLOAD FAIRING', 'STAGE 1 TANK', 'NOSE CONE', 'MERLIN 1D ENGINE 1',
    'SECOND STAGE', 'INTERSTAGE', 'FIRST STAGE TANKS', 'ENGINE BAY',
    'KITCHEN', 'W', 'IIIIIIIIII', 'MMMMMMMMMM', '12\'-6"'
  ];

  it('box width is at least the measured width for the whole corpus', () => {
    [0.6, 0.8, 1.0, 1.2, 2.0].forEach(size => {
      CORPUS.forEach(str => {
        const measured = textWidth(str, size);
        const box = boxWidth(str, size);
        expect(box).toBeGreaterThanOrEqual(measured);
      });
    });
  });

  it('padding is added, never trimmed', () => {
    CORPUS.forEach(str => {
      expect(boxWidth(str, 1)).toBeGreaterThan(textWidth(str, 1));
    });
  });

  it('the old per character estimate was too narrow for wide strings', () => {
    /* This is the bug: 0.58 per character clipped NOSE CONE and friends. */
    const clipped = ['NOSE CONE', 'PAYLOAD FAIRING', 'MERLIN 1D ENGINE 1'].filter(str => {
      const estimate = str.length * 1.0 * 0.58;
      return estimate < textWidth(str, 1.0);
    });
    expect(clipped.length).toBeGreaterThan(0);
  });

  it('composes the same font string the renderer assigns', () => {
    expect(composeFont(12)).toBe('12px Outfit, system-ui');
    expect(composeFont(12, '600')).toBe('600 12px Outfit, system-ui');
  });

  it('helvetica metrics are real advance widths, not a per character guess', () => {
    /* Same character count, very different widths. */
    expect(helveticaWidth('MMMM', 10)).toBeGreaterThan(helveticaWidth('llll', 10));
    expect(helveticaWidth('', 10)).toBe(0);
    /* Unknown glyphs use the widest entry so a box can only grow. */
    expect(helveticaWidth('☃', 10)).toBeGreaterThan(0);
  });

  it('callout boxes enclose their own text', () => {
    const ents = schemaToEntities({
      drawingType: 'part',
      profiles: [{ pts: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      callouts: CORPUS.slice(0, 6).map((t, i) => ({ anchor: [10, i * 2], text: t }))
    }, idLayer);
    ents.filter(e => e.type === 'callout').forEach(co => {
      const frags = explodeForIO(co);
      const box = frags.find(f => f.type === 'poly' && f.closed);
      const text = frags.find(f => f.type === 'text');
      expect(box).toBeTruthy();
      expect(text).toBeTruthy();
      const boxW = Math.max(...box.pts.map(p => p[0])) - Math.min(...box.pts.map(p => p[0]));
      expect(boxW).toBeGreaterThanOrEqual(textWidth(text.content, text.size));
    });
  });
});
