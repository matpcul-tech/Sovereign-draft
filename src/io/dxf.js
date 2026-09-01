/* DXF writer (R12 / optional R2000) and a tolerant reader.
 * World units are decimal feet. The writer stamps $INSUNITS=2.
 * The reader honors $INSUNITS (inches, mm, cm, meters → feet) and, when the
 * header is missing, treats huge coordinates (max > 2000) as millimetres.
 */
import { fmtN, dimGeom, arcPoints } from '../core/geometry.js';
import { LTYPE_NAMES, LINETYPES } from '../core/style.js';
import { hatchLines } from '../core/hatch.js';
import { explodeForIO, membersBBox } from '../core/entities.js';
import { knotsOf, splineToPoly, makeSpline } from '../core/spline.js';
import { hasBulge, bulgeAt } from '../core/bulge.js';
import { makeMText, decodeMText, encodeMText, attachCode, justFromCode, mtextToTexts } from '../core/mtext.js';
import { dimLabel } from '../core/dimStyle.js';
import { sheetOf, makeLayout, TITLE_BLOCK_H, SHEET_MARGIN } from '../core/layout.js';
import { bindAllDims } from '../core/assoc.js';

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
  const ly = layers && layers.length ? layers : [{ name: '0', aci: 7, lt: 'CONTINUOUS' }];
  let bb = [0, 0, 36, 24];
  try { if (entities && entities.length) bb = membersBBox(entities); } catch (err){ /* empty */ }
  if (!isFinite(bb[0]) || bb[0] > 1e8) bb = [0, 0, 36, 24];

  w(0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, acadver,
    9, '$INSUNITS', 70, 2,
    9, '$MEASUREMENT', 70, 0);
  if (r2000){
    w(9, '$HANDLING', 70, 1,
      9, '$HANDSEED', 5, 'FFFF',
      9, '$TILEMODE', 70, 1,
      9, '$LWDISPLAY', 70, 1,
      9, '$EXTMIN', 10, fmtN(bb[0]), 20, fmtN(bb[1]), 30, 0,
      9, '$EXTMAX', 10, fmtN(bb[2]), 20, fmtN(bb[3]), 30, 0,
      9, '$LIMMIN', 10, 0, 20, 0,
      9, '$LIMMAX', 10, fmtN(Math.max(bb[2], 36)), 20, fmtN(Math.max(bb[3], 24)),
      9, '$LUNITS', 70, 4,
      9, '$LUPREC', 70, 4,
      9, '$AUNITS', 70, 0,
      9, '$AUPREC', 70, 0,
      9, '$LTSCALE', 40, 1,
      9, '$PSLTSCALE', 70, 1,
      9, '$FILLMODE', 70, 1,
      9, '$MIRRTEXT', 70, 1,
      9, '$ATTMODE', 70, 1,
      9, '$PDMODE', 70, 0,
      9, '$PDSIZE', 40, 0,
      9, '$CLAYER', 8, '0',
      9, '$TEXTSTYLE', 7, 'Standard',
      9, '$DIMSTYLE', 2, 'Standard',
      9, '$DIMASO', 70, 1,
      9, '$DIMASSOC', 280, 2);
  }
  w(0, 'ENDSEC');

  w(0, 'SECTION', 2, 'TABLES');
  if (r2000) writeVportTable(w);
  const ltypes = r2000 ? ['ByBlock', 'ByLayer'].concat(LTYPE_NAMES) : LTYPE_NAMES.slice();
  w(0, 'TABLE', 2, 'LTYPE', 70, ltypes.length);
  ltypes.forEach(n => {
    if (n === 'ByBlock' || n === 'ByLayer'){
      w(0, 'LTYPE', 2, n, 70, 0, 3, n, 72, 65, 73, 0, 40, 0);
      return;
    }
    const lt = LINETYPES[n];
    w(0, 'LTYPE', 2, n, 70, 0, 3, n, 72, 65, 73, lt.dashes.length, 40, lt.dashes.reduce((a, b) => a + Math.abs(b), 0));
    lt.dashes.forEach((d, i) => w(49, fmtN(i % 2 === 0 ? d : -d)));
  });
  w(0, 'ENDTAB');

  w(0, 'TABLE', 2, 'LAYER', 70, ly.length);
  ly.forEach(l => {
    w(0, 'LAYER', 2, l.name, 70, 0, 62, l.aci, 6, l.lt || 'CONTINUOUS');
    if (r2000 && l.lw != null) w(370, Math.round(Number(l.lw) * 100) || -3);
  });
  w(0, 'ENDTAB');
  if (r2000){
    writeStyleTable(w);
    w(0, 'TABLE', 2, 'VIEW', 70, 0, 0, 'ENDTAB');
    w(0, 'TABLE', 2, 'UCS', 70, 0, 0, 'ENDTAB');
    w(0, 'TABLE', 2, 'APPID', 70, 1, 0, 'APPID', 2, 'ACAD', 70, 0, 0, 'ENDTAB');
    writeDimStyleTable(w);
    writeBlockRecordTable(w, opts.userBlocks, opts.layouts);
  }
  w(0, 'ENDSEC');

  const blocks = opts.userBlocks || [];
  const useInsert = r2000 && blocks.length;
  w(0, 'SECTION', 2, 'BLOCKS');
  if (r2000){
    w(0, 'BLOCK', 8, '0', 2, '*MODEL_SPACE', 70, 0, 10, 0, 20, 0, 30, 0, 0, 'ENDBLK');
    w(0, 'BLOCK', 8, '0', 2, '*PAPER_SPACE', 70, 0, 10, 0, 20, 0, 30, 0, 0, 'ENDBLK');
  }
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
  (entities || []).forEach(e => writeEnt(w, e, r2000, false, 0));
  (opts.faces || []).forEach(f => writeEnt(w, f, r2000, false, 0));
  if (r2000 && opts.layouts && opts.layouts.length){
    writePaperSpace(w, opts.layouts, r2000);
  }
  w(0, 'ENDSEC');
  if (r2000) writeObjects(w, opts.layouts);
  w(0, 'EOF');
  return L.join('\r\n');
}

