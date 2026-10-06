import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import { defaultLayers } from '../src/core/state.js';
import { extrudeDrawing, meshesToFaces, heightStamp, triangulate, signedArea, resolveHeight, ASSUMED_STORY } from '../src/core/solid.js';
import { lookupCommand } from '../src/core/command.js';

describe('triangulate', () => {
  it('fans a rectangle into two triangles', () => {
    const idx = triangulate([[0, 0], [4, 0], [4, 2], [0, 2]]);
    expect(idx.length).toBe(6);
    expect(Math.abs(signedArea([[0, 0], [4, 0], [4, 2], [0, 2]]))).toBeCloseTo(8);
  });
});

describe('resolveHeight', () => {
  it('stamps ASSUMED at 8 feet unless the user set a height', () => {
    expect(resolveHeight()).toEqual({ height: ASSUMED_STORY, assumed: true });
    expect(resolveHeight({ height: 9 })).toEqual({ height: 9, assumed: false });
  });
});

describe('extrude cabin', () => {
  it('builds wall, door, window and floor meshes', () => {
    const solid = extrudeDrawing(cabin24x36(), { layers: defaultLayers() });
    expect(solid.assumed).toBe(true);
    expect(solid.height).toBe(8);
    expect(solid.meshes.some(m => m.kind === 'wall')).toBe(true);
    expect(solid.meshes.some(m => m.kind === 'door')).toBe(true);
    expect(solid.meshes.some(m => m.kind === 'window')).toBe(true);
    expect(solid.meshes.some(m => m.kind === 'floor')).toBe(true);
    expect(solid.verts).toBeGreaterThan(40);
    const walls = solid.meshes.filter(m => m.kind === 'wall');
    const maxZ = Math.max(...walls.map(m => {
      let z = 0;
      for (let i = 2; i < m.positions.length; i += 3) z = Math.max(z, m.positions[i]);
      return z;
    }));
    expect(maxZ).toBeCloseTo(8);
    expect(heightStamp(solid)).toMatch(/ASSUMED/);
  });

  it('uses a user-set story height', () => {
    const solid = extrudeDrawing(cabin24x36(), { height: 10, assumed: false, layers: defaultLayers() });
    expect(solid.assumed).toBe(false);
    expect(solid.height).toBe(10);
    expect(heightStamp(solid)).not.toMatch(/story ASSUMED/);
  });

  it('emits 3DFACE-ready triangles', () => {
    const solid = extrudeDrawing(cabin24x36(), { layers: defaultLayers() });
    const faces = meshesToFaces(solid.meshes);
    expect(faces.length).toBeGreaterThan(20);
    expect(faces[0].type).toBe('face');
    expect(faces[0].a.length).toBe(3);
  });
});

describe('3D / DWG commands', () => {
  it('resolves 3D, HEIGHT, DWGOUT, PLAN', () => {
    expect(lookupCommand('3D').action).toBe('view3d');
    expect(lookupCommand('V3D').action).toBe('view3d');
    expect(lookupCommand('HEIGHT').action).toBe('height');
    expect(lookupCommand('HT').action).toBe('height');
    expect(lookupCommand('DWGOUT').action).toBe('dwgout');
    expect(lookupCommand('2D').action).toBe('view2d');
    expect(lookupCommand('PLAN').action).toBe('view2d');
  });
});

describe('door leaf in 3D', () => {
  function bbox(m){
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3){
      for (let k = 0; k < 3; k++){ mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); }
    }
    return { mn, mx };
  }
  it('sits closed in the opening so a facade shows a door, not a hole', () => {
    const door = { type: 'insert', layer: 'DOORS', def: 'door', x: 22.5, y: 0.25, rot: 0, width: 3, swing: 'L', th: 0.5 };
    const solid = extrudeDrawing([door], { layers: defaultLayers(), height: 9 });
    const m = solid.meshes.find(x => x.kind === 'door');
    const { mn, mx } = bbox(m);
    expect(mn[0]).toBeCloseTo(22.5);
    expect(mx[0]).toBeCloseTo(25.5);
    expect(mx[1] - mn[1]).toBeLessThan(0.2);
    expect((mn[1] + mx[1]) / 2).toBeCloseTo(0.25);
  });
  it('follows a rotated wall', () => {
    const door = { type: 'insert', layer: 'DOORS', def: 'door', x: 13.25, y: 30.5, rot: 90, width: 3, swing: 'R', th: 0.33 };
    const solid = extrudeDrawing([door], { layers: defaultLayers(), height: 9 });
    const { mn, mx } = bbox(solid.meshes.find(x => x.kind === 'door'));
    expect(mn[1]).toBeCloseTo(30.5);
    expect(mx[1]).toBeCloseTo(33.5);
    expect(mx[0] - mn[0]).toBeLessThan(0.2);
  });
});
