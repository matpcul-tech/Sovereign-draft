/* Closed rooms from wall centerlines. Faces of the wall graph become room
 * entities (name + SF) that can stay live as the plan changes.
 */
import { dist, polyArea, polyCentroid, pointInPoly, segSegIntersect, closestOnSeg } from './geometry.js';
import { clFromMembers } from './dynblock.js';
import { offsetEntity } from './offset.js';

const SNAP = 0.04;
const MIN_EDGE = 0.12;
const MIN_AREA = 4;

function q(n){ return Math.round(n / SNAP) * SNAP; }
function nk(x, y){ return q(x).toFixed(2) + ',' + q(y).toFixed(2); }

function groupsOf(entities){
  const g = {};
  (entities || []).forEach(e => {
    if (e.kind === 'wall' && e.g){ (g[e.g] = g[e.g] || []).push(e); }
  });
  return g;
}

export function wallCenterlines(entities){
  const g = groupsOf(entities);
  const out = [];
  Object.keys(g).forEach(id => {
    const cl = clFromMembers(g[id]);
    if (!cl) return;
    if (dist(cl.x1, cl.y1, cl.x2, cl.y2) < MIN_EDGE) return;
    out.push({
      x1: cl.x1, y1: cl.y1, x2: cl.x2, y2: cl.y2,
      th: cl.th || 0.5, g: id, layer: cl.layer || 'WALLS'
    });
  });
  return out;
}

/* A room separator is an invisible boundary: a plain line on the ROOM-SEP
 * layer splits an open plan (kitchen into great room, say) into two rooms
 * without a wall. It never extrudes and does not plot. An end drawn to a
 * wall face, or a little short of the wall, is carried to the nearest wall
 * centreline so the room graph closes. */
export const ROOM_SEP_LAYER = 'ROOM-SEP';
export function isRoomSeparator(e){
  return !!e && e.type === 'line' && String(e.layer || '').toUpperCase() === ROOM_SEP_LAYER;
}
const SEP_REACH = 1;
export function separatorLines(entities, walls){
  const out = [];
  (entities || []).forEach((e, i) => {
    if (!isRoomSeparator(e)) return;
    const len = dist(e.x1, e.y1, e.x2, e.y2);
    if (!(len >= MIN_EDGE)) return;
    const ux = (e.x2 - e.x1) / len, uy = (e.y2 - e.y1) / len;
    const R = SEP_REACH, L = len + 2 * R;
    const ax = e.x1 - ux * R, ay = e.y1 - uy * R;
    const bx = e.x2 + ux * R, by = e.y2 + uy * R;
    let s0 = R, s1 = R + len, d0 = Infinity, d1 = Infinity;
    (walls || []).forEach(w => {
      const hit = segSegIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2, 0.02);
      if (!hit) return;
      const s = hit.t * L;
      const e0 = Math.abs(s - R), e1 = Math.abs(s - (R + len));
      if (e0 <= R && e0 < d0 && s < R + len / 2){ d0 = e0; s0 = s; }
      if (e1 <= R && e1 < d1 && s > R + len / 2){ d1 = e1; s1 = s; }
    });
    /* Near a wall corner the end lands on the corner itself, so the graph
     * gets a real node there instead of a hit a hair off a wall's end. */
    const snapEnd = (x, y) => {
      let best = null, bd = 0.5;
      (walls || []).forEach(w => {
        [[w.x1, w.y1], [w.x2, w.y2]].forEach(p => {
          const d = dist(x, y, p[0], p[1]);
          if (d < bd){ bd = d; best = p; }
        });
      });
      return best || [x, y];
    };
    const p = snapEnd(ax + ux * s0, ay + uy * s0);
    const q = snapEnd(ax + ux * s1, ay + uy * s1);
    out.push({
      x1: p[0], y1: p[1], x2: q[0], y2: q[1],
      th: 0, g: 'sep' + (e.id != null ? e.id : i), layer: ROOM_SEP_LAYER, sep: true
    });
  });
  return out;
}

function splitAll(raw){
  const cuts = raw.map(() => [0, 1]);
  for (let i = 0; i < raw.length; i++){
    const A = raw[i];
    for (let j = i + 1; j < raw.length; j++){
      const B = raw[j];
      const hit = segSegIntersect(A.x1, A.y1, A.x2, A.y2, B.x1, B.y1, B.x2, B.y2, 0.08);
      if (hit){
        if (hit.t > 0.01 && hit.t < 0.99) cuts[i].push(hit.t);
        if (hit.u > 0.01 && hit.u < 0.99) cuts[j].push(hit.u);
      }
    }
  }
  /* T-junctions: an endpoint of A sitting on B. */
  for (let i = 0; i < raw.length; i++){
    const A = raw[i];
    for (let j = 0; j < raw.length; j++){
      if (i === j) continue;
      const B = raw[j];
      [[A.x1, A.y1], [A.x2, A.y2]].forEach(p => {
        const c = closestOnSeg(p[0], p[1], B.x1, B.y1, B.x2, B.y2);
        if (c.d < 0.1 && c.t > 0.02 && c.t < 0.98) cuts[j].push(c.t);
      });
    }
  }
  const segs = [];
  raw.forEach((A, i) => {
    const ts = cuts[i].slice().sort((a, b) => a - b).filter((t, k, a) => k === 0 || t - a[k - 1] > 1e-4);
    for (let k = 0; k + 1 < ts.length; k++){
      const t0 = ts[k], t1 = ts[k + 1];
      const x1 = A.x1 + (A.x2 - A.x1) * t0, y1 = A.y1 + (A.y2 - A.y1) * t0;
      const x2 = A.x1 + (A.x2 - A.x1) * t1, y2 = A.y1 + (A.y2 - A.y1) * t1;
      if (dist(x1, y1, x2, y2) < MIN_EDGE) continue;
      segs.push({ x1, y1, x2, y2, th: A.th, g: A.g });
    }
  });
  return segs;
}

