import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { latin1ToBytes } from '../src/io/pdffont.js';
import { makeLayout, fitViewport } from '../src/core/layout.js';

/* A baseline JPEG header with plenty of bytes above 0x7F (every marker is
 * 0xFF), which is exactly what a UTF-8 round trip would mangle. */
function jpegBytes(w, h){
  return [0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x05, 0x80, 0x9f, 0xc3,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255,
    0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9];
}
function dataUrl(bytes){
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return 'data:image/jpeg;base64,' + btoa(bin);
}

function streamAfter(bytes, marker){
  /* Find the first "stream\n" after the DCTDecode dictionary and return the
   * raw bytes up to "endstream". */
  const text = Array.from(bytes, b => String.fromCharCode(b)).join('');
  const at = text.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const start = text.indexOf('stream', at) + 'stream'.length;
  let s = start;
  if (text[s] === '\r') s++;
  if (text[s] === '\n') s++;
  const end = text.indexOf('endstream', s);
  let e = end;
  while (e > s && (text[e - 1] === '\n' || text[e - 1] === '\r')) e--;
  return bytes.slice(s, e);
}

describe('Export All PDF keeps embedded images byte exact', () => {
  const jpg = jpegBytes(4, 6);
  const ents = [
    { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { type: 'image', layer: 'RENDER', x: 2, y: 2, w: 20, h: 12, rot: 0, src: dataUrl(jpg) }
  ];
  const bb = [0, 0, 24, 14];
  const sheets = [
    makeLayout({ id: 'S1', name: 'A-1 Plan', sheet: 'archd' }),
    makeLayout({ id: 'S2', name: 'A-2 Views', sheet: 'archd' })
  ];
  sheets.forEach(L => L.viewports.forEach(v => fitViewport(v, bb)));

  it('a two sheet PDF written as bytes carries the original JPEG bytes', () => {
    const { pdf, pages } = buildAllSheetsPDF(ents, { sheets, projectName: 'T' });
    expect(pages).toBe(2);
    const bytes = latin1ToBytes(pdf);
    expect(bytes.length).toBe(pdf.length);
    const got = Array.from(streamAfter(bytes, '/Filter /DCTDecode'));
    expect(got).toEqual(jpg);
    /* The /Length the writer declared must match the bytes on disk. */
    const len = Number(pdf.match(/\/Filter \/DCTDecode \/Length (\d+)/)[1]);
    expect(len).toBe(jpg.length);
  });

  it('a string handed to a Blob would have corrupted it (the old bug)', () => {
    const { pdf } = buildAllSheetsPDF(ents, { sheets, projectName: 'T' });
    const utf8 = new TextEncoder().encode(pdf);
    expect(utf8.length).toBeGreaterThan(pdf.length);
  });

  it('every PDF download in the app goes out as bytes, not a string', () => {
    const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const calls = src.match(/download\([^\n]*\.pdf'[^\n]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c).toContain('latin1ToBytes(');
  });
});
