/* Derived build specifications for a sheet set.
 *
 * Labels and marks become a parts schedule with quantity and size. Size is
 * measured from the part's geometry (the same bbox path stretch/AA use),
 * clipped to that station — not station-height × envelope-width. Envelope
 * dimensions stamp overall height and width when the model has none, and
 * they stay on the overall sheet.
 */
import { membersBBox, entBBox } from './entities.js';
import { alignedDim, defaultDimStyle, applyStyleToDim } from './dimStyle.js';
import { fmtFtIn } from './format.js';
import { makeTable, roomRows, doorRows } from './schedule.js';
import { collectCallouts, isCalloutText, padBBox } from './legend.js';
import { clipSegToBox } from './geometry.js';

const SKIP_TYPES = { text: 1, leader: 1, callout: 1, table: 1, dim: 1, room: 1, grid: 1 };
const SKIP_LAYERS = { NOTES: 1, TEXT: 1, SCHEDULES: 1, DIMS: 1, UNDERLAY: 1, DEFPOINTS: 1 };

export function bodyBBox(entities){
  const src = (entities || []).filter(e => e && !SKIP_TYPES[e.type] && !SKIP_LAYERS[e.layer]);
  if (!src.length){
    const fallback = (entities || []).filter(e => e && e.type !== 'table' && e.layer !== 'SCHEDULES' && e.layer !== 'UNDERLAY');
    if (!fallback.length) return [0, 0, 10, 8];
    return membersBBox(fallback);
  }
  return membersBBox(src);
}

