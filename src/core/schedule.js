/* Door / window / room takeoff. Marks live on INSERT (`mark`) and TEXT-in-hatch
 * rooms. A `table` entity is ordinary geometry for move/copy/explode.
 */
import { polyArea, polyCentroid, pointInPoly } from './geometry.js';
import { fmtFtIn } from './format.js';
import { clFromMembers } from './dynblock.js';
import { wrapPaperText } from './titleblock.js';

export function nextMark(entities, prefix){
  let max = 0;
  (entities || []).forEach(e => {
    const m = String(e.mark || '');
    if (m.indexOf(prefix) === 0){
      const n = parseInt(m.slice(prefix.length), 10);
      if (isFinite(n) && n > max) max = n;
    }
  });
  const n = max + 1;
  return prefix + (n < 10 ? '0' + n : String(n));
}

export function tagInserts(entities){
  let n = 0;
  (entities || []).forEach(e => {
    if (e.type !== 'insert') return;
    if (e.mark) return;
    if (e.def === 'door'){ e.mark = nextMark(entities, 'D'); n++; }
    else if (e.def === 'window'){ e.mark = nextMark(entities, 'W'); n++; }
  });
  return n;
}

function wallName(entities, host){
  if (!host) return '—';
  const members = (entities || []).filter(e => e.g === host);
  const cl = clFromMembers(members);
  if (!cl) return host;
  const dx = Math.abs(cl.x2 - cl.x1), dy = Math.abs(cl.y2 - cl.y1);
  if (dx >= dy) return cl.y1 < 8 ? 'SOUTH' : (cl.y1 > 16 ? 'NORTH' : 'INT-X');
  return cl.x1 < 8 ? 'WEST' : (cl.x1 > 20 ? 'EAST' : 'INT-Y');
}

export function doorRows(entities){
  tagInserts(entities);
  return (entities || []).filter(e => e.type === 'insert' && e.def === 'door').map(e => ([
    e.mark || 'D',
    fmtFtIn(e.width || 3),
    e.swing === 'R' ? 'R' : 'L',
    wallName(entities, e.host)
  ]));
}

export function windowRows(entities){
  tagInserts(entities);
  return (entities || []).filter(e => e.type === 'insert' && e.def === 'window').map(e => ([
    e.mark || 'W',
    fmtFtIn(e.width || 3),
    fmtFtIn(e.th || 0.5),
    wallName(entities, e.host)
  ]));
}

/* An area is not a length: 86.3 SF through the feet-inches formatter
 * printed 86'-3" (and pdfSafe stripped the superscript that was meant
 * to excuse it). The AREA column now carries what a schedule wants
 * beside the square feet: the room's plan dimensions. */
function planDims(pts){
  if (!pts || pts.length < 3) return '';
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts){
    if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
  }
  return fmtFtIn(x1 - x0) + ' x ' + fmtFtIn(y1 - y0);
}

export function roomRows(entities){
  const live = (entities || []).filter(h => h.type === 'room');
  if (live.length){
    return live.map(h => {
      const area = h.area != null ? h.area : Math.abs(polyArea(h.pts || []));
      /* The FINISH column is a finish. It used to print the word LIVE,
       * an internal marker meaning "this row came from a room entity
       * rather than a hatch", straight onto issued paper. */
      const finish = String(h.finish || '').trim().toUpperCase();
      return [h.name || 'ROOM', planDims(h.pts), area.toFixed(1) + ' SF', finish || '-'];
    });
  }
  const rooms = [];
  (entities || []).forEach(h => {
    if (h.type !== 'hatch' || !h.pts || h.pts.length < 3) return;
    const texts = (entities || []).filter(t => t.type === 'text' && pointInPoly(t.x, t.y, h.pts));
    const name = texts[0] ? String(texts[0].content || 'ROOM') : 'ROOM';
    const area = Math.abs(polyArea(h.pts));
    rooms.push([name, planDims(h.pts), (area).toFixed(1) + ' SF', h.pattern || 'ANSI31']);
  });
  return rooms;
}

export function makeTable(opts){
  opts = opts || {};
  const headers = opts.headers || [];
  const rows = opts.rows || [];
  const cells = [headers].concat(rows);
  const cols = Math.max(1, ...cells.map(r => r.length));
  const colW = opts.colW || Array.from({ length: cols }, () => (opts.width || 4));
  return {
    type: 'table',
    layer: opts.layer || 'TEXT',
    x: opts.x || 0,
    y: opts.y || 0,
    colW,
    rowH: opts.rowH || 0.85,
    title: opts.title || '',
    /* Header on top is how a schedule reads; the Y-up default drew the
     * header row at the bottom with the caption underneath, upside down
     * on every issued sheet. Explicit fromTop: false keeps the old
     * behaviour for anything that wants it. */
    fromTop: opts.fromTop !== false,
    cells
  };
}

export function tableSize(e){
  const w = (e.colW || []).reduce((a, b) => a + b, 0) || 12;
  const rows = (e.cells || []).length + (e.title ? 1 : 0);
  return [w, rows * (e.rowH || 0.85)];
}

