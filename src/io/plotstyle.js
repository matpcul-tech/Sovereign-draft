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
