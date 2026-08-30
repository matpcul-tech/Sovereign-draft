/* Document model: project, sheets, views.
 *
 * Read this before changing anything here. The premise that geometry needed
 * converting back to true size does not hold in this codebase and acting on it
 * would corrupt every saved drawing:
 *
 *   - entities are already stored at true size in decimal feet, Y up
 *   - serializeProject writes them verbatim, with no plot scaling either way
 *   - plot scale (ppf) is applied only at plot time, in three places:
 *       src/io/pdf.js        buildPDF, the export transform
 *       src/render/draw.js   the paper space preview, model -> view -> screen
 *       src/core/layout.js   modelToPaper / paperToModel / fitViewport
 *
 * So the model-to-view and view-to-sheet transforms already exist and already
 * compose. What was missing is document structure: stable sheet identity, a
 * per view drawing type, somewhere to hang sheet annotations, and marks and
 * attributes on entities for schedules. This module adds exactly that, and the
 * migration is structural only. It never touches a coordinate.
 */

export const DOC_VERSION = 7;

/* A view is a viewport plus identity. The geometric fields (px, py, pw, ph,
 * mx, my, ppf) keep their existing names and meaning so every transform that
 * already reads them keeps working untouched. */
export function normalizeView(vp, index, sheetDefaults){
  const v = vp || {};
  const d = sheetDefaults || {};
  return Object.assign({}, v, {
    id: v.id == null ? (index + 1) : v.id,
    name: v.name || defaultViewName(v, d),
    drawingType: v.drawingType || d.drawingType || 'plan'
  });
}

function defaultViewName(v, d){
  const t = (v.drawingType || d.drawingType || 'plan').toUpperCase();
  return t === 'PLAN' ? 'PLAN' : t;
}

/* Sheet numbers run A-1, A-2, ... unless the file already carries one. */
export function defaultSheetNumber(index){ return 'A-' + (index + 1); }

/* A sheet is a layout plus identity and an annotation list. Existing layout
 * fields (id, name, sheet, ppf, titleBlock, viewports) are preserved as is. */
export function normalizeSheet(layout, index){
  const l = layout || {};
  const views = Array.isArray(l.viewports) ? l.viewports : [];
  return Object.assign({}, l, {
    sheetNumber: l.sheetNumber || defaultSheetNumber(index),
    annotations: Array.isArray(l.annotations) ? l.annotations : [],
    viewports: views.map((v, i) => normalizeView(v, i, l))
  });
}

export function normalizeSheets(layouts){
  const list = Array.isArray(layouts) ? layouts : [];
  return list.map((l, i) => normalizeSheet(l, i));
}

/* Title block sheet label. With a single sheet this is exactly what the
 * pre-refactor build emitted, which is what keeps the PDF identical. */
export function sheetLabel(sheetNumber, index, total){
  const num = sheetNumber || defaultSheetNumber(index || 0);
  if (!total || total <= 1) return 'SHEET ' + num;
  return 'SHEET ' + num + ' OF ' + total;
}

/* ---------- sheet and view creation ---------- */

/* Next free sheet number in the A-N series. */
export function nextSheetNumber(sheets){
  const used = new Set((sheets || []).map(s => s && s.sheetNumber));
  for (let i = 0; i < 500; i++){
    const n = defaultSheetNumber(i);
    if (!used.has(n)) return n;
  }
  return defaultSheetNumber((sheets || []).length);
}

/* A new sheet, normalized, carrying one view unless views are supplied.
 * makeSheetLayout is injected so this module stays free of layout.js. */
export function addSheet(sheets, makeSheetLayout, opts){
  const list = Array.isArray(sheets) ? sheets.slice() : [];
  const o = opts || {};
  const number = o.sheetNumber || nextSheetNumber(list);
  const layout = makeSheetLayout(Object.assign({}, o, {
    id: o.id || ('S' + number.replace(/[^A-Za-z0-9]/g, '')),
    name: o.name || number
  }));
  layout.sheetNumber = number;
  list.push(normalizeSheet(layout, list.length));
  return list;
}

export function removeSheet(sheets, id){
  const list = (sheets || []).filter(s => s && s.id !== id);
  /* Never leave a document with no sheet. */
  return list.length ? list.map((s, i) => normalizeSheet(s, i)) : (sheets || []).slice();
}

/* Add a view to a sheet. The viewport geometry is supplied by the caller,
 * which is what already knows the sheet size and margins. */
export function addViewToSheet(sheet, viewport, opts){
  if (!sheet) return sheet;
  const o = opts || {};
  const views = Array.isArray(sheet.viewports) ? sheet.viewports.slice() : [];
  const v = Object.assign({}, viewport, {
    id: views.length + 1,
    name: o.name || null,
    drawingType: o.drawingType || 'plan'
  });
  views.push(normalizeView(v, views.length, sheet));
  return Object.assign({}, sheet, { viewports: views });
}

export function findSheet(sheets, id){
  return (sheets || []).find(s => s && s.id === id) || null;
}

/* ---------- entity marks and attributes ----------
 * Both are optional and are never written onto an entity that does not have
 * them. Phase D collects these into keynote legends and schedules; nothing
 * reads them yet. Absent stays absent so saved files do not grow. */

export function setMark(entity, mark){
  if (!entity) return entity;
  if (mark == null || mark === '') delete entity.mark;
  else entity.mark = String(mark);
  return entity;
}

export function setAttributes(entity, attrs){
  if (!entity) return entity;
  if (!attrs || !Object.keys(attrs).length) delete entity.attributes;
  else entity.attributes = Object.assign({}, entity.attributes, attrs);
  return entity;
}

export function marksOf(entities){
  const out = [];
  (entities || []).forEach(e => { if (e && e.mark) out.push(e); });
  return out;
}

/* ---------- space rules ----------
 * Anything sized for the eye is a paper value. Anything sized for the world is
 * a model value. These name the rule so tests can assert it rather than each
 * call site restating it in a comment. */

export const PAPER_SPACE_PROPERTIES = ['textHeight', 'hatchSpacing', 'lineWeight', 'arrowSize', 'labelBox', 'titleBlock'];
export const MODEL_SPACE_PROPERTIES = ['geometry', 'dimensionMeasurement'];

export function isPaperSpaceProperty(name){ return PAPER_SPACE_PROPERTIES.indexOf(name) >= 0; }
export function isModelSpaceProperty(name){ return MODEL_SPACE_PROPERTIES.indexOf(name) >= 0; }

/* ---------- migration ----------
 * Structural only. Coordinates are already true size and are passed through
 * untouched. Migrating forward happens on open; nothing is rewritten on disk
 * until the user saves. */
export function migrateDocument(o){
  const src = o || {};
  const from = Number(src.v) || 1;
  const layouts = normalizeSheets(src.layouts);
  return {
    migratedFrom: from,
    v: DOC_VERSION,
    layouts,
    /* Entities are returned by reference and unmodified. If this ever starts
     * mapping coordinates, that is the bug. */
    entities: Array.isArray(src.entities) ? src.entities : []
  };
}

/* True when a migration would alter any coordinate, which it never should. */
export function migrationTouchedGeometry(before, after){
  const a = JSON.stringify(before || []);
  const b = JSON.stringify(after || []);
  return a !== b;
}
