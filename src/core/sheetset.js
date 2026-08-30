/* Sheet-set generator: split a model into CAD pages (cover, overall, one
 * sheet per room or labeled section) with a live legend and a parts schedule
 * (qty, size) on each page so the print can be built from.
 *
 * Viewports are windowed onto existing geometry. Legends and schedules are
 * derived tables placed as sheet-space annotations so they keep their size
 * at any plot scale.
 */
import { membersBBox } from './entities.js';
import { makeLayout, makeViewport, fitViewport, sheetOf, PLOT_SCALES, pickSheetForBBox, modelToPaper, inViewport } from './layout.js';
import { normalizeSheet } from './document.js';
import { placeInMargin, makeTableAnnotation, addAnnotation, makeNote } from './sheetspace.js';
import { entsInBBox, collectCallouts, padBBox, buildLegend, legendToTable, indexToTable } from './legend.js';
import { bodyBBox, collectParts, partsInBBox, partsToTable, buildingSchedule, specNotes, specColW, padForLabels } from './spec.js';

const MAX_SECTIONS = 10;
const PAPER_ROW_H = 0.22;

export function titleCase(s){
  return String(s || '').toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

export function sheetTitle(s){
  const t = String(s || '').trim();
  if (!t) return 'Section';
  if (/[0-9/]/.test(t) && t === t.toUpperCase()) return t;
  return titleCase(t);
}

function modelBBox(entities){
  const body = bodyBBox(entities);
  if (body && body[0] < 1e8) return body;
  const skip = (entities || []).filter(e => e.type !== 'table' && e.layer !== 'SCHEDULES' && e.layer !== 'UNDERLAY');
  const src = skip.length ? skip : (entities || []);
  if (!src.length) return [0, 0, 10, 8];
  return membersBBox(src);
}

function roomSections(entities){
  const rooms = (entities || []).filter(e => e.type === 'room' && e.pts && e.pts.length >= 3).map(r => {
    const bb = [1e9, 1e9, -1e9, -1e9];
    r.pts.forEach(p => {
      if (p[0] < bb[0]) bb[0] = p[0];
      if (p[1] < bb[1]) bb[1] = p[1];
      if (p[0] > bb[2]) bb[2] = p[0];
      if (p[1] > bb[3]) bb[3] = p[1];
    });
    return {
      name: r.name || 'ROOM',
      bbox: padBBox(bb, 0.8),
      source: 'room',
      area: r.area,
      cx: (bb[0] + bb[2]) / 2,
      cy: (bb[1] + bb[3]) / 2
    };
  });
  rooms.sort((a, b) => (a.cx - b.cx) || (b.cy - a.cy));
  return rooms;
}

function bandSections(callouts, overall){
  if (!callouts.length) return [];
  if (callouts.length === 1){
    const c = callouts[0];
    return [{ name: c.name, bbox: padBBox([c.x - 6, c.y - 6, c.x + 6, c.y + 6], 0), source: 'callout' }];
  }
  const xs = callouts.map(c => c.x), ys = callouts.map(c => c.y);
  const dx = Math.max.apply(null, xs) - Math.min.apply(null, xs);
  const dy = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  const vertical = dy >= dx * 0.7;
  const sorted = callouts.slice().sort((a, b) => vertical ? b.y - a.y : a.x - b.x);
  return sorted.map((c, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    let bbox;
    if (vertical){
      const yTop = prev ? (prev.y + c.y) / 2 : overall[3];
      const yBot = next ? (c.y + next.y) / 2 : overall[1];
      bbox = [overall[0], Math.min(yBot, yTop), overall[2], Math.max(yBot, yTop)];
    } else {
      const x0 = prev ? (prev.x + c.x) / 2 : overall[0];
      const x1 = next ? (c.x + next.x) / 2 : overall[2];
      bbox = [Math.min(x0, x1), overall[1], Math.max(x0, x1), overall[3]];
    }
    return { name: c.name, bbox, source: 'callout' };
  });
}

function unionBBox(a, b){
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3])
  ];
}

function mergeSectionName(a, b){
  const left = String(a.name || '').split(' / ')[0].split(' – ')[0];
  const right = String(b.name || '').split(' / ').pop().split(' – ').pop();
  if (!left) return right || 'Section';
  if (!right || left === right) return left;
  const n = left + ' / ' + right;
  return n.length <= 42 ? n : left + ' +';
}

