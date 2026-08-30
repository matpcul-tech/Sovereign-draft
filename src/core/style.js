/* Linetypes (ISO/AutoCAD names) and ISO lineweights in millimetres.
 * Dash patterns are in world feet, scaled by view so they stay readable.
 */

export const LINETYPES = {
  CONTINUOUS: { name: 'CONTINUOUS', dashes: [] },
  DASHED:     { name: 'DASHED',     dashes: [0.5, 0.25] },
  HIDDEN:     { name: 'HIDDEN',     dashes: [0.25, 0.15] },
  CENTER:     { name: 'CENTER',     dashes: [1.0, 0.2, 0.15, 0.2] },
  PHANTOM:    { name: 'PHANTOM',    dashes: [1.2, 0.2, 0.15, 0.2, 0.15, 0.2] },
  DOT:        { name: 'DOT',        dashes: [0.02, 0.18] },
  DIVIDE:     { name: 'DIVIDE',     dashes: [0.8, 0.2, 0.08, 0.2, 0.08, 0.2] },
  BORDER:     { name: 'BORDER',     dashes: [0.6, 0.2, 0.15, 0.2] }
};

export const LTYPE_NAMES = Object.keys(LINETYPES);

/* ISO 128 millimetre lineweights. 0 = default (by layer). */
export const LINEWEIGHTS_MM = [0, 0.13, 0.18, 0.25, 0.35, 0.50, 0.70, 1.00];

export function ltypeOf(e){
  const n = (e && e.lt) ? String(e.lt).toUpperCase() : 'CONTINUOUS';
  return LINETYPES[n] || LINETYPES.CONTINUOUS;
}

/* Convert millimetre lineweight to canvas pixels at the current scale.
 * 1 mm on a 1/4"=1'-0" plot is ~2.8 px at a typical on-screen ppf of ~20.
 * We treat 0.25 mm as the "default" 1.5 px stroke.
 */
export function lwToPx(lw, scl){
  const mm = lw == null ? 0.25 : Number(lw);
  if (!mm) return Math.max(1, scl ? 1.2 : 1.5);
  return Math.max(0.7, (mm / 0.25) * 1.4);
}

export function dashFor(e, scl){
  const lt = ltypeOf(e);
  if (!lt.dashes.length) return [];
  const s = Math.max(scl || 20, 4);
  return lt.dashes.map(d => Math.max(1.5, d * s));
}

export function fmtLw(mm){
  if (!mm) return 'Default';
  return Number(mm).toFixed(2) + ' mm';
}
