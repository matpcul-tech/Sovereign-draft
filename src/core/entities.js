/* Entity-level operations. Entities are plain objects:
 *   {type:'line',   layer, x1,y1,x2,y2}
 *   {type:'poly',   layer, closed, pts:[[x,y],...]}
 *   {type:'circle', layer, cx,cy,r}
 *   {type:'arc',    layer, cx,cy,r,a1,a2}   counterclockwise, degrees
 *   {type:'text',   layer, x,y,size,content}
 *   {type:'dim',    layer, x1,y1,x2,y2,off} linear dimension
 * Placed blocks share a group tag `g`; every entity gets a numeric `id` when it
 * enters the drawing.
 */
import { dist, distToSeg, arcPoints, dimGeom } from './geometry.js';

/* Snap candidates: [x, y, kind] where kind 0=end, 1=mid, 2=center. */
export function entPoints(e){
  const p = [];
  if (e.type === 'line'){ p.push([e.x1, e.y1, 0], [e.x2, e.y2, 0], [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, 1]); }
  else if (e.type === 'poly'){
    for (let i = 0; i < e.pts.length; i++){
      p.push([e.pts[i][0], e.pts[i][1], 0]);
      let j = i + 1; if (j === e.pts.length){ if (!e.closed) break; j = 0; }
      p.push([(e.pts[i][0] + e.pts[j][0]) / 2, (e.pts[i][1] + e.pts[j][1]) / 2, 1]);
    }
  }
  else if (e.type === 'circle'){ p.push([e.cx, e.cy, 2], [e.cx + e.r, e.cy, 0], [e.cx - e.r, e.cy, 0], [e.cx, e.cy + e.r, 0], [e.cx, e.cy - e.r, 0]); }
  else if (e.type === 'arc'){ const ap = arcPoints(e); p.push([e.cx, e.cy, 2], [ap[0][0], ap[0][1], 0], [ap[ap.length - 1][0], ap[ap.length - 1][1], 0]); }
  else if (e.type === 'dim'){ p.push([e.x1, e.y1, 0], [e.x2, e.y2, 0]); }
  else if (e.type === 'text'){ p.push([e.x, e.y, 0]); }
  return p;
}

/* Hit test one entity against world point w with world-space tolerance. */
export function entHit(e, w, tol){
  if (e.type === 'line') return distToSeg(w[0], w[1], e.x1, e.y1, e.x2, e.y2) < tol;
  if (e.type === 'poly'){
    for (let i = 0; i < e.pts.length - 1; i++)
      if (distToSeg(w[0], w[1], e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]) < tol) return true;
    if (e.closed && e.pts.length > 2){
      const a = e.pts[e.pts.length - 1], b = e.pts[0];
      if (distToSeg(w[0], w[1], a[0], a[1], b[0], b[1]) < tol) return true;
    }
    return false;
  }
  if (e.type === 'circle') return Math.abs(dist(w[0], w[1], e.cx, e.cy) - e.r) < tol;
  if (e.type === 'arc'){
    const ap = arcPoints(e);
    for (let j = 0; j < ap.length - 1; j++)
      if (distToSeg(w[0], w[1], ap[j][0], ap[j][1], ap[j + 1][0], ap[j + 1][1]) < tol) return true;
    return false;
  }
  if (e.type === 'text'){
    const wd = (e.content || '').length * e.size * 0.58;
    return w[0] >= e.x - tol && w[0] <= e.x + wd + tol && w[1] >= e.y - tol && w[1] <= e.y + e.size + tol;
  }
  if (e.type === 'dim'){
    const g = dimGeom(e);
    return distToSeg(w[0], w[1], g.d[0][0], g.d[0][1], g.d[1][0], g.d[1][1]) < tol * 1.5;
  }
  return false;
}

