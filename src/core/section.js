/* Cutting planes, true section views, and isolated detail windows.
 *
 * A section is derived from the model: walls the plane crosses become hatched
 * bars at their true thickness; closed profiles contribute their cut span.
 * Height is taken from attrs.height when present, otherwise 8'-0" and the
 * sheet is stamped ASSUMED so we never pretend a 2D plan knew a story height.
 *
 * Details do not copy geometry. They open a tighter viewport onto the same
 * model — the same rule as every other sheet in this program.
 */
import { hypot, segSegIntersect, lineCircleTs } from './geometry.js';
import { makeHatch } from './hatch.js';
import { alignedDim } from './dimStyle.js';
import { fmtFtIn } from './format.js';

export const ASSUMED_HEIGHT = 8;
export const SECTION_GAP = 4;

function viewBBox(ents){
  const bb = [1e9, 1e9, -1e9, -1e9];
  (ents || []).forEach(e => {
    const pts = [];
    if (e.pts) e.pts.forEach(p => pts.push(p));
    if (e.x1 != null) pts.push([e.x1, e.y1], [e.x2, e.y2]);
    if (e.x != null && e.y != null) pts.push([e.x, e.y]);
    pts.forEach(p => {
      if (p[0] < bb[0]) bb[0] = p[0];
      if (p[1] < bb[1]) bb[1] = p[1];
      if (p[0] > bb[2]) bb[2] = p[0];
      if (p[1] > bb[3]) bb[3] = p[1];
    });
  });
  return bb[0] > 1e8 ? [0, 0, 1, 1] : bb;
}

export function nextCutTag(entities){
  const used = new Set();
  (entities || []).forEach(e => {
    if (e && e.type === 'cutplane' && e.tag) used.add(String(e.tag).toUpperCase());
  });
  for (let i = 0; i < 26; i++){
    const t = String.fromCharCode(65 + i);
    if (!used.has(t)) return t;
  }
  return 'X';
}

export function nextDetailTag(layouts){
  let n = 1;
  (layouts || []).forEach(L => {
    const m = String(L && (L.sheetNumber || L.name) || '').match(/^D-(\d+)/i);
    if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
  });
  return n;
}

export function makeCutPlane(p1, p2, tag){
  return {
    type: 'cutplane',
    layer: 'SECTION',
    tag: String(tag || 'A').toUpperCase().slice(0, 2),
    x1: p1[0], y1: p1[1],
    x2: p2[0], y2: p2[1],
    lt: 'DASHED'
  };
}

export function planeFrame(plane){
  const dx = plane.x2 - plane.x1, dy = plane.y2 - plane.y1;
  const L = hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  /* View direction: to the right of the directed cut (Y-up). */
  const nx = uy, ny = -ux;
  return {
    origin: [plane.x1, plane.y1],
    ux, uy, nx, ny, L,
    mid: [(plane.x1 + plane.x2) / 2, (plane.y1 + plane.y2) / 2]
  };
}

export function expandCutPlane(e){
  const f = planeFrame(e);
  const h = 0.7;
  const tag = String(e.tag || 'A');
  const out = [{
    type: 'line',
    layer: e.layer,
    lt: e.lt || 'DASHED',
    x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2
  }];
  function arrow(at){
    const ax = at[0] + f.nx * h * 1.1;
    const ay = at[1] + f.ny * h * 1.1;
    out.push({ type: 'poly', closed: true, layer: e.layer, pts: [
      at,
      [ax + f.ux * h * 0.28, ay + f.uy * h * 0.28],
      [ax - f.ux * h * 0.28, ay - f.uy * h * 0.28]
    ] });
  }
  arrow([e.x1, e.y1]);
  arrow([e.x2, e.y2]);
  out.push({
    type: 'text', layer: e.layer,
    x: e.x1 - f.ux * h * 1.2 - f.nx * h * 0.2,
    y: e.y1 - f.uy * h * 1.2 - f.ny * h * 0.2,
    size: h, content: tag
  });
  out.push({
    type: 'text', layer: e.layer,
    x: e.x2 + f.ux * h * 0.4 - f.nx * h * 0.2,
    y: e.y2 + f.uy * h * 0.4 - f.ny * h * 0.2,
    size: h, content: tag
  });
  return out;
}

