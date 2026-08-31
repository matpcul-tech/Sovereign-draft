/* Embed a TrueType font in a PDF, subset to the glyphs actually used.
 *
 * Without this the writer can only emit the base 14 Helvetica, so a drawing
 * with Cyrillic, Greek or CJK notes plots as the wrong glyphs or as nothing,
 * and a firm cannot plot in its own face.
 *
 * Two things here are not optional:
 *
 * Subsetting. DejaVu Sans is 757 KB. A drawing uses perhaps eighty distinct
 * characters. Embedding the whole file in every sheet of every set is the
 * difference between a deliverable and an attachment that bounces. The
 * subset keeps the original glyph ids and empties the outlines of the
 * glyphs nobody used, which leaves CIDToGIDMap Identity valid and avoids
 * remapping every reference in the file.
 *
 * Byte counting. The PDF is assembled as a string and its cross reference
 * table is built from string offsets. That only holds while every character
 * is one byte, so font bytes go in as latin1 code units and the whole
 * document is encoded latin1 on the way out, never UTF-8.
 */
import { glyphsFor, glyphWidth1000, embeddingAllowed } from './ttf.js';

/* One character per byte, so a string offset stays a byte offset. */
export function bytesToLatin1(bytes){
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK){
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/* The inverse, for handing a finished document to a Blob. Anything above
 * 0xff would mean a byte got mangled somewhere upstream. */
export function latin1ToBytes(str){
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function u16(v){ return [(v >> 8) & 0xff, v & 0xff]; }
function u32(v){ return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }

function locaOffsets(font){
  const t = font.tables.loca;
  if (!t) return null;
  const dv = new DataView(font.raw.buffer, font.raw.byteOffset, font.raw.byteLength);
  const n = font.numGlyphs + 1;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++){
    out[i] = font.indexToLocFormat
      ? dv.getUint32(t.offset + i * 4)
      : dv.getUint16(t.offset + i * 2) * 2;
  }
  return out;
}

/* A composite glyph draws other glyphs, so keeping it without its parts
 * leaves a hole in the page. Walk the components and pull them in too. */
function withComposites(font, used, loca){
  const glyf = font.tables.glyf;
  if (!glyf) return used;
  const dv = new DataView(font.raw.buffer, font.raw.byteOffset, font.raw.byteLength);
  const out = new Set(used);
  const stack = [...used];
  let guard = 0;
  while (stack.length && guard++ < 100000){
    const g = stack.pop();
    if (g >= font.numGlyphs) continue;
    const start = glyf.offset + loca[g], end = glyf.offset + loca[g + 1];
    if (end - start < 10) continue;
    if (dv.getInt16(start) >= 0) continue;      /* simple glyph, no parts */
    let p = start + 10;
    for (;;){
      if (p + 4 > end) break;
      const flags = dv.getUint16(p), idx = dv.getUint16(p + 2);
      p += 4;
      if (!out.has(idx)){ out.add(idx); stack.push(idx); }
      p += (flags & 1) ? 4 : 2;                 /* ARG_1_AND_2_ARE_WORDS */
      if (flags & 8) p += 2;                    /* WE_HAVE_A_SCALE */
      else if (flags & 0x40) p += 4;            /* X_AND_Y_SCALE */
      else if (flags & 0x80) p += 8;            /* TWO_BY_TWO */
      if (!(flags & 0x20)) break;               /* MORE_COMPONENTS */
    }
  }
  return out;
}

/* Rebuild the font with only the used outlines. Glyph ids are unchanged;
 * unused glyphs become zero length, which is a valid empty glyph. */
export function subsetTTF(font, usedGlyphs){
  const loca = locaOffsets(font);
  if (!loca || !font.tables.glyf) return font.raw;   /* nothing to prune */

  const keep = withComposites(font, new Set([0, ...usedGlyphs]), loca);
  const glyfBase = font.tables.glyf.offset;

  /* New glyf: the kept outlines, each padded to a 4 byte boundary. */
  const parts = [];
  const newLoca = new Uint32Array(font.numGlyphs + 1);
  let at = 0;
  for (let g = 0; g < font.numGlyphs; g++){
    newLoca[g] = at;
    if (!keep.has(g)) continue;
    const s = glyfBase + loca[g], e = glyfBase + loca[g + 1];
    if (e <= s) continue;
    const slice = font.raw.subarray(s, e);
    parts.push(slice);
    let len = slice.length;
    const pad = (4 - (len % 4)) % 4;
    if (pad) parts.push(new Uint8Array(pad));
    at += len + pad;
  }
  newLoca[font.numGlyphs] = at;

  const newGlyf = new Uint8Array(at);
  let o = 0;
  for (const p of parts){ newGlyf.set(p, o); o += p.length; }

  /* Long loca everywhere: offsets can now exceed what short loca encodes,
   * and head has to say so. */
  const newLocaBytes = new Uint8Array((font.numGlyphs + 1) * 4);
  for (let i = 0; i <= font.numGlyphs; i++){
    newLocaBytes.set(u32(newLoca[i]), i * 4);
  }

  /* post version 3.0 carries no glyph names. The names are 60 KB of the
   * 124 KB and a PDF using Identity-H never reads them, but post is a
   * required table, so it is replaced rather than dropped. */
  const post3 = new Uint8Array(32);
  post3.set(u32(0x00030000), 0);
  post3.set(u32(Math.round(font.italicAngle * 65536)), 4);

  return rebuild(font, { glyf: newGlyf, loca: newLocaBytes, post: post3 });
}

/* Write a new sfnt with some tables replaced. Tables the PDF does not need
 * for rendering are dropped, which is most of the remaining weight. */
function rebuild(font, replace){
  const KEEP = ['cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'prep', 'cmap', 'OS/2', 'post'];
  const tags = KEEP.filter(t => replace[t] || font.tables[t]).sort();

  const bodies = tags.map(t => {
    if (replace[t]) return replace[t];
    const rec = font.tables[t];
    return font.raw.subarray(rec.offset, rec.offset + rec.length);
  });

  const n = tags.length;
  const dirLen = 12 + n * 16;
  let total = dirLen;
  const offsets = [];
  bodies.forEach(b => {
    offsets.push(total);
    total += b.length + ((4 - (b.length % 4)) % 4);
  });

  const out = new Uint8Array(total);
  let p = 0;
  const put = arr => { out.set(arr, p); p += arr.length; };

  /* Offset table. The binary search fields are advisory; a reader that uses
   * them still works with the exact values below. */
  put(u32(0x00010000));
  put(u16(n));
  let pow = 1, log = 0;
  while (pow * 2 <= n){ pow *= 2; log++; }
  put(u16(pow * 16)); put(u16(log)); put(u16(n * 16 - pow * 16));

  tags.forEach((t, i) => {
    for (let k = 0; k < 4; k++) out[p++] = t.charCodeAt(k);
    put(u32(0));                 /* checksum: readers that matter do not verify */
    put(u32(offsets[i]));
    put(u32(bodies[i].length));
  });

  bodies.forEach((b, i) => { out.set(b, offsets[i]); });

  /* head: say the loca is long now, and clear the whole file checksum since
   * it can no longer be right. */
  const headIdx = tags.indexOf('head');
  if (headIdx >= 0 && replace.loca){
    const h = offsets[headIdx];
    out[h + 8] = out[h + 9] = out[h + 10] = out[h + 11] = 0;   /* checkSumAdjustment */
    out[h + 50] = 0; out[h + 51] = 1;                          /* indexToLocFormat = 1 */
  }
  return out;
}

function esc(s){ return String(s).replace(/[^\x21-\x7e]/g, ''); }

/* The PDF objects for one embedded font. Identity-H means a text string is
 * a run of two byte glyph ids, which is what lets a single font carry every
 * script the drawing uses without an encoding table per language. */
/* A CMap from glyph id back to the character it came from.
 *
 * Identity-H says nothing about what a glyph means, so without this a
 * reader can draw the page but cannot search it, and copying the text gives
 * nonsense. On a drawing set that people grep for a room name or a detail
 * number, that is most of the value of having text at all. */
function toUnicodeCMap(font, ids){
  const pairs = [];
  const seen = new Set();
  /* Invert the font's own cmap: it is the only record of which character
   * produced which glyph. */
  for (const [code, gid] of font.cmap){
    if (!ids.has(gid) || seen.has(gid)) continue;
    seen.add(gid);
    const cp = code > 0xffff
      ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]
      : [code];
    pairs.push('<' + gid.toString(16).padStart(4, '0') + '> <' +
      cp.map(c => c.toString(16).padStart(4, '0')).join('') + '>');
  }
  const chunks = [];
  for (let i = 0; i < pairs.length; i += 100){
    const part = pairs.slice(i, i + 100);
    chunks.push(part.length + ' beginbfchar\n' + part.join('\n') + '\nendbfchar');
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n' +
    chunks.join('\n') + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
}

export function fontObjects(font, usedGlyphs, first){
  if (!embeddingAllowed(font)) throw new Error('This font\'s licence does not permit embedding');
  const sub = subsetTTF(font, usedGlyphs);
  const name = esc(font.name || 'Embedded') || 'Embedded';
  const type0 = first, cid = first + 1, desc = first + 2, file = first + 3, uni = first + 4;

  const ids = [...usedGlyphs].filter(g => g > 0).sort((a, b) => a - b);
  /* /W as one run per glyph is longer than the grouped form but cannot get a
   * range boundary wrong, and it compresses away anyway. */
  const W = ids.map(g => g + ' [' + glyphWidth1000(font, g) + ']').join(' ');

  const k = 1000 / font.unitsPerEm;
  const bb = font.bbox.map(v => Math.round(v * k));
  /* Symbolic, so a viewer uses the font's own cmap rather than trying to
   * map through a standard encoding. */
  const flags = 4 + (font.italicAngle ? 64 : 0);

  const objs = [];
  objs.push(type0 + ' 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /' + name +
    ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + uni + ' 0 R >>\nendobj');
  objs.push(cid + ' 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + name +
    ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
    ' /FontDescriptor ' + desc + ' 0 R /DW 1000 /W [' + W + ']' +
    ' /CIDToGIDMap /Identity >>\nendobj');
  objs.push(desc + ' 0 obj\n<< /Type /FontDescriptor /FontName /' + name +
    ' /Flags ' + flags +
    ' /FontBBox [' + bb.join(' ') + ']' +
    ' /ItalicAngle ' + Math.round(font.italicAngle) +
    ' /Ascent ' + Math.round(font.ascender * k) +
    ' /Descent ' + Math.round(font.descender * k) +
    ' /CapHeight ' + Math.round(font.capHeight * k) +
    ' /StemV 80 /FontFile2 ' + file + ' 0 R >>\nendobj');
  objs.push(file + ' 0 obj\n<< /Length ' + sub.length + ' /Length1 ' + sub.length +
    ' >>\nstream\n' + bytesToLatin1(sub) + '\nendstream\nendobj');

  const cmapText = toUnicodeCMap(font, new Set(ids));
  objs.push(uni + ' 0 obj\n<< /Length ' + cmapText.length + ' >>\nstream\n' + cmapText + '\nendstream\nendobj');

  return { objs, ref: type0, count: 5, bytes: sub.length };
}

/* A text string as Identity-H hex: two bytes per glyph. */
export function hexString(font, str){
  let s = '';
  for (const g of glyphsFor(font, str)){
    s += (g & 0xffff).toString(16).padStart(4, '0');
  }
  return '<' + s + '>';
}

export function collectGlyphs(font, strings){
  const used = new Set();
  for (const s of strings) for (const g of glyphsFor(font, s)) used.add(g);
  return used;
}
