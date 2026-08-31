/* Named text styles.
 *
 *   { name, font:'sans'|'mono'|'serif', bold, widthFactor, oblique }
 *
 * A style is what lets a drawing say "all room names are ROMANS at 0.8 width"
 * in one place instead of on every label. The parts modelled here are the
 * ones that change the drawing: the font decides the glyph widths, and the
 * width factor scales them, so both move where a paragraph wraps. Anything
 * that only changes appearance without moving a glyph is left out rather than
 * stored and ignored.
 *
 * Height on a style is a default for new text, never an override: a style
 * that silently resized existing text would rewrite a drawing when someone
 * edits a style they thought was cosmetic.
 */

export const FONTS = ['sans', 'mono', 'serif'];

export const DEFAULT_STYLE = 'STANDARD';

export function makeTextStyle(name, opts){
  const o = opts || {};
  const s = {
    name: String(name || DEFAULT_STYLE).toUpperCase(),
    font: FONTS.indexOf(o.font) >= 0 ? o.font : 'sans',
    widthFactor: Number(o.widthFactor) > 0 ? Number(o.widthFactor) : 1
  };
  if (o.bold) s.bold = true;
  if (Number(o.oblique)) s.oblique = Number(o.oblique);
  if (Number(o.height) > 0) s.height = Number(o.height);
  return s;
}

export function defaultTextStyles(){
  return [
    makeTextStyle('STANDARD', { font: 'sans' }),
    makeTextStyle('ROMANS', { font: 'serif', widthFactor: 0.9 }),
    makeTextStyle('NOTES', { font: 'sans', widthFactor: 0.9, height: 0.5 }),
    makeTextStyle('TITLE', { font: 'sans', bold: true, height: 1 }),
    makeTextStyle('MONO', { font: 'mono' })
  ];
}

export function styleByName(styles, name){
  const list = styles || [];
  const want = String(name || DEFAULT_STYLE).toUpperCase();
  return list.find(s => s.name === want) || list.find(s => s.name === DEFAULT_STYLE) || null;
}

/* The CSS font stack a style draws with on canvas. */
export function fontStack(style){
  const f = style && style.font;
  if (f === 'mono') return 'ui-monospace, SFMono-Regular, Menlo, monospace';
  if (f === 'serif') return 'Georgia, Times New Roman, serif';
  return 'Outfit, system-ui';
}

/* Measurement options for textmetrics: which AFM table to use and how much to
 * scale the advance widths. Keeping this in one place is what stops the wrap
 * on screen drifting from the wrap on paper. */
export function metricsOpts(style){
  if (!style) return {};
  const o = {};
  if (style.bold) o.bold = true;
  if (style.widthFactor && style.widthFactor !== 1) o.widthFactor = style.widthFactor;
  /* A monospace face is wider than Helvetica per glyph on average, and a
   * serif face is close enough to it that the AFM table stands in well. */
  if (style.font === 'mono') o.widthFactor = (o.widthFactor || 1) * 1.06;
  return o;
}

export function validateTextStyles(list){
  if (!Array.isArray(list)) return defaultTextStyles();
  const out = [];
  const seen = new Set();
  for (const s of list){
    if (!s || !s.name) continue;
    const st = makeTextStyle(s.name, s);
    if (seen.has(st.name)) continue;
    seen.add(st.name);
    out.push(st);
  }
  if (!out.some(s => s.name === DEFAULT_STYLE)) out.unshift(makeTextStyle(DEFAULT_STYLE, {}));
  return out;
}

/* ---------- the one place an entity's style is resolved ----------
 * Renderers and exporters look a style up through here so the font that
 * draws and the widths that wrap always come from the same record. The style
 * table is handed in rather than reached for, which keeps this module free of
 * the application state.
 */
export function styleFor(e, styles){
  return styleByName(styles, e && e.style);
}

/* Measurement options for one entity: the style's metrics, plus the canvas
 * context when there is one to measure against. */
export function textOpts(e, styles, ctx, px){
  const o = metricsOpts(styleFor(e, styles));
  if (ctx){
    o.ctx = ctx;
    if (px != null) o.px = px;
    o.family = fontStack(styleFor(e, styles));
    if (styleFor(e, styles) && styleFor(e, styles).bold) o.weight = 600;
  }
  return o;
}
