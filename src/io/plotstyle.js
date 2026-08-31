/* ISO 128 plot lineweights in millimetres, by layer. Used by the PDF writer
 * so an issued 24×36 reads as a construction document, not a screenshot.
 * Entity `lw` (mm) always wins when set.
 */
export const PLOT_LW_MM = {
  WALLS: 0.50,
  DOORS: 0.35,
  FIXTURES: 0.25,
  DIMS: 0.18,
  TEXT: 0.25,
  HATCH: 0.13,
  CENTER: 0.18,
  SCHEDULES: 0.18,
  UNDERLAY: 0.13,
  ROOMS: 0.13,
  GRID: 0.13,
  DEFPOINTS: 0.13,
  SECTION: 0.35,
  GDT: 0.18,
  NOTES: 0.25,
  0: 0.25
};

export const MM_TO_PT = 72 / 25.4;

export function plotLwMm(e){
  if (!e) return 0.25;
  if (e.lw != null && Number(e.lw) > 0) return Number(e.lw);
  const ly = String(e.layer || '').toUpperCase();
  if (e.kind === 'wall' || e.layer === 'WALLS') return PLOT_LW_MM.WALLS;
  if (PLOT_LW_MM[ly] != null) return PLOT_LW_MM[ly];
  return 0.25;
}

export function plotLwPt(e){
  return plotLwMm(e) * MM_TO_PT;
}

/* ---------- named plot style tables ----------
 *
 * A plot style table is the drawing's answer to "how should this print",
 * kept apart from how it looks on screen. The same model plots as a black
 * and white issue set, a screened background for a demolition plan, or a
 * check print, without touching the geometry or the layer colours.
 *
 *   { name, entries: { LAYER: { lw, screen, plot } }, fallback: { lw, screen } }
 *
 * `lw` is millimetres. `screen` is the percent of full tone, the way a CTB
 * expresses it: 100 prints solid, 50 prints half tone, which is how existing
 * or demolished work is shown. `plot: false` keeps a layer off paper while
 * leaving it on screen.
 *
 * The default table reproduces the hardcoded ISO weights exactly, so an
 * existing drawing plots byte for byte as it did before tables existed.
 */

export const FULL_TONE = 100;
/* The ink the writer has always used for a solid line. Screening is measured
 * against it so a 100 percent entry is unchanged rather than merely close. */
export const SOLID_GRAY = 0.08;
export const DIM_GRAY = 0.35;

export function makePlotStyle(name, opts){
  const o = opts || {};
  const t = {
    name: String(name || 'ISO').toUpperCase(),
    entries: {},
    fallback: {
      lw: Number(o.fallbackLw) > 0 ? Number(o.fallbackLw) : 0.25,
      screen: clampScreen(o.fallbackScreen)
    }
  };
  const src = o.entries || {};
  Object.keys(src).forEach(k => {
    const v = src[k] || {};
    const entry = {};
    if (Number(v.lw) > 0) entry.lw = Number(v.lw);
    if (v.screen != null) entry.screen = clampScreen(v.screen);
    if (v.plot === false) entry.plot = false;
    t.entries[String(k).toUpperCase()] = entry;
  });
  return t;
}

function clampScreen(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return FULL_TONE;
  return Math.max(0, Math.min(FULL_TONE, n));
}

function isoEntries(){
  const out = {};
  Object.keys(PLOT_LW_MM).forEach(k => { out[k] = { lw: PLOT_LW_MM[k] }; });
  return out;
}

export function defaultPlotStyles(){
  const iso = makePlotStyle('ISO', { entries: isoEntries() });

  /* Everything at one weight, which is what a quick check print wants. */
  const check = makePlotStyle('CHECK', { fallbackLw: 0.18 });

  /* Background and existing work dropped to half tone so new work reads
   * against it. This is the table a demolition or renovation sheet uses. */
  const screened = makePlotStyle('SCREENED', { entries: Object.assign(isoEntries(), {
    UNDERLAY: { lw: 0.13, screen: 50, plot: true },
    HATCH: { lw: 0.13, screen: 50 },
    GRID: { lw: 0.13, screen: 50 },
    ROOMS: { lw: 0.13, screen: 60 }
  }) });

  return [iso, check, screened];
}

export function plotStyleByName(tables, name){
  const list = tables || [];
  const want = String(name || 'ISO').toUpperCase();
  return list.find(t => t.name === want) || list.find(t => t.name === 'ISO') || null;
}

function entryFor(table, layer){
  if (!table) return null;
  return table.entries[String(layer || '0').toUpperCase()] || null;
}

/* Lineweight in millimetres under a table. An entity lineweight is an
 * override the drafter set by hand and still wins over any table. */
export function styledLwMm(e, table){
  if (!e) return 0.25;
  if (e.lw != null && Number(e.lw) > 0) return Number(e.lw);
  if (!table) return plotLwMm(e);
  const layer = e.kind === 'wall' ? 'WALLS' : e.layer;
  const en = entryFor(table, layer);
  if (en && en.lw > 0) return en.lw;
  return table.fallback.lw;
}

export function styledLwPt(e, table){
  return styledLwMm(e, table) * MM_TO_PT;
}

/* The PDF gray level for an entity. Screening scales the ink toward white,
 * so 100 percent is the solid tone the writer has always used and 0 percent
 * is nothing at all. */
export function styledGray(e, table, isDim){
  const base = isDim ? DIM_GRAY : SOLID_GRAY;
  const en = entryFor(table, e && (e.kind === 'wall' ? 'WALLS' : e.layer));
  const pct = en && en.screen != null ? en.screen : (table ? table.fallback.screen : FULL_TONE);
  if (pct >= FULL_TONE) return base;
  /* Toward paper white as the screen drops. */
  return base + (1 - base) * (1 - pct / FULL_TONE);
}

/* Whether a layer plots at all. The layer's own flag and the table can each
 * hold it back, and either one is enough. */
export function stylePlots(layer, table, layerRec){
  if (layerRec && layerRec.plot === false) return false;
  const en = entryFor(table, layer);
  return !(en && en.plot === false);
}

export function validatePlotStyles(list){
  if (!Array.isArray(list) || !list.length) return defaultPlotStyles();
  const out = [];
  const seen = new Set();
  for (const t of list){
    if (!t || !t.name) continue;
    const st = makePlotStyle(t.name, { entries: t.entries, fallbackLw: t.fallback && t.fallback.lw, fallbackScreen: t.fallback && t.fallback.screen });
    if (seen.has(st.name)) continue;
    seen.add(st.name);
    out.push(st);
  }
  if (!out.some(t => t.name === 'ISO')) out.unshift(makePlotStyle('ISO', { entries: isoEntries() }));
  return out;
}
