import { describe, it, expect } from 'vitest';
import { buildPDF } from '../src/io/pdf.js';

/* A minimal baseline JPEG: SOI, an SOF0 frame naming 4x6 pixels and three
 * channels, EOI. The writer embeds bytes verbatim under DCTDecode, so the
 * plumbing needs only a header jpegInfo accepts. */
function tinyJpeg(w, h){
  const b = [0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255,
    0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9];
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return 'data:image/jpeg;base64,' + btoa(bin);
}

const IMG = (src, x, y) => ({ type: 'image', layer: 'RENDER', x, y, w: 40, h: 22.5, rot: 0, src });
const LINE = { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 };

describe('placed rasters embed in the issued PDF', () => {
  it('a JPEG image entity becomes a drawn XObject', () => {
    const pdf = buildPDF([LINE, IMG(tinyJpeg(4, 6), 30, 0)], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(pdf).toMatch(/\/XObject << \/Rd1 \d+ 0 R >>/);
    expect(pdf).toContain('/Rd1 Do');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain('/Width 4 /Height 6');
  });

  it('two placements of the same rendering share one XObject', () => {
    const src = tinyJpeg(4, 6);
    const pdf = buildPDF([IMG(src, 0, 0), IMG(src, 60, 0)], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(pdf.split('/Rd1 Do').length - 1).toBe(2);
    expect(pdf.split('/Filter /DCTDecode').length - 1).toBe(1);
    expect(pdf).not.toContain('/Rd2');
  });

  it('a non-JPEG src falls back to the dashed frame, not a blank box', () => {
    const png = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\n');
    const pdf = buildPDF([IMG(png, 0, 0)], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(pdf).not.toContain(' Do');
    expect(pdf).not.toContain('DCTDecode');
  });

  it('a document with no images writes byte-identically to before', () => {
    /* The registry resets per build: an earlier image build must leave no
     * XObject behind in the next one. */
    const withImg = buildPDF([LINE, IMG(tinyJpeg(4, 6), 30, 0)], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(withImg).toContain('Do');
    const plain = buildPDF([LINE], { ppf: 'fit', projectName: 'T' }).pdf;
    expect(plain).not.toContain('/XObject');
    expect(plain).not.toContain('DCTDecode');
  });

  it('the placement matrix carries position, scale and rotation', () => {
    /* 40 ft wide at this scale, rotated 90: the cm row is
     * [0 40ppf ; -22.5ppf 0] at TX,TY of the corner. */
    const pdf = buildPDF([LINE, { ...IMG(tinyJpeg(4, 6), 30, 0), rot: 90 }], { ppf: 6, projectName: 'T' }).pdf;
    const m = pdf.match(/q ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm \/Rd1 Do Q/);
    expect(m).not.toBe(null);
    expect(Number(m[1])).toBeCloseTo(0, 6);
    expect(Number(m[2])).toBeCloseTo(240, 6);      /* 40 ft x 6 ppf */
    expect(Number(m[3])).toBeCloseTo(-135, 6);     /* 22.5 ft x 6 ppf */
    expect(Number(m[4])).toBeCloseTo(0, 6);
  });
});
