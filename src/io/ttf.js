/* TrueType parsing, enough to embed a font in a PDF and measure with it.
 *
 * The PDF writer has only ever embedded the base 14 Helvetica, so the text
 * metrics measure against Helvetica AFM widths to match. That works while
 * every glyph is Latin and the drawing is happy in Helvetica. It does not
 * work for a drawing with Cyrillic, Greek or CJK notes, which plot as the
 * wrong glyphs or as nothing, and it does not work for a firm that draws in
 * its own face.
 *
 * Embedding the real font fixes both, and it makes the metrics honest by
 * construction rather than by keeping two tables in agreement: the widths
 * used to lay text out come from the same font file the plot embeds.
 *
 * This reads only what embedding needs. It does not rasterise, hint, or
 * interpret outlines.
 */

/* Fonts declare what their licence permits in OS/2 fsType. Bit 1 set with no
 * editable or installable bit is "restricted", and embedding one would put a
 * licence violation inside the user's deliverable. */
export const EMBED_RESTRICTED = 0x0002;
export const EMBED_PREVIEW_PRINT = 0x0004;
export const EMBED_EDITABLE = 0x0008;

function rd(dv){
  let p = 0;
  return {
    get pos(){ return p; },
    set pos(v){ p = v; },
    u8(){ return dv.getUint8(p++); },
    u16(){ const v = dv.getUint16(p); p += 2; return v; },
    i16(){ const v = dv.getInt16(p); p += 2; return v; },
    u32(){ const v = dv.getUint32(p); p += 4; return v; },
    tag(){ let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(dv.getUint8(p++)); return s; },
    at(o){ p = o; return this; }
  };
}

function toView(bytes){
  if (bytes instanceof DataView) return bytes;
  if (bytes instanceof ArrayBuffer) return new DataView(bytes);
  if (ArrayBuffer.isView(bytes)) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error('Font must be bytes');
}

function bytesOf(bytes){
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error('Font must be bytes');
}

/* Character to glyph, from the best cmap subtable present. Format 4 covers
 * the basic plane and is universal; format 12 covers everything above it and
 * is what a CJK or emoji capable font uses. */