function writeVportTable(w){
  w(0, 'TABLE', 2, 'VPORT', 70, 1,
    0, 'VPORT', 2, '*ACTIVE', 70, 0,
    10, 0, 20, 0, 11, 1, 21, 1,
    12, 0, 22, 0, 13, 0, 23, 0,
    14, 0.5, 24, 0.5, 15, 0.5, 25, 0.5,
    16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0,
    40, 50, 41, 1.4, 42, 50, 43, 0, 44, 0, 50, 0, 51, 0,
    71, 0, 72, 100, 73, 1, 74, 3, 75, 0, 76, 0, 77, 0, 78, 0,
    0, 'ENDTAB');
}

function writeStyleTable(w){
  w(0, 'TABLE', 2, 'STYLE', 70, 1,
    0, 'STYLE', 2, 'Standard', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 0.2, 3, 'txt', 4, '',
    0, 'ENDTAB');
}

function writeDimStyleTable(w){
  w(0, 'TABLE', 2, 'DIMSTYLE', 70, 1,
    0, 'DIMSTYLE', 2, 'Standard', 70, 0, 3, '', 4, '', 5, '', 6, '', 7, '',
    40, 1, 41, 0.18, 42, 0.0625, 43, 0.38, 44, 0.18, 140, 0.18, 141, 0.09,
    147, 0.09, 271, 4, 272, 4, 273, 2, 274, 3, 275, 0, 276, 0, 277, 2, 278, 46, 279, 1, 280, 0, 281, 0, 282, 0, 283, 1, 284, 0, 285, 0, 286, 0, 288, 0, 289, 3,
    0, 'ENDTAB');
}

function writeBlockRecordTable(w, userBlocks, layouts){
  const names = ['*MODEL_SPACE', '*PAPER_SPACE'];
  (userBlocks || []).forEach((b, i) => names.push(dxfName(b.name || ('BLK' + i))));
  (layouts || []).forEach((L, i) => { if (i > 0) names.push('*PAPER_SPACE' + i); });
  w(0, 'TABLE', 2, 'BLOCK_RECORD', 70, names.length);
  names.forEach(n => w(0, 'BLOCK_RECORD', 2, n));
  w(0, 'ENDTAB');
}

