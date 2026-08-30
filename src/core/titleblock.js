/* Issued-sheet title block. Paper inches, origin at the lower left.
 *
 * A construction document is a stamped sheet, not a screenshot of the model
 * with a caption. This module is the stamp: firm + copyright, project,
 * drawing title, scale, and sheet number, laid out as cells a drafter would
 * recognize. PDF and the paper-space preview both paint the same model.
 */
import { sheetOf, SHEET_MARGIN, TITLE_BLOCK_H } from './layout.js';
import { helveticaWidth } from './textmetrics.js';

export const FIRM_KEY = 'sovereign-draft.firm';

export function defaultFirm(){
  return { company: '', copyright: '', drawnBy: '' };
}

export function loadFirm(){
  try {
    const raw = localStorage.getItem(FIRM_KEY);
    if (!raw) return defaultFirm();
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return defaultFirm();
    return {
      company: String(o.company || '').slice(0, 80),
      copyright: String(o.copyright || '').slice(0, 160),
      drawnBy: String(o.drawnBy || '').slice(0, 40)
    };
  } catch (e){
    return defaultFirm();
  }
}

export function saveFirm(firm){
  try { localStorage.setItem(FIRM_KEY, JSON.stringify(firm || defaultFirm())); }
  catch (e){ /* ignore */ }
}

export function resolveStamp(firm, opts){
  const o = opts || {};
  const year = o.year != null ? Number(o.year) : new Date().getFullYear();
  const companyRaw = String((firm && firm.company) || '').trim();
  const company = (companyRaw || 'SOVEREIGN DRAFT').toUpperCase();
  let copyright = String((firm && firm.copyright) || '').trim();
  if (!copyright){
    copyright = '© ' + year + ' ' + (companyRaw || 'Sovereign Draft') + '. All rights reserved.';
  }
  return {
    company,
    copyright,
    drawnBy: String((firm && firm.drawnBy) || '').trim(),
    year
  };
}

/* Strip a leading sheet number from a layout name so the title cell reads
 * "FULL STACK ELEVATION" rather than "A-1 FULL STACK ELEVATION". */
export function drawingTitleOf(layout){
  if (!layout) return 'PLAN';
  const n = String(layout.sheetNumber || '').trim();
  let t = String(layout.name || '').trim();
  if (n && t.toUpperCase().indexOf(n.toUpperCase()) === 0)
    t = t.slice(n.length).replace(/^[\s.\-–:/]+/, '');
  return t || n || 'PLAN';
}

export function projectLabel(name){
  const n = String(name || '').trim();
  if (!n || /^untitled$/i.test(n)) return '';
  return n;
}

export function fitPaperText(str, sizePt, maxIn, bold){
  const s0 = String(str == null ? '' : str);
  const max = Math.max(0, maxIn) * 72;
  if (helveticaWidth(s0, sizePt, !!bold) <= max + 0.01) return s0;
  let s = s0;
  while (s.length > 1 && helveticaWidth(s + '...', sizePt, !!bold) > max) s = s.slice(0, -1);
  return s ? s + '...' : '';
}

function cell(id, x, y, w, h){
  return { id, x, y, w, h };
}

function label(cell, opts){
  const pad = 0.12;
  const align = opts.align || 'left';
  let x = cell.x + pad;
  if (align === 'center') x = cell.x + cell.w / 2;
  if (align === 'right') x = cell.x + cell.w - pad;
  const maxW = opts.maxW != null ? opts.maxW : Math.max(0.4, cell.w - pad * 2);
  return {
    x, y: opts.y, size: opts.size, text: String(opts.text == null ? '' : opts.text),
    bold: !!opts.bold, gray: opts.gray == null ? 0.08 : opts.gray,
    align, maxW
  };
}

