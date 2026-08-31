import { describe, it, expect } from 'vitest';
import { makeFcf, makeDatum, makeFinish, fcfCells, expandGdt, nextDatumLetter, parseTol } from '../src/core/gdt.js';
import { dimLabel } from '../src/core/dimStyle.js';
import { flattenEnt, isComposite } from '../src/core/entities.js';
import { realizeDocument } from '../src/ai/draft.js';

describe('GD&T frames', () => {
  it('refuses a frame with no tolerance', () => {
    expect(makeFcf({ x: 0, y: 0, char: 'position' })).toBeNull();
    expect(fcfCells({ char: 'position' })).toBeNull();
  });

  it('expands a position frame into boxes and text', () => {
    const e = makeFcf({ x: 2, y: 3, char: 'position', tol: 0.01, datum: 'A', dia: true });
    expect(e.type).toBe('fcf');
    expect(isComposite(e)).toBe(true);
    const cells = fcfCells(e);
    expect(cells[0]).toBe('POS');
    expect(cells.some(c => /DIA/.test(c))).toBe(true);
    expect(cells).toContain('A');
    const fr = expandGdt(e);
    expect(fr.filter(f => f.type === 'poly' && f.closed).length).toBeGreaterThanOrEqual(3);
    expect(fr.some(f => f.type === 'text' && f.content === 'POS')).toBe(true);
    expect(flattenEnt(e).length).toBe(fr.length);
  });

  it('parses millimetre tolerances into feet', () => {
    expect(parseTol('0.5mm')).toBeCloseTo(0.5 / 304.8, 8);
  });

  it('issues sequential datum letters', () => {
    expect(nextDatumLetter([])).toBe('A');
    expect(nextDatumLetter([makeDatum({ x: 0, y: 0, letter: 'A' })])).toBe('B');
  });

  it('a finish mark is a check with optional roughness', () => {
    const e = makeFinish({ x: 1, y: 1, roughness: '125' });
    const fr = expandGdt(e);
    expect(fr.some(f => f.type === 'text' && f.content === '125')).toBe(true);
  });
});

describe('dim tolerances', () => {
  it('prints bilateral plus-minus', () => {
    const e = { type: 'dim', kind: 'aligned', x1: 0, y1: 0, x2: 10, y2: 0, tolPlus: 0.02, tolMinus: 0.02 };
    expect(dimLabel(e)).toMatch(/±/);
  });

  it('prints unequal plus/minus', () => {
    const e = { type: 'dim', kind: 'aligned', x1: 0, y1: 0, x2: 4, y2: 0, tolPlus: 0.03, tolMinus: 0.01 };
    const s = dimLabel(e);
    expect(s).toMatch(/\+/);
    expect(s).toMatch(/-/);
  });
});

describe('AI realizes GD&T only when a tol is given', () => {
  it('drops a frameless fcf and keeps a datum', () => {
    const doc = realizeDocument(JSON.stringify({
      drawingType: 'part',
      profiles: [{ pts: [[0, 0], [4, 0], [4, 2], [0, 2]] }],
      dims: [{ a: [0, 0, 4, 0] }],
      gdt: [
        { kind: 'fcf', at: [5, 1], char: 'position' },
        { kind: 'fcf', at: [5, 2], char: 'position', tol: 0.01, datum: 'A' },
        { kind: 'datum', at: [0, 0], letter: 'A' }
      ]
    }), n => n);
    expect(doc.entities.filter(e => e.type === 'fcf').length).toBe(1);
    expect(doc.entities.filter(e => e.type === 'datum').length).toBe(1);
  });
});