function writePaperSpace(w, layouts, r2000){
  (layouts || []).forEach((layout, li) => {
    const sh = sheetOf(layout.sheet);
    const vps = layout.viewports || [];
    vps.forEach((vp, vi) => {
      const cx = vp.px + vp.pw / 2, cy = vp.py + vp.ph / 2;
      const viewH = vp.ph * 72 / (vp.ppf || layout.ppf || 18);
      w(0, 'VIEWPORT', 8, '0', 67, 1, 68, 2, 69, li * 10 + vi + 2,
        10, fmtN(cx), 20, fmtN(cy), 30, 0,
        40, fmtN(vp.pw), 41, fmtN(vp.ph),
        12, fmtN(vp.mx || 0), 22, fmtN(vp.my || 0),
        13, 0, 23, 0, 14, 0.5, 24, 0.5, 15, 0.5, 25, 0.5,
        16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0,
        42, 50, 43, 0, 44, 0, 45, fmtN(viewH || 24));
    });
    /* Sheet outline so a paperspace round-trip still has a sheet. */
    w(0, 'LWPOLYLINE', 8, '0', 67, 1, 90, 4, 70, 1,
      10, 0, 20, 0, 10, fmtN(sh.w), 20, 0, 10, fmtN(sh.w), 20, fmtN(sh.h), 10, 0, 20, fmtN(sh.h));
    const title = String(layout.name || 'Layout');
    w(0, 'TEXT', 8, 'TEXT', 67, 1, 10, fmtN(SHEET_MARGIN + 0.2), 20, fmtN(SHEET_MARGIN + 0.35), 30, 0, 40, 0.18, 1, title);
    (layout.paper || []).forEach(e => writeEnt(w, e, r2000, false, 1));
  });
}

function writeObjects(w, layouts){
  const list = layouts && layouts.length ? layouts : [];
  w(0, 'SECTION', 2, 'OBJECTS',
    0, 'DICTIONARY', 5, 'C', 3, 'ACAD_GROUP', 350, 'D', 3, 'ACAD_LAYOUT', 350, '1A',
    0, 'DICTIONARY', 5, '1A', 3, 'Model', 350, '1B');
  list.forEach((L, i) => w(3, String(L.name || ('Layout' + (i + 1))).slice(0, 32), 350, (0x1C + i).toString(16).toUpperCase()));
  writeLayoutObj(w, '1B', 'Model', 36, 24, 1);
  list.forEach((L, i) => {
    const sh = sheetOf(L.sheet);
    writeLayoutObj(w, (0x1C + i).toString(16).toUpperCase(), String(L.name || ('Layout' + (i + 1))).slice(0, 32), sh.w, sh.h, 0);
  });
  w(0, 'ENDSEC');
}

function writeLayoutObj(w, handle, name, pw, ph, tab){
  w(0, 'LAYOUT', 5, handle, 100, 'AcDbPlotSettings', 100, 'AcDbLayout',
    1, name, 70, tab, 71, 1,
    10, 0, 20, 0, 11, fmtN(pw), 21, fmtN(ph),
    12, 0, 22, 0, 14, 0, 24, 0, 15, fmtN(pw), 25, fmtN(ph),
    146, 0, 13, 0, 23, 0, 16, 1, 26, 0, 36, 0, 17, 0, 27, 1, 37, 0, 76, 0);
}

function dxfName(s){
  return String(s || 'BLK').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 31) || 'BLK';
}

