/* Column grid: bays with lettered (A,B,C…) and numbered (1,2,3…) bubbles.
 * One live entity, exploded to lines + circles + text for DXF/PDF.
 */
import { rotatePt } from './geometry.js';

export function colLetter(i){
  let n = i, s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function makeGrid(opts){
  opts = opts || {};
  return {
    type: 'grid',
    layer: opts.layer || 'GRID',
    x: opts.x || 0,
    y: opts.y || 0,
    cols: Math.max(1, opts.cols || 3),
    rows: Math.max(1, opts.rows || 2),
    cx: opts.cx || 12,
    ry: opts.ry || 12,
    rot: opts.rot || 0,
    bubble: opts.bubble == null ? 1.1 : opts.bubble
  };
}

export function makeGridFromCorners(p1, p2){
  const x = Math.min(p1[0], p2[0]), y = Math.min(p1[1], p2[1]);
  const w = Math.max(Math.abs(p2[0] - p1[0]), 4);
  const h = Math.max(Math.abs(p2[1] - p1[1]), 4);
  const cols = Math.max(1, Math.round(w / 12));
  const rows = Math.max(1, Math.round(h / 12));
  return makeGrid({ x, y, cols, rows, cx: w / cols, ry: h / rows });
}

export function expandGrid(e){
  const cols = e.cols || 3, rows = e.rows || 2;
  const cx = e.cx || 12, ry = e.ry || 12;
  const W = cols * cx, H = rows * ry;
  const rot = e.rot || 0;
  const r = e.bubble || 1.1;
  const pt = (x, y) => rot ? rotatePt(e.x + x, e.y + y, e.x, e.y, rot) : [e.x + x, e.y + y];
  const ln = (x1, y1, x2, y2) => {
    const a = pt(x1, y1), b = pt(x2, y2);
    return { type: 'line', layer: e.layer || 'GRID', lt: 'CENTER', x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  };
  const out = [];
  for (let i = 0; i <= cols; i++){
    out.push(ln(i * cx, 0, i * cx, H));
    const p = pt(i * cx, -r * 2.2);
    out.push({ type: 'circle', layer: e.layer || 'GRID', cx: p[0], cy: p[1], r });
    out.push({ type: 'text', layer: e.layer || 'GRID', x: p[0] - r * 0.35, y: p[1] - r * 0.35, size: r * 0.9, content: colLetter(i) });
  }
  for (let j = 0; j <= rows; j++){
    out.push(ln(0, j * ry, W, j * ry));
    const p = pt(-r * 2.2, j * ry);
    out.push({ type: 'circle', layer: e.layer || 'GRID', cx: p[0], cy: p[1], r });
    out.push({ type: 'text', layer: e.layer || 'GRID', x: p[0] - r * 0.28, y: p[1] - r * 0.35, size: r * 0.85, content: String(j + 1) });
  }
  return out;
}