function readCmap(r, base){
  r.at(base);
  r.u16();                       /* version */
  const n = r.u16();
  let best = null, bestScore = -1;
  for (let i = 0; i < n; i++){
    const platform = r.u16(), encoding = r.u16(), offset = r.u32();
    /* Prefer full Unicode, then BMP Unicode, then Windows symbol. */
    let score = -1;
    if (platform === 3 && encoding === 10) score = 5;
    else if (platform === 0 && encoding >= 4) score = 4;
    else if (platform === 3 && encoding === 1) score = 3;
    else if (platform === 0) score = 2;
    else if (platform === 3 && encoding === 0) score = 1;
    if (score > bestScore){ bestScore = score; best = base + offset; }
  }
  if (best == null) return new Map();

  r.at(best);
  const format = r.u16();
  const map = new Map();

  if (format === 4){
    r.u16(); r.u16();                     /* length, language */
    const segX2 = r.u16();
    const seg = segX2 / 2;
    r.u16(); r.u16(); r.u16();            /* searchRange, entrySelector, rangeShift */
    const end = [], start = [], delta = [], rangeOff = [];
    for (let i = 0; i < seg; i++) end.push(r.u16());
    r.u16();                              /* reservedPad */
    for (let i = 0; i < seg; i++) start.push(r.u16());
    for (let i = 0; i < seg; i++) delta.push(r.i16());
    const rangeBase = r.pos;
    for (let i = 0; i < seg; i++) rangeOff.push(r.u16());
    for (let i = 0; i < seg; i++){
      if (start[i] > end[i]) continue;
      for (let c = start[i]; c <= end[i] && c !== 0x10000; c++){
        let g;
        if (rangeOff[i] === 0){
          g = (c + delta[i]) & 0xffff;
        } else {
          const gi = rangeBase + i * 2 + rangeOff[i] + (c - start[i]) * 2;
          r.at(gi);
          g = r.u16();
          if (g) g = (g + delta[i]) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (format === 12){
    r.u16(); r.u32(); r.u32();            /* reserved, length, language */
    const groups = r.u32();
    for (let i = 0; i < groups; i++){
      const s = r.u32(), e = r.u32(), g = r.u32();
      /* A single group can span a huge range; cap the walk so a broken or
       * hostile font cannot hang the export. */
      const stop = Math.min(e, s + 0xffff);
      for (let c = s; c <= stop; c++) map.set(c, g + (c - s));
    }
  } else if (format === 6){
    r.u16(); r.u16();
    const first = r.u16(), count = r.u16();
    for (let i = 0; i < count; i++) map.set(first + i, r.u16());
  } else if (format === 0){
    r.u16(); r.u16();
    for (let c = 0; c < 256; c++) map.set(c, r.u8());
  }
  return map;
}

/* Parse a TTF or an OpenType file with TrueType outlines. */
export function parseTTF(bytes){
  const dv = toView(bytes);
  const raw = bytesOf(bytes);
  const r = rd(dv);

  const sfnt = r.u32();
  /* 0x00010000 is TrueType, 'true' is an old Apple tag, 'OTTO' is CFF
   * outlines which this cannot embed as a TrueType font. */
  if (sfnt === 0x4f54544f) throw new Error('OpenType CFF fonts are not supported, use a TrueType font');
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) throw new Error('Not a TrueType font');

  const numTables = r.u16();
  r.u16(); r.u16(); r.u16();
  const tables = {};
  for (let i = 0; i < numTables; i++){
    const tag = r.tag();
    r.u32();
    const offset = r.u32(), length = r.u32();
    tables[tag] = { offset, length };
  }
  const need = ['head', 'hhea', 'hmtx', 'maxp', 'cmap'];
  for (const t of need) if (!tables[t]) throw new Error('Font is missing its ' + t + ' table');

  r.at(tables.head.offset + 18);
  const unitsPerEm = r.u16();
  r.at(tables.head.offset + 36);
  const xMin = r.i16(), yMin = r.i16(), xMax = r.i16(), yMax = r.i16();
  r.at(tables.head.offset + 50);
  const indexToLocFormat = r.i16();

  r.at(tables.hhea.offset + 4);
  const ascender = r.i16(), descender = r.i16();
  r.at(tables.hhea.offset + 34);
  const numberOfHMetrics = r.u16();

  r.at(tables.maxp.offset + 4);
  const numGlyphs = r.u16();

  /* Advance widths. After numberOfHMetrics entries the last width repeats,
   * which is how a monospaced tail is stored compactly. */
  const advance = new Uint16Array(numGlyphs);
  r.at(tables.hmtx.offset);
  let last = 0;
  for (let i = 0; i < numGlyphs; i++){
    if (i < numberOfHMetrics){ last = r.u16(); r.i16(); }
    advance[i] = last;
  }

  let italicAngle = 0;
  if (tables.post){
    r.at(tables.post.offset + 4);
    italicAngle = r.i16() + r.u16() / 65536;
  }

  let fsType = 0, capHeight = 0, typoAscender = ascender, typoDescender = descender;
  if (tables['OS/2']){
    const o = tables['OS/2'].offset;
    r.at(o);
    const version = r.u16();
    r.at(o + 8);
    fsType = r.u16();
    r.at(o + 68);
    typoAscender = r.i16();
    typoDescender = r.i16();
    if (version >= 2 && tables['OS/2'].length >= 90){
      r.at(o + 88);
      capHeight = r.i16();
    }
  }

  const cmap = readCmap(r, tables.cmap.offset);

  let name = 'EmbeddedFont';
  if (tables.name){
    const found = readName(r, tables.name.offset);
    if (found) name = found;
  }

  return {
    raw,
    tables,
    unitsPerEm: unitsPerEm || 1000,
    numGlyphs,
    advance,
    cmap,
    name,
    italicAngle,
    fsType,
    indexToLocFormat,
    bbox: [xMin, yMin, xMax, yMax],
    ascender: typoAscender || ascender,
    descender: typoDescender || descender,
    capHeight: capHeight || Math.round((ascender || 0) * 0.7)
  };
}

/* PostScript name, which is what the PDF font descriptor wants. */
function readName(r, base){
  r.at(base);
  r.u16();
  const count = r.u16(), stringOffset = r.u16();
  let best = null;
  for (let i = 0; i < count; i++){
    const platform = r.u16(), encoding = r.u16();
    r.u16();
    const nameId = r.u16(), length = r.u16(), offset = r.u16();
    if (nameId !== 6) continue;
    const at = base + stringOffset + offset;
    const save = r.pos;
    r.at(at);
    let s = '';
    if (platform === 3){
      for (let k = 0; k < length; k += 2) s += String.fromCharCode(r.u16());
    } else {
      for (let k = 0; k < length; k++) s += String.fromCharCode(r.u8());
    }
    r.at(save);
    if (s) { best = s; break; }
  }
  return best;
}

export function embeddingAllowed(font){
  /* Restricted means no embedding at all. Everything else permits at least
   * preview and print, which is what a plotted drawing is. */
  return !(font && (font.fsType & EMBED_RESTRICTED) &&
    !(font.fsType & (EMBED_PREVIEW_PRINT | EMBED_EDITABLE)));
}

export function glyphFor(font, ch){
  const code = typeof ch === 'number' ? ch : ch.codePointAt(0);
  return font.cmap.get(code) || 0;
}

/* Glyph ids for a string, surrogate pairs handled as one code point so an
 * emoji or a rare CJK character maps to its own glyph rather than two. */
export function glyphsFor(font, str){
  const out = [];
  for (const ch of String(str == null ? '' : str)) out.push(glyphFor(font, ch));
  return out;
}

/* Advance width in the PDF's 1000 unit em, which is what /W and every text
 * measurement below expect. */
export function glyphWidth1000(font, gid){
  const a = font.advance[gid] || 0;
  return Math.round(a * 1000 / font.unitsPerEm);
}

/* Width of a string at a given size, in the same units as size. This is the
 * measurement the layout uses, and it comes from the font that gets
 * embedded, so the wrap on paper is the wrap that was measured. */
export function ttfWidth(font, str, size){
  let units = 0;
  for (const g of glyphsFor(font, str)) units += glyphWidth1000(font, g);
  return units / 1000 * (size || 0);
}

/* Which code points a font has no glyph for. A caller that plots text the
 * font cannot draw should know before the PDF is written, not after. */
export function missingGlyphs(font, str){
  const out = new Set();
  for (const ch of String(str == null ? '' : str)){
    if (ch === '\n' || ch === '\r') continue;
    if (!font.cmap.get(ch.codePointAt(0))) out.add(ch);
  }
  return [...out];
}
