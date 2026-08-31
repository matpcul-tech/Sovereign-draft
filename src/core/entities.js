/* Entity-level operations. Entities are plain objects:
 *   {type:'line',   layer, x1,y1,x2,y2}
 *   {type:'poly',   layer, closed, pts:[[x,y],...]}
 *   {type:'circle', layer, cx,cy,r}
 *   {type:'arc',    layer, cx,cy,r,a1,a2}   counterclockwise, degrees
 *   {type:'text',   layer, x,y,size,content}
 *   {type:'dim',    layer, x1,y1,x2,y2,off} linear / angular / radius / diameter
 *   {type:'hatch',  layer, pts, pattern, scale, angle}
 *   {type:'insert', layer, def, x,y,rot,width,swing,flip,scale,host,t,cl,frags}
 *   {type:'table',  layer, x,y,colW,rowH,title,cells}
 *   {type:'ellipse',layer, cx,cy,rx,ry,rot}
 *   {type:'leader', layer, pts, content, textH}
 *   {type:'cloud',  layer, pts, amp}
 *   {type:'image',  layer, x,y,w,h,rot,src}
 *   {type:'room',   layer, name, pts, cx,cy, area, auto}
 *   {type:'grid',   layer, x,y, cols,rows, cx,ry, rot, bubble}
 *   {type:'xline',  layer, x1,y1,x2,y2}  infinite construction line
 *   {type:'spline', layer, ctrl, degree, knots?, closed?, weights?}
 *   {type:'profile',   layer, pts, fill}      closed outline, no wall semantics
 *   {type:'centerline',layer, pts}            construction geometry, non-printing
 *   {type:'callout',   layer, anchor,pts,content,textH}  leader + boxed label
 *   {type:'hatchRegion',layer, pts, pattern}  explicit region plus pattern
 *   {type:'xref',   layer, name,path,x,y,rot,scale,overlay,entities}
 *   {type:'fcf',    layer, x,y,char,tol,dia,datums,anchor,h}  GD&T frame
 *   {type:'datum',  layer, x,y,letter,h}
 *   {type:'finish', layer, x,y,roughness,h}
 *   {type:'cutplane',layer, x1,y1,x2,y2,tag}  section cut
 * Optional: lt (linetype), lw (mm lineweight), block group `g`, numeric `id`.
 * Walls are groups of lines tagged kind:'wall'. INSERT is a live parametric
 * block (no `g`) expanded at draw/hit/osnap/export; explode yields fragments.
 */
import { dist, distToSeg, arcPoints, dimGeom, pointInPoly, ellipsePoints, cloudPoints, imageCorners, angularGeom } from './geometry.js';
import { hatchLines } from './hatch.js';
import { expandInsert, insertGrips } from './dynblock.js';
import { expandXref, xrefGrips } from './xref.js';
import { expandGdt, isGdt } from './gdt.js';
import { expandCutPlane, isSection } from './section.js';
import { tableFrags, tableCorners } from './schedule.js';
import { dimLabel } from './dimStyle.js';
import { expandGrid } from './grid.js';
import { boxWidth, textWidth } from './textmetrics.js';
import { splinePoints, splineToPoly, translateSpline } from './spline.js';
import { hasBulge, polyOutline } from './bulge.js';
import { mtextToTexts, mtextCorners, translateMText } from './mtext.js';

/* Composite drafting entities used by non-building drawings. Each reduces to
 * primitives, so hit testing, bounds and every exporter run on the expansion
 * instead of needing a bespoke branch per type.
 */
export const COMPOSITE_TYPES = ['profile', 'centerline', 'callout', 'hatchRegion', 'fcf', 'datum', 'finish', 'cutplane'];

export function isComposite(e){ return !!e && COMPOSITE_TYPES.indexOf(e.type) >= 0; }

