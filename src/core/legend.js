/* Live legends for paper-space sheets. A legend is computed from the entities
 * that actually appear in a viewport (layers, symbols, callouts, hatches) so
 * each page of a sheet set carries the key for that section of the build.
 *
 * The result is a derived table. It is placed as a sheet-space annotation
 * (paper inches) so it keeps its size whatever scale the views are drawn at.
 */
import { entBBox } from './entities.js';
import { fmtFtIn } from './format.js';
import { HATCH_PATTERNS } from './hatch.js';
import { makeTable } from './schedule.js';

export const LAYER_MEANING = {
  WALLS:     'Structure',
  DOORS:     'Openings',
  FIXTURES:  'Equipment',
  DIMS:      'Dimensions',
  TEXT:      'Notes & labels',
  HATCH:     'Finishes',
  CENTER:    'Centerlines',
  SCHEDULES: 'Schedules',
  UNDERLAY:  'Reference (n.p.)',
  ROOMS:     'Rooms / areas',
  GRID:      'Column grid',
  PROFILE:   'Outline',
  NOTES:     'Notes & callouts',
  DEFPOINTS: 'Defpoints (n.p.)'
};

export const HATCH_MEANING = {
  ANSI31: 'Brick / 45° hatch',
  ANSI32: 'Steel / dense 45°',
  NET:    'Grid / net',
  SOLID:  'Solid fill'
};

export const GENERAL_NOTES = [
  'Do not scale this drawing.',
  'Dimensions are in feet and inches.',
  'Verify all existing conditions in the field.',
  'See cover sheet for the drawing index.'
];

