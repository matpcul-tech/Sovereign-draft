import { describe, it, expect } from 'vitest';
import { makeLayout, fitViewport, paperToModel, modelToPaper, sheetOf } from '../src/core/layout.js';
import { cabin24x36 } from '../src/core/demo.js';
import { membersBBox } from '../src/core/entities.js';
import { buildPDF } from '../src/io/pdf.js';
import { buildDXF, parseDXF } from '../src/io/dxf.js';
import { defaultLayers } from '../src/core/state.js';

describe('layouts', () => {
  it('Arch D is 36×24', () => {
    expect(sheetOf('archd').w).toBe(36);
    expect(sheetOf('archd').h).toBe(24);
  });
  it('round-trips model ↔ paper through a viewport', () => {
    const L = makeLayout({ sheet: 'archd', ppf: 18 });
    const vp = L.viewports[0];
    vp.mx = 12; vp.my = 8;
    const p = modelToPaper(vp, 12, 8);
    const m = paperToModel(vp, p[0], p[1]);
    expect(m[0]).toBeCloseTo(12); expect(m[1]).toBeCloseTo(8);
  });
  it('fitViewport picks a standard architectural scale', () => {
    const L = makeLayout({ sheet: 'archd', ppf: 18 });
    fitViewport(L.viewports[0], [0, 0, 36, 24]);
    expect(L.viewports[0].ppf).toBeGreaterThan(0);
  });
});

describe('sample cabin', () => {
  it('drafts walls, hatches, dims and a centerline', () => {
    const ents = cabin24x36();
    expect(ents.filter(e => e.kind === 'wall').length).toBeGreaterThan(8);
    expect(ents.some(e => e.type === 'hatch')).toBe(true);
    expect(ents.some(e => e.type === 'dim')).toBe(true);
    expect(ents.some(e => e.lt === 'CENTER')).toBe(true);
    expect(ents.some(e => e.type === 'insert' && e.def === 'door')).toBe(true);
    const bb = membersBBox(ents);
    expect(bb[2] - bb[0]).toBeGreaterThan(30);
    expect(bb[3] - bb[1]).toBeGreaterThan(20);
  });
  it('exports a layout PDF at 1/4" = 1\'-0"', () => {
    const ents = cabin24x36();
    const L = makeLayout({ sheet: 'archd', ppf: 18, name: 'A-1 Floor Plan' });
    fitViewport(L.viewports[0], membersBBox(ents));
    const { pdf, ppf } = buildPDF(ents, { layout: L, projectName: '24x36 Cabin' });
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(ppf).toBe(18);
    expect(pdf).toContain('24X36 CABIN');
  });
  it('DXF round-trips cabin lines and keeps layers', () => {
    const ents = cabin24x36().filter(e => e.type === 'line' || e.type === 'circle' || e.type === 'arc' || e.type === 'poly' || e.type === 'text');
    const dxf = buildDXF(ents, defaultLayers(), { ver: 'R12' });
    expect(dxf).toContain('LTYPE');
    expect(dxf).toContain('CENTER');
    const out = parseDXF(dxf, n => String(n).toUpperCase());
    expect(out.length).toBeGreaterThan(10);
    expect(out.some(e => e.layer === 'WALLS')).toBe(true);
  });
});
