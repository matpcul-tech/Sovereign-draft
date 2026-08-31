/* Paragraph text: a block that wraps to a width instead of running off the
 * sheet.
 *
 *   { type:'mtext', layer, x, y, size, width, content, style, just, rot,
 *     lineSpacing }
 *
 * Every general note, code reference and revision description on a real
 * drawing is a paragraph. Until now the program had single line text only,
 * so an imported MTEXT was flattened to one long run-on line with its breaks
 * turned into spaces, and there was no way to author a wrapped note at all.
 *
 * Wrapping uses the same metrics the PDF writer uses to place glyphs, so a
 * block breaks in the same places on screen and on paper. A wrap that only
 * looks right in one of the two is worse than no wrapping.
 *
 * `x, y` is the attachment point, and `just` says which corner of the block
 * that is, in the DXF sense: TL TC TR ML MC MR BL BC BR.
 */
import { textWidth } from './textmetrics.js';

export const DEFAULT_LINE_SPACING = 1.5;   /* of text height, as DXF does it */
export const JUSTIFY = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];
export const DEFAULT_JUSTIFY = 'TL';

export function makeMText(content, opts){
  const o = opts || {};
  const e = {
    type: 'mtext',
    layer: o.layer || 'NOTES',
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    size: Number(o.size) > 0 ? Number(o.size) : 1,
    content: String(content == null ? '' : content),
    just: JUSTIFY.indexOf(o.just) >= 0 ? o.just : DEFAULT_JUSTIFY
  };
  if (Number(o.width) > 0) e.width = Number(o.width);
  if (o.style) e.style = String(o.style);
  if (o.rot) e.rot = Number(o.rot) || 0;
  if (o.lineSpacing && o.lineSpacing > 0) e.lineSpacing = Number(o.lineSpacing);
  if (o.lt) e.lt = o.lt;
  if (o.lw != null) e.lw = o.lw;
  return e;
}

export function lineSpacingOf(e){
  return (e && e.lineSpacing > 0 ? e.lineSpacing : DEFAULT_LINE_SPACING) * (e ? e.size : 1);
}

function widthOf(str, size, opts){
  return textWidth(str, size, opts);
}

/* Break one paragraph to a width. A word longer than the whole column is cut
 * rather than allowed to overhang, because a note that runs off the sheet is
 * not a note. */