export function boxesOverlap(a, b){
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function padBBox(bb, p){
  p = p == null ? 2 : p;
  return [bb[0] - p, bb[1] - p, bb[2] + p, bb[3] + p];
}

export function entsInBBox(entities, bbox, pad){
  if (!bbox) return entities || [];
  const box = pad ? padBBox(bbox, pad) : bbox;
  return (entities || []).filter(e => {
    if (e.layer === 'DEFPOINTS') return false;
    const eb = [1e9, 1e9, -1e9, -1e9];
    entBBox(e, eb);
    if (eb[0] > 1e8) return false;
    return boxesOverlap(eb, box);
  });
}

function layerOf(layers, name){
  return (layers || []).find(L => L.name === name) || null;
}

function symbolLabel(e){
  if (e.def === 'door') return 'Door';
  if (e.def === 'window') return 'Window';
  const n = e.name || e.def || 'Block';
  return String(n).replace(/^sym:/, '');
}

function symbolDesc(e){
  if (e.def === 'door') return (e.mark ? e.mark + ' · ' : '') + fmtFtIn(e.width || 3) + (e.swing === 'R' ? ' R' : ' L');
  if (e.def === 'window') return (e.mark ? e.mark + ' · ' : '') + fmtFtIn(e.width || 3);
  return e.mark || '';
}

/* TEXT / LEADER / CALLOUT labels that look like part or room names, not dims.
 * AI elevations emit type:'callout' with an anchor on the part — those are
 * always collected. Plain text still has to look like a name (mostly caps). */
export function isCalloutText(e){
  if (!e) return false;
  let t = '';
  if (e.type === 'text' || e.type === 'leader' || e.type === 'callout') t = String(e.content || '').trim();
  else return false;
  if (t.length < 3 || t.length > 64) return false;
  if (/schedule/i.test(t)) return false;
  if (/^[0-9.'\-x×\s"/]+$/i.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  if (e.type === 'callout') return true;
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  return upper > 0.55;
}

export function calloutAnchor(e){
  if (e.type === 'callout'){
    const a = e.anchor;
    let x, y;
    if (Array.isArray(a) && a.length >= 2){ x = a[0]; y = a[1]; }
    else if (a && typeof a === 'object' && a.x != null){ x = a.x; y = a.y; }
    if (x == null || y == null){
      const p = (e.pts && e.pts[0]) || null;
      if (!p) return null;
      x = p[0]; y = p[1];
    }
    return { x: Number(x), y: Number(y), name: String(e.content || '').trim() };
  }
  if (e.type === 'text') return { x: e.x, y: e.y, name: String(e.content || '').trim() };
  if (e.type === 'leader'){
    const last = (e.pts || [])[(e.pts || []).length - 1] || (e.pts || [])[0] || [0, 0];
    return { x: last[0], y: last[1], name: String(e.content || '').trim() };
  }
  return null;
}

export function collectCallouts(entities){
  const out = [];
  const seen = {};
  (entities || []).forEach(e => {
    if (!isCalloutText(e)) return;
    const a = calloutAnchor(e);
    if (!a || !a.name) return;
    const k = a.name.toUpperCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(a);
  });
  return out;
}

export function buildLegend(entities, layers, opts){
  opts = opts || {};
  const items = [];
  const used = {};
  (entities || []).forEach(e => {
    const n = e.layer || 'WALLS';
    used[n] = (used[n] || 0) + 1;
  });
  const layerNames = Object.keys(used).sort((a, b) => {
    const ia = (layers || []).findIndex(L => L.name === a);
    const ib = (layers || []).findIndex(L => L.name === b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }).filter(n => {
    const L = layerOf(layers, n);
    if (L && L.plot === false) return false;
    return n !== 'DEFPOINTS' && n !== 'UNDERLAY';
  });

  if (layerNames.length){
    items.push({ kind: 'header', name: 'LAYERS' });
    layerNames.forEach(n => {
      const L = layerOf(layers, n);
      items.push({
        kind: 'layer',
        name: n,
        desc: LAYER_MEANING[n] || n,
        swatch: (L && L.color) || '#8fa3c0',
        lt: (L && L.lt) || 'CONTINUOUS',
        count: used[n]
      });
    });
  }

  const inserts = (entities || []).filter(e => e.type === 'insert');
  if (inserts.length){
    items.push({ kind: 'header', name: 'SYMBOLS' });
    const by = {};
    inserts.forEach(e => {
      const key = (e.mark || '') + '|' + symbolLabel(e) + '|' + (e.def || '');
      if (!by[key]) by[key] = { e, n: 0 };
      by[key].n++;
    });
    Object.keys(by).forEach(k => {
      const { e, n } = by[k];
      const L = layerOf(layers, e.layer);
      items.push({
        kind: 'symbol',
        mark: e.mark || '',
        name: symbolLabel(e) + (n > 1 ? ' ×' + n : ''),
        desc: symbolDesc(e),
        swatch: (L && L.color) || '#00d4b8'
      });
    });
  }

  const callouts = collectCallouts(entities);
  if (callouts.length){
    items.push({ kind: 'header', name: opts.partsTitle || 'PARTS / CALLOUTS' });
    callouts.forEach((c, i) => {
      items.push({
        kind: 'callout',
        mark: String(i + 1),
        name: c.name,
        desc: '',
        swatch: '#4ade80'
      });
    });
  }

  const rooms = (entities || []).filter(e => e.type === 'room');
  if (rooms.length && !callouts.length){
    items.push({ kind: 'header', name: 'ROOMS' });
    rooms.forEach(r => {
      const sf = Math.round(r.area != null ? r.area : 0);
      items.push({
        kind: 'callout',
        mark: '',
        name: r.name || 'ROOM',
        desc: sf ? sf + ' SF' : '',
        swatch: '#4ade80'
      });
    });
  }

  const pats = {};
  (entities || []).forEach(e => {
    if (e.type === 'hatch' && e.pattern) pats[e.pattern] = (pats[e.pattern] || 0) + 1;
  });
  const patNames = Object.keys(pats);
  if (patNames.length){
    items.push({ kind: 'header', name: 'HATCH' });
    patNames.forEach(p => {
      const spec = HATCH_PATTERNS[p];
      items.push({
        kind: 'hatch',
        name: p,
        desc: HATCH_MEANING[p] || (spec && spec.name) || p,
        swatch: '#6b7c93'
      });
    });
  }

  return {
    title: opts.title || 'LEGEND',
    items,
    notes: opts.notes || GENERAL_NOTES.slice(0, 3)
  };
}

function itemRow(it){
  if (it.kind === 'header') return [it.name, ''];
  if (it.kind === 'symbol') return [it.mark || it.name, it.desc || it.name];
  if (it.kind === 'callout') return [it.mark || '', it.name + (it.desc ? '  ' + it.desc : '')];
  return [it.name || '', it.desc || ''];
}

/* Derived table sized for paper inches (rowH 0.22), ready to hang as a
 * sheet-space annotation. */
export function legendToTable(legend, opts){
  const o = opts || {};
  const rowH = o.rowH || 0.22;
  const colW = o.colW || [1.35, 2.25];
  const maxH = o.maxH || 18;
  const maxRows = Math.max(4, Math.floor(maxH / rowH) - 2);
  let rows = (legend && legend.items || []).map(itemRow);
  if (rows.length > maxRows){
    const left = rows.length - maxRows;
    rows = rows.slice(0, maxRows);
    rows.push(['+' + left + ' more', '']);
  }
  const notes = (legend && legend.notes) || [];
  if (notes.length && rows.length + notes.length + 2 <= maxRows + 6){
    rows.push(['NOTES', '']);
    notes.forEach((n, i) => rows.push([String(i + 1) + '.', n]));
  }
  return makeTable({
    title: (legend && legend.title) || 'LEGEND',
    headers: ['ITEM', 'MEANING'],
    rows,
    colW,
    rowH,
    layer: o.layer || 'SCHEDULES',
    x: 0, y: 0
  });
}

export function indexTitle(L){
  const n = (L && (L.sheetNumber || L.number)) || '';
  let t = (L && L.name) || '';
  if (n && t.indexOf(n) === 0) t = t.slice(n.length).replace(/^\s+/, '');
  return t || (L && L.kind) || 'Sheet';
}

export function indexToTable(layouts, opts){
  const o = opts || {};
  const rows = (layouts || []).map(L => [
    L.sheetNumber || L.number || '',
    indexTitle(L)
  ]);
  return makeTable({
    title: o.title || 'DRAWING INDEX',
    headers: ['SHEET', 'TITLE'],
    rows,
    colW: o.colW || [0.9, 2.7],
    rowH: o.rowH || 0.22,
    layer: o.layer || 'SCHEDULES',
    x: 0, y: 0
  });
}
