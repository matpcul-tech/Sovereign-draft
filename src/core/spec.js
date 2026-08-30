/* Derived build specifications for a sheet set.
 *
 * Labels and marks become a parts schedule with quantity and size. Envelope
 * dimensions (overall height and width) are stamped when the model has none,
 * so a printed set can actually be built from — not just looked at.
 */
import { membersBBox } from './entities.js';
import { alignedDim, defaultDimStyle, applyStyleToDim } from './dimStyle.js';
import { fmtFtIn } from './format.js';
import { makeTable, roomRows, doorRows } from './schedule.js';
import { collectCallouts, isCalloutText, padBBox } from './legend.js';

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

function spanFor(sorted, i, body, vertical){
  const c = sorted[i];
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  if (vertical){
    const yTop = prev ? (prev.y + c.y) / 2 : body[3];
    const yBot = next ? (c.y + next.y) / 2 : body[1];
    return Math.abs(yTop - yBot);
  }
  const x0 = prev ? (prev.x + c.x) / 2 : body[0];
  const x1 = next ? (c.x + next.x) / 2 : body[2];
  return Math.abs(x1 - x0);
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
  const across = vertical ? w : h;
  return sorted.map((c, i) => {
    const src = calloutEntity(ents, c.name);
    const attrs = (src && src.attributes) || {};
    const qty = parseQty(c.name, attrs);
    const desc = cleanPartName(attrs.label || attrs.type || c.name);
    const span = spanFor(sorted, i, body, vertical);
    const size = attrs.size
      ? String(attrs.size)
      : (fmtFtIn(span) + ' × ' + fmtFtIn(across));
    const mark = (src && src.mark) || ('P-' + String(i + 1).padStart(2, '0'));
    return {
      mark: String(mark),
      qty,
      desc: desc || c.name,
      size,
      material: (attrs.material && !attrs.materialInvented) ? String(attrs.material) : '',
      x: c.x,
      y: c.y
    };
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

export function specNotes(body, parts){
  const b = body || [0, 0, 0, 0];
  const w = Math.max(b[2] - b[0], 0);
  const h = Math.max(b[3] - b[1], 0);
  const notes = [];
  if (w > 0.05 && h > 0.05){
    notes.push('Envelope ' + fmtFtIn(w) + ' x ' + fmtFtIn(h) + '.');
  }
  const n = (parts || []).reduce((s, p) => s + (Number(p.qty) || 0), 0);
  if (n){
    notes.push(n + ' part' + (n === 1 ? '' : 's') + '. Station x outline width.');
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

export function padForLabels(bbox, body){
  const bw = Math.max((body[2] - body[0]), 1);
  const bh = Math.max((body[3] - body[1]), 0.5);
  const vertical = bh >= bw * 0.7;
  const pad = Math.max(2, Math.min(bw, bh) * 0.15);
  /* Tall stacks keep a leader column. Floor plans only need a small margin. */
  const labelW = vertical ? Math.max(8, bw * 1.8) : Math.max(2, bw * 0.12);
  return [
    bbox[0] - pad,
    bbox[1],
    Math.max(bbox[2], body[2]) + labelW,
    bbox[3]
  ];
}
