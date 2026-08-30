/* Quantity takeoff from the live drawing: wall LF, openings, room SF. */
import { dist, polyArea } from './geometry.js';
import { clFromMembers } from './dynblock.js';
import { fmtFtIn } from './format.js';
import { makeTable } from './schedule.js';
import { detectRooms } from './rooms.js';

function wallLf(entities){
  const g = {};
  (entities || []).forEach(e => {
    if (e.kind === 'wall' && e.g){ (g[e.g] = g[e.g] || []).push(e); }
  });
  let lf = 0, n = 0;
  Object.keys(g).forEach(id => {
    const cl = clFromMembers(g[id]);
    if (!cl) return;
    lf += dist(cl.x1, cl.y1, cl.x2, cl.y2);
    n++;
  });
  return { lf, n };
}

export function takeoff(entities){
  const w = wallLf(entities);
  const doors = (entities || []).filter(e => e.type === 'insert' && e.def === 'door');
  const windows = (entities || []).filter(e => e.type === 'insert' && e.def === 'window');
  let rooms = (entities || []).filter(e => e.type === 'room');
  if (!rooms.length) rooms = detectRooms(entities);
  const roomSf = rooms.reduce((s, r) => s + (r.area != null ? r.area : Math.abs(polyArea(r.pts || []))), 0);
  return {
    wallLf: w.lf,
    wallCount: w.n,
    doors,
    windows,
    rooms,
    doorCount: doors.length,
    windowCount: windows.length,
    roomCount: rooms.length,
    roomSf
  };
}

export function takeoffRows(entities){
  const t = takeoff(entities);
  return [
    ['Walls', String(t.wallCount), fmtFtIn(t.wallLf) + ' LF'],
    ['Doors', String(t.doorCount), doorsWidth(t.doors)],
    ['Windows', String(t.windowCount), doorsWidth(t.windows)],
    ['Rooms', String(t.roomCount), Math.round(t.roomSf) + ' SF']
  ];
}

function doorsWidth(list){
  if (!list.length) return '—';
  const sum = list.reduce((s, e) => s + (e.width || 3), 0);
  return fmtFtIn(sum) + ' total';
}

export function buildTakeoffTable(entities, at){
  const p = at || [0, 0];
  return makeTable({
    title: 'QUANTITY TAKEOFF',
    headers: ['ITEM', 'COUNT', 'QTY'],
    rows: takeoffRows(entities),
    colW: [6, 3.5, 6],
    x: p[0], y: p[1]
  });
}

export function takeoffSummary(entities){
  const t = takeoff(entities);
  return t.wallCount + ' walls · ' + fmtFtIn(t.wallLf) + ' LF  ·  ' +
    t.doorCount + ' doors  ·  ' + t.windowCount + ' windows  ·  ' +
    Math.round(t.roomSf) + ' SF';
}