export function tableCorners(e){
  const [w, h] = tableSize(e);
  return [[e.x, e.y], [e.x + w, e.y], [e.x + w, e.y + h], [e.x, e.y + h]];
}


function tableFragsFromTop(e){
  const fr = [];
  const rowH = e.rowH || 0.22;
  const colW = e.colW || [];
  const cells = e.cells || [];
  const w = colW.reduce((a, b) => a + b, 0);
  const n = cells.length;
  const titleH = e.title ? rowH : 0;
  const totalH = (n + (e.title ? 1 : 0)) * rowH;
  const top = e.y + totalH;
  if (e.title){
    fr.push({
      type: 'text', layer: e.layer || 'TEXT',
      x: e.x + 0.12, y: top - rowH + rowH * 0.28,
      size: 0.13, content: e.title, maxW: Math.max(0.4, w - 0.24)
    });
  }
  const gridTop = top - titleH;
  const gridBottom = gridTop - n * rowH;
  for (let r = 0; r <= n; r++){
    const yy = gridTop - r * rowH;
    fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: e.x, y1: yy, x2: e.x + w, y2: yy });
  }
  let x = e.x;
  fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: x, y1: gridBottom, x2: x, y2: gridTop });
  colW.forEach(cw => {
    x += cw;
    fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: x, y1: gridBottom, x2: x, y2: gridTop });
  });
  cells.forEach((row, ri) => {
    const rowBottom = gridTop - (ri + 1) * rowH;
    let cx = e.x;
    row.forEach((cell, ci) => {
      const maxW = (colW[ci] || 3) - 0.18;
      const sz = ri === 0 ? 0.1 : 0.085;
      const lines = wrapPaperText(String(cell == null ? '' : cell), sz * 72, maxW, ri === 0, 2);
      const lineH = rowH / Math.max(lines.length, 1);
      lines.forEach((line, li) => {
        fr.push({
          type: 'text',
          layer: e.layer || 'TEXT',
          x: cx + 0.1,
          y: rowBottom + rowH - (li + 1) * lineH + lineH * 0.28,
          size: sz,
          content: line,
          maxW
        });
      });
      cx += colW[ci] || 3;
    });
  });
  return fr;
}

export function tableFrags(e){
  if (e && e.fromTop) return tableFragsFromTop(e);
  const fr = [];
  const rowH = e.rowH || 0.85;
  const colW = e.colW || [];
  const cells = e.cells || [];
  let y = e.y;
  if (e.title){
    fr.push({ type: 'text', layer: e.layer || 'TEXT', x: e.x + 0.15, y: y + rowH * 0.25, size: 0.55, content: e.title });
    y += rowH;
  }
  const w = colW.reduce((a, b) => a + b, 0);
  const n = cells.length;
  for (let r = 0; r <= n; r++){
    const yy = y + r * rowH;
    fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: e.x, y1: yy, x2: e.x + w, y2: yy });
  }
  let x = e.x;
  fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: x, y1: y, x2: x, y2: y + n * rowH });
  colW.forEach(cw => {
    x += cw;
    fr.push({ type: 'line', layer: e.layer || 'TEXT', x1: x, y1: y, x2: x, y2: y + n * rowH });
  });
  cells.forEach((row, ri) => {
    let cx = e.x;
    row.forEach((cell, ci) => {
      fr.push({
        type: 'text',
        layer: e.layer || 'TEXT',
        x: cx + 0.12,
        y: y + (ri + 0.22) * rowH,
        size: ri === 0 ? 0.42 : 0.38,
        content: String(cell == null ? '' : cell)
      });
      cx += colW[ci] || 3;
    });
  });
  return fr;
}

export function buildSchedule(entities, kind, at){
  kind = kind || 'door';
  const p = at || [0, 0];
  if (kind === 'window'){
    return makeTable({
      title: 'WINDOW SCHEDULE',
      headers: ['MARK', 'WIDTH', 'THK', 'WALL'],
      rows: windowRows(entities),
      colW: [3.2, 3.5, 2.8, 4.2],
      x: p[0], y: p[1]
    });
  }
  if (kind === 'room'){
    return makeTable({
      title: 'ROOM SCHEDULE',
      headers: ['ROOM', 'AREA', 'SF', 'FINISH'],
      rows: roomRows(entities),
      colW: [5, 4, 3.5, 4],
      x: p[0], y: p[1]
    });
  }
  return makeTable({
    title: 'DOOR SCHEDULE',
    headers: ['MARK', 'WIDTH', 'SWING', 'WALL'],
    rows: doorRows(entities),
    colW: [3.2, 3.5, 2.8, 4.2],
    x: p[0], y: p[1]
  });
}

export function scheduleCSV(entities, kind){
  const t = buildSchedule(entities, kind, [0, 0]);
  return (t.cells || []).map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}

export function centroidOf(e){
  if (e.type === 'hatch' && e.pts) return polyCentroid(e.pts);
  return null;
}

void centroidOf;
