import { describe, it, expect } from 'vitest';
import { parseDXF, buildDXF } from '../src/io/dxf.js';
import { entBBox } from '../src/core/entities.js';

/* A corpus of the DXF the world actually produces: truncated, commented,
 * carrying entities this program has never heard of, encoded three ways,
 * mirrored through an extrusion vector, or simply broken.
 *
 * The parser's contract against all of it: never throw, never hang, never
 * emit an entity with non finite geometry, and whatever it read must
 * survive its own writer. Round trips against our own output prove self
 * consistency; this file is the closest an offline test can get to files
 * from other systems.
 */

const wrap = e => '0\nSECTION\n2\nENTITIES\n' + e + '0\nENDSEC\n0\nEOF\n';
const LAYERS = [{ name: '0', aci: 7, visible: true }];
const LINE = '0\nLINE\n8\n0\n10\n0\n20\n0\n11\n9\n21\n9\n';

const CORPUS = {
  'an empty file': '',
  'binary garbage': 'not a dxf \x00\x01\x02\x7f\xff',
  'only an EOF': '0\nEOF\n',
  'a header and nothing else': '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nEOF\n',
  'truncated mid entity': wrap('0\nLINE\n8\n0\n10\n1.5\n20\n').slice(0, -14),
  'a coordinate of 1e99': wrap('0\nLINE\n8\n0\n10\n1e99\n20\n0\n11\n5\n21\n5\n'),
  'NaN spelled three ways': wrap('0\nLINE\n8\n0\n10\n1.#QNAN\n20\nnan\n11\nNaN\n21\n5\n'),
  '999 comments everywhere': '999\nc\n' + wrap('999\nc\n' + LINE + '999\nc\n'),
  'a proxy entity in the stream': wrap('0\nACAD_PROXY_ENTITY\n8\n0\n90\n499\n' + LINE),
  'entities we do not model': wrap('0\nMLINE\n8\n0\n10\n0\n20\n0\n0\nWIPEOUT\n8\n0\n0\nREGION\n8\n0\n0\n3DSOLID\n8\n0\n' + LINE),
  'xdata after the geometry': wrap(LINE.slice(0, -1) + '\n1001\nACAD\n1000\napp\n1040\n3.14\n1071\n99\n'),
  'CRLF line endings': wrap(LINE).replace(/\n/g, '\r\n'),
  'padded group codes': wrap(' 0 \nLINE\n 8 \n0\n 10 \n0\n 20 \n0\n 11 \n9\n 21 \n9\n'),
  'a UTF-8 BOM': '﻿' + wrap(LINE),
  'a block that inserts itself': '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nLOOP\n10\n0\n20\n0\n0\nINSERT\n2\nLOOP\n10\n1\n20\n1\n0\nENDBLK\n0\nENDSEC\n' + wrap('0\nINSERT\n2\nLOOP\n10\n0\n20\n0\n'),
  'an insert of a missing block': wrap('0\nINSERT\n2\nNOSUCH\n10\n0\n20\n0\n' + LINE),
  'duplicate group codes': wrap('0\nLINE\n8\n0\n8\nOTHER\n10\n0\n10\n99\n20\n0\n11\n9\n21\n9\n'),
  'ten thousand vertices': wrap('0\nLWPOLYLINE\n8\n0\n90\n10000\n70\n0\n' +
    Array.from({ length: 10000 }, (_, i) => '10\n' + (i % 100) + '\n20\n' + Math.floor(i / 100) + '\n').join('')),
  'a rational spline': wrap('0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n8\n73\n4\n' +
    '40\n0\n40\n0\n40\n0\n40\n0\n40\n1\n40\n1\n40\n1\n40\n1\n' +
    '10\n0\n20\n0\n10\n3\n20\n8\n10\n9\n20\n-4\n10\n12\n20\n4\n')
};

