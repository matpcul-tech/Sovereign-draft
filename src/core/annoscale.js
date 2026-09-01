/* Annotative text: height that means paper, not model.
 *
 * Ordinary text stores a model-space height, so plotting the same drawing at
 * 1/8" and 1/4" prints the notes at two different sizes and one of them is
 * wrong. An annotative entity stores its height in paper inches, the unit a
 * drafter actually specifies (3/32" notes, 1/8" titles), and every consumer
 * converts:
 *
 *   on the sheet    height in points = size * 72, whatever the scale
 *   in model space  height in feet   = size * 72 / annoPpf
 *
 * annoPpf is the drawing's working scale in points per foot (18 is 1/4" =
 * 1'-0"), so what you see in model space is what the sheet will read at
 * that scale, and changing the working scale re-sizes every annotative
 * entity on screen without touching any of them.
 */

export const DEFAULT_ANNO_PPF = 18;   /* 1/4" = 1'-0" */

/* The model-space height a consumer should draw at. Not annotative means
 * the stored size already is the model height. */
export function effTextSize(e, annoPpf){
  if (!e || !e.anno) return e ? e.size : 0;
  return (e.size || 0) * 72 / (annoPpf > 0 ? annoPpf : DEFAULT_ANNO_PPF);
}

/* The height in points on paper. Annotative is exact by definition; plain
 * text scales with the viewport like the geometry it labels. */
export function paperTextPts(e, ppf){
  if (e && e.anno) return (e.size || 0) * 72;
  return Math.max(((e && e.size) || 0) * (ppf || 0), 4);
}

/* Flip an entity to annotative at the current working scale without a
 * visible jump: the paper height that reproduces today's model height. */
export function toAnno(e, annoPpf){
  if (!e || e.anno) return e;
  const ppf = annoPpf > 0 ? annoPpf : DEFAULT_ANNO_PPF;
  e.size = (e.size || 0) * ppf / 72;
  e.anno = true;
  return e;
}

export function fromAnno(e, annoPpf){
  if (!e || !e.anno) return e;
  const ppf = annoPpf > 0 ? annoPpf : DEFAULT_ANNO_PPF;
  e.size = (e.size || 0) * 72 / ppf;
  delete e.anno;
  return e;
}

/* "1/4" or "3/8" or "1" as an architectural scale: that many inches of
 * paper per foot of model. A bare number over 3 is taken as ppf directly. */
export function parseScaleToPpf(text){
  const t = String(text == null ? '' : text).trim().replace(/"/g, '');
  if (!t) return null;
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac){
    const v = Number(frac[1]) / Number(frac[2]);
    return v > 0 ? v * 72 : null;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 3 ? n : n * 72;
}