function heightOf(e){
  const a = (e && (e.attrs || e.attributes)) || {};
  const h = Number(a.height != null ? a.height : a.h);
  if (isFinite(h) && h > 0) return { value: h, assumed: false };
  return { value: ASSUMED_HEIGHT, assumed: true };
}

function thicknessOf(e, fallback){
  if (e && e.th && isFinite(e.th) && e.th > 0) return e.th;
  const a = (e && (e.attrs || e.attributes)) || {};
  const t = Number(a.thickness != null ? a.thickness : a.th);
  if (isFinite(t) && t > 0) return t;
  return fallback == null ? 0.5 : fallback;
}

function projectStation(frame, x, y){
  return (x - frame.origin[0]) * frame.ux + (y - frame.origin[1]) * frame.uy;
}

export function sectionHits(entities, plane){
  const f = planeFrame(plane);
  const hits = [];
  (entities || []).forEach(e => {
    if (!e) return;
    if (e.type === 'cutplane' || e.type === 'dim' || e.type === 'text' || e.type === 'table') return;
    if (e.layer === 'SCHEDULES' || e.layer === 'UNDERLAY' || e.layer === 'DEFPOINTS') return;

    if (e.type === 'line' || e.kind === 'wall'){
      if (e.kind === 'wall' && e.role && e.role !== 'a') return;
      const hit = segSegIntersect(e.x1, e.y1, e.x2, e.y2, plane.x1, plane.y1, plane.x2, plane.y2, 1e-6);
      if (!hit) return;
      const ht = heightOf(e);
      hits.push({
        kind: 'wall',
        station: projectStation(f, hit.x, hit.y),
        thickness: thicknessOf(e, 0.5),
        height: ht.value,
        assumed: ht.assumed,
        src: e
      });
      return;
    }

    if ((e.type === 'poly' || e.type === 'profile' || e.type === 'hatchRegion') && e.pts && e.pts.length > 1){
      const pts = e.pts;
      const n = pts.length;
      const closed = e.closed !== false || e.type === 'profile' || e.type === 'hatchRegion';
      const segs = closed ? n : n - 1;
      const stations = [];
      for (let i = 0; i < segs; i++){
        const a = pts[i], b = pts[(i + 1) % n];
        const hit = segSegIntersect(a[0], a[1], b[0], b[1], plane.x1, plane.y1, plane.x2, plane.y2, 1e-6);
        if (hit) stations.push(projectStation(f, hit.x, hit.y));
      }
      if (stations.length < 2) return;
      stations.sort((a, b) => a - b);
      const ht = heightOf(e);
      hits.push({
        kind: 'profile',
        station: (stations[0] + stations[stations.length - 1]) / 2,
        span: [stations[0], stations[stations.length - 1]],
        thickness: thicknessOf(e, Math.max(0.25, stations[stations.length - 1] - stations[0])),
        height: ht.value,
        assumed: ht.assumed,
        src: e
      });
      return;
    }

    if (e.type === 'circle'){
      const ts = lineCircleTs(plane.x1, plane.y1, plane.x2, plane.y2, e.cx, e.cy, e.r);
      const on = ts.filter(t => t >= -1e-6 && t <= 1 + 1e-6);
      if (on.length < 2) return;
      const pA = [plane.x1 + (plane.x2 - plane.x1) * on[0], plane.y1 + (plane.y2 - plane.y1) * on[0]];
      const pB = [plane.x1 + (plane.x2 - plane.x1) * on[1], plane.y1 + (plane.y2 - plane.y1) * on[1]];
      const s0 = projectStation(f, pA[0], pA[1]);
      const s1 = projectStation(f, pB[0], pB[1]);
      const ht = heightOf(e);
      hits.push({
        kind: 'circle',
        station: (s0 + s1) / 2,
        span: [Math.min(s0, s1), Math.max(s0, s1)],
        thickness: Math.abs(s1 - s0),
        height: ht.value,
        assumed: ht.assumed,
        src: e
      });
    }
  });
  hits.sort((a, b) => a.station - b.station);
  return hits;
}

