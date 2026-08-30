/* DXF writer (R12 / optional R2000) and a tolerant reader.
 * World units are decimal feet. The writer stamps $INSUNITS=2.
 * The reader honors $INSUNITS (inches, mm, cm, meters → feet) and, when the
 * header is missing, treats huge coordinates (max > 2000) as millimetres.
 */
import { fmtN, dimGeom, arcPoints } from '../core/geometry.js';
import { LTYPE_NAMES, LINETYPES } from '../core/style.js';
import { hatchLines } from '../core/hatch.js';
import { explodeForIO } from '../core/entities.js';
import { dimLabel } from '../core/dimStyle.js';

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
  w(0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, acadver,
    9, '$INSUNITS', 70, 2,
    9, '$MEASUREMENT', 70, 0,
    0, 'ENDSEC');

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
  } else if (e.type === 'dim' && e.kind !== 'angular' && e.kind !== 'radius' && e.kind !== 'diameter'){
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
    w(0, 'TEXT', 8, 'DIMS', 10, fmtN(g.mid[0]), 20, fmtN(g.mid[1]), 30, 0, 40, 0.8, 50, fmtN(deg), 72, 1, 11, fmtN(g.mid[0]), 21, fmtN(g.mid[1]), 31, 0, 1, dimLabel(e));
  } else if (e.type === 'insert' || e.type === 'table' || e.type === 'ellipse' || e.type === 'cloud' || e.type === 'leader' || e.type === 'image' || e.type === 'grid' || e.type === 'xline' || e.type === 'room' || e.type === 'profile' || e.type === 'centerline' || e.type === 'callout' || e.type === 'hatchRegion' || (e.type === 'dim' && (e.kind === 'angular' || e.kind === 'radius' || e.kind === 'diameter'))){
    explodeForIO(e).forEach(f => writeEnt(w, f, r2000, inBlock));
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
  let inEnt = false, inBlocks = false, inHeader = false, cur = null, curVerts = null;
  const added = [];
  const blockDefs = {};
  let blockName = null, blockEnts = null;
  let insunits = 0, headerVar = '';


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
      emit(style({ type: 'text', layer: ly, x: num(cur[10]), y: num(cur[20]), size: num(cur[40]) || 1, content }));
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
    else if (t === 'ELLIPSE' && cur[10] !== undefined){
      const mx = num(cur[11]), my = num(cur[21]);
      const rx = Math.hypot(mx, my) || 1;
      const ratio = num(cur[40]) || 1;
      emit(style({ type: 'ellipse', layer: ly, cx: num(cur[10]), cy: num(cur[20]), rx, ry: rx * Math.abs(ratio || 1), rot: Math.atan2(my, mx) * 180 / Math.PI }));
    }
    else if (t === 'SPLINE' && cur._pts && cur._pts.length >= 2){
      emit(style({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: cur._pts }));
    }
    else if (t === 'SOLID' || t === '3DFACE'){
      const pts = [[num(cur[10]), num(cur[20])], [num(cur[11]), num(cur[21])], [num(cur[12]), num(cur[22])]];
      if (cur[13] !== undefined) pts.push([num(cur[13]), num(cur[23])]);
      emit(style({ type: 'poly', layer: ly, closed: true, pts }));
    }
    else if (t === 'XLINE' && cur[10] !== undefined){
      const x = num(cur[10]), y = num(cur[20]), dx = num(cur[11]) || 1, dy = num(cur[21]);
      emit(style({ type: 'xline', layer: ly, lt: lt || 'DASHED', x1: x, y1: y, x2: x + dx, y2: y + dy }));
    }
    else if (t === 'RAY' && cur[10] !== undefined){
      const x = num(cur[10]), y = num(cur[20]), dx = num(cur[11]) || 1, dy = num(cur[21]);
      const L = Math.hypot(dx, dy) || 1;
      emit(style({ type: 'line', layer: ly, lt: lt || 'DASHED', x1: x, y1: y, x2: x + dx / L * 200, y2: y + dy / L * 200 }));
    }
    else if ((t === 'DIMENSION' || t === 'ALIGNED_DIMENSION') && cur[13] !== undefined){
      emit(style({ type: 'dim', layer: ly || 'DIMS', x1: num(cur[13]), y1: num(cur[23]), x2: num(cur[14]), y2: num(cur[24]), off: 2 }));
    }
    else if (t === 'LEADER' && cur._pts && cur._pts.length >= 2){
      emit(style({ type: 'leader', layer: ly, pts: cur._pts, content: String(cur[1] || '') }));
    }
    cur = null; curVerts = null;
  }

  for (const [c, v] of pairs){
    if (c === 0 && v === 'SECTION') continue;
    if (c === 2 && v === 'HEADER'){ inHeader = true; inEnt = false; inBlocks = false; continue; }
    if (c === 2 && v === 'BLOCKS'){ inBlocks = true; inEnt = false; inHeader = false; continue; }
    if (c === 2 && v === 'ENTITIES'){ inEnt = true; inBlocks = false; inHeader = false; blockName = null; continue; }
    if (c === 0 && v === 'ENDSEC'){
      if (inEnt || inBlocks) flush();
      inEnt = false; inBlocks = false; inHeader = false; blockName = null;
      continue;
    }
    if (inHeader){
      if (c === 9) headerVar = v;
      else if (headerVar === '$INSUNITS' && (c === 70 || c === 10)) insunits = parseInt(v, 10) || 0;
      continue;
    }
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
      if (v === 'LWPOLYLINE' || v === 'HATCH' || v === 'SPLINE' || v === 'LEADER') cur._pts = [];
      continue;
    }
    if (!cur) continue;
    if ((cur._t === 'LWPOLYLINE' || cur._t === 'HATCH' || cur._t === 'SPLINE' || cur._t === 'LEADER') && (c === 10 || c === 20 || c === 11 || c === 21)){
      const xcode = (c === 10 || c === 11);
      const ycode = (c === 20 || c === 21);
      if (xcode) cur._pts.push([num(v), 0]);
      else if (ycode && cur._pts.length) cur._pts[cur._pts.length - 1][1] = num(v);
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
  const out = added.filter(e => e.type !== 'poly' || e.pts.every(p => p[0] !== null && p[1] !== null));
  const scaled = applyDxfUnits(out, insunits);
  return scaled;
}

