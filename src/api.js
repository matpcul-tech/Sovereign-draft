/* Public kernel: no DOM. Import this from Node, CI, or another app.
 *
 *   import { open, draw, sheetset, toPDF, toDXF } from 'sovereign-draft'
 *   const doc = open(dxfText, 'plan.dxf')
 *   writeFileSync('plan.pdf', toPDF(doc), 'latin1')
 */
import { defaultLayers } from './core/state.js';
import { defaultLayouts } from './core/layout.js';
import { defaultDimStyles } from './core/dimStyle.js';
import { normalizeSheets } from './core/document.js';
import { generateSheetSet } from './core/sheetset.js';
import { envelopeDims } from './core/spec.js';
import { buildDXF, parseDXF, sniffDrawing, openDXF } from './io/dxf.js';
import { buildPDF, buildAllSheetsPDF } from './io/pdf.js';
import { serializeProject, validateProject } from './io/project.js';
import { generateDraft, realizeDocument } from './ai/draft.js';
import { isDwgBuffer, parseDwg } from './io/dwg.js';
import { cabin24x36 } from './core/demo.js';

export function makeEnsureLayer(layers){
  const list = layers || [];
  return function ensureLayer(name){
    const n = String(name || 'WALLS').toUpperCase().slice(0, 24) || 'WALLS';
    if (!list.find(L => L.name === n)){
      list.push({ name: n, color: '#e8e4dd', aci: 7, visible: true });
    }
    return n;
  };
}

export function createDocument(opts){
  const o = opts || {};
  const layers = o.layers && o.layers.length ? o.layers : defaultLayers();
  const entities = o.entities || [];
  return {
    name: o.name || 'Untitled',
    firm: o.firm || { company: '', copyright: '', drawnBy: '' },
    layers,
    entities,
    layouts: normalizeSheets(o.layouts && o.layouts.length ? o.layouts : defaultLayouts()),
    userBlocks: o.userBlocks || [],
    dimStyles: o.dimStyles && o.dimStyles.length ? o.dimStyles : defaultDimStyles(),
    currentDimStyle: o.currentDimStyle || 'ARCH',
    currentLayout: o.currentLayout || (o.layouts && o.layouts[0] && o.layouts[0].id) || 'A1',
    space: o.space || 'model',
    dxfVer: o.dxfVer === 'R2000' ? 'R2000' : 'R12'
  };
}

