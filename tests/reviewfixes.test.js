import { describe, it, expect } from 'vitest';
import {
  collectParts, instanceBBoxes, envelopeDims, sectionDims, sectionGeo,
  sectionScopedParts, specNotes, bodyBBox
} from '../src/core/spec.js';
import { generateSheetSet } from '../src/core/sheetset.js';
import { dimGeom } from '../src/core/geometry.js';
import { sheetOf, PLOT_SCALES } from '../src/core/layout.js';
import { buildLayoutPDF } from '../src/io/pdf.js';

function prof(pts, mark){ const e = { type: 'profile', layer: 'PROFILE', pts }; if (mark) e.mark = mark; return e; }
function rect(x0, y0, x1, y1, mark){ return prof([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mark); }
function callout(name, x, y, mark, attrs){
  const e = { type: 'text', layer: 'NOTES', x, y, size: 1.2, content: name };
  if (mark) e.mark = mark;
  if (attrs) e.attributes = attrs;
  return e;
}

/* Falcon-like stack: 23 parts, 226 ft envelope, a 132 ft tank, four grid
 * fins and legs sharing marks, nine engines sharing one mark. */
function falcon(){
  const E = [];
  E.push(prof([[0, 200], [12, 200], [12, 218], [6, 230], [0, 218]], 'PF-1'));
  E.push(callout('PAYLOAD FAIRING', 14, 215, 'PF-1', { label: 'PAYLOAD FAIRING' }));
  E.push(rect(0, 170, 12, 200, 'S2-1'));
  E.push(callout('SECOND STAGE', 14, 185, 'S2-1', { label: 'SECOND STAGE' }));
  E.push(rect(5.5, 158, 6.5, 170, 'MV-1'));
  E.push(callout('MVAC ENGINE', 14, 164, 'MV-1', { label: 'MVAC ENGINE' }));
  E.push(rect(0, 150, 12, 158, 'IS-1'));
  E.push(callout('INTERSTAGE', 14, 154, 'IS-1', { label: 'INTERSTAGE' }));
  E.push(rect(-4, 152, 0, 155, 'GF-1'));
  E.push(rect(12, 152, 16, 155, 'GF-1'));
  E.push(rect(-4, 146, 0, 149, 'GF-1'));
  E.push(rect(12, 146, 16, 149, 'GF-1'));
  E.push(callout('GRID FIN x 4', 18, 150, 'GF-1', { label: 'GRID FIN' }));
  E.push(rect(0, 18, 12, 150, 'T-1'));
  E.push(callout('FIRST STAGE TANK', 14, 84, 'T-1', { label: 'FIRST STAGE TANK' }));
  E.push(rect(-5, 4, -2, 18, 'LG-1'));
  E.push(rect(-1, 4, 2, 18, 'LG-1'));
  E.push(rect(10, 4, 13, 18, 'LG-1'));
  E.push(rect(14, 4, 17, 18, 'LG-1'));
  E.push(callout('LANDING LEG x 4', 19, 11, 'LG-1', { label: 'LANDING LEG' }));
  E.push(rect(0, 10, 12, 18, 'OB-1'));
  E.push(callout('ENGINE BAY', 14, 14, 'OB-1', { label: 'ENGINE BAY' }));
  for (let i = 0; i < 9; i++) E.push(rect(0.7 + i * 1.25, 6, 1.7 + i * 1.25, 9, 'E-1'));
  E.push(callout('MERLIN ENGINE x 9', 14, 7, 'E-1', { label: 'MERLIN ENGINE' }));
  return E;
}

const LAYERS = [{ name: 'PROFILE', visible: true }, { name: 'NOTES', visible: true }, { name: 'DIMS', visible: true }];

function row(parts, mark){ return parts.find(p => p.mark === mark); }

describe('1. multi-qty schedule sizes are one instance, never the group union', () => {
  const parts = collectParts(falcon());

  it('a grid fin is a grid fin, not the span of four', () => {
    expect(row(parts, 'GF-1').qty).toBe(4);
    expect(row(parts, 'GF-1').size).toBe("4'-0\" × 3'-0\"");
  });
  it('a landing leg is one leg', () => {
    expect(row(parts, 'LG-1').qty).toBe(4);
    expect(row(parts, 'LG-1').size).toBe("3'-0\" × 14'-0\"");
  });
  it('an engine is one engine', () => {
    expect(row(parts, 'E-1').qty).toBe(9);
    expect(row(parts, 'E-1').size).toBe("1'-0\" × 3'-0\"");
  });
  it('part count still checks out', () => {
    expect(parts.reduce((s, p) => s + p.qty, 0)).toBe(23);
  });
  it('instanceBBoxes splits disjoint parts and keeps touching pieces together', () => {
    const four = [rect(0, 0, 4, 3, 'X'), rect(10, 0, 14, 3, 'X'), rect(0, 10, 4, 13, 'X'), rect(10, 10, 14, 13, 'X')];
    expect(instanceBBoxes(four).length).toBe(4);
    /* An outline plus a detail line touching it is one instance. */
    const composite = [rect(0, 0, 4, 3, 'Y'), { type: 'line', layer: 'PROFILE', x1: 0, y1: 1.5, x2: 4, y2: 1.5, mark: 'Y' }];
    expect(instanceBBoxes(composite).length).toBe(1);
  });
  it('a thin upstream part is reported thin, not widened', () => {
    expect(row(parts, 'MV-1').size).toBe("1'-0\" × 12'-0\"");
  });
});

describe('2. detail scale derives from the part and lands on the ladder', () => {
  const ents = falcon();
  const sheets = generateSheetSet(ents, LAYERS, {});
  const sections = sheets.filter(s => s.kind === 'section');

  it('every sheet scale is a standard architectural scale', () => {
    sheets.forEach(s => {
      const ppf = s.viewports[0].ppf;
      expect(PLOT_SCALES.some(x => Math.abs(x.ppf - ppf) < 0.01)).toBe(true);
    });
  });
  it('the geometry of every section fits its paper at its scale', () => {
    sections.forEach(s => {
      const geo = s.section.geo;
      const sz = sheetOf(s.sheet);
      const ppf = s.viewports[0].ppf;
      expect((geo[3] - geo[1]) * ppf / 72).toBeLessThanOrEqual(sz.h);
      expect((geo[2] - geo[0]) * ppf / 72).toBeLessThanOrEqual(sz.w);
    });
  });
  it('a 132 ft tank forces a smaller scale than a 12 ft interstage', () => {
    const tank = sections.find(s => /Tank/i.test(s.name));
    const inter = sections.find(s => /Interstage/i.test(s.name));
    expect(tank.viewports[0].ppf).toBeLessThan(inter.viewports[0].ppf);
  });
  it('scales are no longer one constant across the set', () => {
    const ppfs = new Set(sections.map(s => s.viewports[0].ppf));
    expect(ppfs.size).toBeGreaterThan(1);
  });
  it('section geometry is the part, not the body width', () => {
    const tank = sections.find(s => /Tank/i.test(s.name));
    expect(tank.section.geo[2] - tank.section.geo[0]).toBeCloseTo(12, 1);
    expect(tank.section.geo[3] - tank.section.geo[1]).toBeCloseTo(132, 1);
  });
});

describe('3. the envelope note stays on the overall', () => {
  const ents = falcon();
  const sheets = generateSheetSet(ents, LAYERS, {});

  function notesOf(sheet){
    return (sheet.annotations || []).flatMap(a =>
      a.kind === 'table' && a.table ? a.table.cells.map(r => r.join(' ')) : []);
  }
  it('cover and overall carry it', () => {
    expect(notesOf(sheets[0]).some(t => /Envelope/.test(t))).toBe(true);
    expect(notesOf(sheets[1]).some(t => /Envelope/.test(t))).toBe(true);
  });
  it('no section sheet carries one', () => {
    sheets.filter(s => s.kind === 'section').forEach(s => {
      expect(notesOf(s).some(t => /Envelope/.test(t))).toBe(false);
    });
  });
  it('specNotes drops the line for sections at the source', () => {
    const body = [0, 0, 22, 226];
    expect(specNotes(body, [], 'section').some(t => /Envelope/.test(t))).toBe(false);
    expect(specNotes(body, [], 'overall').some(t => /Envelope/.test(t))).toBe(true);
  });
});

describe('4. dims land on the sheets they describe', () => {
  const ents = falcon();
  const sheets = generateSheetSet(ents, LAYERS, {});
  const overallIds = sheets.slice(0, 2).map(L => L.id);
  envelopeDims(ents).forEach(d => { d.visibleIn = overallIds; ents.push(d); });
  const secDims = sectionDims(ents, sheets);
  secDims.forEach(d => ents.push(d));
  const dims = ents.filter(e => e.type === 'dim');

  function dimsVisibleOn(sheet){
    return dims.filter(d => !d.visibleIn || d.visibleIn.indexOf(sheet.id) >= 0);
  }
  function len(d){ return Math.hypot(d.x2 - d.x1, d.y2 - d.y1); }

  it('every section sheet carries its own two dims', () => {
    sheets.filter(s => s.kind === 'section').forEach(s => {
      const mine = dimsVisibleOn(s);
      expect(mine.length).toBe(2);
      mine.forEach(d => expect(d.visibleIn).toEqual([s.id]));
    });
  });
  it('the tank sheet reads 132 by 12, not the envelope', () => {
    const tank = sheets.find(s => /Tank/i.test(s.name));
    const reads = dimsVisibleOn(tank).map(len).sort((a, b) => a - b);
    expect(reads[0]).toBeCloseTo(12, 1);
    expect(reads[1]).toBeCloseTo(132, 1);
  });
  it('envelope dims exist only on cover and overall', () => {
    const env = dims.filter(d => d.visibleIn && d.visibleIn.length === 2);
    expect(env.length).toBe(2);
    sheets.filter(s => s.kind === 'section').forEach(s => {
      env.forEach(d => expect(d.visibleIn.indexOf(s.id)).toBe(-1));
    });
  });
  it('the exported PDF of a section omits scoped-out dims', () => {
    const tank = sheets.find(s => /Tank/i.test(s.name));
    const pdf = buildLayoutPDF(ents, { layout: tank, sheets, layerVisible: () => true, dateStr: '2026-01-01' }).pdf;
    expect(pdf).toContain("(132'-0\")");
    expect(pdf).not.toContain("(226'-0\")");
  });
  it('section dims sit inside their sheet window', () => {
    sheets.filter(s => s.kind === 'section').forEach(s => {
      const vp = s.viewports[0];
      const ftPerIn = 72 / vp.ppf;
      const win = [vp.mx - vp.pw / 2 * ftPerIn, vp.my - vp.ph / 2 * ftPerIn, vp.mx + vp.pw / 2 * ftPerIn, vp.my + vp.ph / 2 * ftPerIn];
      dimsVisibleOn(s).forEach(d => {
        const g = dimGeom(d);
        [g.d[0], g.d[1]].forEach(p => {
          expect(p[0]).toBeGreaterThanOrEqual(win[0] - 0.01);
          expect(p[0]).toBeLessThanOrEqual(win[2] + 0.01);
          expect(p[1]).toBeGreaterThanOrEqual(win[1] - 0.01);
          expect(p[1]).toBeLessThanOrEqual(win[3] + 0.01);
        });
      });
    });
  });
});

describe('scoping survives callouts placed beside the body', () => {
  it('a part whose anchor sits right of the body still lands on its sheet', () => {
    const ents = falcon();
    const body = bodyBBox(ents);
    const parts = collectParts(ents);
    /* The landing leg band: full body width, y about 9 to 12.5; the anchor is
     * at x 19, outside the body. Axis-aware scoping keeps it. */
    const sec = { bbox: [body[0], 9, body[2], 12.5] };
    const scoped = sectionScopedParts(parts, sec, body);
    expect(scoped.some(p => p.mark === 'LG-1')).toBe(true);
    const geo = sectionGeo(ents, scoped, sec, body);
    expect(geo[3] - geo[1]).toBeCloseTo(14, 1);
  });
});