function writeEnt(w, e, r2000, inBlock, paper){
  const lt = ltypeName(e);
  const common = () => {
    w(8, e.layer || '0');
    if (paper) w(67, 1);
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
  } else if (e.type === 'spline'){
    if (r2000){
      /* A real SPLINE keeps the definition, so the curve reopens editable
       * rather than as a frozen polyline. R12 has no SPLINE, so it gets the
       * tessellation instead. */
      const U = knotsOf(e);
      const p = Math.min(e.degree || 3, Math.max(1, e.ctrl.length - 1));
      w(0, 'SPLINE'); common();
      w(70, (e.closed ? 1 : 0) | 8, 71, p, 72, U.length, 73, e.ctrl.length, 74, 0);
      U.forEach(k => w(40, fmtN(k)));
      e.ctrl.forEach(c => w(10, fmtN(c[0]), 20, fmtN(c[1]), 30, 0));
    } else {
      writeEnt(w, splineToPoly(e), r2000, inBlock, paper);
    }
  } else if (e.type === 'poly'){
    /* Group 42 is the vertex bulge, and it is the only way an arc segment
     * survives the trip. It is written only where there is a curve, so a
     * straight polyline comes out exactly as it always did. */
    const bulged = hasBulge(e);
    if (r2000){
      w(0, 'LWPOLYLINE'); common();
      w(90, e.pts.length, 70, e.closed ? 1 : 0);
      e.pts.forEach((p, i) => {
        w(10, fmtN(p[0]), 20, fmtN(p[1]));
        if (bulged && bulgeAt(e, i)) w(42, fmtN(bulgeAt(e, i)));
      });
    } else {
      w(0, 'POLYLINE'); common();
      w(66, 1, 70, e.closed ? 1 : 0, 10, 0, 20, 0, 30, 0);
      e.pts.forEach((p, i) => {
        w(0, 'VERTEX', 8, e.layer || '0', 10, fmtN(p[0]), 20, fmtN(p[1]), 30, 0);
        if (bulged && bulgeAt(e, i)) w(42, fmtN(bulgeAt(e, i)));
      });
      w(0, 'SEQEND', 8, e.layer || '0');
    }
  } else if (e.type === 'text'){
    w(0, 'TEXT'); common();
    w(10, fmtN(e.x), 20, fmtN(e.y), 30, 0, 40, fmtN(e.size), 1, e.content || '');
    if (e.rot) w(50, fmtN(e.rot));
  } else if (e.type === 'mtext'){
    if (r2000){
      /* A real MTEXT reopens as an editable paragraph with its column width
       * intact. R12 has no MTEXT, so it gets the laid out lines. */
      w(0, 'MTEXT'); common();
      w(10, fmtN(e.x), 20, fmtN(e.y), 30, 0, 40, fmtN(e.size));
      if (e.width > 0) w(41, fmtN(e.width));
      w(71, attachCode(e.just), 72, 1);
      if (e.rot) w(50, fmtN(e.rot));
      w(1, encodeMText(e.content || ''));
    } else {
      mtextToTexts(e).forEach(t => writeEnt(w, t, r2000, inBlock, paper));
    }
  } else if (e.type === 'hatch'){
    hatchLines(e).forEach(seg => {
      w(0, 'LINE'); common();
      w(10, fmtN(seg[0][0]), 20, fmtN(seg[0][1]), 30, 0, 11, fmtN(seg[1][0]), 21, fmtN(seg[1][1]), 31, 0);
    });
    if (e.pts && e.pts.length >= 2 && !inBlock){
      if (r2000){
        w(0, 'LWPOLYLINE'); common();
        w(90, e.pts.length, 70, 1);
        e.pts.forEach(p => w(10, fmtN(p[0]), 20, fmtN(p[1])));
        /* Island boundaries travel too, or a reopened section loses its
         * cavities' outlines even though the pattern lines respect them. */
        (e.holes || []).forEach(h => {
          if (!h || h.length < 2) return;
          w(0, 'LWPOLYLINE'); common();
          w(90, h.length, 70, 1);
          h.forEach(p => w(10, fmtN(p[0]), 20, fmtN(p[1])));
        });
      }
    }
  } else if (e.type === 'dim' && e.kind !== 'angular' && e.kind !== 'radius' && e.kind !== 'diameter'){
    if (r2000){
      const g = dimGeom(e);
      w(0, 'DIMENSION'); common();
      w(2, '*D0',
        10, fmtN(g.d[0][0]), 20, fmtN(g.d[0][1]), 30, 0,
        11, fmtN(g.mid[0]), 21, fmtN(g.mid[1]), 31, 0,
        12, 0, 22, 0, 32, 0,
        70, 1,
        1, dimLabel(e),
        13, fmtN(e.x1), 23, fmtN(e.y1), 33, 0,
        14, fmtN(e.x2), 24, fmtN(e.y2), 34, 0);
    } else {
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
    }
  } else if (e.type === 'face' && e.a && e.b && e.c){
    const a = e.a, b = e.b, c = e.c, d = e.d || c;
    w(0, '3DFACE'); common();
    w(10, fmtN(a[0]), 20, fmtN(a[1]), 30, fmtN(a[2] || 0));
    w(11, fmtN(b[0]), 21, fmtN(b[1]), 31, fmtN(b[2] || 0));
    w(12, fmtN(c[0]), 22, fmtN(c[1]), 32, fmtN(c[2] || 0));
    w(13, fmtN(d[0]), 23, fmtN(d[1]), 33, fmtN(d[2] || 0));
  } else if (e.type === 'insert' || e.type === 'xref' || e.type === 'table' || e.type === 'ellipse' || e.type === 'cloud' || e.type === 'leader' || e.type === 'image' || e.type === 'grid' || e.type === 'xline' || e.type === 'room' || e.type === 'profile' || e.type === 'centerline' || e.type === 'callout' || e.type === 'hatchRegion' || (e.type === 'dim' && (e.kind === 'angular' || e.kind === 'radius' || e.kind === 'diameter'))){
    explodeForIO(e).forEach(f => writeEnt(w, f, r2000, inBlock, paper));
  }
  void arcPoints;
  void TITLE_BLOCK_H;
}

