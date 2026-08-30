/* OVERKILL: drop zero-length, duplicate, and collinear-overlapping lines.
 * Leaves wall groups, inserts, dims, hatches, rooms and images alone.
 */
import { dist } from './geometry.js';

const EPS = 0.04;

function samePt(a, b){ return dist(a[0], a[1], b[0], b[1]) < EPS; }

function lineKey(e){
  const a = [e.x1, e.y1], b = [e.x2, e.y2];
  const fwd = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const p = fwd ? a : b, q = fwd ? b : a;
  return p[0].toFixed(3) + ',' + p[1].toFixed(3) + '>' + q[0].toFixed(3) + ',' + q[1].toFixed(3) + '@' + (e.layer || '');
}

export function overkill(entities){
  const keep = [];
  const seen = new Set();
  let dropped = 0;
  (entities || []).forEach(e => {
    if (e.kind === 'wall' || e.type === 'insert' || e.type === 'dim' || e.type === 'hatch' ||
        e.type === 'room' || e.type === 'image' || e.type === 'table' || e.type === 'grid'){
      keep.push(e);
      return;
    }
    if (e.type === 'line'){
      if (dist(e.x1, e.y1, e.x2, e.y2) < EPS){ dropped++; return; }
      const k = lineKey(e);
      if (seen.has(k)){ dropped++; return; }
      seen.add(k);
    }
    if (e.type === 'text' && !(e.content || '').trim()){ dropped++; return; }
    keep.push(e);
  });
  return { entities: keep, dropped };
}