describe('the corpus never breaks the parser', () => {
  for (const [name, text] of Object.entries(CORPUS)){
    it(name, () => {
      const t = Date.now();
      const out = parseDXF(text, n => n || '0');
      expect(Date.now() - t).toBeLessThan(2000);
      expect(Array.isArray(out)).toBe(true);
      /* Whatever came out is finite geometry... */
      for (const e of out){
        const bb = [Infinity, Infinity, -Infinity, -Infinity];
        entBBox(e, bb);
        [bb[0], bb[1], bb[2], bb[3]].forEach(v => {
          expect(Number.isNaN(v)).toBe(false);
        });
      }
      /* ...and survives our own writer. */
      const dxf = buildDXF(out, LAYERS, { ver: 'R2000' });
      expect(typeof dxf).toBe('string');
      expect(parseDXF(dxf, n => n || '0').length).toBe(out.length);
    });
  }
});

describe('what foreign files mean is read correctly', () => {
  const one = t => parseDXF(t, n => n || '0')[0];

  it('Fortran exponents from old exporters parse as numbers', () => {
    expect(one(wrap('0\nLINE\n8\n0\n10\n1.5D+2\n20\n0\n11\n5\n21\n5\n')).x1).toBe(150);
  });

  it('AutoCAD unicode escapes decode to their characters', () => {
    const t = one(wrap('0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n1\n1\n\\U+041F\\U+041B\\U+0410\\U+041D\n'));
    expect(t.content).toBe('ПЛАН');
  });

  it('a minus Z extrusion mirrors a circle, which is how AutoCAD stores mirrored geometry', () => {
    const c = one(wrap('0\nCIRCLE\n8\n0\n10\n5\n20\n5\n40\n2\n210\n0\n220\n0\n230\n-1\n'));
    expect(c.cx).toBe(-5);
    expect(c.cy).toBe(5);
  });

  it('and mirrors an arc with its angles reflected', () => {
    const a = one(wrap('0\nARC\n8\n0\n10\n5\n20\n5\n40\n2\n50\n0\n51\n90\n210\n0\n220\n0\n230\n-1\n'));
    expect(a.cx).toBe(-5);
    expect(a.a1).toBe(90);
    expect(a.a2).toBe(180);
  });

  it('and mirrors a polyline, flipping every bulge', () => {
    const p = one(wrap('0\nLWPOLYLINE\n8\n0\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n210\n0\n220\n0\n230\n-1\n'));
    expect(p.pts).toEqual([[0, 0], [-10, 0]]);
    expect(p.bulge).toEqual([-1, 0]);
  });

  it('an ordinary extrusion of plus Z changes nothing', () => {
    const c = one(wrap('0\nCIRCLE\n8\n0\n10\n5\n20\n5\n40\n2\n210\n0\n220\n0\n230\n1\n'));
    expect(c.cx).toBe(5);
  });

  it('garbage coordinates degrade to zero, never to NaN in the document', () => {
    const l = one(wrap('0\nLINE\n8\n0\n10\n1.#QNAN\n20\nnan\n11\n5\n21\n5\n'));
    expect(l.x1).toBe(0);
    expect(l.y1).toBe(0);
    expect(l.x2).toBe(5);
  });
});

describe('random mutation never crashes or hangs the parser', () => {
  it('300 seeded mutations of a real document', () => {
    /* A believable document to mutilate. */
    const doc = buildDXF([
      { type: 'line', layer: '0', x1: 0, y1: 0, x2: 20, y2: 0 },
      { type: 'circle', layer: '0', cx: 5, cy: 5, r: 2 },
      { type: 'arc', layer: '0', cx: 10, cy: 5, r: 3, a1: 10, a2: 200 },
      { type: 'poly', layer: '0', closed: true, pts: [[0, 0], [8, 0], [8, 8], [0, 8]], bulge: [0, 1, 0, 0] },
      { type: 'text', layer: '0', x: 1, y: 1, size: 1, content: 'MUTATE ME' }
    ], [{ name: '0', aci: 7, visible: true }], { ver: 'R2000' });
    const lines = doc.split('\n');

    let seed = 987654321;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    for (let k = 0; k < 300; k++){
      const mutated = lines.slice();
      const kind = Math.floor(rnd() * 5);
      const at = Math.floor(rnd() * mutated.length);
      if (kind === 0) mutated.splice(at, 1);                                   /* drop a line */
      else if (kind === 1) mutated.splice(at, 0, mutated[Math.floor(rnd() * mutated.length)]); /* duplicate one */
      else if (kind === 2 && at + 1 < mutated.length){                          /* swap neighbours */
        const t = mutated[at]; mutated[at] = mutated[at + 1]; mutated[at + 1] = t;
      }
      else if (kind === 3) mutated.length = at;                                 /* truncate */
      else mutated[at] = String.fromCharCode(33 + Math.floor(rnd() * 90)).repeat(1 + Math.floor(rnd() * 6)); /* garbage line */

      const t0 = Date.now();
      const out = parseDXF(mutated.join('\n'), n => n || '0');
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(Array.isArray(out)).toBe(true);
      for (const e of out){
        const bb = [Infinity, Infinity, -Infinity, -Infinity];
        entBBox(e, bb);
        expect(Number.isNaN(bb[0]) || Number.isNaN(bb[3])).toBe(false);
      }
    }
  });
});

