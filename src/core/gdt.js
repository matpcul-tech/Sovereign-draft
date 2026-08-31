/* Geometric dimensioning and tolerancing.
 *
 * Feature control frames, datum features and surface-finish marks expand to
 * ordinary lines + text so hit testing, PDF, DXF and SVG need no extra branch.
 * Tolerances on linear dims live on the dim itself (tolPlus / tolMinus) and
 * are rendered by dimLabel.
 *
 * This is inspection GD&T on a 2D sheet, not a CAM package. A frame without a
 * tolerance is refused. Materials and grades are never invented here.
 */
import { fmtFtIn } from './format.js';
import { boxWidth } from './textmetrics.js';

export const FCF_CHARS = {
  position:        { code: 'POS',  glyph: 'POS' },
  perpendicularity:{ code: 'PERP', glyph: 'PERP' },
  parallelism:     { code: 'PARA', glyph: 'PARA' },
  flatness:        { code: 'FLAT', glyph: 'FLAT' },
  straightness:    { code: 'STR',  glyph: 'STR' },
  circularity:     { code: 'CIRC', glyph: 'CIRC' },
  cylindricity:    { code: 'CYL',  glyph: 'CYL' },
  concentricity:   { code: 'CONC', glyph: 'CONC' },
  runout:          { code: 'RUN',  glyph: 'RUN' },
  profile:         { code: 'PROF', glyph: 'PROF' },
  angularity:      { code: 'ANG',  glyph: 'ANG' }
};

export const FCF_CHAR_LIST = Object.keys(FCF_CHARS);

export function normalizeChar(v){
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (FCF_CHARS[s]) return s;
  const hit = FCF_CHAR_LIST.find(k => FCF_CHARS[k].code.toLowerCase() === s);
  return hit || 'position';
}

export function parseTol(v){
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v) && v > 0) return v;
  const n = Number(v);
  if (isFinite(n) && n > 0) return n;
  /* 0.01, .01, 1/32, 0.5mm — dimLabel / fmtFtIn take feet. */
  const mm = String(v).match(/^([\d.]+)\s*mm$/i);
  if (mm) return Number(mm[1]) / 304.8;
  return null;
}

export function fcfCells(e){
  const ch = FCF_CHARS[normalizeChar(e && e.char)];
  const cells = [ch.code];
  const tol = parseTol(e && e.tol);
  if (tol == null) return null;
  cells.push((e && e.dia ? 'DIA ' : '') + fmtFtIn(tol));
  const refs = Array.isArray(e && e.datums) ? e.datums : (e && e.datum ? [e.datum] : []);
  refs.forEach(d => {
    const L = String(d || '').trim().toUpperCase().slice(0, 2);
    if (L) cells.push(L);
  });
  return cells;
}

export function makeFcf(opts){
  const o = opts || {};
  const char = normalizeChar(o.char);
  const tol = parseTol(o.tol);
  if (tol == null) return null;
  const datums = Array.isArray(o.datums) ? o.datums.map(d => String(d || '').toUpperCase().slice(0, 2)).filter(Boolean)
    : (o.datum ? [String(o.datum).toUpperCase().slice(0, 2)] : []);
  const x = o.x != null ? o.x : (o.at && o.at[0]) || 0;
  const y = o.y != null ? o.y : (o.at && o.at[1]) || 0;
  const e = {
    type: 'fcf',
    layer: o.layer || 'GDT',
    x, y,
    char,
    tol,
    dia: !!o.dia,
    h: o.h || 0.55
  };
  if (datums.length) e.datums = datums;
  if (o.anchor) e.anchor = o.anchor;
  return e;
}

export function makeDatum(opts){
  const o = opts || {};
  const letter = String(o.letter || o.tag || 'A').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'A';
  return {
    type: 'datum',
    layer: o.layer || 'GDT',
    x: o.x != null ? o.x : (o.at && o.at[0]) || 0,
    y: o.y != null ? o.y : (o.at && o.at[1]) || 0,
    letter,
    h: o.h || 0.55
  };
}

export function makeFinish(opts){
  const o = opts || {};
  const e = {
    type: 'finish',
    layer: o.layer || 'GDT',
    x: o.x != null ? o.x : (o.at && o.at[0]) || 0,
    y: o.y != null ? o.y : (o.at && o.at[1]) || 0,
    h: o.h || 0.5
  };
  if (o.roughness != null && String(o.roughness).trim()) e.roughness = String(o.roughness).trim();
  return e;
}

export function nextDatumLetter(entities){
  const used = new Set();
  (entities || []).forEach(e => {
    if (e && e.type === 'datum' && e.letter) used.add(String(e.letter).toUpperCase());
  });
  for (let i = 0; i < 26; i++){
    const L = String.fromCharCode(65 + i);
    if (!used.has(L)) return L;
  }
  return 'Z';
}

function boxPoly(x, y, w, h){
  return { type: 'poly', closed: true, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
}

export function expandFcf(e){
  const cells = fcfCells(e);
  if (!cells) return [];
  const h = e.h || 0.55;
  const pad = h * 0.22;
  const widths = cells.map(c => Math.max(h * 1.35, boxWidth(c, h * 0.72) + pad * 2));
  const out = [];
  let x = e.x;
  const y = e.y;
  cells.forEach((c, i) => {
    const w = widths[i];
    const box = boxPoly(x, y, w, h);
    box.layer = e.layer;
    box.lw = e.lw;
    out.push(box);
    out.push({
      type: 'text',
      layer: e.layer,
      x: x + pad,
      y: y + h * 0.22,
      size: h * 0.72,
      content: c
    });
    x += w;
  });
  if (e.anchor && Array.isArray(e.anchor) && e.anchor.length >= 2){
    out.unshift({
      type: 'poly',
      closed: false,
      layer: e.layer,
      pts: [[e.anchor[0], e.anchor[1]], [e.x, e.y + h / 2]]
    });
  }
  return out;
}

export function expandDatum(e){
  const h = e.h || 0.55;
  const w = h * 1.15;
  const x = e.x, y = e.y;
  const box = boxPoly(x, y, w, h);
  box.layer = e.layer;
  const tri = {
    type: 'poly',
    closed: true,
    layer: e.layer,
    pts: [[x + w / 2, y], [x + w / 2 - h * 0.35, y - h * 0.55], [x + w / 2 + h * 0.35, y - h * 0.55]]
  };
  const txt = {
    type: 'text',
    layer: e.layer,
    x: x + h * 0.22,
    y: y + h * 0.22,
    size: h * 0.72,
    content: String(e.letter || 'A')
  };
  return [tri, box, txt];
}

export function expandFinish(e){
  const h = e.h || 0.5;
  const x = e.x, y = e.y;
  /* Check-mark surface-finish symbol (ISO 1302 simplified). */
  const stem = {
    type: 'poly',
    closed: false,
    layer: e.layer,
    pts: [[x, y], [x + h * 0.35, y + h], [x + h * 0.9, y + h * 0.15]]
  };
  const out = [stem];
  if (e.roughness){
    out.push({
      type: 'text',
      layer: e.layer,
      x: x + h * 0.45,
      y: y + h * 1.1,
      size: h * 0.55,
      content: String(e.roughness)
    });
  }
  return out;
}

export function expandGdt(e){
  if (!e) return [];
  if (e.type === 'fcf') return expandFcf(e);
  if (e.type === 'datum') return expandDatum(e);
  if (e.type === 'finish') return expandFinish(e);
  return [e];
}

export const GDT_TYPES = ['fcf', 'datum', 'finish'];
export function isGdt(e){ return !!e && GDT_TYPES.indexOf(e.type) >= 0; }