export function buildSectionView(entities, plane, opts){
  const o = opts || {};
  const f = planeFrame(plane);
  const hits = sectionHits(entities, plane);
  const tag = plane.tag || 'A';
  const view = [];
  if (!hits.length){
    return {
      entities: view,
      hits,
      bbox: null,
      tag,
      assumedHeight: true,
      note: 'Cutting plane ' + tag + '-' + tag + ' does not cross any walls or profiles'
    };
  }

  const gap = o.gap != null ? o.gap : SECTION_GAP;
  let maxH = 0;
  let assumed = false;
  hits.forEach(h => { if (h.height > maxH) maxH = h.height; if (h.assumed) assumed = true; });

  const ox = f.origin[0] - f.nx * (maxH + gap);
  const oy = f.origin[1] - f.ny * (maxH + gap);

  function toWorld(station, elev){
    return [
      ox + f.ux * station + f.nx * elev,
      oy + f.uy * station + f.ny * elev
    ];
  }

  hits.forEach(h => {
    let a, b;
    if (h.span){
      a = h.span[0];
      b = h.span[1];
    } else {
      const half = (h.thickness || 0.5) / 2;
      a = h.station - half;
      b = h.station + half;
    }
    const p0 = toWorld(a, 0);
    const p1 = toWorld(b, 0);
    const p2 = toWorld(b, h.height);
    const p3 = toWorld(a, h.height);
    const hat = makeHatch([p0, p1, p2, p3], { pattern: 'ANSI31', layer: 'HATCH' });
    if (hat) view.push(hat);
    view.push({ type: 'poly', closed: true, layer: 'SECTION', pts: [p0, p1, p2, p3] });
  });

  const s0 = hits[0].span ? hits[0].span[0] : hits[0].station - (hits[0].thickness || 0.5) / 2;
  const last = hits[hits.length - 1];
  const s1 = last.span ? last.span[1] : last.station + (last.thickness || 0.5) / 2;
  view.push(alignedDim(toWorld(s0, 0), toWorld(s1, 0), 1.4));
  const hDim = alignedDim(toWorld(s0, 0), toWorld(s0, maxH), -1.2);
  if (assumed) hDim.assumed = true;
  view.push(hDim);

  const labelAt = toWorld((s0 + s1) / 2, maxH + 0.8);
  view.push({
    type: 'text',
    layer: 'SECTION',
    x: labelAt[0],
    y: labelAt[1],
    size: 1.0,
    content: 'SECTION ' + tag + '-' + tag
  });
  if (assumed){
    view.push({
      type: 'text',
      layer: 'NOTES',
      x: labelAt[0],
      y: labelAt[1] - 1.1,
      size: 0.6,
      content: 'Height ' + fmtFtIn(maxH) + ' ASSUMED — set attrs.height to stamp a real story'
    });
  }

  return { entities: view, hits, bbox: viewBBox(view), tag, assumedHeight: assumed, note: null };
}

export function buildSection(entities, p1, p2, opts){
  const tag = (opts && opts.tag) || nextCutTag(entities);
  const plane = makeCutPlane(p1, p2, tag);
  const view = buildSectionView(entities, plane, opts);
  return Object.assign({ plane }, view);
}

export function detailWindow(p1, p2){
  return [
    Math.min(p1[0], p2[0]),
    Math.min(p1[1], p2[1]),
    Math.max(p1[0], p2[0]),
    Math.max(p1[1], p2[1])
  ];
}

export function buildDetail(entities, p1, p2, opts){
  const pad = (opts && opts.pad) != null ? opts.pad : 0.4;
  const raw = detailWindow(p1, p2);
  const bbox = [raw[0] - pad, raw[1] - pad, raw[2] + pad, raw[3] + pad];
  const n = nextDetailTag(opts && opts.layouts);
  return {
    bbox,
    tag: n,
    sheetNumber: 'D-' + n,
    name: 'D-' + n + ' Detail'
  };
}

export const SECTION_TYPES = ['cutplane'];
export function isSection(e){ return !!e && e.type === 'cutplane'; }
