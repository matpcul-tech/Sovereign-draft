/* STRETCH: move vertices that fall inside a crossing window, leave the rest. */
import { dist } from './geometry.js';

export function inBox(x, y, box){
  const x0 = Math.min(box[0], box[2]), x1 = Math.max(box[0], box[2]);
  const y0 = Math.min(box[1], box[3]), y1 = Math.max(box[1], box[3]);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function movePt(p, dx, dy){ p[0] += dx; p[1] += dy; }

/* Mutates entities. Returns the number of vertices moved. */
export function stretchEntities(entities, box, dx, dy){
  if (!dx && !dy) return 0;
  let n = 0;
  (entities || []).forEach(e => {
    if (e.type === 'line' || (e.type === 'dim' && e.kind !== 'angular' && e.kind !== 'radius' && e.kind !== 'diameter')){
      /* Associative dims follow the host on refresh — don't double-move them. */
      if (e.type === 'dim' && e.assoc && e.assoc.length >= 2) return;
      if (inBox(e.x1, e.y1, box)){ e.x1 += dx; e.y1 += dy; n++; }
      if (inBox(e.x2, e.y2, box)){ e.x2 += dx; e.y2 += dy; n++; }
    } else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader'){
      (e.pts || []).forEach(p => { if (inBox(p[0], p[1], box)){ movePt(p, dx, dy); n++; } });
    } else if (e.type === 'circle' || e.type === 'ellipse'){
      if (inBox(e.cx, e.cy, box)){ e.cx += dx; e.cy += dy; n++; }
    } else if (e.type === 'arc'){
      if (inBox(e.cx, e.cy, box)){ e.cx += dx; e.cy += dy; n++; }
    } else if (e.type === 'text' || e.type === 'table' || e.type === 'image'){
      if (inBox(e.x, e.y, box)){ e.x += dx; e.y += dy; n++; }
    } else if (e.type === 'insert'){
      if (inBox(e.x, e.y, box)){ e.x += dx; e.y += dy; n++; }
    } else if (e.type === 'spline'){
      /* Control points inside the window stretch; the rest of the curve
       * follows through the basis, which is the point of a spline. */
      (e.ctrl || []).forEach(p => { if (inBox(p[0], p[1], box)){ movePt(p, dx, dy); n++; } });
    } else if (e.type === 'mtext'){
      if (inBox(e.x, e.y, box)){ e.x += dx; e.y += dy; n++; }
    } else if (e.type === 'dim' && e.kind === 'angular'){
      if (inBox(e.x1, e.y1, box)){ e.x1 += dx; e.y1 += dy; n++; }
      if (inBox(e.x2, e.y2, box)){ e.x2 += dx; e.y2 += dy; n++; }
      if (inBox(e.x3, e.y3, box)){ e.x3 += dx; e.y3 += dy; n++; }
    }
  });
  return n;
}

export function boxFromScreen(s0, s1, S2W){
  const a = S2W(s0[0], s0[1]), b = S2W(s1[0], s1[1]);
  return [a[0], a[1], b[0], b[1]];
}

void dist;