const INSUNITS_TO_FEET = {
  1: 1 / 12,        /* inches */
  2: 1,             /* feet */
  4: 1 / 304.8,     /* mm */
  5: 1 / 30.48,     /* cm */
  6: 1 / 0.3048     /* meters */
};

export function dxfUnitLabel(insunits){
  return ({ 1: 'inches', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'meters' })[insunits] || 'feet';
}

function maxAbs(ents){
  let m = 0;
  (ents || []).forEach(e => {
    if (e.x1 != null) m = Math.max(m, Math.abs(e.x1), Math.abs(e.y1), Math.abs(e.x2 || 0), Math.abs(e.y2 || 0));
    if (e.cx != null) m = Math.max(m, Math.abs(e.cx), Math.abs(e.cy), Math.abs(e.r || 0));
    if (e.x != null && e.type !== 'line') m = Math.max(m, Math.abs(e.x), Math.abs(e.y));
    (e.pts || []).forEach(p => { m = Math.max(m, Math.abs(p[0]), Math.abs(p[1])); });
  });
  return m;
}

function scaleEnts(ents, f){
  if (!f || f === 1) return ents;
  (ents || []).forEach(e => {
    if (e.x1 != null){ e.x1 *= f; e.y1 *= f; e.x2 *= f; e.y2 *= f; }
    if (e.x3 != null){ e.x3 *= f; e.y3 *= f; }
    if (e.cx != null){ e.cx *= f; e.cy *= f; }
    if (e.r != null) e.r *= f;
    if (e.rx != null){ e.rx *= f; e.ry *= f; }
    if (e.off != null) e.off *= f;
    if (e.size != null) e.size *= f;
    if (e.x != null && e.y != null && e.type !== 'line' && e.type !== 'dim' && e.type !== 'xline'){
      e.x *= f; e.y *= f;
    }
    if (e.pts) e.pts = e.pts.map(p => [p[0] * f, p[1] * f]);
  });
  return ents;
}

function applyDxfUnits(ents, insunits){
  let f = INSUNITS_TO_FEET[insunits];
  if (!f){
    const m = maxAbs(ents);
    if (m > 2000) f = 1 / 304.8;       /* likely millimetres, no $INSUNITS */
    else f = 1;
  }
  const scaled = scaleEnts(ents, f);
  scaled.forEach(e => {
    if (e.type === 'text' && e.size != null) e.size = clampN(e.size, 0.2, 10);
  });
  return scaled;
}

export function sniffDrawing(text, filename){
  const n = String(filename || '').toLowerCase();
  const t = String(text || '').replace(/^\uFEFF/, '');
  if (n.endsWith('.dwg') || /^AC10\d{2}/.test(t)) return 'dwg';
  if (n.endsWith('.json') || t.trim().startsWith('{')) return 'json';
  if (n.endsWith('.dxf') || (/\bSECTION\b/.test(t) && /\bENTITIES\b/.test(t))) return 'dxf';
  return 'unknown';
}

function peekInsUnits(txt){
  const m = String(txt || '').match(/\$INSUNITS[\s\S]{0,24}?70[\s\S]{0,16}?(-?\d+)/);
  return m ? (parseInt(m[1], 10) || 0) : 0;
}

export function openDXF(txt, ensureLayer){
  const entities = parseDXF(txt, ensureLayer || (n => n || 'WALLS'));
  const insunits = peekInsUnits(txt);
  return { entities, count: entities.length, insunits, units: dxfUnitLabel(insunits) };
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
  } else if (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse'){
    const p = xf(e.cx, e.cy); e.cx = p[0]; e.cy = p[1]; e.r *= Math.abs(sx);
    if (e.rx != null){ e.rx *= Math.abs(sx); e.ry *= Math.abs(sy || sx); }
    if (e.type === 'arc'){ e.a1 += deg; e.a2 += deg; }
    if (e.type === 'ellipse') e.rot = (e.rot || 0) + deg;
  } else if (e.type === 'text'){
    const p = xf(e.x, e.y); e.x = p[0]; e.y = p[1]; e.size *= Math.abs(sx);
  } else if (e.type === 'xline'){
    const a = xf(e.x1, e.y1), b = xf(e.x2, e.y2);
    e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1];
  }
}