function num(v){
  let n = Number(v);
  if (!isFinite(n) && typeof v === 'string' && /\d[dD][+-]?\d/.test(v)){
    /* Fortran exponent notation, 1.5D+2 for 150, from old CAD exporters. */
    n = Number(v.replace(/[dD]/, 'E'));
  }
  return isFinite(n) ? n : 0;
}

/* AutoCAD writes non ASCII text as \U+XXXX in older files. Left undecoded,
 * a Cyrillic room name displays as backslash soup. */
function decodeUplus(str){
  return String(str == null ? '' : str).replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

/* The one OCS case that occurs in practice: an extrusion of (0,0,-1), which
 * is how AutoCAD stores mirrored planar entities. The arbitrary axis
 * algorithm for that normal maps (x, y) to (-x, y) and an angle t to
 * 180 - t. Any other tilted OCS is ignored as before, which is wrong for
 * genuinely 3D files and right for every 2D drawing this program reads. */
function flippedOCS(cur){
  return num(cur[230]) < -0.5 && Math.abs(num(cur[210])) < 1 / 64 && Math.abs(num(cur[220])) < 1 / 64;
}
function clampN(v, a, b){ return v < a ? a : (v > b ? b : v); }


/* Parse DXF text into entity objects (no ids). ensureLayer(name) -> canonical
 * layer name, creating the layer as a side effect when needed.
 */
/* Attach a bulge array only when it carries a curve, so a straight polyline
 * reads back byte for byte the way it always did. */
function withBulge(e, bul){
  if (!bul || !bul.length) return e;
  const b = new Array(e.pts.length).fill(0);
  for (let i = 0; i < bul.length && i < b.length; i++) b[i] = bul[i] || 0;
  if (b.some(v => v)) e.bulge = b;
  return e;
}

export function parseDXF(txt, ensureLayer, sink){
  const lines = txt.split(/\r\n|\n|\r/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2){
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)){ i--; continue; }
    pairs.push([code, lines[i + 1] !== undefined ? lines[i + 1].trim() : '']);
  }
  let inEnt = false, inBlocks = false, inHeader = false, inObjects = false, cur = null, curVerts = null, curBul = null;
  const added = [];
  const paper = [];
  const viewports = [];
  const layoutRecs = [];
  const blockDefs = {};
  let blockName = null, blockEnts = null;
  let insunits = 0, headerVar = '';
  const header = {};
  const meta = sink || {};


  function emit(e){
    if (blockName){ blockEnts.push(e); return; }
    if (e._paper){ delete e._paper; paper.push(e); return; }
    added.push(e);
  }

  function flush(){
    if (!cur) return;
    const t = cur._t, ly = ensureLayer(cur[8] || 'WALLS');
    const lt = cur[6] ? String(cur[6]).toUpperCase() : undefined;
    const lw = cur[370] != null ? num(cur[370]) / 100 : undefined;
    const paperFlag = num(cur[67]) === 1;
    const style = (e) => {
      if (lt && lt !== 'CONTINUOUS') e.lt = lt;
      if (lw) e.lw = lw;
      if (paperFlag) e._paper = true;
      return e;
    };
    if (t === 'VIEWPORT'){
      viewports.push({
        cx: num(cur[10]), cy: num(cur[20]),
        pw: num(cur[40]) || 10, ph: num(cur[41]) || 8,
        mx: num(cur[12]), my: num(cur[22]),
        viewH: num(cur[45]) || 0
      });
      cur = null; curVerts = null; curBul = null;
      return;
    }
    if (t === 'LAYOUT'){
      layoutRecs.push({
        name: String(cur[1] || 'Layout'),
        w: num(cur[15]) || num(cur[11]) || 36,
        h: num(cur[25]) || num(cur[21]) || 24,
        tab: num(cur[70])
      });
      cur = null; curVerts = null; curBul = null;
      return;
    }
    const ocsFlip = flippedOCS(cur);
    const fx = ocsFlip ? v => (v ? -v : 0) : v => v;
    if (t === 'LINE' && cur[10] !== undefined) emit(style({ type: 'line', layer: ly, x1: num(cur[10]), y1: num(cur[20]), x2: num(cur[11]), y2: num(cur[21]) }));
    else if (t === 'CIRCLE' && cur[10] !== undefined) emit(style({ type: 'circle', layer: ly, cx: fx(num(cur[10])), cy: num(cur[20]), r: num(cur[40]) || 0.1 }));
    else if (t === 'ARC' && cur[10] !== undefined){
      const a1 = num(cur[50]), a2 = num(cur[51]);
      emit(style(ocsFlip
        ? { type: 'arc', layer: ly, cx: fx(num(cur[10])), cy: num(cur[20]), r: num(cur[40]) || 0.1, a1: (180 - a2 + 360) % 360, a2: (180 - a1 + 360) % 360 }
        : { type: 'arc', layer: ly, cx: num(cur[10]), cy: num(cur[20]), r: num(cur[40]) || 0.1, a1, a2 }));
    }
    else if (t === 'MTEXT' && cur[10] !== undefined){
      /* Keep it a paragraph. Flattening the breaks to spaces turned every
       * imported general note into one run-on line, which is the note's
       * meaning gone, not just its look. */
      emit(style(makeMText(decodeUplus(decodeMText(cur[1] || '')), {
        layer: ly,
        x: num(cur[10]),
        y: num(cur[20]),
        size: num(cur[40]) || 1,
        width: num(cur[41]) || 0,
        just: justFromCode(num(cur[71])),
        rot: num(cur[50]) || 0
      })));
    }
    else if (t === 'TEXT' && cur[10] !== undefined){
      emit(style({ type: 'text', layer: ly, x: num(cur[10]), y: num(cur[20]), size: num(cur[40]) || 1, content: decodeUplus(cur[1] || ''), rot: num(cur[50]) || 0 }));
    }
    else if (t === 'LWPOLYLINE' && cur._pts && cur._pts.length >= 2){
      const pts = ocsFlip ? cur._pts.map(p => [p[0] ? -p[0] : 0, p[1]]) : cur._pts;
      const bul = ocsFlip && cur._bul ? cur._bul.map(b => (b ? -b : 0)) : cur._bul;
      emit(style(withBulge({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts }, bul)));
    }
    else if (t === 'POLYLINE' && curVerts && curVerts.length >= 2) emit(style(withBulge({ type: 'poly', layer: ly, closed: !!(num(cur[70]) & 1), pts: curVerts }, curBul)));
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
    else if (t === 'HATCH'){
      /* Boundary paths were split at every group 92; the leftover points
       * are the last path. Splitting also keeps the hatch's elevation
       * point (its own 10/20, before any path) out of the boundary, since
       * a pre-path fragment can never reach three vertices. The largest
       * ring is the outer boundary, the rest are islands. */
      const rings = (cur._rings || [])
        .concat(cur._pts && cur._pts.length ? [cur._pts] : [])
        .filter(r => r.length >= 3);
      if (rings.length){
        const area = r => {
          let a = 0;
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
          return Math.abs(a / 2);
        };
        rings.sort((a, b) => area(b) - area(a));
        const h = style({ type: 'hatch', layer: ly, pts: rings[0], pattern: cur[2] || 'ANSI31', scale: num(cur[41]) || 1 });
        if (rings.length > 1) h.holes = rings.slice(1);
        emit(h);
      }
    }
    else if (t === 'ELLIPSE' && cur[10] !== undefined){
      const mx = num(cur[11]), my = num(cur[21]);
      const rx = Math.hypot(mx, my) || 1;
      const ratio = num(cur[40]) || 1;
      emit(style({ type: 'ellipse', layer: ly, cx: num(cur[10]), cy: num(cur[20]), rx, ry: rx * Math.abs(ratio || 1), rot: Math.atan2(my, mx) * 180 / Math.PI }));
    }
    else if (t === 'SPLINE' && cur._pts && cur._pts.length >= 2){
      /* Keep it a spline: degree from 71, knots from the 40 list when the
       * count matches, so a round trip is lossless rather than degrading to
       * line work on every open. */
      const deg = Math.max(1, Math.min(num(cur[71]) || 3, cur._pts.length - 1));
      const closed = !!(num(cur[70]) & 1);
      const knots = (cur._knots && cur._knots.length === cur._pts.length + deg + 1) ? cur._knots : null;
      emit(style(makeSpline(cur._pts, { layer: ly, degree: deg, closed, knots })));
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
    cur = null; curVerts = null; curBul = null;
  }

  for (const [c, v] of pairs){
    if (c === 0 && v === 'SECTION') continue;
    if (c === 2 && v === 'HEADER'){ inHeader = true; inEnt = false; inBlocks = false; inObjects = false; continue; }
    if (c === 2 && v === 'BLOCKS'){ inBlocks = true; inEnt = false; inHeader = false; inObjects = false; continue; }
    if (c === 2 && v === 'ENTITIES'){ inEnt = true; inBlocks = false; inHeader = false; inObjects = false; blockName = null; continue; }
    if (c === 2 && v === 'OBJECTS'){ inObjects = true; inEnt = false; inBlocks = false; inHeader = false; continue; }
    if (c === 0 && v === 'ENDSEC'){
      if (inEnt || inBlocks || inObjects) flush();
      inEnt = false; inBlocks = false; inHeader = false; inObjects = false; blockName = null;
      continue;
    }
    if (inHeader){
      if (c === 9) headerVar = v;
      else if (headerVar === '$INSUNITS' && (c === 70 || c === 10)) insunits = parseInt(v, 10) || 0;
      else if (headerVar && (c === 70 || c === 40 || c === 10 || c === 1 || c === 2 || c === 8)) header[headerVar] = v;
      continue;
    }
    if (inObjects){
      if (c === 0){ flush(); cur = { _t: v }; continue; }
      if (!cur) continue;
      if (cur[c] === undefined) cur[c] = v;
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
      if (v === 'HATCH') cur._rings = [];
      if (v === 'SPLINE') cur._knots = [];
      continue;
    }
    if (!cur) continue;
    if (cur._t === 'SPLINE' && c === 40){ cur._knots.push(num(v)); continue; }
    /* Every HATCH boundary path opens with its type flags in group 92;
     * close out the points gathered so far as the previous ring. */
    if (cur._t === 'HATCH' && c === 92){
      if (cur._pts.length) cur._rings.push(cur._pts);
      cur._pts = [];
      continue;
    }
    if ((cur._t === 'LWPOLYLINE' || cur._t === 'HATCH' || cur._t === 'SPLINE' || cur._t === 'LEADER') && (c === 10 || c === 20 || c === 11 || c === 21)){
      const xcode = (c === 10 || c === 11);
      const ycode = (c === 20 || c === 21);
      if (xcode) cur._pts.push([num(v), 0]);
      else if (ycode && cur._pts.length) cur._pts[cur._pts.length - 1][1] = num(v);
      continue;
    }
    /* A bulge belongs to the vertex it follows. */
    if (cur._t === 'LWPOLYLINE' && c === 42){
      if (!cur._bul) cur._bul = [];
      while (cur._bul.length < cur._pts.length - 1) cur._bul.push(0);
      cur._bul[cur._pts.length - 1] = num(v);
      continue;
    }
    if (cur._t === 'POLYLINE' && cur._inv && curVerts && c === 42){
      if (!curBul) curBul = [];
      while (curBul.length < curVerts.length - 1) curBul.push(0);
      curBul[curVerts.length - 1] = num(v);
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
  bindAllDims(scaled);
  const layouts = layoutsFromDxf(layoutRecs, viewports, paper);
  meta.layouts = layouts;
  meta.paper = paper;
  meta.header = header;
  meta.insunits = insunits;
  return scaled;
}

function sheetKeyFromSize(w, h){
  const W = Number(w) || 0, H = Number(h) || 0;
  if (Math.abs(W - 36) < 1 && Math.abs(H - 24) < 1) return 'archd';
  if (Math.abs(W - 24) < 1 && Math.abs(H - 36) < 1) return 'archdp';
  if (Math.abs(W - 17) < 1 && Math.abs(H - 11) < 1) return 'tabloid';
  if (Math.abs(W - 11) < 1 && Math.abs(H - 8.5) < 1) return 'letter';
  if (H > W * 1.2) return 'archdp';
  return 'archd';
}

function layoutsFromDxf(recs, viewports, paper){
  const named = (recs || []).filter(r => r && String(r.name).toLowerCase() !== 'model' && r.tab !== 1);
  const layouts = [];
  if (named.length){
    named.forEach((r, i) => {
      const sheet = sheetKeyFromSize(r.w, r.h);
      const L = makeLayout({
        id: 'PS' + (i + 1),
        name: r.name || ('Layout ' + (i + 1)),
        sheet,
        ppf: 18
      });
      const vp = viewports[i] || viewports[0];
      if (vp){
        L.viewports = [{
          px: Math.max(0, vp.cx - vp.pw / 2),
          py: Math.max(0, vp.cy - vp.ph / 2),
          pw: vp.pw || 30,
          ph: vp.ph || 20,
          mx: vp.mx || 0,
          my: vp.my || 0,
          ppf: vp.viewH && vp.ph ? (vp.ph * 72 / vp.viewH) : 18
        }];
      }
      if (paper && paper.length) L.paper = paper;
      layouts.push(L);
    });
  } else if (viewports.length){
    const vp = viewports[0];
    const sheet = sheetKeyFromSize(vp.pw + 2, vp.ph + 3);
    const L = makeLayout({ id: 'PS1', name: 'Paperspace', sheet, ppf: 18 });
    L.viewports = [{
      px: Math.max(0, vp.cx - vp.pw / 2),
      py: Math.max(0, vp.cy - vp.ph / 2),
      pw: vp.pw || 30, ph: vp.ph || 20,
      mx: vp.mx || 0, my: vp.my || 0,
      ppf: vp.viewH && vp.ph ? (vp.ph * 72 / vp.viewH) : 18
    }];
    if (paper && paper.length) L.paper = paper;
    layouts.push(L);
  } else if (paper && paper.length){
    const L = makeLayout({ id: 'PS1', name: 'Paperspace', sheet: 'archd', ppf: 18 });
    L.paper = paper;
    layouts.push(L);
  }
  return layouts;
}

export function parseDrawing(txt, ensureLayer){
  const sink = {};
  const entities = parseDXF(txt, ensureLayer || (n => n || 'WALLS'), sink);
  return {
    entities,
    layouts: sink.layouts || [],
    paper: sink.paper || [],
    header: sink.header || {},
    insunits: sink.insunits || 0
  };
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
  const sink = {};
  const entities = parseDXF(txt, ensureLayer || (n => n || 'WALLS'), sink);
  const insunits = peekInsUnits(txt);
  return {
    entities,
    count: entities.length,
    insunits,
    units: dxfUnitLabel(insunits),
    layouts: sink.layouts || [],
    paper: sink.paper || [],
    header: sink.header || {}
  };
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
