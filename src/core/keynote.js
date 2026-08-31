/* Keynote legends and mark schedules.
 *
 * Both are derived, never authored. An entity carries a mark and a bag of
 * attributes; a legend and a schedule are two readings of the same data.
 * Nine engines are nine entities marked E-1 through E-9, or one entity marked
 * E with qty 9, and both spellings tabulate the same way.
 *
 * A legend is scoped to a sheet: it lists only what is actually visible in
 * that sheet's views, which is the whole reason a legend belongs to a sheet
 * and not to the drawing.
 *
 * SIZE is measured from that mark's geometry (the same bbox path stretch / AA
 * use). Authored attributes.size wins. A constant stamped onto every different
 * part loses to the measurement. Copies of one mark measure one instance, not
 * the envelope of all of them.
 */
import { modelToPaper, inViewport } from './layout.js';
import { entBBox, membersBBox } from './entities.js';
import { makeTable } from './schedule.js';
import { fmtFtIn } from './format.js';
import { ptInBox } from './geometry.js';
import { bodyBBox, measureInBox, collectParts, partsToTable } from './spec.js';

const SKIP_MEASURE = { text: 1, leader: 1, callout: 1, table: 1, dim: 1, room: 1, grid: 1 };
const SKIP_LAYER = { NOTES: 1, TEXT: 1, SCHEDULES: 1, DIMS: 1, UNDERLAY: 1, DEFPOINTS: 1 };

