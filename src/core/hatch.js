/* ANSI31 (and similar) hatch generation. A hatch entity is
 *   { type:'hatch', layer, pts:[[x,y],...], pattern:'ANSI31', scale, angle }
 * Pattern lines are generated at draw time so the entity stays compact.
 */
import { dist, pointInPoly, polyArea } from './geometry.js';

/* `paper` is the spacing as it prints, in inches, and is the real definition.
 * `spacing` is the model-space value it works out to at the reference scale
 * below, kept so callers that have no scale to offer behave as before.
 */
export const HATCH_PATTERNS = {
  ANSI31: { angle: 45, spacing: 0.5,  paper: 1 / 8,   name: 'ANSI31' },
  ANSI32: { angle: 45, spacing: 0.35, paper: 0.0875,  name: 'ANSI32' },
  NET:    { angle: 0,  spacing: 0.6,  paper: 0.15, cross: true, name: 'NET' },
  SOLID:  { angle: 0,  spacing: 0,    paper: 0,    solid: true, name: 'SOLID' }
};

/* Paper inches per model foot at 1/4" = 1'-0", the scale the old fixed model
 * spacings were tuned for. Used when a caller supplies no scale. */
export const REFERENCE_SCALE = 0.25;

/* Below this the lines merge into a smear and read as solid fill, so we stop
 * drawing them as lines. */
export const MIN_PAPER_SPACING = 1 / 32;

/* Points per model foot, as the PDF exporter thinks in, to paper inches per
 * model foot. 72 points to the inch. */
export function ppfToScaleFactor(ppf){ return (ppf || 0) / 72; }

/* Canvas pixels per model foot to paper inches per model foot, at 96 dpi. */
export function pxPerFootToScaleFactor(px){ return (px || 0) / 96; }

/* Spacing is authored on paper and converted at plot time. A fixed model
 * spacing collapses at small scales, which is the bug this replaces.
 *   modelSpacing = paperSpacing / scaleFactor
 */
export function paperToModelSpacing(paperInches, scaleFactor){
  const sf = scaleFactor || REFERENCE_SCALE;
  return paperInches / sf;
}

/* What should actually be drawn for this hatch at this scale.
 * Returns { mode: 'lines' | 'tone' | 'none', spacing, paper }.
 */
export function hatchPlan(e, scaleFactor){
  const pat = HATCH_PATTERNS[e && e.pattern] || HATCH_PATTERNS.ANSI31;
  if (pat.solid) return { mode: 'none', spacing: 0, paper: 0 };
  const sf = scaleFactor || REFERENCE_SCALE;
  const userScale = (e && e.scale) || 1;
  const paper = (pat.paper || 0) * userScale;
  if (paper > 0 && paper < MIN_PAPER_SPACING){
    /* Never render hatch that reads as fill. */
    return { mode: 'tone', spacing: paperToModelSpacing(paper, sf), paper };
  }
  return { mode: 'lines', spacing: paperToModelSpacing(paper, sf), paper };
}

function bbox(pts){
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts){
    if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/* Clip an infinite hatch line (point + dir) against a polygon; return segs inside. */
function clipLineToPoly(pts, ox, oy, ux, uy, span){
  const nx = -uy, ny = ux;
  const ts = [];
  const n = pts.length;
  for (let i = 0; i < n; i++){
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const den = ux * dy - uy * dx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
    const u = ((a[0] - ox) * uy - (a[1] - oy) * ux) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < ts.length; i += 2){
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mx = ox + ux * (t0 + t1) / 2, my = oy + uy * (t0 + t1) / 2;
    if (!pointInPoly(mx + nx * 1e-4, my + ny * 1e-4, pts) && !pointInPoly(mx, my, pts)){
      /* Midpoint test; skip if clearly outside. */
      if (!pointInPoly(mx, my, pts)) continue;
    }
    segs.push([[ox + ux * t0, oy + uy * t0], [ox + ux * t1, oy + uy * t1]]);
  }
  void span;
  return segs;
}

export function hatchLines(e, scaleFactor){
  const pts = e.pts; if (!pts || pts.length < 3) return [];
  const pat = HATCH_PATTERNS[e.pattern] || HATCH_PATTERNS.ANSI31;
  if (pat.solid) return [];
  const plan = hatchPlan(e, scaleFactor);
  if (plan.mode !== 'lines') return [];
  const spacing = plan.spacing;
  if (!(spacing > 0)) return [];
  const angle = ((e.angle != null ? e.angle : pat.angle) || 0) * Math.PI / 180;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const nx = -uy, ny = ux;
  const bb = bbox(pts);
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const span = dist(bb[0], bb[1], bb[2], bb[3]) + spacing * 2;
  const out = [];
  const nLines = Math.ceil(span / spacing) + 2;
  for (let i = -nLines; i <= nLines; i++){
    const ox = cx + nx * i * spacing;
    const oy = cy + ny * i * spacing;
    out.push(...clipLineToPoly(pts, ox, oy, ux, uy, span));
  }
  if (pat.cross){
    const ux2 = nx, uy2 = ny, nx2 = -uy2, ny2 = ux2;
    for (let i = -nLines; i <= nLines; i++){
      const ox = cx + nx2 * i * spacing;
      const oy = cy + ny2 * i * spacing;
      out.push(...clipLineToPoly(pts, ox, oy, ux2, uy2, span));
    }
  }
  return out;
}

export function makeHatch(pts, opts){
  opts = opts || {};
  if (!pts || pts.length < 3) return null;
  const clean = pts.map(p => [p[0], p[1]]);
  if (dist(clean[0][0], clean[0][1], clean[clean.length - 1][0], clean[clean.length - 1][1]) < 1e-6) clean.pop();
  if (clean.length < 3) return null;
  return {
    type: 'hatch',
    layer: opts.layer || 'HATCH',
    pts: clean,
    pattern: opts.pattern || 'ANSI31',
    scale: opts.scale || 1,
    angle: opts.angle
  };
}

function circlePoly(e, n){
  n = n || 48;
  const pts = [];
  for (let i = 0; i < n; i++){
    const t = (i / n) * Math.PI * 2;
    pts.push([e.cx + e.r * Math.cos(t), e.cy + e.r * Math.sin(t)]);
  }
  return pts;
}

/* Smallest closed boundary that contains (x, y). Skips hatch entities so a
 * tap inside an existing hatch can cycle its pattern instead of stacking. */
export function boundaryContaining(entities, x, y){
  let best = null, bestArea = Infinity;
  for (const e of entities || []){
    let pts = null;
    if (e.type === 'poly' && e.closed && e.pts && e.pts.length >= 3 && pointInPoly(x, y, e.pts)) pts = e.pts;
    else if (e.type === 'circle' && e.r > 0 && dist(x, y, e.cx, e.cy) <= e.r) pts = circlePoly(e);
    if (!pts) continue;
    const a = Math.abs(polyArea(pts));
    if (a > 1e-6 && a < bestArea){ bestArea = a; best = pts; }
  }
  return best ? best.map(p => [p[0], p[1]]) : null;
}
