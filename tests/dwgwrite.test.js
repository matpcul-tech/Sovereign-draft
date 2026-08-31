import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { buildDWG, packDxfAsDwg, extractPackedDxf } from '../src/io/dwgwrite.js';
import { dwgVersion, extractEmbeddedDxf, parseDwg } from '../src/io/dwg.js';
import { parseDXF } from '../src/io/dxf.js';
import { toDWG, toDXF, createDocument } from '../src/api.js';

describe('packDxfAsDwg', () => {
  it('tags AC1015 and round-trips the DXF', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'WALLS', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'ENDSEC', '0', 'EOF'
    ].join('\r\n');
    const buf = packDxfAsDwg(dxf);
    expect(dwgVersion(buf)).toBe('AC1015');
    expect(extractPackedDxf(buf)).toContain('LINE');
    expect(extractEmbeddedDxf(buf)).toBeTruthy();
  });
});

describe('buildDWG cabin', () => {
  it('writes a file this app reopens', async () => {
    const ents = cabin24x36();
    const bytes = buildDWG(ents, defaultLayers(), { height: 8, assumed: true });
    expect(dwgVersion(bytes)).toBe('AC1015');
    expect(bytes.byteLength).toBeGreaterThan(400);
    const embedded = extractEmbeddedDxf(bytes);
    expect(embedded).toBeTruthy();
    expect(embedded).toContain('3DFACE');
    const parsed = parseDXF(embedded, n => n);
    expect(parsed.some(e => e.type === 'line')).toBe(true);
    const r = await parseDwg(bytes, { filename: 'cabin.dwg', loader: async () => { throw new Error('no wasm'); } });
    expect(r.source).toBe('dxf');
    expect(r.entities.length).toBeGreaterThan(10);
  });
});

describe('toDWG / toDXF solid', () => {
  it('api writes DWG and optional 3D DXF', () => {
    const doc = createDocument({ entities: cabin24x36(), layers: defaultLayers() });
    const dwg = toDWG(doc);
    expect(dwgVersion(dwg)).toBe('AC1015');
    const dxf = toDXF(doc, { solid: true, ver: 'R2000' });
    expect(dxf).toContain('3DFACE');
    expect(dxf).toContain('EOF');
  });
});