export function parseQty(name, attrs){
  if (attrs && attrs.qty != null && isFinite(Number(attrs.qty)) && Number(attrs.qty) > 0){
    return Number(attrs.qty);
  }
  const m = String(name || '').match(/\b[x×]\s*(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

export function cleanPartName(name){
  return String(name || '').replace(/\s*[x×]\s*\d+\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function calloutEntity(entities, name){
  const u = String(name || '').trim().toUpperCase();
  return (entities || []).find(e => isCalloutText(e) && String(e.content || '').trim().toUpperCase() === u) || null;
}

function stationBox(sorted, i, body, vertical){
  const c = sorted[i];
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  if (vertical){
    const yTop = prev ? (prev.y + c.y) / 2 : body[3];
    const yBot = next ? (c.y + next.y) / 2 : body[1];
    return [body[0], Math.min(yBot, yTop), body[2], Math.max(yBot, yTop)];
  }
  const x0 = prev ? (prev.x + c.x) / 2 : body[0];
  const x1 = next ? (c.x + next.x) / 2 : body[2];
  return [Math.min(x0, x1), body[1], Math.max(x0, x1), body[3]];
}

function addPt(pts, x, y){ pts.push([x, y]); }

/* Clip body geometry to `box` and return its bbox. Same measurement
 * stretch and AA already make — just scoped to one part. */
export function measureInBox(entities, box){
  if (!box || box[0] > 1e8) return null;
  const pts = [];
  (entities || []).forEach(e => {
    if (!e || SKIP_TYPES[e.type] || SKIP_LAYERS[e.layer]) return;
    if (e.type === 'line' || e.type === 'xline'){
      const c = clipSegToBox(e.x1, e.y1, e.x2, e.y2, box);
      if (c){ addPt(pts, c.x1, c.y1); addPt(pts, c.x2, c.y2); }
      return;
    }
    if (e.type === 'poly' || e.type === 'profile' || e.type === 'hatch' || e.type === 'hatchRegion' || e.type === 'centerline'){
      const arr = e.pts || [];
      const closed = e.closed || e.type === 'hatch' || e.type === 'hatchRegion' || e.type === 'profile';
      const n = arr.length;
      for (let i = 0; i < n - (closed ? 0 : 1); i++){
        const a = arr[i], b = arr[(i + 1) % n];
        if (!a || !b) continue;
        const c = clipSegToBox(a[0], a[1], b[0], b[1], box);
        if (c){ addPt(pts, c.x1, c.y1); addPt(pts, c.x2, c.y2); }
      }
      return;
    }
    const eb = [1e9, 1e9, -1e9, -1e9];
    entBBox(e, eb);
    if (eb[0] > 1e8) return;
    const x0 = Math.max(eb[0], box[0]), y0 = Math.max(eb[1], box[1]);
    const x1 = Math.min(eb[2], box[2]), y1 = Math.min(eb[3], box[3]);
    if (x0 <= x1 && y0 <= y1){ addPt(pts, x0, y0); addPt(pts, x1, y1); }
  });
  if (pts.length < 2) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  pts.forEach(p => {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  });
  return [x0, y0, x1, y1];
}

function fmtSize(bb){
  if (!bb || bb[0] > 1e8) return '';
  const w = Math.max(bb[2] - bb[0], 0);
  const h = Math.max(bb[3] - bb[1], 0);
  if (w < 0.05 && h < 0.05) return '';
  if (w < 0.05) return fmtFtIn(h);
  if (h < 0.05) return fmtFtIn(w);
  return fmtFtIn(w) + ' × ' + fmtFtIn(h);
}

/* Split a marked group into disjoint physical instances. Four grid fins share
 * one mark but are four separate parts; their schedule size is one fin, never
 * the span of the set. Entities whose boxes touch (a part drawn as an outline
 * plus detail lines) merge into one instance; clear air between boxes means
 * separate instances. */
export function instanceBBoxes(group){
  const TOUCH = 0.05;
  const boxes = [];
  (group || []).forEach(e => {
    const bb = [1e9, 1e9, -1e9, -1e9];
    entBBox(e, bb);
    if (bb[0] < 1e8) boxes.push(bb);
  });
  let merged = true;
  while (merged){
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++){
      for (let j = i + 1; j < boxes.length && !merged; j++){
        const a = boxes[i], b = boxes[j];
        const apart = a[2] + TOUCH < b[0] || b[2] + TOUCH < a[0] || a[3] + TOUCH < b[1] || b[3] + TOUCH < a[1];
        if (!apart){
          boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          boxes.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return boxes;
}

function largestBox(boxes){
  let best = null, bestA = -1;
  (boxes || []).forEach(b => {
    const a = Math.max(b[2] - b[0], 0.01) * Math.max(b[3] - b[1], 0.01);
    if (a > bestA){ bestA = a; best = b; }
  });
  return best;
}

function sizeOfPart(ents, src, sorted, i, body, vertical){
  const attrs = (src && src.attributes) || {};
  if (attrs.size) return String(attrs.size);
  const mark = src && src.mark ? String(src.mark) : '';
  if (mark){
    const group = ents.filter(e => e && e.mark && String(e.mark) === mark && !SKIP_TYPES[e.type] && !SKIP_LAYERS[e.layer]);
    if (group.length){
      /* One instance, not the union of the set. */
      const s = fmtSize(largestBox(instanceBBoxes(group)));
      if (s) return s;
    }
  }
  const box = stationBox(sorted, i, body, vertical);
  return fmtSize(measureInBox(ents, box)) || '';
}

/* One scheduled row per unique callout. Building plans with rooms skip this
 * and use the room / door schedule instead — those already carry sizes. */
export function collectParts(entities){
  const ents = entities || [];
  if (ents.filter(e => e.type === 'room').length >= 2) return [];
  const body = bodyBBox(ents);
  const callouts = collectCallouts(ents);
  if (callouts.length < 1) return [];
  const w = Math.max(body[2] - body[0], 0.5);
  const h = Math.max(body[3] - body[1], 0.5);
  const vertical = h >= w * 0.7;
  const sorted = callouts.slice().sort((a, b) => vertical ? b.y - a.y : a.x - b.x);
  return sorted.map((c, i) => {
    const src = calloutEntity(ents, c.name);
    const attrs = (src && src.attributes) || {};
    const qty = parseQty(c.name, attrs);
    const desc = cleanPartName(attrs.label || attrs.type || c.name);
    const mark = (src && src.mark) || ('P-' + String(i + 1).padStart(2, '0'));
    return {
      mark: String(mark),
      qty,
      desc: desc || c.name,
      size: sizeOfPart(ents, src, sorted, i, body, vertical),
      material: (attrs.material && !attrs.materialInvented) ? String(attrs.material) : '',
      x: c.x,
      y: c.y
    };
  });
}

/* Scope parts to a section band. Bands split the body along one axis and span
 * it fully on the other, while callout anchors sit beside the body; testing
 * both axes threw a part off its own sheet. Only the split axis decides. */
export function sectionScopedParts(parts, sec, body){
  if (!sec || !sec.bbox) return parts || [];
  const b = sec.bbox;
  const spansX = b[0] <= body[0] + 0.01 && b[2] >= body[2] - 0.01;
  const spansY = b[1] <= body[1] + 0.01 && b[3] >= body[3] - 0.01;
  return (parts || []).filter(p => {
    const inX = p.x >= b[0] - 0.5 && p.x <= b[2] + 0.5;
    const inY = p.y >= b[1] - 0.5 && p.y <= b[3] + 0.5;
    if (spansX && !spansY) return inY;
    if (spansY && !spansX) return inX;
    return inX && inY;
  });
}

export function partsInBBox(parts, bbox, pad){
  if (!bbox) return parts || [];
  const box = pad != null ? padBBox(bbox, pad) : bbox;
  return (parts || []).filter(p => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]);
}

export function specColW(hasMat){
  return hasMat ? [0.7, 0.45, 2.1, 1.45, 1.4] : [0.7, 0.45, 2.5, 1.55];
}

export function partsToTable(parts, opts){
  const o = opts || {};
  const list = parts || [];
  const hasMat = o.hasMat != null ? o.hasMat : list.some(p => p.material);
  const headers = hasMat
    ? ['MARK', 'QTY', 'DESCRIPTION', 'SIZE', 'MATL']
    : ['MARK', 'QTY', 'DESCRIPTION', 'SIZE'];
  const rows = list.map(p => hasMat
    ? [p.mark, String(p.qty), p.desc, p.size, p.material || '—']
    : [p.mark, String(p.qty), p.desc, p.size]);
  return makeTable({
    title: o.title || 'PARTS SCHEDULE',
    headers,
    rows,
    colW: o.colW || specColW(hasMat),
    rowH: o.rowH || 0.22,
    layer: o.layer || 'SCHEDULES',
    x: 0, y: 0
  });
}

export function buildingSchedule(entities, opts){
  const o = opts || {};
  const rooms = roomRows(entities);
  if (rooms.length){
    return makeTable({
      title: o.title || 'ROOM SCHEDULE',
      headers: ['ROOM', 'AREA', 'SF', 'FINISH'],
      rows: rooms,
      colW: o.colW || [1.5, 1.15, 0.8, 0.9],
      rowH: o.rowH || 0.22,
      layer: 'SCHEDULES',
      x: 0, y: 0
    });
  }
  const doors = doorRows(entities);
  if (doors.length){
    return makeTable({
      title: 'DOOR SCHEDULE',
      headers: ['MARK', 'WIDTH', 'SWING', 'WALL'],
      rows: doors,
      colW: [0.7, 1.1, 0.7, 1.4],
      rowH: 0.22,
      layer: 'SCHEDULES',
      x: 0, y: 0
    });
  }
  return null;
}

export function specNotes(body, parts, kind){
  const b = body || [0, 0, 0, 0];
  const w = Math.max(b[2] - b[0], 0);
  const h = Math.max(b[3] - b[1], 0);
  const notes = [];
  /* The envelope belongs to the overall. On a detail sheet the band is not
   * the part, so the number described nothing real; it is dropped rather
   * than computed wrong. */
  if (kind !== 'section' && w > 0.05 && h > 0.05){
    notes.push('Envelope ' + fmtFtIn(w) + ' x ' + fmtFtIn(h) + '.');
  }
  const n = (parts || []).reduce((s, p) => s + (Number(p.qty) || 0), 0);
  if (n){
    notes.push(n + ' part' + (n === 1 ? '' : 's') + '. Sizes from the geometry of each part.');
  } else {
    notes.push('See the legend for rooms, symbols, finishes.');
  }
  notes.push('Do not scale. Dims in feet-inches.');
  return notes;
}

/* Overall height and width, in model space, only when the drawing has no
 * dims of its own. Offset and text height scale with the body so a 230 ft
 * elevation still plots a readable string at 3/32". */
export function envelopeDims(entities){
  const existing = (entities || []).filter(e => e.type === 'dim').length;
  if (existing >= 2) return [];
  const body = bodyBBox(entities);
  const w = Math.max(body[2] - body[0], 0.5);
  const h = Math.max(body[3] - body[1], 0.5);
  if (w < 0.75 && h < 0.75) return [];
  const textH = Math.max(0.8, Math.min(w, h) / 18);
  const style = Object.assign({}, defaultDimStyle(), { textHeight: textH });
  const offH = -Math.max(2, w * 0.45);
  const offW = -Math.max(2, Math.min(w, h) * 0.35);
  const dims = [
    applyStyleToDim(alignedDim([body[0], body[1]], [body[0], body[3]], offH, style), style),
    applyStyleToDim(alignedDim([body[0], body[1]], [body[2], body[1]], offW, style), style)
  ];
  dims.forEach(d => { d.auto = true; d.layer = 'DIMS'; });
  return dims;
}

/* The geometry a section sheet is really about: its band clipped to the
 * body, grown to include every instance of the parts scoped to it. A 14 ft
 * leg in a 3.5 ft band gets the whole leg; a 132 ft tank gets the whole
 * tank, and the scale follows from that instead of from the band. */
export function sectionGeo(entities, scopedParts, sec, body){
  const band = sec && sec.bbox ? sec.bbox : body;
  const clamped = [
    Math.max(band[0], body[0]), Math.max(band[1], body[1]),
    Math.min(band[2], body[2]), Math.min(band[3], body[3])
  ];
  const box = (clamped[0] > clamped[2] || clamped[1] > clamped[3]) ? band.slice() : clamped;
  /* Measure what is actually drawn in the band rather than inheriting the
   * band itself; a band is full body width by construction, the part is not. */
  let geo = measureInBox(entities, box) || box;
  (scopedParts || []).forEach(pt => {
    if (!pt || !pt.mark) return;
    const group = (entities || []).filter(e => e && e.mark && String(e.mark) === String(pt.mark) && !SKIP_TYPES[e.type] && !SKIP_LAYERS[e.layer]);
    instanceBBoxes(group).forEach(b => {
      geo = [Math.min(geo[0], b[0]), Math.min(geo[1], b[1]), Math.max(geo[2], b[2]), Math.max(geo[3], b[3])];
    });
  });
  return geo;
}

/* Room for the section's own dims outside the geometry. */
export function sectionDimPad(geo){
  const w = Math.max(geo[2] - geo[0], 0.5);
  const h = Math.max(geo[3] - geo[1], 0.5);
  const textH = Math.max(0.35, Math.min(w, h) / 16);
  const off = Math.max(1.2, Math.min(w, h) * 0.18);
  return { off, textH, pad: off + textH * 2.2 };
}

/* The window a section sheet fits: its geometry, its callout labels, and
 * clearance for its dims. Sized from the part, not from the body, so each
 * sheet earns its own scale. */
export function sectionFit(entities, scopedParts, sec, body){
  const geo = sectionGeo(entities, scopedParts, sec, body);
  const d = sectionDimPad(geo);
  let fit = [geo[0] - d.pad, geo[1] - d.pad, geo[2], geo[3]];
  const band = sec && sec.bbox ? sec.bbox : geo;
  (entities || []).forEach(e => {
    if (!e || (e.type !== 'text' && e.type !== 'leader' && e.type !== 'callout')) return;
    const eb = [1e9, 1e9, -1e9, -1e9];
    entBBox(e, eb);
    if (eb[0] > 1e8) return;
    const cy = (eb[1] + eb[3]) / 2, cx = (eb[0] + eb[2]) / 2;
    if (cx < band[0] - 0.5 || cx > band[2] + 8 || cy < band[1] - 0.5 || cy > band[3] + 0.5) return;
    fit = [Math.min(fit[0], eb[0]), Math.min(fit[1], eb[1]), Math.max(fit[2], eb[2]), Math.max(fit[3], eb[3])];
  });
  const padOut = Math.max(0.4, Math.min(geo[2] - geo[0], geo[3] - geo[1]) * 0.04);
  return { geo, fit: [fit[0] - padOut, fit[1] - padOut, fit[2] + padOut, fit[3] + padOut] };
}

/* Width and height of each section's geometry, stamped as dims that exist
 * only on that sheet. The overall keeps the envelope dims; a detail sheet
 * carries the measurements of the thing it details. */
export function sectionDims(entities, layouts){
  const out = [];
  (layouts || []).forEach(L => {
    if (!L || L.kind !== 'section' || !L.section || !L.section.geo) return;
    const geo = L.section.geo;
    const w = Math.max(geo[2] - geo[0], 0);
    const h = Math.max(geo[3] - geo[1], 0);
    if (w < 0.4 && h < 0.4) return;
    const d = sectionDimPad(geo);
    const style = Object.assign({}, defaultDimStyle(), { textHeight: d.textH });
    const dims = [];
    if (h >= 0.4) dims.push(applyStyleToDim(alignedDim([geo[0], geo[1]], [geo[0], geo[3]], -d.off, style), style));
    if (w >= 0.4) dims.push(applyStyleToDim(alignedDim([geo[0], geo[1]], [geo[2], geo[1]], -d.off, style), style));
    dims.forEach(dim => {
      dim.auto = true;
      dim.layer = 'DIMS';
      dim.visibleIn = [L.id];
      out.push(dim);
    });
  });
  return out;
}

export function padForLabels(bbox, body, kind){
  const bw = Math.max((body[2] - body[0]), 1);
  const bh = Math.max((body[3] - body[1]), 0.5);
  const vertical = bh >= bw * 0.7;
  if (kind === 'section'){
    /* Isolate this room / station. Do not expand to the whole body. */
    const pad = vertical ? Math.max(1.2, bw * 0.15) : 0.45;
    const labelW = vertical ? Math.max(4, bw * 0.9) : 0.7;
    return [bbox[0] - pad, bbox[1] - 0.35, bbox[2] + labelW, bbox[3] + 0.35];
  }
  const pad = Math.max(2, Math.min(bw, bh) * 0.15);
  const labelW = vertical ? Math.max(8, bw * 1.8) : Math.max(2, bw * 0.12);
  return [
    bbox[0] - pad,
    bbox[1],
    Math.max(bbox[2], body[2]) + labelW,
    bbox[3]
  ];
}