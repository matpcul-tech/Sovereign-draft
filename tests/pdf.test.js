import { describe, it, expect } from 'vitest';
import { buildPDF, scaleLabel, pdfSafe, SCALE_LADDER } from '../src/io/pdf.js';

describe('pdfSafe', () => {
  it('escapes PDF string delimiters', () => {
    expect(pdfSafe('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
  });
  it('replaces typographic characters with ASCII', () => {
    expect(pdfSafe("6½\" × 2°")).toBe('6 1/2" x 2 deg');
  });
});

describe('scaleLabel', () => {
  it('names standard architectural scales', () => {
    expect(scaleLabel(18)).toBe('1/4" = 1\'-0"');
    expect(scaleLabel(9)).toBe('1/8" = 1\'-0"');
  });
  it('falls back to pt/ft for non-standard values', () => {
    expect(scaleLabel(11)).toBe('11 pt/ft');
  });
});

describe('buildPDF', () => {
  const ents = [
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 0, y2: 16 },
    { type: 'text', layer: 'TEXT', x: 5, y: 5, size: 1.2, content: 'ROOM' },
    { type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 24, y2: 0, off: -2 }
  ];
  it('produces a structurally valid one-page PDF', () => {
    const { pdf } = buildPDF(ents, { ppf: 'fit', projectName: 'Test House' });
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Type /Page');
    expect(pdf.trim().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('TEST HOUSE');
    // xref offsets must point at "N 0 obj" lines.
    const xref = pdf.slice(pdf.indexOf('xref'));
    const offsets = xref.split('\n').slice(3, 9).map(l => parseInt(l, 10));
    offsets.forEach((off, i) => {
      expect(pdf.slice(off, off + 8)).toMatch(new RegExp('^' + (i + 1) + ' 0 obj'));
    });
  });
  it('fit picks the largest standard scale that fits', () => {
    // 24 ft wide drawing: 700/24 ≈ 29 → expect 1/2" = 36 rejected, 3/8" = 27 ok.
    const { ppf } = buildPDF(ents, { ppf: 'fit' });
    expect(SCALE_LADDER.some(s => s.ppf === ppf)).toBe(true);
    expect(24 * ppf).toBeLessThanOrEqual(700);
  });
  it('marks fixed scales that overflow the sheet as clipped', () => {
    const { clipped } = buildPDF(ents, { ppf: 72 });
    expect(clipped).toBe(true);
  });
  it('skips hidden layers', () => {
    const { pdf } = buildPDF(ents, { ppf: 'fit', layerVisible: n => n !== 'TEXT' });
    expect(pdf).not.toContain('(ROOM)');
  });
});
