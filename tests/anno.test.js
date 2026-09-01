import { describe, it, expect, beforeEach } from 'vitest';
import {
  effTextSize, paperTextPts, toAnno, fromAnno, parseScaleToPpf, DEFAULT_ANNO_PPF
} from '../src/core/annoscale.js';
import { buildPDF } from '../src/io/pdf.js';
import { state, defaultLayers } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { lookupCommand } from '../src/core/command.js';

describe('what an annotative height means', () => {
  it('paper inches convert to model feet through the working scale', () => {
    /* 3/32" notes at 1/4" = 1'-0": 0.09375 * 72 / 18 = 0.375 ft = 4 1/2". */
    const e = { anno: true, size: 3 / 32 };
    expect(effTextSize(e, 18)).toBeCloseTo(0.375, 9);
    /* At 1/8" the same note is twice the model size, same paper size. */
    expect(effTextSize(e, 9)).toBeCloseTo(0.75, 9);
  });

  it('plain text is untouched', () => {
    expect(effTextSize({ size: 1.2 }, 18)).toBe(1.2);
    expect(effTextSize({ size: 1.2 }, 9)).toBe(1.2);
  });

  it('on paper an annotative height is exact points at every scale', () => {
    const e = { anno: true, size: 3 / 32 };
    expect(paperTextPts(e, 18)).toBeCloseTo(6.75, 9);
    expect(paperTextPts(e, 9)).toBeCloseTo(6.75, 9);
    expect(paperTextPts(e, 72)).toBeCloseTo(6.75, 9);
  });

  it('plain text still scales with the viewport like its geometry', () => {
    expect(paperTextPts({ size: 1 }, 18)).toBe(18);
    expect(paperTextPts({ size: 1 }, 9)).toBe(9);
  });

  it('toggling at the working scale never jumps on screen', () => {
    const e = { size: 0.375 };
    toAnno(e, 18);
    expect(e.anno).toBe(true);
    expect(e.size).toBeCloseTo(3 / 32, 9);
    expect(effTextSize(e, 18)).toBeCloseTo(0.375, 9);
    fromAnno(e, 18);
    expect(e.anno).toBeUndefined();
    expect(e.size).toBeCloseTo(0.375, 9);
  });

  it('a double toggle is the identity', () => {
    const e = { size: 0.8 };
    fromAnno(toAnno(e, 24), 24);
    expect(e.size).toBeCloseTo(0.8, 12);
    expect(e.anno).toBeUndefined();
  });
});

describe('scale parsing', () => {
  it('reads architectural fractions', () => {
    expect(parseScaleToPpf('1/4')).toBe(18);
    expect(parseScaleToPpf('1/8')).toBe(9);
    expect(parseScaleToPpf('3/8"')).toBe(27);
    expect(parseScaleToPpf('1')).toBe(72);
  });
  it('a big bare number is points per foot directly', () => {
    expect(parseScaleToPpf('18')).toBe(18);
    expect(parseScaleToPpf('96')).toBe(96);
  });
  it('junk is refused, not guessed', () => {
    expect(parseScaleToPpf('')).toBe(null);
    expect(parseScaleToPpf('zero')).toBe(null);
    expect(parseScaleToPpf('0/4')).toBe(null);
    expect(parseScaleToPpf('-2')).toBe(null);
  });
});

describe('the plot honours it', () => {
  const ents = anno => ([
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 40, y2: 0 },
    { id: 2, type: 'text', layer: 'TEXT', x: 2, y: 5, size: anno ? 3 / 32 : 1, content: 'NOTE', anno: anno || undefined }
  ]);

  it('an annotative note prints at the same points at two scales', () => {
    const at = ppf => {
      const pdf = buildPDF(ents(true), { ppf, projectName: 'T' }).pdf;
      const m = pdf.match(/\/F1 ([\d.]+) Tf [\d.]+ g [^(]*\(NOTE\)/);
      return m ? Number(m[1]) : null;
    };
    expect(at(18)).toBeCloseTo(6.75, 2);
    expect(at(9)).toBeCloseTo(6.75, 2);
  });

  it('a plain note still scales with the plot', () => {
    const at = ppf => {
      const pdf = buildPDF(ents(false), { ppf, projectName: 'T' }).pdf;
      const m = pdf.match(/\/F1 ([\d.]+) Tf [\d.]+ g [^(]*\(NOTE\)/);
      return m ? Number(m[1]) : null;
    };
    expect(at(18)).toBeCloseTo(18, 2);
    expect(at(9)).toBeCloseTo(9, 2);
  });
});

describe('the working scale lives in the document', () => {
  beforeEach(() => {
    state.layers = defaultLayers();
    state.entities = [];
    state.constraints = [];
    state.selIds = [];
    state.undoStack = [];
    state.redoStack = [];
    state.idSeq = 1;
    state.annoPpf = DEFAULT_ANNO_PPF;
  });

  it('survives save and load', () => {
    state.annoPpf = 9;
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.annoPpf).toBe(9);
    const target = { ...state, annoPpf: 18 };
    applyProject(target, p);
    expect(target.annoPpf).toBe(9);
  });

  it('an old file defaults to quarter inch', () => {
    const raw = JSON.parse(serializeProject(state, true));
    delete raw.annoPpf;
    expect(validateProject(raw).annoPpf).toBe(18);
  });
});

describe('the commands are registered', () => {
  it('ANNO and ANNOSCALE reach the command line', () => {
    expect(lookupCommand('ANNO').action).toBe('anno');
    expect(lookupCommand('ANNOTATIVE').action).toBe('anno');
    expect(lookupCommand('ANNOSCALE').action).toBe('annoscale');
    expect(lookupCommand('ASCALE').action).toBe('annoscale');
  });
});
