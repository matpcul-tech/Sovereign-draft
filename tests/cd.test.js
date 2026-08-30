import { describe, it, expect } from 'vitest';
import { ellipsePoints, cloudPoints, tanPoints, angularGeom, imageCorners } from '../src/core/geometry.js';
import { angularDim, radiusDim, diameterDim, makeLeader, dimLabel, angularValue } from '../src/core/dimStyle.js';
import { tagInserts, buildSchedule, tableFrags, tableSize, scheduleCSV, makeTable } from '../src/core/schedule.js';
import { stretchEntities, inBox } from '../src/core/stretch.js';
import { areaOf, listEntity, idPoint } from '../src/core/inquiry.js';
import { findTJoins, cleanupTJunctions } from '../src/core/cleanup.js';
import { buildSVG } from '../src/io/svg.js';
import { explodeForIO, entHit, translateEnt, entPoints } from '../src/core/entities.js';
import { wallFrags } from '../src/core/walls.js';
import { cabin24x36 } from '../src/core/demo.js';
import { lookupCommand } from '../src/core/command.js';
import { defaultLayers } from '../src/core/state.js';
import { buildDXF } from '../src/io/dxf.js';

describe('ellipse / cloud / tan', () => {
  it('ellipsePoints is a closed loop around the center', () => {
    const pts = ellipsePoints({ cx: 0, cy: 0, rx: 4, ry: 2, rot: 0 }, 16);
    expect(pts.length).toBe(16);
    expect(pts[0][0]).toBeCloseTo(4);
    expect(pts[4][1]).toBeCloseTo(2);
  });
  it('cloudPoints scallops a triangle', () => {
    const pts = cloudPoints([[0, 0], [4, 0], [2, 3]], 0.4);
    expect(pts.length).toBeGreaterThan(12);
  });
  it('tanPoints from an external point', () => {
    const t = tanPoints({ type: 'circle', cx: 0, cy: 0, r: 5 }, [10, 0]);
    expect(t.length).toBe(2);
    expect(t[0][2]).toBe(6);
    t.forEach(p => expect(Math.hypot(p[0], p[1])).toBeCloseTo(5, 5));
  });
  it('imageCorners is a 4-point rectangle', () => {
    const c = imageCorners({ x: 1, y: 2, w: 4, h: 3, rot: 0 });
    expect(c[2]).toEqual([5, 5]);
  });
});

describe('angular / radius / diameter dims', () => {
  it('angularValue of a right angle is 90', () => {
    const e = angularDim([1, 0], [0, 0], [0, 1], 2);
    expect(angularValue(e)).toBeCloseTo(90);
    expect(dimLabel(e)).toBe('90°');
    expect(angularGeom(e).arc.length).toBeGreaterThan(4);
  });
  it('radius and diameter labels', () => {
    const r = radiusDim(0, 0, 3, 0);
    expect(dimLabel(r)).toMatch(/^R /);
    const d = diameterDim(0, 0, 3, 0);
    expect(d.kind).toBe('diameter');
    expect(dimLabel(d)).toMatch(/⌀/);
  });
  it('makeLeader keeps points and text', () => {
    const L = makeLeader([[0, 0], [2, 2]], 'NOTE 1');
    expect(L.type).toBe('leader');
    expect(L.content).toBe('NOTE 1');
  });
});

describe('schedules', () => {
  it('tags door and window inserts', () => {
    const ents = [
      { type: 'insert', def: 'door', width: 3, swing: 'L' },
      { type: 'insert', def: 'window', width: 4 }
    ];
    expect(tagInserts(ents)).toBe(2);
    expect(ents[0].mark).toBe('D01');
    expect(ents[1].mark).toBe('W01');
  });
  it('builds a door schedule table with fragments', () => {
    const ents = cabin24x36();
    const t = buildSchedule(ents, 'door', [0, 0]);
    expect(t.type).toBe('table');
    expect(t.title).toMatch(/DOOR/);
    expect(t.cells.length).toBeGreaterThan(1);
    const fr = tableFrags(t);
    expect(fr.some(f => f.type === 'text' && /DOOR/.test(f.content))).toBe(true);
    expect(tableSize(t)[0]).toBeGreaterThan(8);
    expect(scheduleCSV(ents, 'door')).toContain('MARK');
  });
  it('makeTable is ordinary geometry after explodeForIO', () => {
    const t = makeTable({ title: 'T', headers: ['A', 'B'], rows: [['1', '2']], x: 0, y: 0, colW: [2, 2] });
    const fr = explodeForIO(t);
    expect(fr.every(f => f.type === 'line' || f.type === 'text')).toBe(true);
  });
});