function buildGraph(segs){
  const nodes = new Map();
  function node(x, y){
    const k = nk(x, y);
    if (!nodes.has(k)) nodes.set(k, { key: k, x: q(x), y: q(y), out: [] });
    return nodes.get(k);
  }
  segs.forEach(s => {
    const a = node(s.x1, s.y1), b = node(s.x2, s.y2);
    if (a.key === b.key) return;
    const angAB = Math.atan2(b.y - a.y, b.x - a.x);
    const angBA = Math.atan2(a.y - b.y, a.x - b.x);
    const ab = { to: b.key, ang: angAB, used: false, th: s.th };
    const ba = { to: a.key, ang: angBA, used: false, th: s.th };
    ab.twin = ba; ba.twin = ab;
    a.out.push(ab); b.out.push(ba);
  });
  nodes.forEach(n => n.out.sort((a, b) => a.ang - b.ang));
  return nodes;
}

function nextCCW(node, arrived){
  /* arrived.twin lives on `node` (the reverse of the edge we came in on).
   * Previous in atan2 order is a left turn in Y-up, which traces CCW interiors. */
  const star = node.out;
  if (!star.length) return null;
  const twin = arrived.twin;
  let idx = star.indexOf(twin);
  if (idx < 0){
    let best = 0, bd = 1e9;
    star.forEach((e, i) => {
      let d = Math.abs(e.ang - (arrived.ang + Math.PI));
      while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
      if (d < bd){ bd = d; best = i; }
    });
    idx = best;
  }
  return star[(idx - 1 + star.length) % star.length];
}

function walkFaces(nodes){
  const faces = [];
  nodes.forEach(start => {
    start.out.forEach(e0 => {
      if (e0.used) return;
      const pts = [];
      let cur = start, e = e0, guard = 0;
      while (guard++ < 4000){
        e.used = true;
        pts.push([cur.x, cur.y]);
        const nxt = nodes.get(e.to);
        if (!nxt) break;
        const nx = nextCCW(nxt, e);
        if (!nx) break;
        if (nxt === start && nx === e0){
          faces.push(pts);
          break;
        }
        cur = nxt; e = nx;
      }
    });
  });
  return faces;
}

function insetPts(pts, d){
  if (!pts || pts.length < 3 || !d) return pts;
  const c = polyCentroid(pts);
  const e = { type: 'poly', closed: true, pts: pts.map(p => [p[0], p[1]]) };
  const out = offsetEntity(e, d, c);
  return (out && out.pts && out.pts.length >= 3) ? out.pts : pts;
}

export function detectRooms(entities){
  const walls = wallCenterlines(entities);
  const raw = walls.concat(separatorLines(entities, walls));
  if (raw.length < 3) return [];
  const segs = splitAll(raw);
  const nodes = buildGraph(segs);
  const faces = walkFaces(nodes);
  const th = (walls[0] && walls[0].th) || 0.5;
  const rooms = [];
  faces.forEach(pts => {
    if (!pts || pts.length < 3) return;
    const a = polyArea(pts);
    if (a <= MIN_AREA) return; /* skip clockwise exterior and slivers */
    const inner = insetPts(pts, th / 2);
    const area = Math.abs(polyArea(inner));
    if (area < MIN_AREA) return;
    const c = polyCentroid(inner);
    rooms.push({
      type: 'room',
      layer: 'ROOMS',
      name: 'ROOM',
      pts: inner,
      auto: true,
      cx: c[0], cy: c[1],
      area
    });
  });
  rooms.sort((a, b) => b.area - a.area);
  /* Drop the exterior leftover if it still snuck through (covers all others). */
  if (rooms.length > 1){
    const outer = rooms[0];
    const covered = rooms.slice(1).every(r => pointInPoly(r.cx, r.cy, outer.pts));
    const sum = rooms.slice(1).reduce((s, r) => s + r.area, 0);
    if (covered && outer.area > sum * 1.15) rooms.shift();
  }
  rooms.forEach((r, i) => { r.name = 'ROOM ' + (i + 1); });
  return rooms;
}

export function nameRoomsFromText(rooms, entities){
  (rooms || []).forEach(r => {
    const t = (entities || []).find(e => e.type === 'text' && pointInPoly(e.x, e.y, r.pts));
    if (t && t.content) r.name = String(t.content).trim().slice(0, 24);
  });
  return rooms;
}

export function syncAutoRooms(state){
  if (!state || !state.autoRooms) return;
  const kept = (state.entities || []).filter(e => e.type !== 'room' || !e.auto);
  const prev = (state.entities || []).filter(e => e.type === 'room' && e.auto);
  const next = nameRoomsFromText(detectRooms(kept), kept);
  next.forEach(r => {
    const hit = prev.find(p => dist(p.cx || 0, p.cy || 0, r.cx, r.cy) < 3);
    /* A label typed inside the room names it, even after the walls
     * closed; otherwise the room keeps the name it had. */
    const labelled = kept.some(e => e.type === 'text' && e.content && pointInPoly(e.x, e.y, r.pts));
    if (hit && hit.name && !labelled) r.name = hit.name;
    r.id = state.idSeq++;
  });
  state.entities = kept.concat(next);
}

export function roomAreaLabel(r){
  const a = r.area != null ? r.area : Math.abs(polyArea(r.pts || []));
  return Math.round(a) + ' SF';
}
