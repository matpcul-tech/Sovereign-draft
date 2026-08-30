import { describe, it, expect } from 'vitest';
import { wallFrags, cutWallOpening, placeOpening, paramOnWall, wallCenterline, wallWithOpenings } from '../src/core/walls.js';
import { dist } from '../src/core/geometry.js';

describe('wallFrags', () => {
  it('emits two faces and two caps of the requested thickness', () => {
    const fr = wallFrags(0, 0, 10, 0, 0.5, 'WALLS');
    expect(fr.length).toBe(4);
    const a = fr.find(e => e.role === 'a');
    const b = fr.find(e => e.role === 'b');
    expect(dist(a.x1, a.y1, b.x1, b.y1)).toBeCloseTo(0.5);
    expect(a.kind).toBe('wall');
  });
});

describe('cutWallOpening', () => {
  it('splits both faces and adds jambs', () => {
    const members = wallFrags(0, 0, 20, 0, 0.5, 'WALLS');
    const res = cutWallOpening(members, 0.5, 3);
    expect(res.ok).toBe(true);
    expect(res.add.filter(e => e.role === 'jamb').length).toBe(2);
    expect(res.opening.width).toBeCloseTo(3);
  });
});

describe('placeOpening', () => {
  it('returns door geometry rotated onto the wall', () => {
    const members = wallFrags(0, 0, 20, 0, 0.5, 'WALLS');
    const res = placeOpening(members, 'door', 0.4, 3, 'L');
    expect(res.ok).toBe(true);
    expect(res.openingFrags.some(e => e.type === 'arc')).toBe(true);
    expect(res.openingFrags.every(e => e.layer === 'DOORS')).toBe(true);
  });
});

describe('paramOnWall', () => {
  it('reports 0.5 at the midpoint', () => {
    const members = wallFrags(0, 0, 10, 0, 0.5);
    expect(paramOnWall(members, [5, 0])).toBeCloseTo(0.5);
    expect(wallCenterline(members).x2).toBeCloseTo(10);
  });
});

describe('wallWithOpenings', () => {
  it('punches two openings in one pass and keeps end caps', () => {
    const cl = { x1: 0, y1: 0, x2: 20, y2: 0, th: 0.5, layer: 'WALLS' };
    const add = wallWithOpenings(cl, [{ t: 0.3, width: 3 }, { t: 0.7, width: 3 }]);
    expect(add.filter(e => e.role === 'jamb').length).toBe(4);
    expect(add.filter(e => e.role === 'cap0' || e.role === 'cap1').length).toBe(2);
    expect(add[0].ocl.x2).toBe(20);
  });
  it('restores a solid wall when given no openings', () => {
    const cl = { x1: 0, y1: 0, x2: 10, y2: 0, th: 0.5, layer: 'WALLS' };
    const add = wallWithOpenings(cl, []);
    expect(add.filter(e => e.role === 'a').length).toBe(1);
    expect(add.filter(e => e.role === 'jamb').length).toBe(0);
  });
});