function nameFromFile(filename){
  const n = String(filename || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return n ? n.slice(0, 80) : 'Untitled';
}

function fromValidated(p){
  return createDocument({
    name: p.name,
    firm: p.firm,
    layers: p.layers,
    entities: p.entities,
    layouts: p.layouts,
    userBlocks: p.userBlocks,
    dimStyles: p.dimStyles,
    currentDimStyle: p.currentDimStyle,
    currentLayout: p.currentLayout,
    space: p.space,
    dxfVer: p.dxfVer
  });
}

/* Sync open: JSON or DXF text. Binary DWG must go through openAsync. */
export function open(input, filename){
  if (input && typeof input !== 'string' && (input.byteLength != null || input.buffer)){
    if (isDwgBuffer(input, filename)){
      throw new Error('DWG is binary — use openAsync(arrayBuffer, filename)');
    }
    input = new TextDecoder('latin1').decode(input instanceof Uint8Array ? input : new Uint8Array(input));
  }
  const text = String(input || '');
  const kind = sniffDrawing(text, filename);
  if (kind === 'json' || (!filename && text.trim().charAt(0) === '{')){
    return fromValidated(validateProject(JSON.parse(text)));
  }
  if (kind === 'dwg'){
    throw new Error('DWG is binary — use openAsync(arrayBuffer, filename)');
  }
  const layers = defaultLayers();
  const { entities, count } = openDXF(text, makeEnsureLayer(layers));
  if (!count) throw new Error('No supported objects in that file');
  return createDocument({ name: nameFromFile(filename), entities, layers });
}

export async function openAsync(input, filename, opts){
  if (input && typeof input !== 'string' && (input.byteLength != null || input.buffer)){
    if (isDwgBuffer(input, filename)){
      const layers = defaultLayers();
      const r = await parseDwg(input, Object.assign({ ensureLayer: makeEnsureLayer(layers) }, opts || {}));
      if (!r.entities.length) throw new Error('No supported objects in that DWG');
      return createDocument({ name: nameFromFile(filename), entities: r.entities, layers });
    }
    const text = new TextDecoder('latin1').decode(input instanceof Uint8Array ? input : new Uint8Array(input));
    return open(text, filename);
  }
  return open(input, filename);
}

export function sheetset(doc, opts){
  const d = doc || {};
  const entities = (d.entities || []).slice();
  envelopeDims(entities).forEach(e => entities.push(e));
  const layouts = generateSheetSet(entities, d.layers || defaultLayers(), {
    projectName: (opts && opts.name) || d.name
  });
  return createDocument(Object.assign({}, d, { entities, layouts, currentLayout: layouts[0] && layouts[0].id }));
}

export async function draw(prompt, opts){
  const o = opts || {};
  if (!prompt) throw new Error('Nothing to draft');
  const layers = (o.layers && o.layers.slice()) || defaultLayers();
  const text = await generateDraft({
    prompt,
    contextText: o.contextText || null,
    apiKey: o.apiKey || (typeof process !== 'undefined' && process.env && process.env.ANTHROPIC_API_KEY),
    model: o.model
  });
  const realized = realizeDocument(text, makeEnsureLayer(layers), { prompt });
  let entities = realized.entities || [];
  let layouts = realized.sheets && realized.sheets.length ? realized.sheets : null;
  if (o.sheets !== false && !layouts){
    envelopeDims(entities).forEach(e => entities.push(e));
    layouts = generateSheetSet(entities, layers, { projectName: o.name || prompt });
  }
  return createDocument({
    name: o.name || String(prompt).trim().slice(0, 40),
    entities,
    layers,
    layouts: layouts || defaultLayouts(),
    firm: o.firm
  });
}

export function toPDF(doc, opts){
  const o = opts || {};
  const d = doc || {};
  const layouts = d.layouts || [];
  if (o.model || !layouts.length){
    return buildPDF(d.entities || [], {
      projectName: d.name,
      firm: d.firm,
      dateStr: o.dateStr
    });
  }
  const { pdf } = buildAllSheetsPDF(d.entities || [], {
    sheets: layouts,
    projectName: d.name,
    firm: d.firm,
    dateStr: o.dateStr
  });
  return pdf;
}

export function toDXF(doc, opts){
  const d = doc || {};
  return buildDXF(d.entities || [], d.layers || defaultLayers(), {
    ver: (opts && opts.ver) || d.dxfVer || 'R12',
    userBlocks: d.userBlocks
  });
}

export function toJSON(doc, pretty){
  const d = doc || createDocument();
  return serializeProject({
    projectName: d.name,
    firm: d.firm,
    idSeq: (d.entities || []).length + 1,
    gSeq: 1,
    layers: d.layers,
    entities: d.entities,
    userBlocks: d.userBlocks,
    dimStyles: d.dimStyles,
    currentDimStyle: d.currentDimStyle,
    layouts: d.layouts,
    currentLayout: d.currentLayout,
    space: d.space,
    dxfVer: d.dxfVer
  }, pretty !== false);
}

export function sampleCabin(){
  const layers = defaultLayers();
  return sheetset(createDocument({
    name: '24x36 Cabin',
    entities: cabin24x36(),
    layers
  }));
}

export { parseDXF, sniffDrawing, openDXF, buildDXF, buildPDF, buildAllSheetsPDF, generateSheetSet, cabin24x36 };