describe('island hatches round trip', () => {
  /* A HATCH the way AutoCAD writes one: elevation point, pattern name,
   * then two boundary paths each opened by its group 92 flags. */
  const ISLAND_HATCH = '0\nSECTION\n2\nENTITIES\n' +
    '0\nHATCH\n8\n0\n10\n0\n20\n0\n30\n0\n2\nANSI31\n70\n0\n71\n0\n91\n2\n' +
    '92\n7\n72\n0\n73\n1\n93\n4\n' +
    '10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n' +
    '92\n22\n72\n0\n73\n1\n93\n4\n' +
    '10\n4\n20\n4\n10\n6\n20\n4\n10\n6\n20\n6\n10\n4\n20\n6\n' +
    '75\n0\n76\n1\n98\n0\n' +
    '0\nENDSEC\n0\nEOF\n';

  it('a foreign two path HATCH parses to a hatch with its island', async () => {
    const { hatchArea } = await import('../src/core/hatch.js');
    const { polyArea } = await import('../src/core/geometry.js');
    const out = parseDXF(ISLAND_HATCH, n => n || '0');
    const h = out.find(e => e.type === 'hatch');
    expect(h).toBeTruthy();
    expect(Math.abs(polyArea(h.pts))).toBeCloseTo(100, 9);
    expect(h.holes.length).toBe(1);
    expect(Math.abs(polyArea(h.holes[0]))).toBeCloseTo(4, 9);
    expect(hatchArea(h)).toBeCloseTo(96, 9);
  });

  it('a holed hatch writes one HATCH entity whose rings carry the cavity', async () => {
    /* The R2000 writer used to explode a hatch into clipped lines plus
     * two boundary polylines; it now writes the real HATCH entity, so
     * the reopened file has one editable hatch whose outer ring and
     * island hold their exact areas, pattern and scale intact. The
     * pattern-avoids-the-cavity property lives in the renderer and is
     * covered by the insideWithHoles tests. */
    const { polyArea } = await import('../src/core/geometry.js');
    const src = {
      type: 'hatch', layer: '0', pattern: 'ANSI31', scale: 1,
      pts: [[0, 0], [10, 0], [10, 10], [0, 10]],
      holes: [[[4, 4], [6, 4], [6, 6], [4, 6]]]
    };
    const doc = buildDXF([src], LAYERS, { ver: 'R2000' });
    const back = parseDXF(doc, n => n || '0');
    const hatches = back.filter(e => e.type === 'hatch');
    expect(hatches.length).toBe(1);
    expect(back.filter(e => e.type === 'line').length).toBe(0);
    expect(Math.abs(polyArea(hatches[0].pts))).toBeCloseTo(100, 9);
    expect(hatches[0].holes.length).toBe(1);
    expect(Math.abs(polyArea(hatches[0].holes[0]))).toBeCloseTo(4, 9);
    expect(hatches[0].pattern).toBe('ANSI31');
    expect(hatches[0].scale).toBeCloseTo(1, 9);
  });
});
