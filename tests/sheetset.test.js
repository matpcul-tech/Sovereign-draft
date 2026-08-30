import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { detectSections, generateSheetSet, legendForLayout, sheetTitle } from '../src/core/sheetset.js';
import { buildLegend, collectCallouts, entsInBBox, isCalloutText } from '../src/core/legend.js';
import { makeLayout, sheetOf, TITLE_BLOCK_H, SHEET_MARGIN } from '../src/core/layout.js';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { membersBBox } from '../src/core/entities.js';

describe('sheetTitle', () => {
  it('title-cases rooms and keeps all-caps engineering labels', () => {
    expect(sheetTitle('KITCHEN')).toBe('Kitchen');
    expect(sheetTitle('STAGE 2 LOX/RP-1')).toBe('STAGE 2 LOX/RP-1');
  });
});

describe('callouts', () => {
  it('accepts part labels and rejects dimensions', () => {
    expect(isCalloutText({ type: 'text', content: 'NOSE CONE' })).toBe(true);
    expect(isCalloutText({ type: 'text', content: 'PAYLOAD FAIRING' })).toBe(true);
    expect(isCalloutText({ type: 'text', content: "12'-6\"" })).toBe(false);
    expect(isCalloutText({ type: 'leader', content: 'INTERSTAGE' })).toBe(true);
  });
});

describe('cabin sheet set', () => {
  const ents = cabin24x36();
  const layers = defaultLayers();

  it('detects kitchen, bedroom and living as sections', () => {
    const { sections } = detectSections(ents);
    const names = sections.map(s => String(s.name).toUpperCase()).sort();
    expect(names).toContain('KITCHEN');
    expect(names).toContain('BEDROOM');
    expect(names).toContain('LIVING');
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });

  it('builds cover + overall + one sheet per room', () => {
    const layouts = generateSheetSet(ents, layers, { projectName: '24x36 Cabin' });
    expect(layouts[0].kind).toBe('cover');
    expect(layouts[0].sheetNumber).toBe('G-001');
    expect(layouts[1].kind).toBe('overall');
    expect(layouts[1].sheetNumber).toBe('A-101');
    const sections = layouts.filter(L => L.kind === 'section');
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.every(L => L.section && L.section.bbox)).toBe(true);
    expect(layouts.every(L => L.viewports && L.viewports[0] && L.viewports[0].pw > 0)).toBe(true);
  });

  it('each section sheet has a legend that only lists that section', () => {
    const layouts = generateSheetSet(ents, layers);
    const kitchen = layouts.find(L => /kitchen/i.test(L.name));
    expect(kitchen).toBeTruthy();
    const legend = legendForLayout(kitchen, ents, layers);
    const names = legend.items.filter(i => i.kind === 'callout' || i.kind === 'symbol').map(i => i.name.toUpperCase());
    expect(legend.items.some(i => i.kind === 'layer' && i.name === 'WALLS')).toBe(true);
    expect(names.join(' ')).toMatch(/STOVE|FRIDGE|DOOR|KITCHEN/);
    const bedroom = layouts.find(L => /bedroom/i.test(L.name));
    const bLeg = legendForLayout(bedroom, ents, layers);
    const bNames = bLeg.items.map(i => (i.name || '').toUpperCase()).join(' ');
    expect(bNames).not.toMatch(/STOVE/);
  });

  it('leaves a right-hand gutter so the legend sits in the margin', () => {
    const layouts = generateSheetSet(ents, layers);
    const cover = layouts[0];
    const sh = sheetOf(cover.sheet);
    const vp = cover.viewports[0];
    expect(vp.pw).toBeLessThan(sh.w - 3);
    expect(cover.annotations.some(a => a.kind === 'table' && a.table && /INDEX/i.test(a.table.title))).toBe(true);
    const plan = layouts[1];
    expect(plan.annotations.some(a => a.kind === 'table' && a.table && /LEGEND/i.test(a.table.title))).toBe(true);
    expect(plan.viewports[0].pw).toBeLessThan(sh.w - 3);
  });

  it('exports a multi-page PDF with a drawing index and legends', () => {
    const layouts = generateSheetSet(ents, layers);
    const { pdf, pages } = buildAllSheetsPDF(ents, {
      sheets: layouts,
      projectName: '24x36 Cabin',
      dateStr: '1/1/2026'
    });
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pages).toBe(layouts.length);
    expect(pdf).toContain('/Count ' + layouts.length);
    expect((pdf.match(/\/Type \/Page /g) || []).length).toBe(layouts.length);
    expect(pdf).toContain('24X36 CABIN');
    expect(pdf).toContain('DRAWING INDEX');
    expect(pdf).toContain('LEGEND');
    expect(pdf).toContain('G-001');
    expect(pdf).toContain('A-101');
    expect(pdf.trim().endsWith('%%EOF')).toBe(true);
  });
});

describe('rocket-style callout banding', () => {
  it('splits a vertical stack of labels into pages', () => {
    const ents = [];
    const labels = ['NOSE CONE', 'PAYLOAD FAIRING', 'STAGE 2', 'STAGE 1', 'ENGINES'];
    labels.forEach((name, i) => {
      ents.push({ type: 'text', layer: 'TEXT', x: 4, y: 40 - i * 8, size: 0.7, content: name });
      ents.push({ type: 'line', layer: 'WALLS', x1: 0, y1: 36 - i * 8, x2: 3, y2: 36 - i * 8 });
    });
    ents.push({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 0, y2: 42 });
    const { sections } = detectSections(ents);
    expect(sections.length).toBeGreaterThanOrEqual(4);
    const names = sections.map(s => s.name);
    expect(names).toContain('NOSE CONE');
    expect(names).toContain('ENGINES');
    const layouts = generateSheetSet(ents, defaultLayers());
    expect(layouts.filter(L => L.kind === 'section').length).toBe(sections.length);
  });
});

describe('legend from a bbox', () => {
  it('only includes inserts that sit in the box', () => {
    const ents = [
      { type: 'insert', layer: 'DOORS', def: 'door', mark: 'D01', x: 2, y: 2, width: 3 },
      { type: 'insert', layer: 'DOORS', def: 'door', mark: 'D02', x: 20, y: 20, width: 3 },
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 4, y2: 0 }
    ];
    const subset = entsInBBox(ents, [0, 0, 6, 6], 0);
    const legend = buildLegend(subset, defaultLayers());
    const marks = legend.items.filter(i => i.kind === 'symbol').map(i => i.mark);
    expect(marks).toContain('D01');
    expect(marks).not.toContain('D02');
  });
});

describe('default plan layout clears the issued title block', () => {
  it('A-1 fills the sheet above the stamp', () => {
    const L = makeLayout({ id: 'A1', name: 'A-1 Floor Plan', sheet: 'archd' });
    const sh = sheetOf(L.sheet);
    const vp = L.viewports[0];
    expect(vp.pw).toBeCloseTo(sh.w - SHEET_MARGIN * 2);
    expect(vp.py).toBeCloseTo(SHEET_MARGIN + TITLE_BLOCK_H);
    expect(vp.ph).toBeCloseTo(sh.h - SHEET_MARGIN * 2 - TITLE_BLOCK_H);
  });
});

void membersBBox;
void collectCallouts;
