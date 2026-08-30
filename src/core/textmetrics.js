/* One text measurement path for every consumer.
 *
 * A label box used to be sized with a per-character estimate while the
 * renderer drew with real font metrics, so the box was narrower than the text
 * and clipped it. Everything that needs a width now calls in here and gets the
 * same number the drawing code will use.
 *
 * Canvas: measureText with the exact composed font string used at draw time.
 * PDF: the Adobe AFM advance widths for the Type1 base fonts the exporter
 * actually embeds (Helvetica and Helvetica-Bold), never an estimate.
 */

export const CANVAS_FONT_STACK = 'Outfit, system-ui';

/* The exact string assigned to ctx.font at draw time. Measuring with anything
 * else is what produced the clipped labels. */
export function composeFont(px, weight){
  return (weight ? weight + ' ' : '') + px + 'px ' + CANVAS_FONT_STACK;
}

/* Adobe AFM advance widths, 1/1000 em. */
const HELVETICA = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584
};

const HELVETICA_BOLD = {
  ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611,
  '@': 975, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, '_': 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  '{': 389, '|': 280, '}': 389, '~': 584
};

/* Widest glyph in the table, used for characters outside it so an unknown
 * character can only ever make the box too wide, never too narrow. */
const HELV_FALLBACK = 1015;

/* True advance width in the same units as `size`, using the metrics of the
 * font the PDF exporter embeds. */
export function helveticaWidth(str, size, bold){
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++){
    const w = table[s[i]];
    units += (w == null ? HELV_FALLBACK : w);
  }
  return units / 1000 * (size || 0);
}

/* Measure on a canvas with the exact draw-time font. Restores ctx.font. */
export function canvasWidth(str, px, ctx, weight){
  if (!ctx || typeof ctx.measureText !== 'function') return null;
  const prev = ctx.font;
  ctx.font = composeFont(px, weight);
  const w = ctx.measureText(String(str == null ? '' : str)).width;
  ctx.font = prev;
  return w;
}

/* The measured width. Pass a canvas context to measure what the screen will
 * draw; without one the AFM metrics stand in, which is what the PDF draws.
 */
export function textWidth(str, size, opts){
  const o = opts || {};
  if (o.ctx){
    const px = o.px == null ? size : o.px;
    const w = canvasWidth(str, px, o.ctx, o.weight);
    if (w != null && isFinite(w)) return o.px == null ? w : w * (size / px);
  }
  return helveticaWidth(str, size, !!o.bold);
}

/* Padding is added, never subtracted. A box is allowed to be roomy; it is
 * never allowed to clip. */
export const BOX_PAD_FRACTION = 0.06;
export const BOX_PAD_ABSOLUTE = 0.25;

export function boxWidth(str, size, opts){
  const w = textWidth(str, size, opts);
  return w * (1 + BOX_PAD_FRACTION) + (size || 0) * BOX_PAD_ABSOLUTE;
}
