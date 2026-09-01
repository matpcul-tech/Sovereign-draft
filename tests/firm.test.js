import { describe, it, expect } from 'vitest';
import { buildPDF } from '../src/io/pdf.js';
import { makeLayout } from '../src/core/layout.js';
import { jpegInfo, isJpeg, dataUrlToBytes } from '../src/io/jpeg.js';
import { resolveStamp } from '../src/core/titleblock.js';
import { validateProject } from '../src/io/project.js';
import { state, defaultLayers } from '../src/core/state.js';
import { serializeProject } from '../src/io/project.js';

const ENTS = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 40, y2: 0 }];
const FIRM = { company: 'MATPCUL DESIGN STUDIO', copyright: '(c) 2026 Matpcul Design Studio. All rights reserved.', drawnBy: 'MP' };

/* A tiny but structurally honest baseline JPEG: SOI, APP0, SOF0 for 8x4. */
function tinyJpeg(){
  const b = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x04, 0x00, 0x08, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9
  ];
  return new Uint8Array(b);
}
const tinyDataUrl = () => 'data:image/jpeg;base64,' + Buffer.from(tinyJpeg()).toString('base64');

describe('the firm stamp reaches every export', () => {
  it('the quick export prints company, drawn-by and copyright', () => {
    const pdf = buildPDF(ENTS, { ppf: 'fit', projectName: 'LAKE HOUSE', firm: FIRM }).pdf;
    expect(pdf).toContain('MATPCUL DESIGN STUDIO');
    expect(pdf).toContain('DRAWN MP');
    expect(pdf).toContain('2026 Matpcul Design Studio');
  });

  it('the sheet export always did, and still does', () => {
    const pdf = buildPDF(ENTS, { layout: makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 }), projectName: 'LAKE HOUSE', firm: FIRM }).pdf;
    expect(pdf).toContain('MATPCUL DESIGN STUDIO');
  });

  it('an export with no firm is byte for byte the historical footer', () => {
    const a = buildPDF(ENTS, { ppf: 'fit', projectName: 'X', dateStr: '1/1/2026' }).pdf;
    const b = buildPDF(ENTS, { ppf: 'fit', projectName: 'X', dateStr: '1/1/2026', firm: { company: '', copyright: '', drawnBy: '' } }).pdf;
    expect(a).toBe(b);
    expect(a).not.toContain('DRAWN');
  });

  it('an empty copyright is synthesised from the company and year', () => {
    const s = resolveStamp({ company: 'Acme Drafting', copyright: '', drawnBy: '' }, { year: 2026 });
    expect(s.copyright).toBe('© 2026 Acme Drafting. All rights reserved.');
    expect(s.company).toBe('ACME DRAFTING');
  });
});

describe('the firm logo', () => {
  it('a JPEG data URL becomes an image object drawn on the page', () => {
    const pdf = buildPDF(ENTS, { ppf: 'fit', projectName: 'X', firm: { ...FIRM, logo: tinyDataUrl() } }).pdf;
    expect(pdf).toContain('/DCTDecode');
    expect(pdf).toContain('/Lg Do');
    expect(pdf).toContain('/Width 8');
    expect(pdf).toContain('/Height 4');
  });

  it('the sheet title block carries it too, one object shared by the pages', () => {
    const pdf = buildPDF(ENTS, { layout: makeLayout({ id: 'A1', sheet: 'archd', ppf: 18 }), projectName: 'X', firm: { ...FIRM, logo: tinyDataUrl() } }).pdf;
    expect(pdf).toContain('/Lg Do');
    expect((pdf.match(/DCTDecode/g) || []).length).toBe(1);
  });

  it('no logo means no image object at all', () => {
    const pdf = buildPDF(ENTS, { ppf: 'fit', projectName: 'X', firm: FIRM }).pdf;
    expect(pdf).not.toContain('/DCTDecode');
  });

  it('junk logos are refused, not embedded', () => {
    for (const bad of ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,iVBORw0KGgo=', 'not a url', '']){
      const pdf = buildPDF(ENTS, { ppf: 'fit', projectName: 'X', firm: { ...FIRM, logo: bad } }).pdf;
      expect(pdf).not.toContain('/DCTDecode');
    }
  });

  it('jpegInfo reads dimensions and refuses non JPEGs', () => {
    const info = jpegInfo(tinyJpeg());
    expect(info).toEqual({ width: 8, height: 4, channels: 3, progressive: false });
    expect(isJpeg(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(null);
  });

  it('dataUrlToBytes round trips', () => {
    const back = dataUrlToBytes(tinyDataUrl());
    expect(Array.from(back)).toEqual(Array.from(tinyJpeg()));
    expect(dataUrlToBytes('data:text/plain;base64,aGk=')).toBe(null);
  });
});

describe('the logo lives in the project file', () => {
  it('survives save and load, and junk is dropped on load', () => {
    state.layers = defaultLayers();
    state.entities = [];
    state.firm = { company: 'A', copyright: '', drawnBy: '', logo: tinyDataUrl() };
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.firm.logo).toBe(tinyDataUrl());
    const junk = validateProject(JSON.parse(serializeProject({ ...state, firm: { company: 'A', logo: 'javascript:alert(1)' } }, true)));
    expect(junk.firm.logo).toBeUndefined();
  });
});

