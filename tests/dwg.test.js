import { describe, it, expect } from 'vitest';
import { dwgVersion, isDwgBuffer, extractEmbeddedDxf, mapDwgEntity, mapDwgDatabase, parseDwg } from '../src/io/dwg.js';

function bytesFrom(str){
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i);
  return u8;
}

describe('DWG sniff', () => {
  it('reads the AC10xx version string', () => {
    const buf = bytesFrom('AC1015' + '\0'.repeat(20));
    expect(dwgVersion(buf)).toBe('AC1015');
    expect(isDwgBuffer(buf)).toBe(true);
    expect(isDwgBuffer(new Uint8Array([0, 1, 2]), 'plan.dwg')).toBe(true);
    expect(isDwgBuffer(bytesFrom('  0\nSECTION\n'), 'plan.dxf')).toBe(false);
  });
});

describe('embedded DXF inside a misnamed file', () => {
  it('opens a DXF that was named like a drawing', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'WALLS', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'ENDSEC', '0', 'EOF'
    ].join('\n');
    expect(extractEmbeddedDxf(bytesFrom(dxf))).toBeTruthy();
  });
});

describe('mapDwgEntity', () => {
  it('maps LINE / CIRCLE / TEXT / LWPOLYLINE', () => {
    expect(mapDwgEntity({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 4, y: 1 }, layer: 'WALLS' }))
      .toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 4, y2: 1 });
    expect(mapDwgEntity({ type: 'CIRCLE', center: { x: 2, y: 2 }, radius: 3, layer: 'WALLS' }))
      .toMatchObject({ type: 'circle', cx: 2, cy: 2, r: 3 });
    expect(mapDwgEntity({ type: 'TEXT', position: { x: 1, y: 2 }, height: 0.8, text: 'KITCHEN', layer: 'TEXT' }))
      .toMatchObject({ type: 'text', content: 'KITCHEN' });
    const pl = mapDwgEntity({ type: 'LWPOLYLINE', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: true, layer: 'WALLS' });
    expect(pl.type).toBe('poly');
    expect(pl.pts.length).toBe(3);
    expect(pl.closed).toBe(true);
  });
});

describe('parseDwg with an injected parser', () => {
  it('maps the database the wasm would have returned', async () => {
    const fake = {
      parse: async () => ({
        entities: [
          { type: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: 'WALLS' },
          { type: 'CIRCLE', center: { x: 5, y: 5 }, radius: 2, layer: 'WALLS' }
        ]
      })
    };
    const buf = bytesFrom('AC1015' + '\0'.repeat(32));
    const r = await parseDwg(buf, { loader: async () => fake });
    expect(r.source).toBe('libredwg');
    expect(r.entities.length).toBe(2);
    expect(r.entities[0].type).toBe('line');
    expect(r.entities[1].type).toBe('circle');
  });
});