export function expandComposite(e){
  if (e.type === 'profile'){
    const out = [];
    if (e.fill && e.pts && e.pts.length > 2){
      out.push({ type: 'hatch', layer: e.layer, pts: e.pts, pattern: e.fill === true ? 'ANSI31' : String(e.fill), scale: 1, angle: 0 });
    }
    if (e.pts && e.pts.length > 1){
      out.push({ type: 'poly', closed: true, pts: e.pts, layer: e.layer, lt: e.lt, lw: e.lw });
    }
    return out;
  }
  if (e.type === 'centerline'){
    if (!e.pts || e.pts.length < 2) return [];
    return [{ type: 'poly', closed: false, pts: e.pts, layer: e.layer || 'DEFPOINTS', lt: e.lt || 'CENTER', lw: e.lw }];
  }
  if (e.type === 'hatchRegion'){
    if (!e.pts || e.pts.length < 3) return [];
    return [{ type: 'hatch', layer: e.layer, pts: e.pts, pattern: e.pattern || 'ANSI31', scale: e.scale || 1, angle: e.angle || 0, explicit: true }];
  }
  if (e.type === 'callout'){
    const out = [];
    const pts = e.pts && e.pts.length > 1 ? e.pts : null;
    if (pts) out.push({ type: 'poly', closed: false, pts, layer: e.layer, lt: e.lt });
    const tip = pts ? pts[pts.length - 1] : (e.anchor || [0, 0]);
    const h = e.textH || 0.8;
    const w = boxWidth(e.content, h);
    out.push({ type: 'poly', closed: true, layer: e.layer, pts: [
      [tip[0], tip[1] - h * 0.35], [tip[0] + w + h * 0.4, tip[1] - h * 0.35],
      [tip[0] + w + h * 0.4, tip[1] + h * 1.05], [tip[0], tip[1] + h * 1.05]
    ] });
    out.push({ type: 'text', layer: e.layer, x: tip[0] + h * 0.2, y: tip[1], size: h, content: String(e.content || '') });
    return out;
  }
  if (isGdt(e)) return expandGdt(e);
  if (isSection(e)) return expandCutPlane(e);
  return [e];
}

export function spanXline(e, reach){
  reach = reach == null ? 400 : reach;
  const dx = (e.x2 || 0) - (e.x1 || 0), dy = (e.y2 || 0) - (e.y1 || 0);
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  return {
    type: 'line',
    layer: e.layer,
    lt: e.lt || 'DASHED',
    x1: e.x1 - ux * reach,
    y1: e.y1 - uy * reach,
    x2: e.x1 + ux * reach,
    y2: e.y1 + uy * reach
  };
}

export function flattenEnt(e){
  if (!e) return [];
  if (isComposite(e)) return expandComposite(e);
  if (e.type === 'mtext') return mtextToTexts(e);
  if (e.type === 'spline') return [splineToPoly(e)];
  /* Arc segments become line work here, so exporters and hatching see the
   * real curve instead of a chord. The entity itself keeps its bulges. */
  if (e.type === 'poly' && hasBulge(e)) return [{ type: 'poly', closed: !!e.closed, pts: polyOutline(e), layer: e.layer, lt: e.lt, lw: e.lw }];
  if (e.type === 'insert') return expandInsert(e);
  if (e.type === 'xref') return expandXref(e);
  if (e.type === 'grid') return expandGrid(e);
  if (e.type === 'xline') return [spanXline(e)];
  return [e];
}

