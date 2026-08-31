import { describe, it, expect } from 'vitest';
import { buildDXF, parseDXF, parseDrawing, openDXF } from '../src/io/dxf.js';
import { buildDWG, extractPackedDxf } from '../src/io/dwgwrite.js';
import { parseDwg } from '../src/io/dwg.js';
import { cabin24x36, partPlate, gaDiagram } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { createDocument, toDXF, toDWG, toPDF, open, samplePart, sampleGA, sampleCabin } from '../src/api.js';
import { makeLayout } from '../src/core/layout.js';
import { stretchEntities } from '../src/core/stretch.js';
import { bindAlignedDim, refreshAssocDims } from '../src/core/assoc.js';
import { wallFrags } from '../src/core/walls.js';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { plotLwMm } from '../src/io/plotstyle.js';

const layers = defaultLayers();

function architectDxf(){
  /* A mid-size architect-style DXF: model walls, a DIMENSION, paperspace
   * VIEWPORT + title text, LAYOUT object. What we must not drop. */
  return [
    0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, 'AC1015',
    9, '$INSUNITS', 70, 2,
    9, '$TILEMODE', 70, 0,
    0, 'ENDSEC',
    0, 'SECTION', 2, 'TABLES',
    0, 'TABLE', 2, 'LAYER', 70, 3,
    0, 'LAYER', 2, 'A-WALL', 70, 0, 62, 7, 6, 'CONTINUOUS',
    0, 'LAYER', 2, 'A-ANNO', 70, 0, 62, 7, 6, 'CONTINUOUS',
    0, 'LAYER', 2, 'A-DOOR', 70, 0, 62, 4, 6, 'CONTINUOUS',
    0, 'ENDTAB', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    0, 'LINE', 8, 'A-WALL', 10, 0, 20, 0, 11, 40, 21, 0,
    0, 'LINE', 8, 'A-WALL', 10, 40, 20, 0, 11, 40, 21, 28,
    0, 'LINE', 8, 'A-WALL', 10, 40, 20, 28, 11, 0, 21, 28,
    0, 'LINE', 8, 'A-WALL', 10, 0, 20, 28, 11, 0, 21, 0,
    0, 'LINE', 8, 'A-WALL', 10, 16, 20, 0, 11, 16, 21, 28,
    0, 'CIRCLE', 8, 'A-DOOR', 10, 8, 20, 14, 40, 1.5,
    0, 'DIMENSION', 8, 'A-ANNO', 10, 0, 20, -2, 13, 0, 23, 0, 14, 40, 24, 0, 70, 1, 1, '40\'-0"',
    0, 'VIEWPORT', 8, '0', 67, 1, 10, 18, 20, 13, 40, 34, 41, 20, 12, 20, 22, 14, 45, 30,
    0, 'TEXT', 8, 'A-ANNO', 67, 1, 10, 1, 20, 0.4, 40, 0.18, 1, 'A-101 FLOOR PLAN',
    0, 'LWPOLYLINE', 8, '0', 67, 1, 90, 4, 70, 1, 10, 0, 20, 0, 10, 36, 20, 0, 10, 36, 20, 24, 10, 0, 20, 24,
    0, 'ENDSEC',
    0, 'SECTION', 2, 'OBJECTS',
    0, 'LAYOUT', 1, 'Model', 70, 1, 15, 36, 25, 24,
    0, 'LAYOUT', 1, 'A-101 Floor Plan', 70, 0, 15, 36, 25, 24, 11, 36, 21, 24,
    0, 'ENDSEC',
    0, 'EOF'
  ].join('\n');
}

describe('AutoCAD R2000 DXF', () => {
  it('writes the tables AutoCAD Open expects', () => {
    const dxf = buildDXF(cabin24x36(), layers, { ver: 'R2000' });
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('STYLE');
    expect(dxf).toContain('Standard');
    expect(dxf).toContain('APPID');
    expect(dxf).toContain('ACAD');
    expect(dxf).toContain('DIMSTYLE');
    expect(dxf).toContain('*MODEL_SPACE');
    expect(dxf).toContain('*PAPER_SPACE');
    expect(dxf).toContain('BLOCK_RECORD');
    expect(dxf).toContain('OBJECTS');
    expect(dxf).toContain('LAYOUT');
    expect(dxf).toContain('DIMENSION');
    expect(dxf).toContain('$DIMASSOC');
  });
  it('round-trips a DIMENSION as a dim, not exploded lines', () => {
    const src = [{ type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }];
    const dxf = buildDXF(src, layers, { ver: 'R2000' });
    expect(dxf).toContain('DIMENSION');
    const out = parseDXF(dxf, n => n || 'DIMS');
    expect(out.some(e => e.type === 'dim')).toBe(true);
    const d = out.find(e => e.type === 'dim');
    expect(d.x2).toBeCloseTo(10);
  });
  it('keeps R12 exploding dims so old files stay byte-stable', () => {
    const dxf = buildDXF([{ type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }], layers);
    expect(dxf).toContain('TEXT');
    expect(dxf).not.toContain('DIMENSION');
  });
});

