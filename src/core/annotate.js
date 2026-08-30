/* Annotation policy and placement.
 *
 * A drawing type decides what annotation is even legal. The gate lives here,
 * in code, so a model that ignores the system prompt still cannot put a door
 * swing on an elevation or a square-foot tag on a rocket.
 */
import { polyArea, pointInPoly, dist } from './geometry.js';
import { textWidth, boxWidth } from './textmetrics.js';

/* Per drawing type: what the annotation pass is allowed to emit.
 *   areaTags     square-foot tags
 *   doorSwings   door leaf plus swing arc
 *   impliedHatch hatch derived from geometry rather than an explicit region
 *   roomLabels   room name text
 *   callouts     leader plus boxed label
 *   dims         dimensions by default
 *   building     wall / door / window entities may exist at all
 */
export const ANNOTATION_RULES = {
  plan:      { areaTags: true,  doorSwings: true,  impliedHatch: true,  roomLabels: true,  callouts: false, dims: true,  building: true },
  elevation: { areaTags: false, doorSwings: false, impliedHatch: false, roomLabels: false, callouts: true,  dims: true,  building: false },
  section:   { areaTags: false, doorSwings: true,  impliedHatch: false, roomLabels: false, callouts: true,  dims: true,  building: true },
  part:      { areaTags: false, doorSwings: false, impliedHatch: false, roomLabels: false, callouts: true,  dims: true,  building: false },
  diagram:   { areaTags: false, doorSwings: false, impliedHatch: false, roomLabels: false, callouts: true,  dims: false, building: false }
};

export function rulesFor(drawingType){
  return ANNOTATION_RULES[drawingType] || ANNOTATION_RULES.plan;
}

/* An implied fill is one the drawing type did not ask for: a profile that
 * carries a fill style, or hatch derived from geometry. Only an explicit
 * hatchRegion may put a fill on an elevation or a part.
 */
export function impliedFillAllowed(drawingType){ return rulesFor(drawingType).impliedHatch; }

/* Throws when a fill slipped through that the drawing type forbids. Explicit
 * hatchRegion entities are always allowed; they were asked for by name. */
export function assertNoImpliedFill(entities, drawingType){
  if (impliedFillAllowed(drawingType)) return true;
  const offenders = (entities || []).filter(e =>
    (e.type === 'profile' && e.fill) ||
    (e.type === 'hatch' && !e.explicit)
  );
  if (offenders.length){
    throw new Error('implied fill on a ' + drawingType + ': ' + offenders.length + ' entity(s)');
  }
  return true;
}

/* Only a plan reports floor area. */
export function reportsArea(drawingType){ return rulesFor(drawingType).areaTags; }

/* Shoelace area of a closed polygon. Never a bounding box, so two shapes with
 * the same extents still report different areas.
 */
export function polygonArea(pts){ return Math.abs(polyArea(pts || [])); }

/* ---------- dimension chains ---------- */

export const DISPLAY_UNIT = 1 / 24; /* half an inch, in feet */

/* The overall is the sum of the emitted segments. It is never measured from a
 * separate extent, which is how a chain drifts away from its own total.
 */
export function chainOverall(lengths){
  return (lengths || []).reduce((s, v) => s + (Number(v) || 0), 0);
}

/* Carry full precision through the chain and round only for display, letting
 * the final segment absorb the rounding remainder so the chain always closes.
 * Returns { overall, display, corrected, drift }.
 */
export function closeChain(lengths, unit){
  const u = unit || DISPLAY_UNIT;
  const src = (lengths || []).map(v => Number(v) || 0);
  const overall = chainOverall(src);
  if (!src.length) return { overall: 0, display: [], corrected: false, drift: 0 };
  const display = src.map(v => Math.round(v / u) * u);
  const before = chainOverall(display);
  const drift = overall - before;
  let corrected = false;
  if (Math.abs(drift) > 1e-9){
    display[display.length - 1] = display[display.length - 1] + drift;
    corrected = true;
  }
  const after = chainOverall(display);
  if (Math.abs(overall - after) > u){
    /* Should be unreachable: the last segment absorbs the whole remainder. */
    console.warn('[annotate] dim chain did not close', { overall, after });
  }
  return { overall, display, corrected, drift };
}

/* Group dim segments into axis-aligned chains, then close each one. Segments
 * are {a:[x,y], b:[x,y]}. Returns the same list with lengths reconciled.
 */
