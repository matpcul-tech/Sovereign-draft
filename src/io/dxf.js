/* DXF writer (R12 / optional R2000) and a tolerant reader for LINE, CIRCLE,
 * ARC, TEXT, MTEXT, LWPOLYLINE, POLYLINE/VERTEX, INSERT (as a block group),
 * HATCH. Units are assumed to be feet both ways.
 */
import { fmtN, dimGeom, arcPoints } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { LTYPE_NAMES, LINETYPES } from '../core/style.js';
import { hatchLines } from '../core/hatch.js';
import { expandInsert } from '../core/dynblock.js';

function ltypeName(e){ return (e && e.lt) ? String(e.lt).toUpperCase() : 'CONTINUOUS'; }

function lw370(e){
  if (e.lw == null || e.lw === 0) return 25; /* 0.25 mm in 100ths */
  return Math.round(Number(e.lw) * 100);
}

export function buildDXF(entities, layers, opts){
  opts = opts || {};
  const r2000 = opts.ver === 'R2000' || opts.ver === 'AC1015';
  const L = [];
  function w(...args){ for (const a of args) L.push(String(a)); }
  const acadver = r2000 ? 'AC1015' : 'AC1009';
  w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, acadver, 0, 'ENDSEC');

  w(0, 'SECTION', 2, 'TABLES');
  /* LTYPE table */
  const ltypes = LTYPE_NAMES.slice();
  w(0, 'TABLE', 2, 'LTYPE', 70, ltypes.length);
  ltypes.forEach(n => {
    const lt = LINETYPES[n];
    w(0, 'LTYPE', 2, n, 70, 0, 3, n, 72, 65, 73, lt.dashes.length, 40, lt.dashes.reduce((a, b) => a + Math.abs(b), 0));
    lt.dashes.forEach((d, i) => w(49, fmtN(i % 2 === 0 ? d : -d)));
  });
  w(0, 'ENDTAB');

  w(0, 'TABLE', 2, 'LAYER', 70, layers.length);
  layers.forEach(l => {
    w(0, 'LAYER', 2, l.name, 70, 0, 62, l.aci, 6, l.lt || 'CONTINUOUS');
  });
  w(0, 'ENDTAB', 0, 'ENDSEC');

  /* BLOCKS — user blocks as INSERT targets when exporting R2000; R12 inlines. */
  const blocks = opts.userBlocks || [];
  const useInsert = r2000 && blocks.length;
  w(0, 'SECTION', 2, 'BLOCKS');
  if (useInsert){
    blocks.forEach((b, i) => {
      const name = dxfName(b.name || ('BLK' + i));
      w(0, 'BLOCK', 8, '0', 2, name, 70, 0, 10, 0, 20, 0, 30, 0);
      (b.frags || []).forEach(e => writeEnt(w, e, r2000, true));
      w(0, 'ENDBLK');
    });
  }
  w(0, 'ENDSEC');

  w(0, 'SECTION', 2, 'ENTITIES');
  entities.forEach(e => writeEnt(w, e, r2000, false));
  w(0, 'ENDSEC', 0, 'EOF');
  return L.join('\r\n');
}

function dxfName(s){
  return String(s || 'BLK').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 31) || 'BLK';
}