/* The geometry and copy for one sheet's stamp. */
export function titleBlockModel(sheetKey, info){
  const s = sheetOf(sheetKey);
  const m = SHEET_MARGIN;
  const h = TITLE_BLOCK_H;
  const x = m, y = m, w = s.w - m * 2;
  const stamp = resolveStamp(info && info.firm, info);
  const project = projectLabel(info && info.projectName);
  const title = String((info && info.drawingTitle) || 'PLAN');
  const scale = String((info && info.scale) || '');
  const dateStr = String((info && info.dateStr) || '');
  const number = String((info && info.sheetNumber) || 'A-1');
  const total = (info && info.sheetCount) || 1;
  const ofLabel = total > 1 ? 'OF ' + total : '';
  const units = 'UNITS: FEET';

  let cells;
  if (w >= 26){
    const sheetW = 3.35, scaleW = 3.55, firmW = 7.5, projW = 6.3;
    const titleW = w - sheetW - scaleW - firmW - projW;
    let cx = x;
    cells = [
      cell('firm', cx, y, firmW, h),
      cell('project', (cx += firmW), y, projW, h),
      cell('title', (cx += projW), y, titleW, h),
      cell('scale', (cx += titleW), y, scaleW, h),
      cell('sheet', (cx += scaleW), y, sheetW, h)
    ];
  } else if (w >= 14){
    const sheetW = 2.7, scaleW = 3.1, firmW = 4.4;
    const titleW = w - sheetW - scaleW - firmW;
    let cx = x;
    cells = [
      cell('firm', cx, y, firmW, h),
      cell('title', (cx += firmW), y, titleW, h),
      cell('scale', (cx += titleW), y, scaleW, h),
      cell('sheet', (cx += scaleW), y, sheetW, h)
    ];
  } else {
    const sheetW = 2.15, firmW = 3.2;
    const titleW = w - sheetW - firmW;
    let cx = x;
    cells = [
      cell('firm', cx, y, firmW, h),
      cell('title', (cx += firmW), y, titleW, h),
      cell('sheet', (cx += titleW), y, sheetW, h)
    ];
  }

  const byId = {};
  cells.forEach(c => { byId[c.id] = c; });
  const labels = [];
  const top = y + h;

  const firm = byId.firm;
  labels.push(label(firm, { y: top - 0.22, size: 0.08, text: 'ISSUED BY', gray: 0.4 }));
  labels.push(label(firm, { y: top - 0.52, size: 0.18, text: stamp.company, bold: true }));
  labels.push(label(firm, { y: y + 0.42, size: 0.095, text: stamp.copyright, gray: 0.2 }));
  if (stamp.drawnBy){
    labels.push(label(firm, { y: y + 0.18, size: 0.09, text: 'DRAWN: ' + stamp.drawnBy, gray: 0.25 }));
  } else {
    labels.push(label(firm, { y: y + 0.18, size: 0.085, text: 'DO NOT SCALE THIS DRAWING', gray: 0.4 }));
  }

  if (byId.project){
    const p = byId.project;
    labels.push(label(p, { y: top - 0.22, size: 0.08, text: 'PROJECT', gray: 0.4 }));
    labels.push(label(p, { y: top - 0.52, size: 0.15, text: (project || title).toUpperCase(), bold: true }));
    labels.push(label(p, { y: y + 0.38, size: 0.09, text: dateStr ? 'DATE  ' + dateStr : '', gray: 0.25 }));
    labels.push(label(p, { y: y + 0.16, size: 0.085, text: units, gray: 0.4 }));
  }

  const tcell = byId.title;
  labels.push(label(tcell, { y: top - 0.22, size: 0.08, text: 'DRAWING TITLE', gray: 0.4 }));
  labels.push(label(tcell, { y: top - 0.58, size: 0.20, text: title.toUpperCase(), bold: true }));
  if (!byId.project){
    labels.push(label(tcell, { y: y + 0.38, size: 0.09, text: (project ? project + '   ' : '') + (dateStr || ''), gray: 0.25 }));
    labels.push(label(tcell, { y: y + 0.16, size: 0.085, text: (scale ? 'SCALE  ' + scale + '    ' : '') + units, gray: 0.35 }));
  } else {
    labels.push(label(tcell, { y: y + 0.22, size: 0.09, text: 'CONSTRUCTION DOCUMENT  ·  DO NOT SCALE', gray: 0.4 }));
  }

  if (byId.scale){
    const sc = byId.scale;
    labels.push(label(sc, { y: top - 0.22, size: 0.08, text: 'SCALE', gray: 0.4 }));
    labels.push(label(sc, { y: top - 0.55, size: 0.14, text: scale || 'AS NOTED', bold: true }));
    labels.push(label(sc, { y: y + 0.38, size: 0.09, text: dateStr, gray: 0.25 }));
    labels.push(label(sc, { y: y + 0.16, size: 0.085, text: units, gray: 0.4 }));
  }

  const shCell = byId.sheet;
  labels.push(label(shCell, { y: top - 0.22, size: 0.08, text: 'SHEET', gray: 0.4, align: 'center' }));
  labels.push(label(shCell, { y: top - 0.72, size: 0.34, text: number, bold: true, align: 'center' }));
  labels.push(label(shCell, { y: y + 0.22, size: 0.12, text: ofLabel || 'OF 1', bold: true, align: 'center' }));

  return {
    x, y, w, h,
    sheetW: s.w, sheetH: s.h,
    border: { x: m, y: m, w: s.w - 2 * m, h: s.h - 2 * m },
    inner: { x: 0.38, y: 0.38, w: s.w - 0.76, h: s.h - 0.76 },
    cells, labels, stamp, ofLabel
  };
}

export function viewportClearOfTitle(vp){
  if (!vp) return vp;
  const minY = SHEET_MARGIN + TITLE_BLOCK_H;
  if (vp.py >= minY - 1e-6) return vp;
  const top = vp.py + vp.ph;
  if (top <= minY) return Object.assign({}, vp, { py: minY, ph: 0.05 });
  return Object.assign({}, vp, { py: minY, ph: top - minY });
}