export function translateEnt(e, dx, dy){
  if (e.type === 'line' || e.type === 'dim'){ e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; }
  else if (e.type === 'poly'){ for (let i = 0; i < e.pts.length; i++){ e.pts[i][0] += dx; e.pts[i][1] += dy; } }
  else if (e.type === 'circle' || e.type === 'arc'){ e.cx += dx; e.cy += dy; }
  else if (e.type === 'text'){ e.x += dx; e.y += dy; }
}

export function entBBox(e, bb){
  function add(x, y){ if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
  if (e.type === 'line'){ add(e.x1, e.y1); add(e.x2, e.y2); }
  else if (e.type === 'poly'){ for (let i = 0; i < e.pts.length; i++) add(e.pts[i][0], e.pts[i][1]); }
  else if (e.type === 'circle'){ add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); }
  else if (e.type === 'arc'){ const ap = arcPoints(e); for (let j = 0; j < ap.length; j++) add(ap[j][0], ap[j][1]); }
  else if (e.type === 'text'){ add(e.x, e.y); add(e.x + (e.content || '').length * e.size * 0.58, e.y + e.size); }
  else if (e.type === 'dim'){ const g = dimGeom(e); add(e.x1, e.y1); add(e.x2, e.y2); add(g.d[0][0], g.d[0][1]); add(g.d[1][0], g.d[1][1]); }
}

export function membersBBox(ms){
  const bb = [1e9, 1e9, -1e9, -1e9];
  ms.forEach(e => entBBox(e, bb));
  return bb;
}

/* Rotate members 90° counterclockwise around their collective bbox center. */
export function rotateMembers(ms){
  const bb = membersBBox(ms), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const rot = (x, y) => [cx - (y - cy), cy + (x - cx)];
  ms.forEach(e => {
    let p;
    if (e.type === 'line' || e.type === 'dim'){ p = rot(e.x1, e.y1); e.x1 = p[0]; e.y1 = p[1]; p = rot(e.x2, e.y2); e.x2 = p[0]; e.y2 = p[1]; }
    else if (e.type === 'poly'){ for (let i = 0; i < e.pts.length; i++){ p = rot(e.pts[i][0], e.pts[i][1]); e.pts[i] = [p[0], p[1]]; } }
    else if (e.type === 'circle'){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; }
    else if (e.type === 'arc'){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; e.a1 += 90; e.a2 += 90; }
    else if (e.type === 'text'){ p = rot(e.x, e.y); e.x = p[0]; e.y = p[1]; }
  });
}

/* Grip points for single-entity editing. Each grip mutates its entity via apply(p). */
export function gripPts(e){
  const g = [];
  if (e.type === 'line'){
    g.push({ x: e.x1, y: e.y1, apply(p){ e.x1 = p[0]; e.y1 = p[1]; } });
    g.push({ x: e.x2, y: e.y2, apply(p){ e.x2 = p[0]; e.y2 = p[1]; } });
  } else if (e.type === 'poly'){
    e.pts.forEach((pt, i) => { g.push({ x: pt[0], y: pt[1], apply(p){ e.pts[i] = [p[0], p[1]]; } }); });
  } else if (e.type === 'circle'){
    g.push({ x: e.cx + e.r, y: e.cy, apply(p){ e.r = Math.max(dist(p[0], p[1], e.cx, e.cy), 0.05); } });
  } else if (e.type === 'text'){
    g.push({ x: e.x, y: e.y, apply(p){ e.x = p[0]; e.y = p[1]; } });
  } else if (e.type === 'dim'){
    g.push({ x: e.x1, y: e.y1, apply(p){ e.x1 = p[0]; e.y1 = p[1]; } });
    g.push({ x: e.x2, y: e.y2, apply(p){ e.x2 = p[0]; e.y2 = p[1]; } });
    const gm = dimGeom(e);
    g.push({ x: gm.mid[0], y: gm.mid[1], apply(p){
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      const ux = dx / len, uy = dy / len;
      e.off = ux * (p[1] - e.y1) - uy * (p[0] - e.x1);
      if (Math.abs(e.off) < 0.3) e.off = 0.3 * Math.sign(e.off || 1);
    } });
  }
  return g;
}