function writeEnt(w, e, r2000, inBlock){
  const lt = ltypeName(e);
  const common = () => {
    w(8, e.layer || '0');
    if (lt && lt !== 'CONTINUOUS') w(6, lt);
    if (e.lw != null) w(370, lw370(e));
  };
  if (e.type === 'line'){
    w(0, 'LINE'); common();
    w(10, fmtN(e.x1), 20, fmtN(e.y1), 30, 0, 11, fmtN(e.x2), 21, fmtN(e.y2), 31, 0);
  } else if (e.type === 'circle'){
    w(0, 'CIRCLE'); common();
    w(10, fmtN(e.cx), 20, fmtN(e.cy), 30, 0, 40, fmtN(e.r));
  } else if (e.type === 'arc'){
    w(0, 'ARC'); common();
    w(10, fmtN(e.cx), 20, fmtN(e.cy), 30, 0, 40, fmtN(e.r), 50, fmtN(e.a1), 51, fmtN(e.a2));
  } else if (e.type === 'poly'){
    if (r2000){
      w(0, 'LWPOLYLINE'); common();
      w(90, e.pts.length, 70, e.closed ? 1 : 0);
      e.pts.forEach(p => w(10, fmtN(p[0]), 20, fmtN(p[1])));
    } else {
      w(0, 'POLYLINE'); common();
      w(66, 1, 70, e.closed ? 1 : 0, 10, 0, 20, 0, 30, 0);
      e.pts.forEach(p => { w(0, 'VERTEX', 8, e.layer || '0', 10, fmtN(p[0]), 20, fmtN(p[1]), 30, 0); });
      w(0, 'SEQEND', 8, e.layer || '0');
    }
  } else if (e.type === 'text'){
    w(0, 'TEXT'); common();
    w(10, fmtN(e.x), 20, fmtN(e.y), 30, 0, 40, fmtN(e.size), 1, e.content || '');
  } else if (e.type === 'hatch'){
    /* Explode hatch to lines so R12 viewers agree; R2000 still gets lines (HATCH is finicky). */
    hatchLines(e).forEach(seg => {
      w(0, 'LINE'); common();
      w(10, fmtN(seg[0][0]), 20, fmtN(seg[0][1]), 30, 0, 11, fmtN(seg[1][0]), 21, fmtN(seg[1][1]), 31, 0);
    });
    if (e.pts && e.pts.length >= 2 && !inBlock){
      if (r2000){
        w(0, 'LWPOLYLINE'); common();
        w(90, e.pts.length, 70, 1);
        e.pts.forEach(p => w(10, fmtN(p[0]), 20, fmtN(p[1])));
      }
    }
  } else if (e.type === 'dim'){
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
    w(0, 'TEXT', 8, 'DIMS', 10, fmtN(g.mid[0]), 20, fmtN(g.mid[1]), 30, 0, 40, 0.8, 50, fmtN(deg), 72, 1, 11, fmtN(g.mid[0]), 21, fmtN(g.mid[1]), 31, 0, 1, fmtFtIn(g.len, e.precision));
  } else if (e.type === 'insert'){
    expandInsert(e).forEach(f => writeEnt(w, f, r2000, inBlock));
  }
  void arcPoints;
}

function num(v){ v = Number(v); return isFinite(v) ? v : 0; }
function clampN(v, a, b){ return v < a ? a : (v > b ? b : v); }

