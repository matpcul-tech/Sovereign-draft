/* Hand-rolled PDF printed at a true architectural scale, with title block and
 * scale bar. When a layout is supplied, the sheet size and viewports of that
 * layout are used; otherwise Letter landscape (legacy path, tests rely on it).
 */
import { arcPoints, dimGeom } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { membersBBox, explodeForIO } from '../core/entities.js';
import { hatchLines, hatchPlan, ppfToScaleFactor } from '../core/hatch.js';
import { helveticaWidth } from '../core/textmetrics.js';
import { sheetOf } from '../core/layout.js';

export const SCALE_LADDER = [
  { ppf: 72,   lbl: '1" = 1\'-0"' },
  { ppf: 54,   lbl: '3/4" = 1\'-0"' },
  { ppf: 36,   lbl: '1/2" = 1\'-0"' },
  { ppf: 27,   lbl: '3/8" = 1\'-0"' },
  { ppf: 18,   lbl: '1/4" = 1\'-0"' },
  { ppf: 13.5, lbl: '3/16" = 1\'-0"' },
  { ppf: 9,    lbl: '1/8" = 1\'-0"' },
  { ppf: 6.75, lbl: '3/32" = 1\'-0"' },
  { ppf: 4.5,  lbl: '1/16" = 1\'-0"' }
];

export function scaleLabel(ppf){
  for (const s of SCALE_LADDER) if (Math.abs(s.ppf - ppf) < 0.01) return s.lbl;
  return ppf + ' pt/ft';
}

export function pdfSafe(s){
  s = String(s).replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/×/g, 'x').replace(/Δ/g, 'd').replace(/·/g, '-').replace(/°/g, ' deg');
  let out = '';
  for (let i = 0; i < s.length; i++){
    const ch = s[i], cd = s.charCodeAt(i);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (cd < 32 || cd > 126) out += ' ';
    else out += ch;
  }
  return out;
}