function wrapParagraph(para, size, width, opts){
  if (!width || width <= 0) return [para];
  const words = para.split(/ +/);
  const lines = [];
  let line = '';
  const fits = s => widthOf(s, size, opts) <= width;

  const breakLongWord = word => {
    let rest = word;
    while (rest.length > 1 && !fits(rest)){
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return rest;
  };

  for (let w of words){
    if (w === '') continue;
    if (!line){
      if (!fits(w)) w = breakLongWord(w);
      line = w;
      continue;
    }
    const merged = line + ' ' + w;
    if (fits(merged)){ line = merged; continue; }
    lines.push(line);
    if (!fits(w)) w = breakLongWord(w);
    line = w;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/* The block as laid out lines. Explicit breaks always break; the width only
 * decides where a paragraph wraps on top of that. */
export function mtextLines(e, opts){
  if (!e) return [];
  const paras = String(e.content == null ? '' : e.content).split(/\r\n|\r|\n/);
  const out = [];
  for (const p of paras) wrapParagraph(p, e.size, e.width, opts).forEach(l => out.push(l));
  return out;
}

export function mtextBlockWidth(e, opts){
  const lines = mtextLines(e, opts);
  let w = 0;
  for (const l of lines) w = Math.max(w, widthOf(l, e.size, opts));
  /* An explicit column width is the block's width even when no line fills
   * it, so a centred block does not shift as its text is edited. */
  return e.width > 0 ? Math.max(w, e.width) : w;
}

export function mtextBlockHeight(e, opts){
  const n = mtextLines(e, opts).length;
  if (!n) return 0;
  return e.size + (n - 1) * lineSpacingOf(e);
}

function rotate(px, py, cx, cy, deg){
  if (!deg) return [px, py];
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/* Each line placed in model space: position, the text, and the width it
 * occupies. Positions are baselines with the anchor already applied, so a
 * renderer or exporter only has to draw. */
export function mtextLayout(e, opts){
  const lines = mtextLines(e, opts);
  if (!lines.length) return [];
  const lead = lineSpacingOf(e);
  const blockW = mtextBlockWidth(e, opts);
  const blockH = mtextBlockHeight(e, opts);
  const j = JUSTIFY.indexOf(e.just) >= 0 ? e.just : DEFAULT_JUSTIFY;
  const vert = j[0], horiz = j[1];

  /* Top of the block relative to the attachment point. */
  const top = vert === 'T' ? 0 : vert === 'M' ? blockH / 2 : blockH;
  const left = horiz === 'L' ? 0 : horiz === 'C' ? -blockW / 2 : -blockW;

  return lines.map((text, i) => {
    const w = widthOf(text, e.size, opts);
    const indent = horiz === 'L' ? 0 : horiz === 'C' ? (blockW - w) / 2 : (blockW - w);
    /* Baseline sits one cap height below the top of its own line. */
    const ly = e.y + top - i * lead - e.size;
    const lx = e.x + left + indent;
    const p = rotate(lx, ly, e.x, e.y, e.rot || 0);
    return { x: p[0], y: p[1], text, width: w, line: i };
  });
}

/* The four corners of the block, rotation included. Used for bounding boxes
 * and hit testing, which both need the real footprint rather than the
 * anchor point. */
export function mtextCorners(e, opts){
  const blockW = mtextBlockWidth(e, opts);
  const blockH = mtextBlockHeight(e, opts);
  const j = JUSTIFY.indexOf(e.just) >= 0 ? e.just : DEFAULT_JUSTIFY;
  const top = j[0] === 'T' ? 0 : j[0] === 'M' ? blockH / 2 : blockH;
  const left = j[1] === 'L' ? 0 : j[1] === 'C' ? -blockW / 2 : -blockW;
  const x0 = e.x + left, y1 = e.y + top, x1 = x0 + blockW, y0 = y1 - blockH;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => rotate(p[0], p[1], e.x, e.y, e.rot || 0));
}

/* A paragraph block reduces to single line text entities for everything that
 * can only draw one line at a time. */
export function mtextToTexts(e, opts){
  return mtextLayout(e, opts).map(l => ({
    type: 'text',
    layer: e.layer,
    x: l.x,
    y: l.y,
    size: e.size,
    content: l.text,
    rot: e.rot || 0,
    style: e.style,
    lt: e.lt,
    lw: e.lw
  }));
}

/* ---------- DXF MTEXT content coding ----------
 * DXF wraps paragraph text in its own inline formatting language. The parts
 * that carry meaning here are \P for a line break and \~ for a hard space;
 * the rest is font and colour switching this program does not model, so it
 * is dropped rather than shown to the user as literal escape codes.
 *
 * A single scan rather than a chain of replaces, because the escaped forms
 * of the very characters the formatting uses have to be taken out of play
 * before the formatting is read, and passing over the string once is the
 * only way to do that without placeholders.
 */
export function decodeMText(s){
  const src = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < src.length; i++){
    const c = src[i];
    if (c === '{' || c === '}') continue;         /* grouping, not content */
    if (c !== '\\'){ out += c; continue; }
    const n = src[i + 1];
    if (n === undefined) break;
    /* An escaped literal is content, and must not be read as a code. */
    if (n === '\\' || n === '{' || n === '}'){ out += n; i++; continue; }
    if (n === 'P'){ out += '\n'; i++; continue; }
    if (n === '~'){ out += ' '; i++; continue; }
    if (n === 'S'){
      /* A stacked fraction: keep both parts, drop the stacking. */
      const end = src.indexOf(';', i + 2);
      const body = end < 0 ? src.slice(i + 2) : src.slice(i + 2, end);
      out += body.replace(/[\^#]/g, '/');
      i = end < 0 ? src.length : end;
      continue;
    }
    if (/[A-Za-z]/.test(n)){
      /* Any other code runs to its semicolon, or to the next character when
       * it takes no argument. */
      const end = src.indexOf(';', i + 2);
      const nl = src.indexOf('\\', i + 2);
      if (end >= 0 && (nl < 0 || end < nl)) i = end;
      else i++;
      continue;
    }
    out += n; i++;
  }
  /* Trailing blanks on a line are invisible and only cause diff noise. */
  return out.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
}

export function encodeMText(s){
  let t = String(s == null ? '' : s);
  t = t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  return t.replace(/\r\n|\r|\n/g, '\\P');
}

/* DXF attachment point codes, group 71. */
export const ATTACH_CODES = { TL: 1, TC: 2, TR: 3, ML: 4, MC: 5, MR: 6, BL: 7, BC: 8, BR: 9 };
export function attachCode(just){ return ATTACH_CODES[just] || ATTACH_CODES[DEFAULT_JUSTIFY]; }
export function justFromCode(n){
  const k = Object.keys(ATTACH_CODES).find(j => ATTACH_CODES[j] === Number(n));
  return k || DEFAULT_JUSTIFY;
}

export function translateMText(e, dx, dy){
  e.x += dx; e.y += dy;
  return e;
}