/* When a stack has more labeled parts than MAX_SECTIONS, fold neighboring
 * bands together (smallest span first) so nose and engines both stay on the
 * set. Dropping by bbox area used to throw away the tips. */
function capSections(sections){
  if (!sections || sections.length <= MAX_SECTIONS) return sections || [];
  const out = sections.slice();
  const cx = s => (s.bbox[0] + s.bbox[2]) / 2;
  const cy = s => (s.bbox[1] + s.bbox[3]) / 2;
  const xs = out.map(cx), ys = out.map(cy);
  const dx = Math.max.apply(null, xs) - Math.min.apply(null, xs);
  const dy = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  const vertical = dy >= dx * 0.7;
  while (out.length > MAX_SECTIONS){
    let bestI = 0, best = Infinity;
    for (let i = 0; i < out.length - 1; i++){
      const u = unionBBox(out[i].bbox, out[i + 1].bbox);
      const span = vertical ? (u[3] - u[1]) : (u[2] - u[0]);
      if (span < best){ best = span; bestI = i; }
    }
    const a = out[bestI], b = out[bestI + 1];
    out.splice(bestI, 2, {
      name: mergeSectionName(a, b),
      bbox: unionBBox(a.bbox, b.bbox),
      source: a.source || b.source || 'callout'
    });
  }
  return out;
}

export function detectSections(entities){
  const overall = modelBBox(entities);
  let sections = roomSections(entities);
  if (sections.length < 2){
    const callouts = collectCallouts(entities).filter(c => {
      const u = c.name.toUpperCase();
      return !sections.some(s => String(s.name).toUpperCase() === u);
    });
    if (callouts.length >= 2) sections = bandSections(callouts, overall);
    else if (!sections.length && callouts.length === 1){
      sections = bandSections(callouts, overall);
    }
  }
  sections = capSections(sections);
  return { overall, sections };
}

function legendGutter(sheetKey, kind){
  const s = sheetOf(sheetKey);
  if (kind === 'cover'){
    if (s.w <= 12) return 3.4;
    if (s.w <= 18) return 4.6;
    if (s.w <= 24) return 6.0;
    return 6.8;
  }
  if (s.w <= 12) return 2.4;
  if (s.w <= 18) return 3.2;
  return 4.0;
}

function legendColW(sheetKey){
  const g = legendGutter(sheetKey);
  if (g <= 2.5) return [0.9, 1.4];
  if (g <= 3.3) return [1.15, 1.9];
  return [1.35, 2.25];
}

/* Leave a right-hand gutter so the legend / spec sits in true margin. */
function makePlanViewport(sheetKey, ppf, kind){
  const vp = makeViewport(sheetKey, ppf);
  vp.pw = Math.max(6, vp.pw - legendGutter(sheetKey, kind));
  return vp;
}

function tablePaperSize(t){
  const rowH = t.rowH || PAPER_ROW_H;
  const w = (t.colW || []).reduce((a, b) => a + b, 0);
  const h = ((t.cells || []).length + (t.title ? 1 : 0)) * rowH;
  return [w, h];
}

function placeTable(sheet, table){
  table.rowH = table.rowH || PAPER_ROW_H;
  const slot = placeInMargin(sheet, tablePaperSize(table));
  if (!slot) return sheet;
  return addAnnotation(sheet, makeTableAnnotation(slot.x, slot.y, table));
}

function buildSheet(opts, bbox){
  const sheet = opts.sheet || 'archd';
  const ppf = opts.ppf || 18;
  const layout = makeLayout({
    id: opts.id,
    name: opts.name,
    sheet,
    ppf,
    viewports: [makePlanViewport(sheet, ppf, opts.kind)]
  });
  layout.kind = opts.kind;
  layout.section = opts.section || null;
  layout.sheetNumber = opts.sheetNumber;
  if (bbox && bbox[0] < 1e8){
    fitViewport(layout.viewports[0], bbox, opts.kind === 'cover' ? 0.82 : 0.88);
  }
  layout.ppf = layout.viewports[0].ppf;
  const out = normalizeSheet(layout, 0);
  out.sheetNumber = opts.sheetNumber;
  if (out.viewports[0]){
    out.viewports[0].name = opts.viewName || (opts.kind === 'cover' ? 'COVER' : 'PLAN');
    out.viewports[0].drawingType = 'plan';
  }
  return out;
}