function flattenMtext(s){
  s = String(s || '');
  s = s.replace(/\\P/g, ' ').replace(/\\[~]/g, ' ');
  s = s.replace(/\{[^;]*;/g, '').replace(/\}/g, '');
  s = s.replace(/\\[A-Za-z][^;]*;/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

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
  let inEnt = false, inBlocks = false, cur = null, curVerts = null;
  const added = [];
  const blockDefs = {};
  let blockName = null, blockEnts = null;

  function emit(e){
    if (blockName){ blockEnts.push(e); return; }
    added.push(e);
  }

  function flush(){
    if (!cur) return;
    const t = cur._t, ly = ensureLayer(cur[8] || 'WALLS');
    const lt = cur[6] ? String(cur[6]).toUpperCase() : undefined;
    const lw = cur[370] != null ? num(cur[370]) / 100 : undefined;
    const style = (e) => { if (lt && lt !== 'CONTINUOUS') e.lt = lt; if (lw) e.lw = lw; return e; };
    if (t === 'LINE' && cur[10] !== undefined) emit(style({ type: 'line', layer: ly, x1: num(cur[10]), y1: num(cur[20]), x2: num(cur[11]), y2: num(cur[21]) }));
    else if (t === 'CIRCLE' && cur[10] !== undefined) emit(style({ type: 'circle', layer: ly, cx: num(cur[10]), cy: num(cur[20]), r: num(cur[40]) || 0.1 }));
    else if (t === 'ARC' && cur[10] !== undefined) emit(style({ type: 'arc', layer: ly, cx: num(cur[10]), cy: num(cur[20]), r: num(cur[40]) || 0.1, a1: num(cur[50]), a2: num(cur[51]) }));
    else if ((t === 'TEXT' || t === 'MTEXT') && cur[10] !== undefined){
      const content = t === 'MTEXT' ? flattenMtext(cur[1] || '') : String(cur[1] || '');
      emit(style({ type: 'text', layer: ly, x: num(cur[10]), y: num(cur[20]), size: clampN(num(cur[40]) || 1, 0.2, 10), content }));
    }
    else if (t === 'LWPOLYLINE' && cur._pts && cur._pts.length >= 2) emit(style({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: cur._pts }));
    else if (t === 'POLYLINE' && curVerts && curVerts.length >= 2) emit(style({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: curVerts }));
    else if (t === 'INSERT' && cur[2]){
      const name = String(cur[2]);
      const def = blockDefs[name] || blockDefs[name.toUpperCase()];
      const x = num(cur[10]), y = num(cur[20]);
      const sx = num(cur[41]) || 1, sy = num(cur[42]) || sx;
      const rot = num(cur[50]) || 0;
      if (def && def.length){
        def.forEach(frag => {
          const f = JSON.parse(JSON.stringify(frag));
          scaleRotateTranslate(f, x, y, sx, sy, rot);
          emit(f);
        });
      }
    }
    else if (t === 'HATCH' && cur._pts && cur._pts.length >= 3){
      emit(style({ type: 'hatch', layer: ly, pts: cur._pts, pattern: cur[2] || 'ANSI31', scale: num(cur[41]) || 1 }));
    }
    cur = null; curVerts = null;
  }

  for (const [c, v] of pairs){
    if (c === 0 && v === 'SECTION') continue;
    if (c === 2 && v === 'BLOCKS'){ inBlocks = true; inEnt = false; continue; }
    if (c === 2 && v === 'ENTITIES'){ inEnt = true; inBlocks = false; blockName = null; continue; }
    if (c === 0 && v === 'ENDSEC'){ if (inEnt || inBlocks) flush(); inEnt = false; inBlocks = false; blockName = null; continue; }
    if (inBlocks && c === 0 && v === 'BLOCK'){ flush(); cur = { _t: 'BLOCK' }; continue; }
    if (inBlocks && cur && cur._t === 'BLOCK' && c === 2){
      blockName = String(v).toUpperCase();
      blockEnts = [];
      blockDefs[blockName] = blockEnts;
      cur = null;
      continue;
    }
    if (inBlocks && c === 0 && v === 'ENDBLK'){ flush(); blockName = null; blockEnts = null; continue; }
    if (!inEnt && !inBlocks) continue;
    if (c === 0){
      if (v === 'VERTEX'){ if (cur && cur._t === 'POLYLINE'){ if (!curVerts) curVerts = []; curVerts.push([null, null]); cur._inv = true; } continue; }
      if (v === 'SEQEND'){ if (cur) cur._inv = false; flush(); continue; }
      flush();
      cur = { _t: v };
      if (v === 'LWPOLYLINE' || v === 'HATCH') cur._pts = [];
      continue;
    }
    if (!cur) continue;
    if ((cur._t === 'LWPOLYLINE' || cur._t === 'HATCH') && (c === 10 || c === 20)){
      if (c === 10) cur._pts.push([num(v), 0]);
      else if (cur._pts.length) cur._pts[cur._pts.length - 1][1] = num(v);
      continue;
    }
    if (cur._t === 'POLYLINE' && cur._inv && curVerts && (c === 10 || c === 20)){
      const lastV = curVerts[curVerts.length - 1];
      if (c === 10) lastV[0] = num(v); else lastV[1] = num(v);
      continue;
    }
    if (cur._t === 'MTEXT' && c === 3){ cur[1] = (cur[1] || '') + v; continue; }
    if (cur[c] === undefined) cur[c] = v;
  }
  flush();
  return added.filter(e => e.type !== 'poly' || e.pts.every(p => p[0] !== null && p[1] !== null));
}

function scaleRotateTranslate(e, x, y, sx, sy, deg){
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const xf = (px, py) => {
    const X = px * sx, Y = py * sy;
    return [x + X * c - Y * s, y + X * s + Y * c];
  };
  if (e.type === 'line' || e.type === 'dim'){
    const a = xf(e.x1, e.y1), b = xf(e.x2, e.y2);
    e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1];
  } else if (e.type === 'poly' || e.type === 'hatch'){
    e.pts = e.pts.map(p => xf(p[0], p[1]));
  } else if (e.type === 'circle' || e.type === 'arc'){
    const p = xf(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; e.r *= Math.abs(sx);
    if (e.type === 'arc'){ e.a1 += deg; e.a2 += deg; }
  } else if (e.type === 'text'){
    const p = xf(e.x, e.y); e.x = p[0]; e.y = p[1]; e.size *= Math.abs(sx);
  }
}