/* The model rectangle a view shows, as [x0, y0, x1, y1] in model units. */
export function viewModelWindow(view){
  if (!view) return [0, 0, 0, 0];
  const ftPerIn = 72 / (view.ppf || 18);
  const halfW = (view.pw || 0) / 2 * ftPerIn;
  const halfH = (view.ph || 0) / 2 * ftPerIn;
  const cx = view.mx || 0, cy = view.my || 0;
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

function bboxOf(e){
  const bb = [1e9, 1e9, -1e9, -1e9];
  entBBox(e, bb);
  return bb;
}

function overlaps(a, b){
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
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

function geomOf(ents){
  const geom = (ents || []).filter(e => e && !SKIP_MEASURE[e.type] && !SKIP_LAYER[e.layer]);
  return geom.length ? geom : [];
}

/* One instance of a mark, not the envelope of every copy. When qty is 9 and
 * nine engines sit on the page, size is one engine. An assembly (several
 * nearby pieces, qty 1) still unions. A mark that lives only on a callout
 * measures the body in that station — not the envelope, not the label. */
export function measureMark(g, universe){
  const geom = geomOf(g && g.entities);
  if (geom.length){
    if ((g.qty || 1) > 1 && geom.length > 1){
      const n = Math.max(1, Math.round(geom.length / g.qty));
      const sorted = geom.slice().sort((a, b) => {
        const A = bboxOf(a), B = bboxOf(b);
        return (A[0] - B[0]) || (A[1] - B[1]);
      });
      return fmtSize(membersBBox(sorted.slice(0, n)));
    }
    return fmtSize(membersBBox(geom));
  }
  if (universe && universe.length) return measureStation(g, universe);
  return '';
}

function anchorOf(g){
  const ents = (g && g.entities) || [];
  for (let i = 0; i < ents.length; i++){
    const e = ents[i];
    if (!e) continue;
    if (e.anchor && e.anchor.length >= 2) return [Number(e.anchor[0]), Number(e.anchor[1])];
    if (e.type === 'callout' && e.pts && e.pts[0]) return [e.pts[0][0], e.pts[0][1]];
    if (e.type === 'text' && e.x != null) return [e.x, e.y];
  }
  if (ents[0]){
    const bb = bboxOf(ents[0]);
    if (bb[0] < 1e8) return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  }
  return null;
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

function measureStation(g, universe){
  const pos = anchorOf(g);
  if (!pos) return '';
  const body = bodyBBox(universe);
  if (!body || body[0] > 1e8) return '';
  const vertical = (body[3] - body[1]) >= (body[2] - body[0]) * 0.7;
  const others = collectMarks(universe).map(m => {
    const p = anchorOf(m);
    return p ? { mark: m.mark, x: p[0], y: p[1] } : null;
  }).filter(Boolean);
  if (!others.length) return '';
  const sorted = others.slice().sort((a, b) => vertical ? b.y - a.y : a.x - b.x);
  const i = sorted.findIndex(o => o.mark === g.mark);
  if (i < 0) return '';
  return fmtSize(measureInBox(universe, stationBox(sorted, i, body, vertical))) || '';
}

/* A size string written onto every different part is a stamp, not a spec. */
function stampedSize(groups){
  const list = groups || [];
  const nonempty = list.map(g => String((g.attributes && g.attributes.size) || '').trim()).filter(Boolean);
  if (nonempty.length < 2) return '';
  const first = nonempty[0];
  if (!nonempty.every(s => s === first)) return '';
  const types = new Set(list.map(g => String((g.attributes && (g.attributes.type || g.attributes.label)) || g.label || g.type || '').toLowerCase()));
  return types.size > 1 ? first : '';
}

function looksStamped(s){
  const t = String(s || '').trim();
  return /^x\s*[x×]/i.test(t);
}

function sizeCell(g, stamp, universe){
  const authored = g.attributes && g.attributes.size != null ? String(g.attributes.size).trim() : '';
  if (authored && authored !== stamp && !looksStamped(authored)) return authored;
  return measureMark(g, universe) || '';
}

/* Entities at least partly inside a view. A dim belongs only when both
 * origins sit in the window — bbox overlap lets a 230 ft envelope leak onto
 * every detail sheet, and its text then lands at the span midpoint. */
export function entitiesInView(entities, view){
  const win = viewModelWindow(view);
  return (entities || []).filter(e => {
    if (e && e.type === 'dim'){
      if (e.x1 == null || e.y1 == null || e.x2 == null || e.y2 == null) return false;
      return ptInBox(e.x1, e.y1, win) && ptInBox(e.x2, e.y2, win);
    }
    const bb = bboxOf(e);
    if (bb[0] > 1e8) return false;
    return overlaps(bb, win);
  });
}

/* Entities visible anywhere on a sheet, across all of its views. */
export function entitiesOnSheet(entities, sheet){
  const views = (sheet && sheet.viewports) || [];
  if (!views.length) return [];
  const seen = new Set();
  const out = [];
  views.forEach(v => {
    entitiesInView(entities, v).forEach(e => {
      const key = e.id != null ? e.id : e;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(e);
    });
  });
  return out;
}

/* Group marked entities into one row per mark.
 * qty is the sum of each entity's own qty attribute, defaulting to one, so
 * "nine instances" and "one instance with qty 9" both come out as 9. */
export function collectMarks(entities){
  const byMark = new Map();
  (entities || []).forEach(e => {
    if (!e || !e.mark) return;
    const mark = String(e.mark);
    const attrs = e.attributes || {};
    const qty = Number(attrs.qty);
    const add = isFinite(qty) && qty > 0 ? qty : 1;
    const existing = byMark.get(mark);
    if (existing){
      existing.qty += add;
      existing.entities.push(e);
      /* First non-empty value wins, so one tagged instance describes the set. */
      Object.keys(attrs).forEach(k => {
        if (k === 'qty') return;
        if (existing.attributes[k] == null || existing.attributes[k] === '') existing.attributes[k] = attrs[k];
      });
      if (!existing.label && labelOf(e)) existing.label = labelOf(e);
    } else {
      byMark.set(mark, {
        mark,
        label: labelOf(e),
        type: attrs.type || '',
        qty: add,
        attributes: Object.assign({}, attrs),
        entities: [e]
      });
    }
  });
  return [...byMark.values()].sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true }));
}

function labelOf(e){
  if (!e) return '';
  const a = e.attributes || {};
  return String(a.label || a.type || e.content || e.name || '');
}

/* Legend rows for one sheet: mark and label, only what the sheet shows. */
export function keynoteRows(entities, sheet){
  const scoped = sheet ? entitiesOnSheet(entities, sheet) : entities;
  return collectMarks(scoped).map(g => [g.mark, g.label || g.type || '']);
}

export function buildKeynoteLegend(entities, sheet, at, opts){
  const o = opts || {};
  const p = at || [0, 0];
  return makeTable({
    title: o.title || 'KEYNOTE LEGEND',
    headers: ['MARK', 'DESCRIPTION'],
    rows: keynoteRows(entities, sheet),
    colW: o.colW || [3, 12],
    layer: o.layer || 'SCHEDULES',
    x: p[0], y: p[1]
  });
}

/* Schedule rows: mark, qty and any extra attribute columns asked for.
 * The size column is measured when attributes.size is empty or stamped. */