export function explodeForIO(e){
  if (!e) return [];
  if (isComposite(e)) return expandComposite(e);
  if (e.type === 'mtext') return mtextToTexts(e);
  if (e.type === 'spline') return [splineToPoly(e)];
  /* Line work for consumers that cannot express an arc segment. The DXF
   * writer never reaches here for a polyline, so group 42 still survives. */
  if (e.type === 'poly' && hasBulge(e)) return [{ type: 'poly', closed: !!e.closed, pts: polyOutline(e), layer: e.layer, lt: e.lt, lw: e.lw }];
  if (e.type === 'insert') return expandInsert(e);
  if (e.type === 'xref') return expandXref(e);
  if (e.type === 'table') return tableFrags(e);
  if (e.type === 'ellipse') return [{ type: 'poly', closed: true, pts: ellipsePoints(e), layer: e.layer, lt: e.lt, lw: e.lw }];
  if (e.type === 'cloud') return [{ type: 'poly', closed: true, pts: cloudPoints(e.pts || [], e.amp), layer: e.layer, lt: e.lt, lw: e.lw }];
  if (e.type === 'leader'){
    const out = [];
    if (e.pts && e.pts.length > 1) out.push({ type: 'poly', closed: false, pts: e.pts, layer: e.layer, lt: e.lt, lw: e.lw });
    const last = e.pts && e.pts[e.pts.length - 1];
    if (last && e.content) out.push({ type: 'text', layer: e.layer || 'DIMS', x: last[0] + 0.15, y: last[1], size: e.textH || 0.7, content: e.content });
    return out;
  }
  if (e.type === 'image'){
    return [{ type: 'poly', closed: true, pts: imageCorners(e), layer: e.layer, lt: 'DASHED' }];
  }
  if (e.type === 'grid') return expandGrid(e);
  if (e.type === 'xline') return [spanXline(e)];
  if (e.type === 'room'){
    const out = [];
    if (e.pts && e.pts.length > 2) out.push({ type: 'poly', closed: true, pts: e.pts, layer: e.layer || 'ROOMS' });
    const label = (e.name || 'ROOM') + '  ' + Math.round(e.area != null ? e.area : 0) + ' SF';
    out.push({ type: 'text', layer: e.layer || 'ROOMS', x: (e.cx || 0) - 1.6, y: (e.cy || 0) - 0.3, size: 1.0, content: label });
    return out;
  }
  if (e.type === 'dim' && e.kind === 'angular'){
    const g = angularGeom(e);
    return [
      { type: 'line', layer: e.layer, x1: e.x2, y1: e.y2, x2: g.pA[0], y2: g.pA[1] },
      { type: 'line', layer: e.layer, x1: e.x2, y1: e.y2, x2: g.pB[0], y2: g.pB[1] },
      { type: 'poly', layer: e.layer, closed: false, pts: g.arc },
      { type: 'text', layer: e.layer || 'DIMS', x: g.mid[0], y: g.mid[1], size: e.textH || 0.7, content: (Math.round(g.value * 10) / 10) + '°' }
    ];
  }
  if (e.type === 'dim' && (e.kind === 'radius' || e.kind === 'diameter')){
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    const a = e.kind === 'diameter' ? [e.x1 - dx, e.y1 - dy] : [e.x1, e.y1];
    return [
      { type: 'line', layer: e.layer, x1: a[0], y1: a[1], x2: e.x2, y2: e.y2 },
      { type: 'text', layer: e.layer || 'DIMS', x: (a[0] + e.x2) / 2, y: (a[1] + e.y2) / 2, size: e.textH || 0.7, content: dimLabel(e) }
    ];
  }
  return [e];
}

function hitPath(pts, w, tol, closed){
  if (!pts || pts.length < 2) return false;
  const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++){
    const a = pts[i], b = pts[(i + 1) % n];
    if (distToSeg(w[0], w[1], a[0], a[1], b[0], b[1]) < tol) return true;
  }
  return false;
}

/* Snap candidates: [x, y, kind] where kind 0=end, 1=mid, 2=center. */
export function entPoints(e){
  if (e.type === 'spline'){
    /* Control points snap, plus the curve ends. */
    const pts = (e.ctrl || []).map(p => [p[0], p[1], 0]);
    const t = splinePoints(e);
    if (t.length) pts.push([t[0][0], t[0][1], 0], [t[t.length - 1][0], t[t.length - 1][1], 0]);
    return pts;
  }
  if (isComposite(e)){
    const out = [];
    expandComposite(e).forEach(f => { entPoints(f).forEach(p => out.push(p)); });
    return out;
  }
  if (e.type === 'insert'){
    const p = [];
    flattenEnt(e).forEach(f => p.push(...entPoints(f)));
    p.push([e.x, e.y, 2]);
    return p;
  }
  const p = [];
  if (e.type === 'line'){ p.push([e.x1, e.y1, 0], [e.x2, e.y2, 0], [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, 1]); }
  else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader'){
    const pts = e.pts || [];
    const closed = e.closed || e.type === 'hatch' || e.type === 'cloud';
    for (let i = 0; i < pts.length; i++){
      p.push([pts[i][0], pts[i][1], 0]);
      let j = i + 1; if (j === pts.length){ if (!closed) break; j = 0; }
      p.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2, 1]);
    }
  }
  else if (e.type === 'circle'){ p.push([e.cx, e.cy, 2], [e.cx + e.r, e.cy, 0], [e.cx - e.r, e.cy, 0], [e.cx, e.cy + e.r, 0], [e.cx, e.cy - e.r, 0]); }
  else if (e.type === 'arc'){ const ap = arcPoints(e); p.push([e.cx, e.cy, 2], [ap[0][0], ap[0][1], 0], [ap[ap.length - 1][0], ap[ap.length - 1][1], 0]); }
  else if (e.type === 'ellipse'){
    p.push([e.cx, e.cy, 2]);
    ellipsePoints(e, 4).forEach(pt => p.push([pt[0], pt[1], 0]));
  }
  else if (e.type === 'dim'){
    p.push([e.x1, e.y1, 0], [e.x2, e.y2, 0]);
    if (e.kind === 'angular' && e.x3 != null) p.push([e.x3, e.y3, 0]);
  }
  else if (e.type === 'text'){ p.push([e.x, e.y, 0]); }
  else if (e.type === 'mtext'){ p.push([e.x, e.y, 0]); mtextCorners(e).forEach(c => p.push([c[0], c[1], 0])); }
  else if (e.type === 'table'){ tableCorners(e).forEach(pt => p.push([pt[0], pt[1], 0])); }
  else if (e.type === 'image'){ imageCorners(e).forEach(pt => p.push([pt[0], pt[1], 0])); }
  else if (e.type === 'xline'){ p.push([e.x1, e.y1, 0], [e.x2, e.y2, 0]); }
  else if (e.type === 'grid'){ flattenEnt(e).forEach(f => p.push(...entPoints(f))); }
  else if (e.type === 'room' && e.pts){ e.pts.forEach((pt, i) => p.push([pt[0], pt[1], 0])); if (e.cx != null) p.push([e.cx, e.cy, 2]); }
  return p;
}

