import { describe, it, expect } from 'vitest';
import { buildDXF, parseDXF } from '../src/io/dxf.js';

const layers = [
  { name: 'WALLS', color: '#d4a843', aci: 2, visible: true },
  { name: 'DIMS', color: '#8fa3c0', aci: 8, visible: true }
];
const identityLayer = n => n || 'WALLS';

describe('buildDXF', () => {
  it('emits an R12 header, layer table and EOF', () => {
    const dxf = buildDXF([], layers);
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('WALLS');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
  it('explodes dimensions into lines and text', () => {
    const dxf = buildDXF([{ type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: 2 }], layers);
    expect(dxf).toContain('TEXT');
    expect(dxf.match(/\bLINE\b/g).length).toBeGreaterThanOrEqual(5);
  });
});

describe('round trip', () => {
  it('preserves lines, circles, arcs, polylines and text', () => {
    const src = [
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 5 },
      { type: 'circle', layer: 'WALLS', cx: 3, cy: 4, r: 2.5 },
      { type: 'arc', layer: 'WALLS', cx: 0, cy: 0, r: 3, a1: 0, a2: 90 },
      { type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [4, 0], [4, 4]] },
      { type: 'poly', layer: 'WALLS', closed: false, pts: [[1, 1], [2, 3], [5, 3]] },
      { type: 'text', layer: 'WALLS', x: 1, y: 2, size: 1.2, content: 'KITCHEN' }
    ];
    const out = parseDXF(buildDXF(src, layers), identityLayer);
    expect(out.length).toBe(6);
    const line = out.find(e => e.type === 'line');
    expect(line.x2).toBeCloseTo(10); expect(line.y2).toBeCloseTo(5);
    const circle = out.find(e => e.type === 'circle');
    expect(circle.r).toBeCloseTo(2.5);
    const arc = out.find(e => e.type === 'arc');
    expect(arc.a2).toBeCloseTo(90);
    const closed = out.find(e => e.type === 'poly' && e.closed);
    expect(closed.pts.length).toBe(3);
    const open = out.find(e => e.type === 'poly' && !e.closed);
    expect(open.pts[2]).toEqual([5, 3]);
    const text = out.find(e => e.type === 'text');
    expect(text.content).toBe('KITCHEN');
    expect(text.size).toBeCloseTo(1.2);
  });
});

describe('parseDXF external files', () => {
  it('reads LWPOLYLINE entities', () => {
    const dxf = [
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LWPOLYLINE', 8, 'WALLS', 70, 1, 10, 0, 20, 0, 10, 5, 20, 0, 10, 5, 20, 5,
      0, 'ENDSEC', 0, 'EOF'
    ].join('\n');
    const out = parseDXF(dxf, identityLayer);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('poly');
    expect(out[0].closed).toBe(true);
    expect(out[0].pts).toEqual([[0, 0], [5, 0], [5, 5]]);
  });
  it('survives garbage input without throwing', () => {
    expect(parseDXF('not a dxf at all', identityLayer)).toEqual([]);
    expect(parseDXF('', identityLayer)).toEqual([]);
  });
  it('canonicalizes layers through ensureLayer', () => {
    const seen = [];
    const dxf = [0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 8, 'walls', 10, 0, 20, 0, 11, 1, 21, 1, 0, 'ENDSEC', 0, 'EOF'].join('\n');
    parseDXF(dxf, n => { seen.push(n); return String(n).toUpperCase(); });
    expect(seen).toEqual(['walls']);
  });
});