describe('paperspace is not dropped', () => {
  it('opens an architect DXF with model geometry and a layout', () => {
    const d = parseDrawing(architectDxf(), n => String(n || 'WALLS').toUpperCase().slice(0, 24));
    expect(d.entities.filter(e => e.type === 'line').length).toBeGreaterThanOrEqual(4);
    expect(d.entities.some(e => e.type === 'dim')).toBe(true);
    expect(d.entities.some(e => e.type === 'circle')).toBe(true);
    expect(d.layouts.length).toBeGreaterThanOrEqual(1);
    expect(d.layouts[0].name).toMatch(/A-101|Floor|Paperspace/i);
    expect(d.paper.length).toBeGreaterThanOrEqual(1);
    expect(d.paper.some(e => e.type === 'text' && /A-101/.test(e.content))).toBe(true);
  });
  it('writes VIEWPORT + LAYOUT into the DXF we send to AutoCAD', () => {
    const layout = makeLayout({ id: 'A1', name: 'A-101 Floor Plan', sheet: 'archd', ppf: 18 });
    const dxf = buildDXF(
      [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 }],
      layers,
      { ver: 'R2000', layouts: [layout] }
    );
    expect(dxf).toContain('VIEWPORT');
    expect(dxf).toContain('A-101 Floor Plan');
    const again = parseDrawing(dxf, n => n);
    expect(again.layouts.length).toBeGreaterThanOrEqual(1);
  });
  it('open() attaches layouts from paperspace', () => {
    const doc = open(architectDxf(), 'unit.dxf');
    expect(doc.entities.length).toBeGreaterThan(4);
    expect(doc.layouts.length).toBeGreaterThanOrEqual(1);
  });
  it('DWG pack round-trips paperspace through the embedded DXF', async () => {
    const layout = makeLayout({ id: 'A1', name: 'A-101 Floor Plan', sheet: 'archd', ppf: 18 });
    const bytes = buildDWG(
      [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 40, y2: 0 }],
      layers,
      { layouts: [layout], solid: false }
    );
    const dxf = extractPackedDxf(bytes);
    expect(dxf).toContain('VIEWPORT');
    const r = await parseDwg(bytes, { filename: 'unit.dwg', loader: async () => { throw new Error('no wasm'); } });
    expect(r.layouts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('associative dims follow a stretch', () => {
  it('moves with the wall end, not the stretch window on the dim', () => {
    const fr = wallFrags(0, 0, 10, 0, 0.5, 'WALLS');
    fr.forEach((f, i) => { f.g = 'w1'; f.id = i + 1; });
    const dim = { type: 'dim', id: 99, x1: 0, y1: 0, x2: 10, y2: 0, off: -2 };
    bindAlignedDim(dim, fr);
    expect(dim.assoc[0].kind).toBe('wall');
    stretchEntities(fr, [8, -1, 12, 1], 6, 0);
    refreshAssocDims(fr.concat([dim]));
    expect(dim.x2).toBeCloseTo(16, 1);
    expect(dim.x1).toBeCloseTo(0, 1);
  });
});

describe('issued plot', () => {
  it('Arch D cabin PDF is 36×24 inches with ISO lineweights', () => {
    const doc = sampleCabin();
    const pdf = toPDF(doc);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 2592 1728]');
    expect(plotLwMm({ layer: 'WALLS', kind: 'wall' })).toBe(0.50);
    expect(plotLwMm({ layer: 'DIMS' })).toBe(0.18);
  });
  it('plots every sheet in the set', () => {
    const doc = sampleCabin();
    const { pdf, pages } = buildAllSheetsPDF(doc.entities, {
      sheets: doc.layouts,
      projectName: doc.name,
      firm: doc.firm
    });
    expect(pages).toBe(doc.layouts.length);
    expect(pdf).toContain('/Count ' + doc.layouts.length);
  });
});

describe('examples ship', () => {
  it('cabin, plate and GA all export DXF + PDF + DWG', () => {
    [sampleCabin(), samplePart(), sampleGA()].forEach(doc => {
      expect(doc.entities.length).toBeGreaterThan(3);
      const dxf = toDXF(doc, { ver: 'R2000' });
      expect(dxf).toContain('AC1015');
      expect(dxf).toContain('EOF');
      const pdf = toPDF(doc);
      expect(pdf.startsWith('%PDF-1.4')).toBe(true);
      const dwg = toDWG(doc, { solid: false });
      expect(dwg[0]).toBe(65);
      expect(dwg[1]).toBe(67);
    });
    expect(partPlate().some(e => e.type === 'fcf' || e.type === 'datum')).toBe(true);
    expect(gaDiagram().some(e => e.type === 'table' || e.type === 'profile')).toBe(true);
  });
});