export function closeDimChains(segs, unit){
  const out = (segs || []).map(s => Object.assign({}, s));
  const horiz = out.filter(s => Math.abs(s.a[1] - s.b[1]) < 1e-6);
  const vert = out.filter(s => Math.abs(s.a[0] - s.b[0]) < 1e-6);
  [['x', horiz, 0], ['y', vert, 1]].forEach(([, group, axis]) => {
    const byRow = {};
    group.forEach(s => {
      const key = (axis === 0 ? s.a[1] : s.a[0]).toFixed(4);
      (byRow[key] = byRow[key] || []).push(s);
    });
    Object.keys(byRow).forEach(k => {
      const row = byRow[k];
      if (row.length < 2) return;
      row.sort((p, q) => Math.min(p.a[axis], p.b[axis]) - Math.min(q.a[axis], q.b[axis]));
      const lengths = row.map(s => Math.abs(s.b[axis] - s.a[axis]));
      const res = closeChain(lengths, unit);
      let cursor = Math.min(row[0].a[axis], row[0].b[axis]);
      row.forEach((s, i) => {
        const len = res.display[i];
        const lo = cursor, hi = cursor + len;
        if (s.a[axis] <= s.b[axis]){ s.a[axis] = lo; s.b[axis] = hi; }
        else { s.a[axis] = hi; s.b[axis] = lo; }
        cursor = hi;
      });
      row.forEach(s => { s.chainOverall = res.overall; });
    });
  });
  return out;
}

/* ---------- label placement ---------- */

/* The box is sized with the same measurement the renderer draws with, and the
 * result is padded. A per-character estimate is what clipped NOSE CONE. */
export function textBox(x, y, content, size, opts){
  const h = size || 1;
  const w = boxWidth(content, h, opts);
  return [x, y - h * 0.25, x + w, y + h];
}

export function boxesIntersect(a, b, pad){
  const p = pad || 0;
  return !(a[2] + p < b[0] || b[2] + p < a[0] || a[3] + p < b[1] || b[3] + p < a[1]);
}

function boxInsidePoly(box, pts, clearance){
  const c = clearance || 0;
  const corners = [
    [box[0] - c, box[1] - c], [box[2] + c, box[1] - c],
    [box[2] + c, box[3] + c], [box[0] - c, box[3] + c]
  ];
  return corners.every(p => pointInPoly(p[0], p[1], pts));
}

/* Place one label.
 *   1. centroid, when the text box fits inside the polygon with clearance
 *   2. outside the drawing extents on the side with the most free space,
 *      with a leader back to the anchor
 *   3. the next best free side
 * Every candidate is tested against already placed boxes and against
 * dimension strings. Text is never drawn over a dimension line.
 */
export function placeLabel(opts){
  const content = opts.content || '';
  const size = opts.size || 1;
  const pts = opts.pts || [];
  const obstacles = opts.obstacles || [];
  const ext = opts.extents || [0, 0, 1, 1];
  const anchor = opts.anchor || centroidOf(pts);
  const clash = box => obstacles.some(o => boxesIntersect(box, o, 0.15));

  if (pts.length > 2){
    const w = boxWidth(content, size, opts.metrics);
    const c = centroidOf(pts);
    const box = textBox(c[0] - w / 2, c[1], content, size);
    if (boxInsidePoly(box, pts, size * 0.3) && !clash(box)){
      return { x: c[0] - w / 2, y: c[1], box, leader: null };
    }
  }

  const w = boxWidth(content, size, opts.metrics);
  const gap = size * 1.5;
  const sides = [
    { name: 'right', x: ext[2] + gap,         y: anchor[1], free: 1 },
    { name: 'left',  x: ext[0] - gap - w,     y: anchor[1], free: 1 },
    { name: 'top',   x: anchor[0] - w / 2,    y: ext[3] + gap, free: 1 },
    { name: 'bottom', x: anchor[0] - w / 2,   y: ext[1] - gap - size, free: 1 }
  ];
  sides.forEach(s => {
    const b = textBox(s.x, s.y, content, size);
    s.free = obstacles.filter(o => boxesIntersect(b, o, 0.15)).length;
    s.box = b;
  });
  sides.sort((a, b) => a.free - b.free);
  for (const s of sides){
    if (!clash(s.box)){
      return { x: s.x, y: s.y, box: s.box, leader: [[anchor[0], anchor[1]], [s.x, s.y]] };
    }
  }
  /* Everything collided: stack clear of the extents so nothing overlaps. */
  let y = ext[3] + gap;
  for (let i = 0; i < 200; i++){
    const b = textBox(ext[2] + gap, y, content, size);
    if (!clash(b)) return { x: ext[2] + gap, y, box: b, leader: [[anchor[0], anchor[1]], [ext[2] + gap, y]] };
    y += size * 1.6;
  }
  const b = textBox(ext[2] + gap, y, content, size);
  return { x: ext[2] + gap, y, box: b, leader: [[anchor[0], anchor[1]], [ext[2] + gap, y]] };
}

export function centroidOf(pts){
  if (!pts || !pts.length) return [0, 0];
  let x = 0, y = 0;
  pts.forEach(p => { x += p[0]; y += p[1]; });
  return [x / pts.length, y / pts.length];
}

/* Boxes that text must never cover: dimension lines and their strings. */
export function dimObstacles(dims){
  const out = [];
  (dims || []).forEach(d => {
    const x1 = Math.min(d.x1, d.x2), x2 = Math.max(d.x1, d.x2);
    const y1 = Math.min(d.y1, d.y2), y2 = Math.max(d.y1, d.y2);
    const off = d.off || 0;
    const pad = 0.6;
    out.push([x1 - pad, Math.min(y1, y1 + off) - pad, x2 + pad, Math.max(y2, y2 + off) + pad]);
  });
  return out;
}

void dist;