/* Hit test one entity against world point w with world-space tolerance. */
export function entHit(e, w, tol){
  if (e.type === 'spline') return entHit(splineToPoly(e), w, tol);
  if (isComposite(e)) return expandComposite(e).some(f => entHit(f, w, tol));
  if (e.type === 'insert') return flattenEnt(e).some(f => entHit(f, w, tol));
  if (e.type === 'grid') return flattenEnt(e).some(f => entHit(f, w, tol));
  if (e.type === 'xline'){
    const s = spanXline(e);
    return distToSeg(w[0], w[1], s.x1, s.y1, s.x2, s.y2) < tol;
  }
  if (e.type === 'room'){
    if (e.pts && pointInPoly(w[0], w[1], e.pts)) return true;
    return hitPath(e.pts, w, tol, true);
  }
  if (e.type === 'line') return distToSeg(w[0], w[1], e.x1, e.y1, e.x2, e.y2) < tol;
  if (e.type === 'poly' || e.type === 'leader') return hitPath(polyOutline(e), w, tol, e.closed);
  if (e.type === 'cloud') return hitPath(cloudPoints(e.pts || [], e.amp), w, tol, true) || (e.pts && pointInPoly(w[0], w[1], e.pts));
  if (e.type === 'ellipse') return hitPath(ellipsePoints(e), w, tol, true);
  if (e.type === 'hatch'){
    if (pointInPoly(w[0], w[1], e.pts)) return true;
    if (hitPath(e.pts, w, tol, true)) return true;
    for (const seg of hatchLines(e)){
      if (distToSeg(w[0], w[1], seg[0][0], seg[0][1], seg[1][0], seg[1][1]) < tol) return true;
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
    const wd = boxWidth(e.content, e.size);
    return w[0] >= e.x - tol && w[0] <= e.x + wd + tol && w[1] >= e.y - tol && w[1] <= e.y + e.size + tol;
  }
  if (e.type === 'mtext') return pointInPoly(w[0], w[1], mtextCorners(e));
  if (e.type === 'table') return pointInPoly(w[0], w[1], tableCorners(e));
  if (e.type === 'image') return pointInPoly(w[0], w[1], imageCorners(e));
  if (e.type === 'dim'){
    if (e.kind === 'angular') return hitPath(angularGeom(e).arc, w, tol * 1.5, false);
    const g = dimGeom(e);
    return distToSeg(w[0], w[1], g.d[0][0], g.d[0][1], g.d[1][0], g.d[1][1]) < tol * 1.5;
  }
  return false;
}

export function translateEnt(e, dx, dy){
  if (e.type === 'spline'){ translateSpline(e, dx, dy); return; }
  if (isComposite(e)){
    if (e.pts) e.pts = e.pts.map(p => [p[0] + dx, p[1] + dy]);
    if (e.anchor) e.anchor = [e.anchor[0] + dx, e.anchor[1] + dy];
    return;
  }
  if (e.type === 'line' || e.type === 'dim'){
    e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy;
    if (e.x3 != null){ e.x3 += dx; e.y3 += dy; }
  }
  else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader'){
    for (let i = 0; i < (e.pts || []).length; i++){ e.pts[i][0] += dx; e.pts[i][1] += dy; }
  }
  else if (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse'){ e.cx += dx; e.cy += dy; }
  else if (e.type === 'mtext'){ translateMText(e, dx, dy); }
  else if (e.type === 'text' || e.type === 'table' || e.type === 'image'){ e.x += dx; e.y += dy; }
  else if (e.type === 'insert' || e.type === 'xref'){ e.x += dx; e.y += dy; }
  else if (e.type === 'xline'){ e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; }
  else if (e.type === 'room'){
    if (e.pts) for (let i = 0; i < e.pts.length; i++){ e.pts[i][0] += dx; e.pts[i][1] += dy; }
    if (e.cx != null){ e.cx += dx; e.cy += dy; }
  }
  else if (e.type === 'grid'){ e.x += dx; e.y += dy; }
}

export function entBBox(e, bb){
  if (e.type === 'spline'){ entBBox(splineToPoly(e), bb); return; }
  if (isComposite(e)){ expandComposite(e).forEach(f => entBBox(f, bb)); return; }
  function add(x, y){ if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
  if (e.type === 'insert' || e.type === 'xref'){ flattenEnt(e).forEach(f => entBBox(f, bb)); add(e.x, e.y); return; }
  if (e.type === 'grid'){ flattenEnt(e).forEach(f => entBBox(f, bb)); return; }
  if (e.type === 'line' || e.type === 'xline'){ add(e.x1, e.y1); add(e.x2, e.y2); }
  else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'leader' || e.type === 'room'){
    const op = e.type === 'poly' ? polyOutline(e) : (e.pts || []);
    for (let i = 0; i < op.length; i++) add(op[i][0], op[i][1]);
  }
  else if (e.type === 'cloud'){ cloudPoints(e.pts || [], e.amp).forEach(p => add(p[0], p[1])); }
  else if (e.type === 'ellipse'){ ellipsePoints(e).forEach(p => add(p[0], p[1])); }
  else if (e.type === 'circle'){ add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); }
  else if (e.type === 'arc'){ const ap = arcPoints(e); for (let j = 0; j < ap.length; j++) add(ap[j][0], ap[j][1]); }
  else if (e.type === 'text'){ add(e.x, e.y); add(e.x + boxWidth(e.content, e.size), e.y + e.size); }
  else if (e.type === 'mtext'){ mtextCorners(e).forEach(p => add(p[0], p[1])); }
  else if (e.type === 'table'){ tableCorners(e).forEach(p => add(p[0], p[1])); }
  else if (e.type === 'image'){ imageCorners(e).forEach(p => add(p[0], p[1])); }
  else if (e.type === 'dim'){
    if (e.kind === 'angular'){ angularGeom(e).arc.forEach(p => add(p[0], p[1])); add(e.x1, e.y1); add(e.x2, e.y2); add(e.x3, e.y3); }
    else { const g = dimGeom(e); add(e.x1, e.y1); add(e.x2, e.y2); add(g.d[0][0], g.d[0][1]); add(g.d[1][0], g.d[1][1]); }
  }
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
    if (e.type === 'line' || e.type === 'dim' || e.type === 'xline'){
      p = rot(e.x1, e.y1); e.x1 = p[0]; e.y1 = p[1]; p = rot(e.x2, e.y2); e.x2 = p[0]; e.y2 = p[1];
      if (e.x3 != null){ p = rot(e.x3, e.y3); e.x3 = p[0]; e.y3 = p[1]; }
    }
    else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader' || e.type === 'room'){
      for (let i = 0; i < (e.pts || []).length; i++){ p = rot(e.pts[i][0], e.pts[i][1]); e.pts[i] = [p[0], p[1]]; }
      if (e.type === 'room' && e.cx != null){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; }
    }
    else if (e.type === 'circle'){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; }
    else if (e.type === 'ellipse'){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; e.rot = (e.rot || 0) + 90; }
    else if (e.type === 'arc'){ p = rot(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; e.a1 += 90; e.a2 += 90; }
    else if (e.type === 'mtext'){ p = rot(e.x, e.y); e.x = p[0]; e.y = p[1]; e.rot = (e.rot || 0) + 90; }
    else if (e.type === 'text' || e.type === 'table'){ p = rot(e.x, e.y); e.x = p[0]; e.y = p[1]; }
    else if (e.type === 'image'){ p = rot(e.x, e.y); e.x = p[0]; e.y = p[1]; e.rot = (e.rot || 0) + 90; }
    else if (e.type === 'insert' || e.type === 'xref'){
      p = rot(e.x, e.y); e.x = p[0]; e.y = p[1];
      e.rot = (e.rot || 0) + 90;
      if (e.type === 'insert'){ e.host = null; e.cl = null; e.t = undefined; }
    }
    else if (e.type === 'grid'){
      p = rot(e.x, e.y); e.x = p[0]; e.y = p[1];
      e.rot = (e.rot || 0) + 90;
    }
  });
}

