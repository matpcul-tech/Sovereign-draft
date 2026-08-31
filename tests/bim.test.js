import { describe, it, expect } from 'vitest';
import { wallFrags } from '../src/core/walls.js';
import { detectRooms, nameRoomsFromText } from '../src/core/rooms.js';
import { bindAlignedDim, refreshAssocDims } from '../src/core/assoc.js';
import { stretchEntities } from '../src/core/stretch.js';
import { colLetter, makeGrid, expandGrid, makeGridFromCorners } from '../src/core/grid.js';
import { overkill } from '../src/core/overkill.js';
import { takeoff } from '../src/core/takeoff.js';
import { polarArray } from '../src/core/modify.js';
import { cabin24x36 } from '../src/core/demo.js';
import { lookupCommand } from '../src/core/command.js';
import { healWalls } from '../src/core/cleanup.js';

function boxWalls(w, h){
  const ents = [];
  function wall(x1, y1, x2, y2, g){
    wallFrags(x1, y1, x2, y2, 0.5, 'WALLS').forEach(f => { f.g = g; ents.push(f); });
  }
  wall(0, 0, w, 0, 's');
  wall(w, 0, w, h, 'e');
  wall(w, h, 0, h, 'n');
  wall(0, h, 0, 0, 'w');
  return ents;
}

describe('detectRooms', () => {
  it('finds one room inside a rectangle of walls', () => {
    const rooms = detectRooms(boxWalls(20, 12));
    expect(rooms.length).toBe(1);
    expect(rooms[0].area).toBeGreaterThan(200);
    expect(rooms[0].area).toBeLessThan(240);
  });

  it('names rooms from text inside them', () => {
    const ents = boxWalls(20, 12);
    ents.push({ type: 'text', x: 10, y: 6, size: 1, content: 'KITCHEN' });
    const rooms = nameRoomsFromText(detectRooms(ents), ents);
    expect(rooms[0].name).toBe('KITCHEN');
  });

  it('finds three rooms in the 24×36 cabin', () => {
    const ents = cabin24x36();
    const rooms = ents.filter(e => e.type === 'room');
    expect(rooms.length).toBe(3);
    const names = rooms.map(r => r.name).sort();
    expect(names).toEqual(['BEDROOM', 'KITCHEN', 'LIVING']);
  });
});

describe('associative dims', () => {
  it('follows a wall end when the centerline moves', () => {
    const fr = wallFrags(0, 0, 10, 0, 0.5, 'WALLS');
    fr.forEach(f => { f.g = 'w1'; });
    const dim = { type: 'dim', x1: 0, y1: 0, x2: 10, y2: 0, off: -2 };
    bindAlignedDim(dim, fr);
    expect(dim.assoc).toBeTruthy();
    expect(dim.assoc[0].kind).toBe('wall');
    stretchEntities(fr, [8, -1, 12, 1], 6, 0);
    refreshAssocDims(fr.concat([dim]));
    expect(dim.x2).toBeCloseTo(16, 1);
  });
});

describe('column grid', () => {
  it('letters wrap past Z', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
  });
  it('expands to CENTER lines and letter/number bubbles', () => {
    const g = makeGrid({ x: 0, y: 0, cols: 3, rows: 2, cx: 12, ry: 12 });
    const fr = expandGrid(g);
    expect(fr.filter(e => e.type === 'line' && e.lt === 'CENTER').length).toBe(4 + 3);
    expect(fr.some(e => e.type === 'text' && e.content === 'A')).toBe(true);
    expect(fr.some(e => e.type === 'text' && e.content === '1')).toBe(true);
    const from = makeGridFromCorners([0, 0], [36, 24]);
    expect(from.cols).toBe(3);
    expect(from.rows).toBe(2);
  });
});

describe('overkill', () => {
  it('drops zero-length and duplicate lines', () => {
    const ents = [
      { type: 'line', layer: '0', x1: 0, y1: 0, x2: 5, y2: 0 },
      { type: 'line', layer: '0', x1: 5, y1: 0, x2: 0, y2: 0 },
      { type: 'line', layer: '0', x1: 0, y1: 0, x2: 0, y2: 0 },
      { type: 'circle', layer: '0', cx: 1, cy: 1, r: 1 }
    ];
    const res = overkill(ents);
    expect(res.dropped).toBe(2);
    expect(res.entities.filter(e => e.type === 'line').length).toBe(1);
    expect(res.entities.some(e => e.type === 'circle')).toBe(true);
  });
});

describe('takeoff', () => {
  it('reports wall LF, doors and room SF on the cabin', () => {
    const t = takeoff(cabin24x36());
    expect(t.wallCount).toBeGreaterThanOrEqual(6);
    expect(t.wallLf).toBeGreaterThan(100);
    expect(t.doorCount).toBe(3);
    expect(t.windowCount).toBe(2);
    expect(t.roomCount).toBe(3);
    expect(t.roomSf).toBeGreaterThan(700);
  });
});

describe('polarArray', () => {
  it('emits count-1 copies around a center', () => {
    const src = [{ type: 'circle', cx: 4, cy: 0, r: 0.5 }];
    const out = polarArray(src, 0, 0, 4, 360);
    expect(out.length).toBe(3);
    expect(out.some(e => Math.abs(e.cy - 4) < 1e-6 && Math.abs(e.cx) < 1e-6)).toBe(true);
  });
});

describe('healWalls', () => {
  it('pulls near L-corners onto the centerline intersection', () => {
    const ents = [];
    wallFrags(0, 0, 10.08, 0, 0.5, 'WALLS').forEach(f => { f.g = 'a'; ents.push(f); });
    wallFrags(10, -0.06, 10, 8, 0.5, 'WALLS').forEach(f => { f.g = 'b'; ents.push(f); });
    const res = healWalls(ents);
    expect(res.ok).toBe(true);
  });
});

describe('command aliases', () => {
  it('resolves BIM-lite aliases', () => {
    expect(lookupCommand('XL').tool).toBe('xline');
    expect(lookupCommand('GRID').tool).toBe('grid');
    expect(lookupCommand('ARP').tool).toBe('arraypolar');
    expect(lookupCommand('OV').action).toBe('overkill');
    expect(lookupCommand('ROOMS').action).toBe('rooms');
    expect(lookupCommand('TO').action).toBe('takeoff');
    expect(lookupCommand('LAYISO').action).toBe('layiso');
    expect(lookupCommand('UNISO').action).toBe('layuniso');
  });
});
