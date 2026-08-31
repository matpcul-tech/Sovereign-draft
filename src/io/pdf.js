/* Hand-rolled PDF printed at a true architectural scale, with title block and
 * scale bar. When a layout is supplied, the sheet size and viewports of that
 * layout are used; otherwise Letter landscape (legacy path, tests rely on it).
 */
import { arcPoints, dimGeom } from '../core/geometry.js';
import { fmtFtIn } from '../core/format.js';
import { membersBBox, explodeForIO } from '../core/entities.js';
import { hatchLines, hatchPlan, ppfToScaleFactor } from '../core/hatch.js';
import { polyOutline } from '../core/bulge.js';
import { mtextLayout } from '../core/mtext.js';
import { styleFor, metricsOpts } from '../core/textstyle.js';
import { helveticaWidth } from '../core/textmetrics.js';
import { sheetLabel } from '../core/document.js';
import { tableFrags } from '../core/schedule.js';
import { detailBubbleText, viewportClearOfAnnotations, annotationRect } from '../core/sheetspace.js';
import { sheetOf, clipPoly, viewportRot } from '../core/layout.js';
import { fontObjects, hexString, collectGlyphs } from './pdffont.js';
import { missingGlyphs } from './ttf.js';
import { titleBlockModel, drawingTitleOf, fitPaperText, viewportClearOfTitle } from '../core/titleblock.js';
import { entsInBBox } from '../core/legend.js';
import { refreshDerivedTables } from '../core/keynote.js';
import { plotLwPt, styledLwPt, styledGray, stylePlots, plotStyleByName, defaultPlotStyles, SOLID_GRAY, DIM_GRAY } from './plotstyle.js';

export const SCALE_LADDER = [
  { ppf: 864,  lbl: '1:1' },
  { ppf: 432,  lbl: '6" = 1\'-0"' },
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

/* Typographic characters the base fonts cannot draw but that have an honest
 * ASCII spelling. Folding these first means a degree sign does not drag a
 * whole embedded font into the file just to print one glyph. */
export function foldTypographic(s){
  return String(s).replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/×/g, 'x').replace(/Δ/g, 'd').replace(/·/g, '-').replace(/°/g, ' deg').replace(/©/g, '(c)');
}

export function pdfSafe(s){
  s = foldTypographic(s);
  let out = '';
  for (let i = 0; i < s.length; i++){
    const ch = s[i], cd = s.charCodeAt(i);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (cd < 32 || cd > 126) out += ' ';
    else out += ch;
  }
  return out;
}

/* One page per entry: [{ stream, pageW, pageH }].
 * Object numbering is 1 catalog, 2 pages, then page and contents in pairs,
 * then the two fonts. With a single page that is objects 3,4,5,6, which is
 * exactly the layout the single page writer used, so the bytes are unchanged.
 */