describe('stretch', () => {
  it('moves only vertices inside the box', () => {
    const line = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const n = stretchEntities([line], [8, -1, 12, 1], 0, 2);
    expect(n).toBe(1);
    expect(line.x1).toBe(0); expect(line.y1).toBe(0);
    expect(line.x2).toBe(10); expect(line.y2).toBe(2);
  });
  it('inBox is inclusive', () => {
    expect(inBox(1, 1, [0, 0, 2, 2])).toBe(true);
    expect(inBox(3, 1, [0, 0, 2, 2])).toBe(false);
  });
});

describe('inquiry', () => {
  it('areaOf a circle and ellipse', () => {
    expect(areaOf({ type: 'circle', r: 2 })).toBeCloseTo(Math.PI * 4);
    expect(areaOf({ type: 'ellipse', rx: 2, ry: 1 })).toBeCloseTo(Math.PI * 2);
  });
  it('listEntity mentions type and layer', () => {
    const s = listEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(s).toMatch(/LINE/);
    expect(s).toMatch(/WALLS/);
  });
  it('idPoint formats feet-inches', () => {
    expect(idPoint([10, 0.5])).toMatch(/10'-0"/);
  });
});

describe('T-junction cleanup', () => {
  it('finds a stem landing on a run', () => {
    const run = wallFrags(0, 0, 20, 0, 0.5, 'WALLS');
    const stem = wallFrags(10, 0, 10, 8, 0.5, 'WALLS');
    run.forEach(e => { e.g = 'run'; });
    stem.forEach(e => { e.g = 'stem'; });
    const joins = findTJoins([...run, ...stem]);
    expect(joins.length).toBeGreaterThanOrEqual(1);
    const res = cleanupTJunctions([...run, ...stem]);
    expect(res.ok).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });
});

describe('SVG + DXF of new types', () => {
  it('buildSVG emits a viewBox and escapes text', () => {
    const svg = buildSVG([{ type: 'text', layer: 'TEXT', x: 0, y: 0, size: 1, content: 'A&B<C>' }], defaultLayers());
    expect(svg).toContain('<svg');
    expect(svg).toContain('&' + 'amp;');
    expect(svg).toContain('&' + 'lt;');
  });
  it('ellipse explodes into a polyline in DXF', () => {
    const dxf = buildDXF([{ type: 'ellipse', layer: 'WALLS', cx: 0, cy: 0, rx: 3, ry: 1, rot: 0 }], defaultLayers());
    expect(dxf).toMatch(/POLYLINE|LWPOLYLINE/);
  });
});

describe('entity ops for new types', () => {
  it('hits an ellipse on its rim', () => {
    const e = { type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rot: 0 };
    expect(entHit(e, [4, 0], 0.2)).toBe(true);
    expect(entHit(e, [0, 0], 0.2)).toBe(false);
  });
  it('translateEnt moves ellipse, table, leader', () => {
    const ell = { type: 'ellipse', cx: 0, cy: 0, rx: 1, ry: 1 };
    translateEnt(ell, 3, 4);
    expect(ell.cx).toBe(3); expect(ell.cy).toBe(4);
    const t = { type: 'table', x: 0, y: 0, colW: [2], rowH: 1, cells: [['A']] };
    translateEnt(t, 1, 1);
    expect(t.x).toBe(1);
  });
  it('entPoints includes ellipse center', () => {
    const p = entPoints({ type: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 1, rot: 0 });
    expect(p.some(q => q[0] === 5 && q[1] === 5 && q[2] === 2)).toBe(true);
  });
});

describe('command aliases for CD tools', () => {
  it('resolves the new aliases', () => {
    expect(lookupCommand('EL').tool).toBe('ellipse');
    expect(lookupCommand('RC').tool).toBe('cloud');
    expect(lookupCommand('LE').tool).toBe('leader');
    expect(lookupCommand('DRA').tool).toBe('dimrad');
    expect(lookupCommand('DDI').tool).toBe('dimdia');
    expect(lookupCommand('DAN').tool).toBe('dimang');
    expect(lookupCommand('ST').tool).toBe('stretch');
    expect(lookupCommand('MA').tool).toBe('match');
    expect(lookupCommand('AA').tool).toBe('area');
    expect(lookupCommand('LI').tool).toBe('list');
    expect(lookupCommand('SCH').tool).toBe('schedule');
    expect(lookupCommand('CLN').action).toBe('cleanup');
    expect(lookupCommand('SVG').action).toBe('svg');
  });
});

describe('sample cabin CD extras', () => {
  it('tags doors and places a door schedule', () => {
    const ents = cabin24x36();
    expect(ents.some(e => e.type === 'insert' && e.def === 'door' && e.mark)).toBe(true);
    expect(ents.some(e => e.type === 'table' && /DOOR/.test(e.title || ''))).toBe(true);
    expect(ents.some(e => e.type === 'table' && /ROOM/.test(e.title || ''))).toBe(true);
  });
});