/* Grip points for single-entity editing. Each grip mutates its entity via apply(p). */
export function gripPts(e){
  if (e.type === 'insert') return insertGrips(e);
  if (e.type === 'xref') return xrefGrips(e);
  const g = [];
  if (e.type === 'line' || e.type === 'xline'){
    g.push({ x: e.x1, y: e.y1, apply(p){ e.x1 = p[0]; e.y1 = p[1]; } });
    g.push({ x: e.x2, y: e.y2, apply(p){ e.x2 = p[0]; e.y2 = p[1]; } });
  } else if (e.type === 'poly' || e.type === 'hatch' || e.type === 'cloud' || e.type === 'leader' || e.type === 'room'){
    (e.pts || []).forEach((pt, i) => { g.push({ x: pt[0], y: pt[1], apply(p){ e.pts[i] = [p[0], p[1]]; } }); });
  } else if (e.type === 'circle'){
    g.push({ x: e.cx + e.r, y: e.cy, apply(p){ e.r = Math.max(dist(p[0], p[1], e.cx, e.cy), 0.05); } });
  } else if (e.type === 'ellipse'){
    const rot = (e.rot || 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    g.push({ x: e.cx + (e.rx || 0) * c, y: e.cy + (e.rx || 0) * s, apply(p){ e.rx = Math.max(dist(p[0], p[1], e.cx, e.cy), 0.05); } });
    g.push({ x: e.cx - (e.ry || 0) * s, y: e.cy + (e.ry || 0) * c, apply(p){ e.ry = Math.max(dist(p[0], p[1], e.cx, e.cy), 0.05); } });
  } else if (e.type === 'text' || e.type === 'table'){
    g.push({ x: e.x, y: e.y, apply(p){ e.x = p[0]; e.y = p[1]; } });
  } else if (e.type === 'grid'){
    g.push({ x: e.x, y: e.y, apply(p){ e.x = p[0]; e.y = p[1]; } });
  } else if (e.type === 'image'){
    g.push({ x: e.x, y: e.y, apply(p){ e.x = p[0]; e.y = p[1]; } });
    const c = imageCorners(e)[2];
    g.push({ x: c[0], y: c[1], kind: 'stretch', apply(p){
      e.w = Math.max(Math.abs(p[0] - e.x), 0.2);
      e.h = Math.max(Math.abs(p[1] - e.y), 0.2);
    } });
  } else if (e.type === 'dim'){
    g.push({ x: e.x1, y: e.y1, apply(p){ e.x1 = p[0]; e.y1 = p[1]; } });
    g.push({ x: e.x2, y: e.y2, apply(p){ e.x2 = p[0]; e.y2 = p[1]; } });
    if (e.kind === 'angular' && e.x3 != null){
      g.push({ x: e.x3, y: e.y3, apply(p){ e.x3 = p[0]; e.y3 = p[1]; } });
    } else if (e.kind !== 'radius' && e.kind !== 'diameter'){
      const gm = dimGeom(e);
      g.push({ x: gm.mid[0], y: gm.mid[1], apply(p){
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        const ux = dx / len, uy = dy / len;
        e.off = ux * (p[1] - e.y1) - uy * (p[0] - e.x1);
        if (Math.abs(e.off) < 0.3) e.off = 0.3 * Math.sign(e.off || 1);
      } });
    }
  } else if (e.type === 'arc'){
    const ap = arcPoints(e);
    g.push({ x: ap[0][0], y: ap[0][1], apply(p){ e.a1 = Math.atan2(p[1] - e.cy, p[0] - e.cx) * 180 / Math.PI; } });
    g.push({ x: ap[ap.length - 1][0], y: ap[ap.length - 1][1], apply(p){ e.a2 = Math.atan2(p[1] - e.cy, p[0] - e.cx) * 180 / Math.PI; } });
  }
  return g;
}

export function copyMeta(from, to){
  if (from.lt) to.lt = from.lt;
  if (from.lw != null) to.lw = from.lw;
  if (from.kind) to.kind = from.kind;
  if (from.th != null) to.th = from.th;
  if (from.role) to.role = from.role;
  return to;
}