function stampMarks(layout, parts){
  const vp = layout && layout.viewports && layout.viewports[0];
  if (!vp || !parts || !parts.length) return layout;
  let out = layout;
  parts.forEach(p => {
    const xy = modelToPaper(vp, p.x, p.y);
    if (!inViewport(vp, xy[0], xy[1])) return;
    out = addAnnotation(out, makeNote(xy[0] + 0.08, xy[1] + 0.08, p.mark, { size: 0.11 }));
  });
  return out;
}

export function generateSheetSet(entities, layers, opts){
  opts = opts || {};
  const detected = detectSections(entities);
  const body = bodyBBox(entities);
  const sheet = opts.sheet || pickSheetForBBox(detected.overall);
  const parts = collectParts(entities);
  const layouts = [];
  const coverFit = padForLabels(detected.overall, body);

  layouts.push(buildSheet({
    id: 'G001',
    sheetNumber: 'G-001',
    name: 'G-001 Cover & Index',
    kind: 'cover',
    sheet,
    ppf: 18,
    viewName: 'COVER'
  }, coverFit));

  layouts.push(buildSheet({
    id: 'A101',
    sheetNumber: 'A-101',
    name: 'A-101 Overall',
    kind: 'overall',
    sheet,
    ppf: 18,
    viewName: 'PLAN',
    section: { bbox: detected.overall, name: 'Overall', source: 'overall' }
  }, coverFit));

  detected.sections.forEach((sec, i) => {
    const num = 'A-' + String(102 + i);
    const title = sheetTitle(sec.name);
    const fit = padForLabels(sec.bbox, body);
    layouts.push(buildSheet({
      id: 'A' + (102 + i),
      sheetNumber: num,
      name: num + ' ' + title,
      kind: 'section',
      sheet,
      ppf: 18,
      viewName: 'PLAN',
      section: { bbox: sec.bbox, name: sec.name, source: sec.source }
    }, fit));
  });

  const colW = legendColW(sheet);
  const pColW = specColW(parts.some(p => p.material));
  return layouts.map(L => {
    let out = L;
    if (out.kind === 'cover'){
      out = placeTable(out, indexToTable(layouts, { colW: [colW[0], colW[1]] }));
      if (parts.length){
        out = placeTable(out, partsToTable(parts, { title: 'PARTS SCHEDULE', colW: pColW }));
      } else {
        const b = buildingSchedule(entities);
        if (b) out = placeTable(out, b);
      }
    } else if (out.kind === 'section' && parts.length){
      const scoped = partsInBBox(parts, out.section && out.section.bbox, 0.5);
      if (scoped.length){
        out = placeTable(out, partsToTable(scoped, { title: 'SPECIFICATIONS', colW: pColW }));
      }
    }
    const legend = legendForLayout(out, entities, layers, {
      skipCallouts: parts.length && (out.kind === 'cover' || out.kind === 'section'),
      notes: specNotes(body, out.kind === 'section' ? partsInBBox(parts, out.section && out.section.bbox, 0.5) : parts)
    });
    out = placeTable(out, legendToTable(legend, { colW }));
    if (out.kind !== 'cover' && parts.length){
      const scoped = out.kind === 'section'
        ? partsInBBox(parts, out.section && out.section.bbox, 0.5)
        : parts;
      out = stampMarks(out, scoped);
    }
    return out;
  });
}

export function legendForLayout(layout, entities, layers, extra){
  const sec = layout && layout.section;
  const subset = sec && sec.bbox ? entsInBBox(entities, sec.bbox, 0.5) : (entities || []);
  const title = layout && layout.kind === 'cover' ? 'GENERAL LEGEND' : 'LEGEND';
  const o = extra || {};
  return buildLegend(subset, layers, {
    title,
    partsTitle: layout && layout.kind === 'section' ? 'THIS SHEET' : 'PARTS / CALLOUTS',
    skipCallouts: !!o.skipCallouts,
    notes: o.notes
  });
}

export function scaleOf(layout){
  const ppf = (layout && layout.viewports && layout.viewports[0] && layout.viewports[0].ppf) || (layout && layout.ppf) || 18;
  const s = PLOT_SCALES.find(x => Math.abs(x.ppf - ppf) < 0.01);
  return s ? s.lbl : (ppf + ' pt/ft');
}

export { modelBBox };