export function wrapPDFPages(pages, embed){
  const n = pages.length;
  const fontR = 3 + n * 2, fontB = 4 + n * 2;
  const kids = pages.map((_, i) => (3 + i * 2) + ' 0 R').join(' ');
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>\nendobj'
  ];
  /* An embedded font takes four objects after the base fonts, and is offered
   * to every page as /F3 so text can name it without a per page table. */
  const embedRef = embed ? fontB + 1 : 0;
  const fontRes = '/F1 ' + fontR + ' 0 R /F2 ' + fontB + ' 0 R' +
    (embed ? ' /F3 ' + embedRef + ' 0 R' : '');
  pages.forEach((pg, i) => {
    const pageNum = 3 + i * 2, contentNum = 4 + i * 2;
    objs.push(pageNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pg.pageW + ' ' + pg.pageH +
      '] /Contents ' + contentNum + ' 0 R /Resources << /Font << ' + fontRes + ' >> >> >>\nendobj');
    objs.push(contentNum + ' 0 obj\n<< /Length ' + pg.stream.length + ' >>\nstream\n' + pg.stream + '\nendstream\nendobj');
  });
  objs.push(fontR + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  objs.push(fontB + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');
  if (embed) fontObjects(embed.font, embed.glyphs, embedRef).objs.forEach(o => objs.push(o));
  return assemblePDF(objs);
}

function wrapPDF(stream, pageW, pageH){
  return wrapPDFPages([{ stream, pageW, pageH }], embedPayload());
}

/* ---------- text output, with or without an embedded font ----------
 *
 * With no font the writer emits a literal string in the base 14 Helvetica,
 * exactly as it always has. With one, text becomes a run of two byte glyph
 * ids under Identity-H, which is what carries a script Helvetica has no
 * glyphs for.
 *
 * The embedded font is named per string rather than per document: a drawing
 * is mostly Latin, and leaving that on Helvetica keeps the subset small and
 * the plotted weight of ordinary notes unchanged.
 */
let EMBED = null;
const EMBED_SEEN = new Set();

export function setEmbeddedFont(font){
  EMBED = font || null;
  EMBED_SEEN.clear();
}

/* Text the base fonts cannot draw has to use the embedded one.
 *
 * This has to look at the original string. pdfSafe replaces everything
 * outside printable ASCII with a space, so asking it what it produced would
 * always answer "plain ASCII" and no text would ever reach the embedded
 * font. The question is what pdfSafe would have destroyed. */
function needsEmbed(str){
  if (!EMBED) return false;
  return /[^\x20-\x7e]/.test(foldTypographic(String(str == null ? '' : str)));
}

function fontOp(str, bold){
  if (needsEmbed(str)) return '/F3';
  return bold ? '/F2' : '/F1';
}

function showText(str){
  const s = String(str == null ? '' : str);
  if (needsEmbed(str)){
    EMBED_SEEN.add(s);
    return hexString(EMBED, s);
  }
  return '(' + pdfSafe(s) + ')';
}

/* What the document actually needs embedded, gathered while it was drawn. */
function embedPayload(){
  if (!EMBED || !EMBED_SEEN.size) return null;
  return { font: EMBED, glyphs: collectGlyphs(EMBED, [...EMBED_SEEN]) };
}

function assemblePDF(objs){
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

function drawEntities(P, f2, TX, TY, visible, ppf, textAt, seg, path, circlePts, issued, styles, table, named){
  const list = [];
  visible.forEach(e => {
    if (e.type === 'insert' || e.type === 'table' || e.type === 'ellipse' || e.type === 'cloud' || e.type === 'leader' || e.type === 'image' || e.type === 'grid' || e.type === 'xline' || e.type === 'room' || e.type === 'profile' || e.type === 'centerline' || e.type === 'callout' || e.type === 'hatchRegion' || (e.type === 'dim' && (e.kind === 'angular' || e.kind === 'radius' || e.kind === 'diameter'))){
      explodeForIO(e).forEach(f => list.push(f));
    } else list.push(e);
  });
  list.forEach(e => {
    const isDim = e.layer === 'DIMS';
    const isWall = e.layer === 'WALLS' || e.kind === 'wall';
    /* An issued sheet always plots at real lineweights. The quick export
     * uses screen weights unless a table was actually asked for, so naming
     * one governs weight on both paths while naming none leaves the quick
     * export exactly as it was. */
    if (issued || named){
      const pt = table ? styledLwPt(e, table) : plotLwPt(e);
      P(f2(isDim ? Math.min(pt, 0.55) : pt) + ' w');
    } else {
      P((isWall ? '1.4' : (isDim ? '0.4' : '0.7')) + ' w');
    }
    /* Screening scales the ink toward paper white. With no table, or a table
     * at full tone, this is the same value the writer has always used. */
    P(f2(table ? styledGray(e, table, isDim) : (isDim ? DIM_GRAY : SOLID_GRAY)) + ' G');
    if (e.type === 'line') seg(e.x1, e.y1, e.x2, e.y2);
    else if (e.type === 'poly') path(polyOutline(e), e.closed);
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
        pathFill(e.pts, e.holes);
        P('Q');
      }
    }
    else if (e.type === 'text'){
      /* paperTextH is a paper space height in points and is NOT scaled by
       * ppf, so it prints the same at every view scale. `size` stays a
       * model height for entities authored before the document model, so
       * existing drawings export byte for byte as they did. Phase C moves
       * new text onto the paper value once views can differ in scale. */
      const th = e.paperTextH ? e.paperTextH : Math.max(e.size * ppf, 4);
      textAt(TX(e.x), TY(e.y), th, e.content || '', 0, false, 0.1);
    }
    else if (e.type === 'mtext'){
      /* No ctx here, so the wrap uses the AFM metrics, which are the metrics
       * of the font this writer embeds. That is the authority: the canvas
       * measures against the same widths for exactly this reason. */
      const th = e.paperTextH ? e.paperTextH : Math.max(e.size * ppf, 4);
      /* textAt takes radians. */
      const ang = (e.rot || 0) * Math.PI / 180;
      const st = styleFor(e, styles);
      for (const l of mtextLayout(e, metricsOpts(st))) textAt(TX(l.x), TY(l.y), th, l.text, ang, !!(st && st.bold), 0.1);
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
  setEmbeddedFont((opts && opts.font) || null);
  opts = opts || {};
  if (opts.layout) return buildLayoutPDF(entities, opts);
  const layerVisible = opts.layerVisible || (() => true);
  /* A layer can be on screen and off paper. The app folds that flag into the
   * layerVisible callback it passes in, but the default here is permissive,
   * so any other caller silently printed layers marked not to plot. Reading
   * it from the layer records makes the writer correct on its own, and it is
   * also how a plot style table holds a layer back. */
  const table = plotStyleByName(opts.plotStyles || defaultPlotStyles(), opts.plotStyle);
  const layerRec = n => (opts.layers || []).find(L => L && L.name === n) || null;
  const visible = entities.filter(e => layerVisible(e.layer) && stylePlots(e.layer, table, layerRec(e.layer)));
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
  function pathFill(pts, holes){
    if (!pts || !pts.length) return;
    const sub = ring => {
      let t = f2(TX(ring[0][0])) + ' ' + f2(TY(ring[0][1])) + ' m';
      for (let i = 1; i < ring.length; i++) t += ' ' + f2(TX(ring[i][0])) + ' ' + f2(TY(ring[i][1])) + ' l';
      return t + ' h';
    };
    const rings = (holes || []).filter(h => h && h.length > 2);
    let s = sub(pts);
    /* Each hole is another subpath and the fill switches to even-odd, which
     * is what leaves a void instead of painting straight over it. */
    rings.forEach(h => { s += ' ' + sub(h); });
    P(s + (rings.length ? ' f*' : ' f'));
  }
  function circlePts(ccx, ccy, r){
    const pts = [];
    for (let a = 0; a <= 360; a += 6){ const rad = a * Math.PI / 180; pts.push([ccx + r * Math.cos(rad), ccy + r * Math.sin(rad)]); }
    return pts;
  }
  function textAt(px, py, size, str, ang, bold, gray){
    const co = Math.cos(ang || 0), si = Math.sin(ang || 0);
    P('BT ' + fontOp(str, bold) + ' ' + f2(size) + ' Tf ' + f2(gray) + ' g ' + f2(co) + ' ' + f2(si) + ' ' + f2(-si) + ' ' + f2(co) + ' ' + f2(px) + ' ' + f2(py) + ' Tm ' + showText(str) + ' Tj ET');
  }
  P('q');
  P(f2(VX) + ' ' + f2(VY) + ' ' + f2(VW) + ' ' + f2(VH) + ' re W n');
  drawEntities(P, f2, TX, TY, visible, ppf, textAt, seg, path, circlePts, false, opts.textStyles, table, !!opts.plotStyle);
  P('Q');
  P('0.08 G 1.2 w');
  P('36 92 m 756 92 l S');
  const name = (opts.projectName || 'SOVEREIGN DRAFT').toUpperCase();
  textAt(42, 66, 17, name, 0, true, 0.05);
  textAt(42, 48, 9, (opts.dateStr || new Date().toLocaleDateString()) + '   units: feet', 0, false, 0.35);
  textAt(430, 48, 10, 'SCALE: ' + scaleLabel(ppf) + (clipped ? '  (clipped to sheet)' : ''), 0, false, 0.15);
  /* With one sheet this is exactly 'SHEET A-1', which is what the
   * pre-refactor build emitted. The count only appears once a document
   * actually holds more than one sheet. */
  textAt(700, 66, 11, sheetLabel(opts.sheetNumber, opts.sheetIndex || 0, opts.sheetCount || 1), 0, true, 0.15);
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

/* Produces one page's content stream rather than a finished document, so a
 * sheet set can be assembled from many of them. */
function layoutPage(entities, opts){
  const layout = opts.layout;
  refreshDerivedTables(layout, entities);
  const sh = sheetOf(layout.sheet);
  const pageW = Math.round(sh.w * 72), pageH = Math.round(sh.h * 72);
  const layerVisible = opts.layerVisible || (() => true);
  const table = plotStyleByName(opts.plotStyles || defaultPlotStyles(), opts.plotStyle);
  const layerRec = n => (opts.layers || []).find(L => L && L.name === n) || null;
  let visible = entities.filter(e => layerVisible(e.layer) && stylePlots(e.layer, table, layerRec(e.layer)))
    /* An entity scoped to specific sheets appears only there. */
    .filter(e => !e.visibleIn || e.visibleIn.indexOf(layout.id) >= 0);
  if (layout.section && layout.section.bbox){
    const secBox = layout.section.geo
      ? [Math.min(layout.section.bbox[0], layout.section.geo[0]), Math.min(layout.section.bbox[1], layout.section.geo[1]),
         Math.max(layout.section.bbox[2], layout.section.geo[2]), Math.max(layout.section.bbox[3], layout.section.geo[3])]
      : layout.section.bbox;
    visible = entsInBBox(visible, secBox, 0.4);
  }
  const f2 = n => String(Math.round(n * 100) / 100);
  const C = [];
  const P = s => C.push(s);
  function textAt(px, py, size, str, ang, bold, gray){
    const co = Math.cos(ang || 0), si = Math.sin(ang || 0);
    P('BT ' + fontOp(str, bold) + ' ' + f2(size) + ' Tf ' + f2(gray == null ? 0.08 : gray) + ' g ' + f2(co) + ' ' + f2(si) + ' ' + f2(-si) + ' ' + f2(co) + ' ' + f2(px) + ' ' + f2(py) + ' Tm ' + showText(str) + ' Tj ET');
  }
  const ppf = layout.ppf || 18;
  for (const vpRaw of layout.viewports){
    const vp0 = viewportClearOfAnnotations(viewportClearOfTitle(vpRaw), layout.annotations);
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
    /* The clip is a paper space polygon when the viewport has one, and the
     * frame otherwise. An arbitrary path clips exactly the same way a
     * rectangle does, so an L shaped enlarged plan or a round detail bubble
     * costs nothing extra here. */
    const clip = clipPoly(vp0);
    if (clip){
      let cp = f2(clip[0][0] * 72) + ' ' + f2(clip[0][1] * 72) + ' m';
      for (let i = 1; i < clip.length; i++) cp += ' ' + f2(clip[i][0] * 72) + ' ' + f2(clip[i][1] * 72) + ' l';
      P(cp + ' h W n');
    } else {
      P(f2(VX) + ' ' + f2(VY) + ' ' + f2(VW) + ' ' + f2(VH) + ' re W n');
    }
    /* Twist is a rotation of the view about the frame centre. PDF applies it
     * itself, which keeps the model to paper mapping below a plain scale and
     * offset rather than something every drawing call has to know about. */
    const rot = viewportRot(vp0);
    if (rot){
      const r = rot * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
      const ox = VX + VW / 2, oy = VY + VH / 2;
      P('1 0 0 1 ' + f2(ox) + ' ' + f2(oy) + ' cm');
      P(f2(co) + ' ' + f2(si) + ' ' + f2(-si) + ' ' + f2(co) + ' 0 0 cm');
      P('1 0 0 1 ' + f2(-ox) + ' ' + f2(-oy) + ' cm');
    }
    drawEntities(P, f2, TX, TY, visible, vppf, textAt, seg, path, circlePts, true, opts.textStyles, table, !!opts.plotStyle);
    P('Q');
    drawScaleBar(P, f2, textAt, vp0, vppf);
  }
  /* Paper-space entities preserved from a DWG/DXF layout (inches). */
  (layout.paper || []).forEach(e => {
    const IX = v => v * 72, IY = v => v * 72;
    P(f2(plotLwPt(e)) + ' w 0.08 G');
    if (e.type === 'line'){
      P(f2(IX(e.x1)) + ' ' + f2(IY(e.y1)) + ' m ' + f2(IX(e.x2)) + ' ' + f2(IY(e.y2)) + ' l S');
    } else if (e.type === 'text'){
      textAt(IX(e.x), IY(e.y), Math.max((e.size || 0.12) * 72, 6), e.content || '', 0, false, 0.1);
    } else if (e.type === 'poly' && e.pts && e.pts.length){
      let s = f2(IX(e.pts[0][0])) + ' ' + f2(IY(e.pts[0][1])) + ' m';
      for (let i = 1; i < e.pts.length; i++) s += ' ' + f2(IX(e.pts[i][0])) + ' ' + f2(IY(e.pts[i][1])) + ' l';
      P(s + (e.closed ? ' h S' : ' S'));
    }
  });
  /* Sheet space annotations. Coordinates are paper inches, so a legend keeps
   * its size and position whatever scale the views are drawn at. */
  (layout.annotations || []).forEach(a => {
    if (!a) return;
    const IX = v => v * 72, IY = v => v * 72;
    P('0.6 w 0.08 G');
    if (a.kind === 'table' && a.table){
      const t = Object.assign({}, a.table, { x: a.x, y: a.y, fromTop: true });
      const paper = (t.rowH || 0.85) < 0.4;
      const ts = paper ? 1 : ((t.rowH || 0.22) / 0.85);
      const box = annotationRect(a);
      if (box){
        P('q 0.96 0.94 0.89 rg ' + f2(IX(box[0])) + ' ' + f2(IY(box[1])) + ' ' +
          f2(IX(box[2]) - IX(box[0])) + ' ' + f2(IY(box[3]) - IY(box[1])) + ' re f Q');
      }
      tableFrags(t).forEach(f => {
        if (f.type === 'line'){
          P(f2(IX(f.x1)) + ' ' + f2(IY(f.y1)) + ' m ' + f2(IX(f.x2)) + ' ' + f2(IY(f.y2)) + ' l S');
        } else if (f.type === 'text'){
          const sz = Math.max(f.size * ts * 72, 5);
          let str = f.content || '';
          if (f.maxW) str = fitPaperText(str, sz, f.maxW, false);
          textAt(IX(f.x), IY(f.y), sz, str, 0, false, 0.1);
        }
      });
      return;
    }
    if (a.leader && a.leader.length === 2){
      P(f2(IX(a.leader[0][0])) + ' ' + f2(IY(a.leader[0][1])) + ' m ' + f2(IX(a.leader[1][0])) + ' ' + f2(IY(a.leader[1][1])) + ' l S');
    }
    if (a.kind === 'mark'){
      const cx = IX(a.x), cy = IY(a.y), r = (a.r || 0.18) * 72;
      const k = r * 0.5523;
      const circ = f2(cx + r) + ' ' + f2(cy) + ' m ' +
        f2(cx + r) + ' ' + f2(cy + k) + ' ' + f2(cx + k) + ' ' + f2(cy + r) + ' ' + f2(cx) + ' ' + f2(cy + r) + ' c ' +
        f2(cx - k) + ' ' + f2(cy + r) + ' ' + f2(cx - r) + ' ' + f2(cy + k) + ' ' + f2(cx - r) + ' ' + f2(cy) + ' c ' +
        f2(cx - r) + ' ' + f2(cy - k) + ' ' + f2(cx - k) + ' ' + f2(cy - r) + ' ' + f2(cx) + ' ' + f2(cy - r) + ' c ' +
        f2(cx + k) + ' ' + f2(cy - r) + ' ' + f2(cx + r) + ' ' + f2(cy - k) + ' ' + f2(cx + r) + ' ' + f2(cy) + ' c';
      P('1 g'); P(circ + ' f');
      P('0.08 G 1.05 w'); P(circ + ' S');
      const ts = Math.max((a.size || 0.09) * 72, 5);
      const label = String(a.text || '');
      textAt(cx - helveticaWidth(label, ts, true) / 2, cy - ts * 0.32, ts, label, 0, true, 0.08);
      return;
    }
    if (a.kind === 'detail'){
      /* The standard bubble: a circle split by its horizontal diameter, view
       * number over sheet number. */
      const cx = IX(a.x), cy = IY(a.y), r = (a.r || 0.28) * 72;
      const k = r * 0.5523;
      P(f2(cx + r) + ' ' + f2(cy) + ' m ' +
        f2(cx + r) + ' ' + f2(cy + k) + ' ' + f2(cx + k) + ' ' + f2(cy + r) + ' ' + f2(cx) + ' ' + f2(cy + r) + ' c ' +
        f2(cx - k) + ' ' + f2(cy + r) + ' ' + f2(cx - r) + ' ' + f2(cy + k) + ' ' + f2(cx - r) + ' ' + f2(cy) + ' c ' +
        f2(cx - r) + ' ' + f2(cy - k) + ' ' + f2(cx - k) + ' ' + f2(cy - r) + ' ' + f2(cx) + ' ' + f2(cy - r) + ' c ' +
        f2(cx + k) + ' ' + f2(cy - r) + ' ' + f2(cx + r) + ' ' + f2(cy - k) + ' ' + f2(cx + r) + ' ' + f2(cy) + ' c S');
      P(f2(cx - r) + ' ' + f2(cy) + ' m ' + f2(cx + r) + ' ' + f2(cy) + ' l S');
      const t = detailBubbleText(opts.sheets || [layout], a);
      const ts = (a.size || 0.12) * 72;
      textAt(cx - helveticaWidth(t.top, ts, true) / 2, cy + ts * 0.35, ts, t.top, 0, true, 0.08);
      textAt(cx - helveticaWidth(t.bottom, ts, true) / 2, cy - ts * 1.15, ts, t.bottom, 0, true, 0.08);
      return;
    }
    textAt(IX(a.x), IY(a.y), Math.max((a.size || 0.12) * 72, 4), a.text || '', 0, false, 0.1);
  });

  if (layout.titleBlock !== false){
    const total = opts.sheetCount || 1;
    const vpPpf = (layout.viewports && layout.viewports[0] && layout.viewports[0].ppf) || ppf;
    const model = titleBlockModel(layout.sheet, {
      firm: opts.firm,
      projectName: opts.projectName,
      drawingTitle: drawingTitleOf(layout),
      sheetNumber: layout.sheetNumber || '',
      sheetCount: total,
      scale: scaleLabel(vpPpf),
      dateStr: opts.dateStr || new Date().toLocaleDateString(),
      year: opts.year
    });
    paintTitleBlock(P, f2, textAt, model);
  }
  return { stream: C.join('\n'), pageW, pageH, ppf };
}

function drawScaleBar(P, f2, textAt, vp, ppf){
  if (!vp || !ppf) return;
  const ft = ppf >= 27 ? 5 : ppf >= 13 ? 10 : 20;
  const x = (vp.px + 0.28) * 72;
  const y = (vp.py + 0.28) * 72;
  const w = ft * ppf;
  if (w < 28 || w > (vp.pw || 10) * 72 * 0.4) return;
  const segs = 4;
  const sw = w / segs;
  for (let i = 0; i < segs; i++){
    P((i % 2 ? '0.12' : '0.92') + ' g');
    P(f2(x + i * sw) + ' ' + f2(y) + ' ' + f2(sw) + ' 5.5 re f');
  }
  P('0.08 G 0.55 w');
  P(f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' 5.5 re S');
  textAt(x, y + 7.5, 6.2, '0', 0, false, 0.3);
  const lab = ft + ' FT';
  textAt(x + w - helveticaWidth(lab, 6.2, false), y + 7.5, 6.2, lab, 0, false, 0.3);
}

function paintTitleBlock(P, f2, textAt, model){
  const IX = v => v * 72, IY = v => v * 72;
  P('0.08 G 1.5 w');
  P(f2(IX(model.inner.x)) + ' ' + f2(IY(model.inner.y)) + ' ' + f2(IX(model.inner.w)) + ' ' + f2(IY(model.inner.h)) + ' re S');
  P('1.15 w');
  P(f2(IX(model.border.x)) + ' ' + f2(IY(model.border.y)) + ' ' + f2(IX(model.border.w)) + ' ' + f2(IY(model.border.h)) + ' re S');
  P('1 g');
  P(f2(IX(model.x)) + ' ' + f2(IY(model.y)) + ' ' + f2(IX(model.w)) + ' ' + f2(IY(model.h)) + ' re f');
  P('0.08 G 1.1 w');
  P(f2(IX(model.x)) + ' ' + f2(IY(model.y)) + ' ' + f2(IX(model.w)) + ' ' + f2(IY(model.h)) + ' re S');
  (model.cells || []).forEach(c => {
    P(f2(IX(c.x)) + ' ' + f2(IY(c.y)) + ' ' + f2(IX(c.w)) + ' ' + f2(IY(c.h)) + ' re S');
  });
  (model.labels || []).forEach(L => {
    const sz = L.size * 72;
    const str = fitPaperText(L.text, sz, L.maxW, L.bold);
    if (!str) return;
    let px = IX(L.x), py = IY(L.y);
    if (L.align === 'center') px -= helveticaWidth(str, sz, L.bold) / 2;
    if (L.align === 'right') px -= helveticaWidth(str, sz, L.bold);
    textAt(px, py, sz, str, 0, L.bold, L.gray);
  });
}

export function buildLayoutPDF(entities, opts){
  const pg = layoutPage(entities, opts);
  return { pdf: wrapPDFPages([pg], embedPayload()), ppf: pg.ppf, clipped: false };
}

/* Every sheet in the document, one page each, in one file. Sheet numbering and
 * the sheet count in each title block come from the position in this list. */
export function buildAllSheetsPDF(entities, opts){
  setEmbeddedFont((opts && opts.font) || null);
  const o = opts || {};
  const sheets = Array.isArray(o.sheets) ? o.sheets.filter(Boolean) : [];
  if (!sheets.length) return buildPDF(entities, o);
  const pages = sheets.map((layout, i) => layoutPage(entities, Object.assign({}, o, {
    layout,
    sheetIndex: i,
    sheetCount: sheets.length
  })));
  return { pdf: wrapPDFPages(pages, embedPayload()), pages: pages.length, ppf: pages[0].ppf, clipped: false };
}
