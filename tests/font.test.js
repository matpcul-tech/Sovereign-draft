import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseTTF, glyphsFor, glyphWidth1000, ttfWidth, missingGlyphs,
  embeddingAllowed, EMBED_RESTRICTED
} from '../src/io/ttf.js';
import {
  subsetTTF, collectGlyphs, hexString, fontObjects,
  bytesToLatin1, latin1ToBytes
} from '../src/io/pdffont.js';
import { buildPDF, pdfSafe, foldTypographic } from '../src/io/pdf.js';

const PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
];
const PATH = PATHS.find(p => existsSync(p));
const font = () => parseTTF(readFileSync(PATH));

/* Without a font on the machine these cannot run, and a silently skipped
 * suite is worse than a loud one. */
describe('a TrueType font is available to test with', () => {
  it('found one', () => expect(PATH).toBeTruthy());
});

describe('parsing a real font', () => {
  it('reads the header values', () => {
    const f = font();
    expect(f.unitsPerEm).toBeGreaterThan(0);
    expect(f.numGlyphs).toBeGreaterThan(100);
    expect(f.advance.length).toBe(f.numGlyphs);
    expect(f.cmap.size).toBeGreaterThan(100);
    expect(f.name).toBeTruthy();
  });

  it('maps characters across scripts to real glyphs', () => {
    const f = font();
    for (const ch of ['A', 'z', '0', ' ', '-']) expect(glyphsFor(f, ch)[0]).toBeGreaterThan(0);
  });

  it('widths are positive, additive, and ordered sensibly', () => {
    const f = font();
    expect(ttfWidth(f, '', 1)).toBe(0);
    expect(ttfWidth(f, 'M', 1)).toBeGreaterThan(0);
    expect(ttfWidth(f, ' ', 1)).toBeLessThan(ttfWidth(f, 'M', 1));
    expect(ttfWidth(f, 'ABAB', 1)).toBeCloseTo(2 * ttfWidth(f, 'AB', 1), 9);
    expect(ttfWidth(f, 'AB', 2)).toBeCloseTo(2 * ttfWidth(f, 'AB', 1), 9);
  });

  it('reports characters it has no glyph for', () => {
    const f = font();
    expect(missingGlyphs(f, 'PLAIN ASCII')).toEqual([]);
    /* A private use codepoint is in no ordinary font. */
    expect(missingGlyphs(f, 'AB')).toEqual(['']);
    expect(missingGlyphs(f, 'A\nB')).toEqual([]);
  });

  it('refuses things that are not TrueType', () => {
    expect(() => parseTTF(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow();
    const otto = new Uint8Array(12);
    otto.set([0x4f, 0x54, 0x54, 0x4f]);
    expect(() => parseTTF(otto)).toThrow(/CFF/);
  });

  it('honours an embedding restriction', () => {
    const f = font();
    expect(embeddingAllowed(f)).toBe(true);
    expect(embeddingAllowed({ fsType: EMBED_RESTRICTED })).toBe(false);
    /* Restricted plus print permitted is allowed: a plot is a print. */
    expect(embeddingAllowed({ fsType: EMBED_RESTRICTED | 0x0004 })).toBe(true);
  });
});

describe('subsetting', () => {
  const TEXT = ['GENERAL NOTES', 'A-101', '1. VERIFY IN FIELD.'];

  it('is a large saving', () => {
    const f = font();
    const sub = subsetTTF(f, collectGlyphs(f, TEXT));
    expect(sub.length).toBeLessThan(f.raw.length / 2);
  });

  it('the result is still a parseable font with the same glyph count', () => {
    const f = font();
    const re = parseTTF(subsetTTF(f, collectGlyphs(f, TEXT)));
    expect(re.numGlyphs).toBe(f.numGlyphs);
    expect(re.unitsPerEm).toBe(f.unitsPerEm);
  });

  it('keeps every advance width, so nothing measured before shifts after', () => {
    const f = font();
    const re = parseTTF(subsetTTF(f, collectGlyphs(f, TEXT)));
    for (let g = 0; g < f.numGlyphs; g++) expect(re.advance[g]).toBe(f.advance[g]);
    for (const t of TEXT) expect(ttfWidth(re, t, 1)).toBeCloseTo(ttfWidth(f, t, 1), 9);
  });

  it('always keeps notdef, which is what a viewer draws for a missing glyph', () => {
    const f = font();
    const sub = subsetTTF(f, new Set());
    expect(parseTTF(sub).numGlyphs).toBe(f.numGlyphs);
  });

  it('subsetting twice gives the same bytes', () => {
    const f = font();
    const a = subsetTTF(f, collectGlyphs(f, TEXT));
    const b = subsetTTF(f, collectGlyphs(f, TEXT));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('latin1 byte handling', () => {
  it('round trips every byte value exactly', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const back = latin1ToBytes(bytesToLatin1(bytes));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('one character per byte, which is what keeps the xref offsets right', () => {
    const f = font();
    const sub = subsetTTF(f, collectGlyphs(f, ['A']));
    expect(bytesToLatin1(sub).length).toBe(sub.length);
  });

  it('handles a font larger than one conversion chunk', () => {
    const big = new Uint8Array(0x8000 * 3 + 17).fill(0xab);
    expect(bytesToLatin1(big).length).toBe(big.length);
  });
});

describe('the writer decides correctly which text needs the font', () => {
  it('folds typographic characters that have an honest ASCII spelling', () => {
    expect(pdfSafe('6½" × 2°')).toBe('6 1/2" x 2 deg');
    expect(/[^\x20-\x7e]/.test(foldTypographic('6½" × 2°'))).toBe(false);
  });

  it('and keeps the ones it cannot spell', () => {
    /* pdfSafe destroys these, which is exactly why they must route to the
     * embedded font instead. */
    expect(/[^\x20-\x7e]/.test(foldTypographic('ПЛАН'))).toBe(true);
    expect(pdfSafe('ПЛАН').trim()).toBe('');
  });
});

describe('embedding into a PDF', () => {
  const ents = () => ([
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { type: 'text', layer: 'TEXT', x: 2, y: 10, size: 1.5, content: 'FLOOR PLAN' },
    { type: 'text', layer: 'TEXT', x: 2, y: 7, size: 1.5, content: 'ПЛАН ЭТАЖА' }
  ]);

  it('without a font the drawing still plots, losing only the glyphs it cannot draw', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T' }).pdf;
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(FLOOR PLAN) Tj');
    expect(pdf).not.toContain('/FontFile2');
  });

  it('with a font the non Latin text becomes real glyphs', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/Identity-H');
    expect(pdf).toContain('/CIDFontType2');
    expect(pdf).toMatch(/<[0-9a-f]{8,}> Tj/);
  });

  it('Latin text stays on the base font, so ordinary notes are unchanged', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    expect(pdf).toMatch(/\/F1 [\d.]+ Tf[^\n]*\(FLOOR PLAN\) Tj/);
  });

  it('carries a ToUnicode map so the sheet can be searched', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    expect(pdf).toContain('/ToUnicode');
    expect(pdf).toContain('beginbfchar');
  });

  it('the embedded stream is a TrueType file of the declared length', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    const m = pdf.match(/\/Length (\d+) \/Length1 (\d+) >>\nstream\n/);
    expect(m).toBeTruthy();
    expect(m[1]).toBe(m[2]);
    const start = pdf.indexOf('stream\n', pdf.indexOf('/Length1')) + 7;
    expect(pdf.charCodeAt(start)).toBe(0x00);
    expect(pdf.charCodeAt(start + 1)).toBe(0x01);
  });

  it('the xref offsets stay byte offsets, which is what latin1 buys', () => {
    const pdf = buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    expect(latin1ToBytes(pdf).length).toBe(pdf.length);
    const startxref = Number(pdf.slice(pdf.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('a document with no font never leaks the previous one', () => {
    const a = buildPDF(ents(), { ppf: 'fit', projectName: 'T' }).pdf;
    buildPDF(ents(), { ppf: 'fit', projectName: 'T', font: font() });
    const b = buildPDF(ents(), { ppf: 'fit', projectName: 'T' }).pdf;
    expect(b).toBe(a);
  });

  it('an all Latin drawing embeds nothing even when a font is offered', () => {
    const latin = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
      { type: 'text', layer: 'TEXT', x: 2, y: 5, size: 1, content: 'PLAN' }];
    const pdf = buildPDF(latin, { ppf: 'fit', projectName: 'T', font: font() }).pdf;
    expect(pdf).not.toContain('/FontFile2');
  });

  it('only the glyphs used are carried', () => {
    const f = font();
    const few = fontObjects(f, collectGlyphs(f, ['AB']), 7);
    const many = fontObjects(f, collectGlyphs(f, ['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']), 7);
    expect(few.bytes).toBeLessThan(many.bytes);
    expect(few.count).toBe(5);
  });

  it('refuses a font whose licence forbids embedding', () => {
    const f = font();
    expect(() => fontObjects({ ...f, fsType: EMBED_RESTRICTED }, new Set([1]), 7)).toThrow(/licence/);
  });
});

describe('glyph runs', () => {
  it('are four hex digits per glyph, in order', () => {
    const f = font();
    const h = hexString(f, 'AB');
    expect(h).toMatch(/^<[0-9a-f]{8}>$/);
    const [a, b] = glyphsFor(f, 'AB');
    expect(h).toBe('<' + a.toString(16).padStart(4, '0') + b.toString(16).padStart(4, '0') + '>');
  });

  it('an empty string is an empty run, not a broken one', () => {
    expect(hexString(font(), '')).toBe('<>');
  });

  it('widths in the PDF thousand unit em match what the layout measured', () => {
    const f = font();
    const g = glyphsFor(f, 'M')[0];
    expect(glyphWidth1000(f, g) / 1000).toBeCloseTo(ttfWidth(f, 'M', 1), 3);
  });
});
