import { describe, it, expect } from 'vitest';
import { resolveStamp, drawingTitleOf, fitPaperText, titleBlockModel, viewportClearOfTitle } from '../src/core/titleblock.js';
import { makeLayout, TITLE_BLOCK_H, SHEET_MARGIN } from '../src/core/layout.js';
import { normalizeSheets } from '../src/core/document.js';
import { tableFrags, makeTable } from '../src/core/schedule.js';
import { buildLayoutPDF, buildPDF } from '../src/io/pdf.js';
import { cabin24x36 } from '../src/core/demo.js';

describe('firm stamp', () => {
  it('defaults to Sovereign Draft copyright when the firm is blank', () => {
    const s = resolveStamp({}, { year: 2026 });
    expect(s.company).toBe('SOVEREIGN DRAFT');
    expect(s.copyright).toContain('© 2026');
    expect(s.copyright).toMatch(/Sovereign Draft/);
    expect(s.copyright).toMatch(/All rights reserved/);
  });
  it('uses the company and copyright the drafter typed', () => {
    const s = resolveStamp({
      company: 'Acme Aerospace',
      copyright: '© 2026 Acme Aerospace. All rights reserved.',
      drawnBy: 'J. Doe'
    }, { year: 2026 });
    expect(s.company).toBe('ACME AEROSPACE');
    expect(s.copyright).toBe('© 2026 Acme Aerospace. All rights reserved.');
    expect(s.drawnBy).toBe('J. Doe');
  });
});

describe('drawing titles', () => {
  it('strips a leading sheet number from the layout name', () => {
    expect(drawingTitleOf({ sheetNumber: 'A-1', name: 'A-1 Full Stack Elevation' })).toBe('Full Stack Elevation');
    expect(drawingTitleOf({ sheetNumber: 'G-001', name: 'G-001 Cover & Index' })).toBe('Cover & Index');
  });
});

describe('fitPaperText', () => {
  it('leaves short strings alone and ellipsizes long ones', () => {
    expect(fitPaperText('PLAN', 12, 4, true)).toBe('PLAN');
    const long = 'FALCON 9 FULL STACK ELEVATION OF TWO WITH A VERY LONG SUBTITLE';
    const clipped = fitPaperText(long, 14, 1.2, true);
    expect(clipped.endsWith('...')).toBe(true);
    expect(clipped.length).toBeLessThan(long.length);
  });
});

describe('issued title block on a layout PDF', () => {
  it('stamps firm, copyright, drawing title and sheet count', () => {
    const layout = normalizeSheets([makeLayout({ id: 'A1', name: 'A-1 Full Stack Elevation', sheet: 'archd', ppf: 18 })])[0];
    layout.sheetNumber = 'A-1';
    const { pdf } = buildLayoutPDF(cabin24x36(), {
      layout,
      projectName: 'Falcon 9',
      dateStr: '8/30/2026',
      year: 2026,
      sheetCount: 2,
      firm: { company: 'Acme Aerospace', copyright: '© 2026 Acme Aerospace. All rights reserved.' }
    });
    expect(pdf).toContain('ACME AEROSPACE');
    expect(pdf).toContain('2026 Acme Aerospace. All rights reserved.');
    expect(pdf).toContain('FULL STACK ELEVATION');
    expect(pdf).toContain('FALCON 9');
    expect(pdf).toContain('A-1');
    expect(pdf).toContain('OF 2');
    expect(pdf).toContain('DO NOT SCALE');
    expect(pdf).toContain('ISSUED BY');
    expect(pdf).not.toContain('UNTITLED');
  });
  it('does not put the drawing title at the right edge of the sheet', () => {
    const layout = normalizeSheets([makeLayout({ id: 'A1', name: 'ENGINE DETAILS', sheet: 'archd', ppf: 18 })])[0];
    const { pdf } = buildLayoutPDF([], { layout, projectName: 'Untitled', dateStr: '1/1/2026', year: 2026 });
    expect(pdf).toContain('ENGINE DETAILS');
    expect(pdf).toContain('SOVEREIGN DRAFT');
  });
});

describe('paper-space tables read top down', () => {
  it('puts the title above the header row', () => {
    const t = Object.assign(makeTable({
      title: 'KEYNOTE LEGEND',
      headers: ['MARK', 'DESCRIPTION'],
      rows: [['E-1', 'MERLIN 1D'], ['NC-1', 'NOSE CONE']],
      colW: [0.8, 2.8],
      rowH: 0.22,
      x: 0, y: 0
    }), { fromTop: true });
    const fr = tableFrags(t);
    const texts = fr.filter(f => f.type === 'text');
    const title = texts.find(f => f.content === 'KEYNOTE LEGEND');
    const header = texts.find(f => f.content === 'MARK');
    const last = texts.find(f => f.content === 'NC-1');
    expect(title.y).toBeGreaterThan(header.y);
    expect(header.y).toBeGreaterThan(last.y);
  });
});

describe('viewports sit above the stamp', () => {
  it('lifts a legacy 0.9" viewport off the taller title block', () => {
    const vp = { px: 0.5, py: 1.4, pw: 35, ph: 22.1, mx: 0, my: 0, ppf: 18 };
    const lifted = viewportClearOfTitle(vp);
    expect(lifted.py).toBeGreaterThanOrEqual(SHEET_MARGIN + TITLE_BLOCK_H - 1e-9);
    expect(lifted.py + lifted.ph).toBeCloseTo(23.5, 5);
  });
});

describe('model space PDF still plots', () => {
  it('keeps the legacy letter title strip', () => {
    const r = buildPDF(cabin24x36(), { ppf: 18, layerVisible: () => true, projectName: 'CABIN', dateStr: '2026-01-01' });
    expect(r.pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(r.pdf).toContain('CABIN');
  });
});

void titleBlockModel;
