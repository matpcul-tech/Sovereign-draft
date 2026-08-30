/* DXF R12 (AC1009) writer and a tolerant reader for LINE, CIRCLE, ARC, TEXT,
 * LWPOLYLINE and POLYLINE/VERTEX. Units are assumed to be feet both ways.
 */
import { fmtN, dimGeom } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';

export function buildDXF(entities, layers){
  const L = [];
  function w(...args){ for (const a of args) L.push(String(a)); }
  w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  layers.forEach(l => { w(0, 'LAYER', 2, l.name, 70, 0, 62, l.aci, 6, 'CONTINUOUS'); });
  w(0, 'ENDTAB', 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'ENTITIES');
  entities.forEach(e => {
    if (e.type === 'line') w(0, 'LINE', 8, e.layer, 10, fmtN(e.x1), 20, fmtN(e.y1), 30, 0, 11, fmtN(e.x2), 21, fmtN(e.y2), 31, 0);
    else if (e.type === 'circle') w(0, 'CIRCLE', 8, e.layer, 10, fmtN(e.cx), 20, fmtN(e.cy), 30, 0, 40, fmtN(e.r));
    else if (e.type === 'arc') w(0, 'ARC', 8, e.layer, 10, fmtN(e.cx), 20, fmtN(e.cy), 30, 0, 40, fmtN(e.r), 50, fmtN(e.a1), 51, fmtN(e.a2));
    else if (e.type === 'poly'){
      w(0, 'POLYLINE', 8, e.layer, 66, 1, 70, e.closed ? 1 : 0, 10, 0, 20, 0, 30, 0);
      e.pts.forEach(p => { w(0, 'VERTEX', 8, e.layer, 10, fmtN(p[0]), 20, fmtN(p[1]), 30, 0); });
      w(0, 'SEQEND', 8, e.layer);
    }
    else if (e.type === 'text') w(0, 'TEXT', 8, e.layer, 10, fmtN(e.x), 20, fmtN(e.y), 30, 0, 40, fmtN(e.size), 1, e.content || '');
    else if (e.type === 'dim'){
      // Dimensions are exploded to primitive lines + text so R12 viewers agree.
      const g = dimGeom(e);
      [g.e1, g.e2, g.d].forEach(seg => {
        w(0, 'LINE', 8, 'DIMS', 10, fmtN(seg[0][0]), 20, fmtN(seg[0][1]), 30, 0, 11, fmtN(seg[1][0]), 21, fmtN(seg[1][1]), 31, 0);
      });
      const tick = 0.4, ux = g.u[0], uy = g.u[1];
      [g.d[0], g.d[1]].forEach(p => {
        const ax = (ux - uy) * 0.7071 * tick, ay = (uy + ux) * 0.7071 * tick;
        w(0, 'LINE', 8, 'DIMS', 10, fmtN(p[0] - ax), 20, fmtN(p[1] - ay), 30, 0, 11, fmtN(p[0] + ax), 21, fmtN(p[1] + ay), 31, 0);
      });
      let deg = g.ang * 180 / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;
      w(0, 'TEXT', 8, 'DIMS', 10, fmtN(g.mid[0]), 20, fmtN(g.mid[1]), 30, 0, 40, 0.8, 50, fmtN(deg), 72, 1, 11, fmtN(g.mid[0]), 21, fmtN(g.mid[1]), 31, 0, 1, fmtFtIn(g.len));
    }
  });
  w(0, 'ENDSEC', 0, 'EOF');
  return L.join('\r\n');
}

function num(v){ v = Number(v); return isFinite(v) ? v : 0; }
function clampN(v, a, b){ return v < a ? a : (v > b ? b : v); }

/* Parse DXF text into entity objects (no ids). ensureLayer(name) -> canonical
 * layer name, creating the layer as a side effect when needed.
 */
export function parseDXF(txt, ensureLayer){
  const lines = txt.split(/\r\n|\n|\r/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2){
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)){ i--; continue; }
    pairs.push([code, lines[i + 1] !== undefined ? lines[i + 1].trim() : '']);
  }
  let inEnt = false, cur = null, curVerts = null;
  const added = [];
  function flush(){
    if (!cur) return;
    const t = cur._t, ly = ensureLayer(cur[8] || 'WALLS');
    if (t === 'LINE' && cur[10] !== undefined) added.push({ type: 'line', layer: ly, x1: num(cur[10]), y1: num(cur[20]), x2: num(cur[11]), y2: num(cur[21]) });
    else if (t === 'CIRCLE' && cur[10] !== undefined) added.push({ type: 'circle', layer: ly, cx: num(cur[10]), cy: num(cur[20]), r: num(cur[40]) || 0.1 });
    else if (t === 'ARC' && cur[10] !== undefined) added.push({ type: 'arc', layer: ly, cx: num(cur[10]), cy: num(cur[20]), r: num(cur[40]) || 0.1, a1: num(cur[50]), a2: num(cur[51]) });
    else if (t === 'TEXT' && cur[10] !== undefined) added.push({ type: 'text', layer: ly, x: num(cur[10]), y: num(cur[20]), size: clampN(num(cur[40]) || 1, 0.2, 10), content: String(cur[1] || '') });
    else if (t === 'LWPOLYLINE' && cur._pts && cur._pts.length >= 2) added.push({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: cur._pts });
    else if (t === 'POLYLINE' && curVerts && curVerts.length >= 2) added.push({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: curVerts });
    cur = null; curVerts = null;
  }
  for (const [c, v] of pairs){
    if (c === 0 && v === 'SECTION') continue;
    if (c === 2 && v === 'ENTITIES'){ inEnt = true; continue; }
    if (c === 0 && v === 'ENDSEC'){ if (inEnt) flush(); inEnt = false; continue; }
    if (!inEnt) continue;
    if (c === 0){
      if (v === 'VERTEX'){ if (cur && cur._t === 'POLYLINE'){ if (!curVerts) curVerts = []; curVerts.push([null, null]); cur._inv = true; } continue; }
      if (v === 'SEQEND'){ if (cur) cur._inv = false; flush(); continue; }
      flush();
      cur = { _t: v };
      if (v === 'LWPOLYLINE') cur._pts = [];
      continue;
    }
    if (!cur) continue;
    if (cur._t === 'LWPOLYLINE' && (c === 10 || c === 20)){
      if (c === 10) cur._pts.push([num(v), 0]);
      else if (cur._pts.length) cur._pts[cur._pts.length - 1][1] = num(v);
      continue;
    }
    if (cur._t === 'POLYLINE' && cur._inv && curVerts && (c === 10 || c === 20)){
      const lastV = curVerts[curVerts.length - 1];
      if (c === 10) lastV[0] = num(v); else lastV[1] = num(v);
      continue;
    }
    if (cur[c] === undefined) cur[c] = v;
  }
  flush();
  return added.filter(e => e.type !== 'poly' || e.pts.every(p => p[0] !== null && p[1] !== null));
}
