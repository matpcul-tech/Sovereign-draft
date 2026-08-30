import { describe, it, expect } from 'vitest';
import { buildDXF, parseDXF, sniffDrawing, openDXF, dxfUnitLabel } from '../src/io/dxf.js';
import { lookupCommand } from '../src/core/command.js';

const layers = [
  { name: 'WALLS', color: '#d4a843', aci: 2, visible: true },
  { name: 'DIMS', color: '#8fa3c0', aci: 8, visible: true }
];
const identityLayer = n => n || 'WALLS';

function dxfPairs(...vals){
  return vals.join('\n');
}

describe('buildDXF', () => {
  it('emits an R12 header, layer table and EOF', () => {
    const dxf = buildDXF([], layers);
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('WALLS');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
  it('stamps $INSUNITS feet', () => {
    const dxf = buildDXF([], layers);
    expect(dxf).toMatch(/\$INSUNITS[\s\S]*?70[\s\S]*?2/);
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

describe('units', () => {
  it('scales millimetre $INSUNITS so 304.8 becomes 1 ft', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'HEADER',
      9, '$INSUNITS', 70, 4,
      0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 304.8, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out.length).toBe(1);
    expect(out[0].x2).toBeCloseTo(1, 5);
    expect(out[0].y2).toBeCloseTo(0);
    const opened = openDXF(dxf, identityLayer);
    expect(opened.units).toBe('mm');
    expect(opened.insunits).toBe(4);
    expect(dxfUnitLabel(4)).toBe('mm');
  });
  it('scales inches $INSUNITS so 12 becomes 1 ft', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'HEADER',
      9, '$INSUNITS', 70, 1,
      0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 12, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out[0].x2).toBeCloseTo(1, 5);
  });
  it('does not autoscale a 36 ft cabin when $INSUNITS is missing', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, 'WALLS', 10, 0, 20, 0, 11, 36, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out[0].x2).toBeCloseTo(36);
  });
  it('autoscales headerless millimetre coords (max > 2000)', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 3048, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out[0].x2).toBeCloseTo(10, 4);
  });
  it('leaves a 500 ft site plan in feet when $INSUNITS is missing', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 500, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    expect(parseDXF(dxf, identityLayer)[0].x2).toBeCloseTo(500);
  });
});

describe('extra entity types', () => {
  it('reads ELLIPSE as an ellipse', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'ELLIPSE', 8, 'WALLS', 10, 5, 20, 5, 11, 4, 21, 0, 40, 0.5,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('ellipse');
    expect(out[0].cx).toBeCloseTo(5);
    expect(out[0].cy).toBeCloseTo(5);
    expect(out[0].rx).toBeCloseTo(4);
    expect(out[0].ry).toBeCloseTo(2);
    expect(out[0].rot).toBeCloseTo(0);
  });
  it('reads DIMENSION as an aligned dim', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'DIMENSION', 8, 'DIMS', 13, 0, 23, 0, 14, 10, 24, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('dim');
    expect(out[0].x1).toBeCloseTo(0);
    expect(out[0].x2).toBeCloseTo(10);
  });
  it('reads XLINE as a construction line', () => {
    const dxf = dxfPairs(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'XLINE', 8, 'DEFPOINTS', 10, 2, 20, 3, 11, 1, 21, 0,
      0, 'ENDSEC', 0, 'EOF'
    );
    const out = parseDXF(dxf, identityLayer);
    expect(out[0].type).toBe('xline');
    expect(out[0].x1).toBeCloseTo(2);
    expect(out[0].x2).toBeCloseTo(3);
  });
});

describe('sniffDrawing', () => {
  it('detects dxf, json, dwg and unknown', () => {
    expect(sniffDrawing('', 'plan.dxf')).toBe('dxf');
    expect(sniffDrawing('0\nSECTION\n2\nENTITIES\n0\nENDSEC', 'x.txt')).toBe('dxf');
    expect(sniffDrawing('{ "app": "sovereign-draft" }', 'cabin.json')).toBe('json');
    expect(sniffDrawing('{ "app": "sovereign-draft" }', '')).toBe('json');
    expect(sniffDrawing('AC1015....', 'house.dwg')).toBe('dwg');
    expect(sniffDrawing('AC1027binary', 'noext')).toBe('dwg');
    expect(sniffDrawing('hello', 'notes.txt')).toBe('unknown');
  });
});

describe('OPEN / DXFIN commands', () => {
  it('registers OPEN as replace and DXFIN as merge', () => {
    expect(lookupCommand('OPEN').action).toBe('open');
    expect(lookupCommand('OP').action).toBe('open');
    expect(lookupCommand('DXFIN').action).toBe('dxfin');
  });
});