export function markScheduleRows(entities, sheet, columns){
  const scoped = sheet ? entitiesOnSheet(entities, sheet) : entities;
  const cols = columns && columns.length ? columns : ['type', 'material', 'size'];
  const groups = collectMarks(scoped);
  const stamp = stampedSize(groups);
  return groups.map(g => {
    const row = [g.mark, String(g.qty)];
    cols.forEach(c => {
      if (String(c).toLowerCase() === 'size'){
        row.push(sizeCell(g, stamp, scoped));
        return;
      }
      row.push(g.attributes[c] == null ? '' : String(g.attributes[c]));
    });
    return row;
  });
}

export function buildMarkSchedule(entities, sheet, at, opts){
  const o = opts || {};
  const p = at || [0, 0];
  const cols = o.columns && o.columns.length ? o.columns : ['type', 'material', 'size'];
  return makeTable({
    title: o.title || 'SCHEDULE',
    headers: ['MARK', 'QTY'].concat(cols.map(c => String(c).toUpperCase())),
    rows: markScheduleRows(entities, sheet, cols),
    colW: o.colW || [3, 2.4].concat(cols.map(() => 4.5)),
    layer: o.layer || 'SCHEDULES',
    x: p[0], y: p[1]
  });
}

/* Every attribute key present across the marked entities, so a schedule can
 * offer real columns rather than a guess. */
export function attributeKeys(entities){
  const keys = new Set();
  collectMarks(entities).forEach(g => {
    Object.keys(g.attributes || {}).forEach(k => { if (k !== 'qty') keys.add(k); });
  });
  return [...keys].sort();
}

/* Always include size so a schedule measures even when the AI omitted attrs.size. */
export function scheduleColumns(entities){
  const keys = attributeKeys(entities).filter(k => k !== 'qty' && k !== 'size');
  const prefer = ['type', 'label', 'material'];
  const ordered = [];
  prefer.forEach(k => { if (keys.indexOf(k) >= 0) ordered.push(k); });
  keys.forEach(k => { if (ordered.indexOf(k) < 0) ordered.push(k); });
  ordered.push('size');
  return ordered.slice(0, 4);
}

/* Rewrite derived keynote / mark / parts tables in place so a sheet that was
 * stamped with envelope sizes updates on the next draw. */
export function refreshDerivedTables(sheet, entities){
  if (!sheet || !sheet.annotations) return sheet;
  const scope = (sheet.viewports && sheet.viewports.length) ? sheet : null;
  sheet.annotations.forEach(a => {
    if (!a || a.kind !== 'table' || !a.table) return;
    const title = String(a.table.title || '').toUpperCase();
    if (title === 'KEYNOTE LEGEND'){
      a.table.cells = [['MARK', 'DESCRIPTION']].concat(keynoteRows(entities, scope));
      return;
    }
    if (title === 'PARTS SCHEDULE'){
      const t = partsToTable(collectParts(entities));
      if (t && t.cells) a.table.cells = t.cells;
      return;
    }
    if (title === 'SCHEDULE' || title === 'MARK SCHEDULE'){
      const head = (a.table.cells && a.table.cells[0] && a.table.cells[0].length > 1)
        ? a.table.cells[0]
        : ['MARK', 'QTY', 'TYPE', 'MATERIAL', 'SIZE'];
      let cols = head.slice(2).map(h => String(h).toLowerCase());
      if (cols.indexOf('size') < 0) cols = cols.concat(['size']);
      const rows = markScheduleRows(entities, scope, cols);
      a.table.cells = [['MARK', 'QTY'].concat(cols.map(c => String(c).toUpperCase()))].concat(rows);
    }
  });
  return sheet;
}

/* CSV of a mark schedule, for the same reason the door schedule has one. */
export function markScheduleCSV(entities, sheet, columns){
  const cols = columns && columns.length ? columns : ['type', 'material', 'size'];
  const head = ['MARK', 'QTY'].concat(cols.map(c => String(c).toUpperCase()));
  const rows = markScheduleRows(entities, sheet, cols);
  return [head].concat(rows)
    .map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(','))
    .join('\n');
}

void modelToPaper; void inViewport;

/* Paper-inch column widths so a legend on Arch D is readable, not a smear. */
export function paperKeynoteColW(){ return [0.8, 2.8]; }
export function paperScheduleColW(columns){
  const cols = columns && columns.length ? columns : ['type', 'material', 'size'];
  return [0.75, 0.5].concat(cols.map(c => {
    const k = String(c).toLowerCase();
    if (k === 'material') return 2.6;
    if (k === 'size') return 2.0;
    if (k === 'type' || k === 'label') return 2.2;
    return 1.7;
  }));
}