function wrapPDF(stream, pageW, pageH){
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj',
    '4 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream\nendobj',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const o of objs){
    offsets.push(pdf.length);
    pdf += o + '\n';
  }
  const xrefPos = pdf.length;
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let q = 1; q <= objs.length; q++){
    pdf += String(offsets[q]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return pdf;
}

function drawEntities(P, f2, TX, TY, visible, ppf, textAt, seg, path, circlePts){
  const list = [];
  visible.forEach(e => {
    if (e.type === 'insert' || e.type === 'table' || e.type === 'ellipse' || e.type === 'cloud' || e.type === 'leader' || e.type === 'image' || e.type === 'grid' || e.type === 'xline' || e.type === 'room' || e.type === 'profile' || e.type === 'centerline' || e.type === 'callout' || e.type === 'hatchRegion' || (e.type === 'dim' && (e.kind === 'angular' || e.kind === 'radius' || e.kind === 'diameter'))){
      explodeForIO(e).forEach(f => list.push(f));
    } else list.push(e);
  });
  list.forEach(e => {
    const isDim = e.layer === 'DIMS';
    const isWall = e.layer === 'WALLS' || e.kind === 'wall';
    P((isWall ? '1.4' : (isDim ? '0.4' : '0.7')) + ' w');
    P((isDim ? '0.35' : '0.08') + ' G');
    if (e.type === 'line') seg(e.x1, e.y1, e.x2, e.y2);
    else if (e.type === 'poly') path(e.pts, e.closed);
    else if (e.type === 'circle') path(circlePts(e.cx, e.cy, e.r), false);
    else if (e.type === 'arc') path(arcPoints(e), false);
    else if (e.type === 'hatch'){
      /* Spacing is a paper value converted at plot time, so the pattern reads
       * the same at 1/16" as it does at 1/2". */
      const sf = ppfToScaleFactor(ppf);
      const plan = hatchPlan(e, sf);
      if (plan.mode === 'lines'){
        hatchLines(e, sf).forEach(sg => seg(sg[0][0], sg[0][1], sg[1][0], sg[1][1]));
      } else if (plan.mode === 'tone'){
        /* Too fine to read as lines. A light tone instead of a smear. */
        P('q 0.88 g');
        pathFill(e.pts);
        P('Q');
      }
    }
    else if (e.type === 'text'){
      textAt(TX(e.x), TY(e.y), Math.max(e.size * ppf, 4), e.content || '', 0, false, 0.1);
    }
    else if (e.type === 'dim'){
      const g = dimGeom(e);
      [g.e1, g.e2, g.d].forEach(sg => seg(sg[0][0], sg[0][1], sg[1][0], sg[1][1]));
      const pa = [TX(g.d[0][0]), TY(g.d[0][1])], pb = [TX(g.d[1][0]), TY(g.d[1][1])];
      let ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
      [pa, pb].forEach(p => {
        const tx = 2.6 * Math.cos(ang - Math.PI / 4), tyk = 2.6 * Math.sin(ang - Math.PI / 4);
        P(f2(p[0] - tx) + ' ' + f2(p[1] - tyk) + ' m ' + f2(p[0] + tx) + ' ' + f2(p[1] + tyk) + ' l S');
      });
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const txt = fmtFtIn(g.len, e.precision), sz = 7.5;
      const wtxt = helveticaWidth(txt, sz, false);
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      textAt(mx - Math.cos(ang) * wtxt / 2 + nx * 2.5, my - Math.sin(ang) * wtxt / 2 + ny * 2.5, sz, txt, ang, false, 0.25);
    }
  });
}

/* opts: { ppf: number | 'fit', layerVisible(name)=>bool, projectName, dateStr, layout } */
export function buildPDF(entities, opts){
  opts = opts || {};
  if (opts.layout) return buildLayoutPDF(entities, opts);
  const layerVisible = opts.layerVisible || (() => true);
  const visible = entities.filter(e => layerVisible(e.layer));
  const bb = membersBBox(visible.length ? visible : entities);
  const wft = Math.max(bb[2] - bb[0], 0.5), hft = Math.max(bb[3] - bb[1], 0.5);
  const VX = 36, VY = 100, VW = 720, VH = 476;
  let ppf, clipped = false;
  if (opts.ppf === 'fit' || opts.ppf === undefined){
    ppf = SCALE_LADDER[SCALE_LADDER.length - 1].ppf;
    for (const s of SCALE_LADDER){
      if (wft * s.ppf <= VW - 20 && hft * s.ppf <= VH - 20){ ppf = s.ppf; break; }
    }
    if (wft * ppf > VW || hft * ppf > VH) clipped = true;
  } else {
    ppf = Number(opts.ppf);
    if (wft * ppf > VW || hft * ppf > VH) clipped = true;
  }
  const cx = (bb[0] + bb[2]) / 2, cyw = (bb[1] + bb[3]) / 2;
  const TX = x => VX + VW / 2 + (x - cx) * ppf;
  const TY = y => VY + VH / 2 + (y - cyw) * ppf;
  const f2 = n => String(Math.round(n * 100) / 100);
  const C = [];
  const P = s => C.push(s);
  const seg = (x1, y1, x2, y2) => P(f2(TX(x1)) + ' ' + f2(TY(y1)) + ' m ' + f2(TX(x2)) + ' ' + f2(TY(y2)) + ' l S');
  function path(pts, close){
    if (!pts || !pts.length) return;
    let s = f2(TX(pts[0][0])) + ' ' + f2(TY(pts[0][1])) + ' m';
    for (let i = 1; i < pts.length; i++) s += ' ' + f2(TX(pts[i][0])) + ' ' + f2(TY(pts[i][1])) + ' l';
    P(s + (close ? ' h S' : ' S'));
  }
  /* Filled version of path(), for the too-fine-to-draw hatch tone. */
  function pathFill(pts){
    if (!pts || !pts.length) return;
    let s = f2(TX(pts[0][0])) + ' ' + f2(TY(pts[0][1])) + ' m';
    for (let i = 1; i < pts.length; i++) s += ' ' + f2(TX(pts[i][0])) + ' ' + f2(TY(pts[i][1])) + ' l';
    P(s + ' h f');
  }
  function circlePts(ccx, ccy, r){
    const pts = [];
    for (let a = 0; a <= 360; a += 6){ const rad = a * Math.PI / 180; pts.push([ccx + r * Math.cos(rad), ccy + r * Math.sin(rad)]); }
    return pts;
  }
  function textAt(px, py, size, str, ang, bold, gray){
    const co = Math.cos(ang || 0), si = Math.sin(ang || 0);
    P('BT /' + (bold ? 'F2' : 'F1') + ' ' + f2(size) + ' Tf ' + f2(gray) + ' g ' + f2(co) + ' ' + f2(si) + ' ' + f2(-si) + ' ' + f2(co) + ' ' + f2(px) + ' ' + f2(py) + ' Tm (' + pdfSafe(str) + ') Tj ET');
  }
  P('q');
  P(f2(VX) + ' ' + f2(VY) + ' ' + f2(VW) + ' ' + f2(VH) + ' re W n');
  drawEntities(P, f2, TX, TY, visible, ppf, textAt, seg, path, circlePts);
  P('Q');
  P('0.08 G 1.2 w');
  P('36 92 m 756 92 l S');
  const name = (opts.projectName || 'SOVEREIGN DRAFT').toUpperCase();
  textAt(42, 66, 17, name, 0, true, 0.05);
  textAt(42, 48, 9, (opts.dateStr || new Date().toLocaleDateString()) + '   units: feet', 0, false, 0.35);
  textAt(430, 48, 10, 'SCALE: ' + scaleLabel(ppf) + (clipped ? '  (clipped to sheet)' : ''), 0, false, 0.15);
  textAt(700, 66, 11, 'SHEET A-1', 0, true, 0.15);
  let barFt = 10; if (barFt * ppf > 200) barFt = 5; if (barFt * ppf > 200) barFt = 2;
  const bwp = barFt * ppf, bx = 430, byp = 70;
  P('0.08 G 1 w');
  P(f2(bx) + ' ' + f2(byp) + ' m ' + f2(bx + bwp) + ' ' + f2(byp) + ' l S');
  P(f2(bx) + ' ' + f2(byp - 4) + ' m ' + f2(bx) + ' ' + f2(byp + 4) + ' l S');
  P(f2(bx + bwp) + ' ' + f2(byp - 4) + ' m ' + f2(bx + bwp) + ' ' + f2(byp + 4) + ' l S');
  P(f2(bx + bwp / 2) + ' ' + f2(byp - 3) + ' m ' + f2(bx + bwp / 2) + ' ' + f2(byp + 3) + ' l S');
  textAt(bx + bwp + 8, byp - 3, 8, barFt + ' FT', 0, false, 0.35);

  return { pdf: wrapPDF(C.join('\n'), 792, 612), ppf, clipped };
}

export function buildLayoutPDF(entities, opts){
  const layout = opts.layout;
  const sh = sheetOf(layout.sheet);
  const pageW = Math.round(sh.w * 72), pageH = Math.round(sh.h * 72);
  const layerVisible = opts.layerVisible || (() => true);
  const visible = entities.filter(e => layerVisible(e.layer));
  const f2 = n => String(Math.round(n * 100) / 100);
  const C = [];
  const P = s => C.push(s);
  function textAt(px, py, size, str, ang, bold, gray){
    const co = Math.cos(ang || 0), si = Math.sin(ang || 0);
    P('BT /' + (bold ? 'F2' : 'F1') + ' ' + f2(size) + ' Tf ' + f2(gray == null ? 0.08 : gray) + ' g ' + f2(co) + ' ' + f2(si) + ' ' + f2(-si) + ' ' + f2(co) + ' ' + f2(px) + ' ' + f2(py) + ' Tm (' + pdfSafe(str) + ') Tj ET');
  }
  const ppf = layout.ppf || 18;
  for (const vp0 of layout.viewports){
    const VX = vp0.px * 72, VY = vp0.py * 72, VW = vp0.pw * 72, VH = vp0.ph * 72;
    const vppf = vp0.ppf || ppf;
    const TX = x => VX + VW / 2 + (x - vp0.mx) * vppf;
    const TY = y => VY + VH / 2 + (y - vp0.my) * vppf;
    const seg = (x1, y1, x2, y2) => P(f2(TX(x1)) + ' ' + f2(TY(y1)) + ' m ' + f2(TX(x2)) + ' ' + f2(TY(y2)) + ' l S');
    function path(pts, close){
      if (!pts || !pts.length) return;
      let s = f2(TX(pts[0][0])) + ' ' + f2(TY(pts[0][1])) + ' m';
      for (let i = 1; i < pts.length; i++) s += ' ' + f2(TX(pts[i][0])) + ' ' + f2(TY(pts[i][1])) + ' l';
      P(s + (close ? ' h S' : ' S'));
    }
    function circlePts(ccx, ccy, r){
      const pts = [];
      for (let a = 0; a <= 360; a += 6){ const rad = a * Math.PI / 180; pts.push([ccx + r * Math.cos(rad), ccy + r * Math.sin(rad)]); }
      return pts;
    }
    P('q');
    P(f2(VX) + ' ' + f2(VY) + ' ' + f2(VW) + ' ' + f2(VH) + ' re W n');
    drawEntities(P, f2, TX, TY, visible, vppf, textAt, seg, path, circlePts);
    P('Q');
    P('0.2 G 0.8 w');
    P(f2(VX) + ' ' + f2(VY) + ' ' + f2(VW) + ' ' + f2(VH) + ' re S');
  }
  if (layout.titleBlock !== false){
    const tbY = 36, tbH = 54, tbX = 36, tbW = pageW - 72;
    P('0.08 G 1.2 w');
    P(f2(tbX) + ' ' + f2(tbY) + ' ' + f2(tbW) + ' ' + f2(tbH) + ' re S');
    const name = (opts.projectName || 'SOVEREIGN DRAFT').toUpperCase();
    textAt(tbX + 10, tbY + 32, 16, name, 0, true, 0.05);
    textAt(tbX + 10, tbY + 14, 9, (opts.dateStr || new Date().toLocaleDateString()) + '   units: feet', 0, false, 0.35);
    textAt(tbX + tbW * 0.55, tbY + 14, 10, 'SCALE: ' + scaleLabel(ppf), 0, false, 0.15);
    textAt(tbX + tbW - 12, tbY + 32, 11, layout.name || 'SHEET A-1', 0, true, 0.15);
  }
  return { pdf: wrapPDF(C.join('\n'), pageW, pageH), ppf, clipped: false };
}
