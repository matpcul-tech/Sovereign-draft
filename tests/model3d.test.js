import { describe, it, expect, beforeEach } from 'vitest';
import {
  csgUnion, csgSubtract, csgIntersect, csg
} from '../src/core/csg.js';
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeWedge, sweepPath,
  extrudeRings, meshVolume, meshArea, isWatertight, rotateMesh, translateMesh, scaleMesh
} from '../src/core/mesh.js';
import { sliceMesh, sliceArea } from '../src/core/slice.js';
import { parseSTL, weld, looksLikeSTL } from '../src/io/stl.js';
import { meshToSTL } from '../src/core/mesh.js';
import {
  addSolid, createSolid, solidByName, solidNames, removeSolid,
  booleanSolids, moveSolid, rotateSolid, sliceSolidToPlan,
  serializeSolids, validateSolids
} from '../src/core/model3d.js';
import { runScript } from '../src/core/script.js';
import { state, defaultLayers, doUndo } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { lookupCommand } from '../src/core/command.js';

const V = meshVolume;
const box = (x, y, z, w, d, h) => makeBox(x, y, z, w, d, h);

function reset(){
  state.layers = defaultLayers();
  state.entities = [];
  state.constraints = [];
  state.selIds = [];
  state.undoStack = [];
  state.redoStack = [];
  state.idSeq = 1;
  state.solids = [];
  state.autoRooms = false;
  state.scripts = [];
}

describe('CSG holds the volume identity exactly', () => {
  it('overlapping boxes', () => {
    const A = box(0, 0, 0, 10, 10, 10), B = box(5, 0, 0, 10, 10, 10);
    expect(V(csgUnion(A, B))).toBeCloseTo(1500, 6);
    expect(V(csgIntersect(A, B))).toBeCloseTo(500, 6);
    expect(V(csgSubtract(A, B))).toBeCloseTo(500, 6);
  });

  it('a through hole', () => {
    const plate = box(0, 0, 0, 10, 10, 10);
    const drill = box(3, 3, -1, 4, 4, 12);
    expect(V(csgSubtract(plate, drill))).toBeCloseTo(840, 6);
  });

  it('coplanar shared faces, the classic CSG killer', () => {
    const A = box(0, 0, 0, 10, 10, 10), E = box(10, 0, 0, 10, 10, 10);
    expect(V(csgUnion(A, E))).toBeCloseTo(2000, 6);
    expect(Math.abs(V(csgIntersect(A, E)))).toBeLessThan(1e-4);
  });

  it('a solid against itself', () => {
    const A = box(0, 0, 0, 10, 10, 10);
    expect(V(csgUnion(A, box(0, 0, 0, 10, 10, 10)))).toBeCloseTo(1000, 3);
    expect(Math.abs(V(csgSubtract(A, box(0, 0, 0, 10, 10, 10))))).toBeLessThan(1e-3);
  });

  it('vol(A) + vol(B) = vol(union) + vol(intersection) over random pairs, curved included', () => {
    let seed = 777;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let worst = 0;
    for (let k = 0; k < 25; k++){
      const A = box(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 3 - 1, 2 + rnd() * 6, 2 + rnd() * 6, 2 + rnd() * 6);
      const B = k % 3 === 0
        ? makeCylinder(rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 2 - 1, 1 + rnd() * 3, 2 + rnd() * 5, 24)
        : box(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 3 - 1, 2 + rnd() * 6, 2 + rnd() * 6, 2 + rnd() * 6);
      const lhs = V(A) + V(B);
      const rhs = V(csgUnion(A, B)) + V(csgIntersect(A, B));
      worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, lhs));
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it('an unknown operation is refused', () => {
    expect(() => csg('nope', box(0, 0, 0, 1, 1, 1), box(0, 0, 0, 1, 1, 1))).toThrow();
  });
});

describe('primitives match their formulas', () => {
  it('box, wedge exactly; round solids to their tessellation', () => {
    expect(V(makeBox(1, 2, 3, 4, 5, 6))).toBeCloseTo(120, 9);
    expect(meshArea(makeBox(1, 2, 3, 4, 5, 6))).toBeCloseTo(148, 9);
    expect(V(makeWedge(0, 0, 0, 4, 6, 3))).toBeCloseTo(36, 9);
    expect(V(makeCylinder(0, 0, 0, 3, 10, 256)) / (Math.PI * 90)).toBeCloseTo(1, 3);
    expect(V(makeCone(0, 0, 0, 3, 9, 256)) / (Math.PI * 27)).toBeCloseTo(1, 3);
    expect(V(makeSphere(0, 0, 0, 4, 96)) / (4 / 3 * Math.PI * 64)).toBeCloseTo(1, 2);
  });

  it('every primitive is watertight', () => {
    [makeBox(0, 0, 0, 2, 2, 2), makeCylinder(0, 0, 0, 1, 2, 24), makeSphere(0, 0, 0, 1, 16),
      makeCone(0, 0, 0, 1, 2, 24), makeWedge(0, 0, 0, 2, 2, 2)].forEach(m => {
      expect(isWatertight(m)).toBe(true);
      expect(V(m)).toBeGreaterThan(0);
    });
  });
});

describe('sweep', () => {
  const SEC = [[-0.5, 0], [0.5, 0], [0.5, 2], [-0.5, 2]];

  it('a straight sweep is exactly area times length', () => {
    expect(V(sweepPath(SEC, [[0, 0], [10, 0]]))).toBeCloseTo(20, 9);
    expect(V(sweepPath(SEC, [[0, 0], [7, 7]]))).toBeCloseTo(2 * Math.hypot(7, 7), 9);
  });

  it('a mitred corner conserves area times centreline exactly', () => {
    expect(V(sweepPath(SEC, [[0, 0], [10, 0], [10, 10]]))).toBeCloseTo(40, 9);
  });

  it('is watertight', () => {
    expect(isWatertight(sweepPath(SEC, [[0, 0], [10, 0], [10, 10]]))).toBe(true);
  });
});

describe('slicing a solid back into plan geometry', () => {
  it('a box slices to its footprint', () => {
    expect(sliceArea(makeBox(2, 3, 0, 10, 6, 8), 4)).toBeCloseTo(60, 9);
  });

  it('a sphere slices to the circle of its height, equator included', () => {
    const sph = makeSphere(0, 0, 0, 5, 96);
    expect(sliceArea(sph, 3) / (Math.PI * 16)).toBeCloseTo(1, 2);
    expect(sliceArea(sph, 0) / (Math.PI * 25)).toBeCloseTo(1, 2);
  });

  it('a drilled plate slices to a ring and its void', () => {
    const drilled = csgSubtract(makeBox(0, 0, 0, 20, 20, 4), makeCylinder(10, 10, -1, 4, 6, 64));
    const s = sliceMesh(drilled, 2);
    expect(s.rings.length).toBe(2);
    expect(s.open.length).toBe(0);
    expect(sliceArea(drilled, 2) / (400 - Math.PI * 16)).toBeCloseTo(1, 2);
  });

  it('outside the solid there is no section', () => {
    expect(sliceMesh(makeBox(0, 0, 0, 4, 4, 4), 99).rings.length).toBe(0);
  });
});

describe('STL both ways', () => {
  it('our ASCII output reads back with welded vertices', () => {
    const back = parseSTL(meshToSTL(makeBox(1, 2, 3, 4, 5, 6), 't'));
    expect(V(back)).toBeCloseTo(120, 5);
    expect(back.verts.length).toBe(8);
    expect(isWatertight(back)).toBe(true);
  });

  it('binary parses, including the header that starts with the word solid', () => {
    const boxm = makeBox(0, 0, 0, 3, 3, 3);
    const n = boxm.faces.length;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, n, true);
    let p = 84;
    for (const f of boxm.faces){
      p += 12;
      for (const vi of f){
        const v = boxm.verts[vi];
        dv.setFloat32(p, v[0], true); dv.setFloat32(p + 4, v[1], true); dv.setFloat32(p + 8, v[2], true);
        p += 12;
      }
      p += 2;
    }
    new Uint8Array(buf).set([0x73, 0x6f, 0x6c, 0x69, 0x64, 0x20], 0);
    expect(V(parseSTL(buf))).toBeCloseTo(27, 5);
    expect(looksLikeSTL('part.stl')).toBe(true);
  });

  it('garbage parses to an empty mesh, never a throw', () => {
    expect(parseSTL('nothing here').faces.length).toBe(0);
    expect(weld({ verts: [], faces: [] }).faces.length).toBe(0);
  });
});

describe('solids are document objects', () => {
  beforeEach(reset);

  it('named uniquely, found case-insensitively, removed by name', () => {
    const a = addSolid(box(0, 0, 0, 2, 2, 2), 'mass');
    const b = addSolid(box(9, 0, 0, 2, 2, 2), 'MASS');
    expect(a.name).toBe('MASS');
    expect(b.name).toBe('MASS-2');
    expect(solidByName('mass').id).toBe(a.id);
    expect(removeSolid('mass-2')).toBe(true);
    expect(solidNames()).toEqual(['MASS']);
  });

  it('a boolean replaces its operands with the result', () => {
    createSolid('box', [0, 0, 0, 10, 10, 10], 'A');
    createSolid('box', [5, 0, 0, 10, 10, 10], 'B');
    const r = booleanSolids('union', 'A', 'B');
    expect(solidNames()).toEqual([r.name]);
    expect(V(r.mesh)).toBeCloseTo(1500, 6);
  });

  it('transforms keep the name and the volume', () => {
    createSolid('box', [0, 0, 0, 4, 5, 6], 'M');
    moveSolid('M', 100, 0, 3);
    rotateSolid('M', 'z', 0, 0, 0, 30);
    expect(V(solidByName('M').mesh)).toBeCloseTo(120, 9);
  });

  it('slicing lands closed polylines on the SECTION layer', () => {
    createSolid('box', [2, 3, 0, 10, 6, 8], 'M');
    const r = sliceSolidToPlan('M', 4);
    expect(r.made.length).toBe(1);
    expect(r.made[0].layer).toBe('SECTION');
    expect(r.made[0].closed).toBe(true);
    expect(r.area).toBeCloseTo(60, 6);
    expect(state.entities.length).toBe(1);
  });

  it('solids survive save and load with the project', () => {
    createSolid('box', [0, 0, 0, 4, 5, 6], 'KEEP');
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.solids.length).toBe(1);
    const target = { ...state, solids: [] };
    applyProject(target, p);
    expect(target.solids[0].name).toBe('KEEP');
    expect(V(target.solids[0].mesh)).toBeCloseTo(120, 5);
  });

  it('junk solids are dropped on load', () => {
    expect(validateSolids([null, { name: 'X' }, { name: 'Y', verts: [[0, 0, 'a']], faces: [[0, 0, 0]] }])).toEqual([]);
    expect(serializeSolids(null)).toEqual([]);
  });

  it('creating a solid is one undo step away from gone', () => {
    state.undoStack = [];
    runScript("sd.solid.box(0,0,0,4,4,4,'B')");
    expect(solidNames()).toEqual(['B']);
    doUndo();
    expect(solidNames()).toEqual([]);
  });
});

describe('the scripting facade models in 3D', () => {
  beforeEach(reset);

  it('a drilled plate, scripted, measured, sliced', () => {
    const r = runScript(`
      sd.solid.box(0, 0, 0, 20, 20, 4, 'PLATE');
      sd.solid.cylinder(10, 10, -1, 4, 6, 'DRILL');
      const out = sd.solid.subtract('PLATE', 'DRILL', 'PLATE');
      print('volume', sd.solid.volume(out).toFixed(1));
      const ids = sd.solid.slice(out, 2);
      print('section rings', ids.length);
    `);
    expect(r.ok).toBe(true);
    /* The drill is a 48-gon, slightly inside the true cylinder, so the
     * remainder is slightly above the closed form. Within a tenth of a
     * percent is the tessellation, not an error. */
    const got = Number(r.output[0].split(' ')[1]);
    expect(got / (400 * 4 - Math.PI * 16 * 4)).toBeCloseTo(1, 3);
    expect(r.output[1]).toBe('section rings 2');
    expect(state.entities.filter(e => e.layer === 'SECTION').length).toBe(2);
  });

  it('a failing 3D script rolls back the solids too', () => {
    runScript("sd.solid.box(0,0,0,2,2,2,'OK')");
    const r = runScript(`
      sd.solid.box(9, 9, 0, 3, 3, 3, 'DOOMED');
      throw new Error('bail');
    `);
    expect(r.ok).toBe(false);
    expect(solidNames()).toEqual(['OK']);
  });
});

describe('the commands are registered', () => {
  it('the 3D command set reaches the command line', () => {
    expect(lookupCommand('BOX').action).toBe('prim:box');
    expect(lookupCommand('CYL').action).toBe('prim:cylinder');
    expect(lookupCommand('SPHERE').action).toBe('prim:sphere');
    expect(lookupCommand('CONE').action).toBe('prim:cone');
    expect(lookupCommand('WEDGE').action).toBe('prim:wedge');
    expect(lookupCommand('SWEEP').action).toBe('sweep3d');
    expect(lookupCommand('U3D').action).toBe('bool3d:union');
    expect(lookupCommand('SUB3D').action).toBe('bool3d:subtract');
    expect(lookupCommand('INT3D').action).toBe('bool3d:intersect');
    expect(lookupCommand('SLICE').action).toBe('slice3d');
    expect(lookupCommand('SOLIDS').action).toBe('solids');
    expect(lookupCommand('SOLIDDEL').action).toBe('soliddel');
  });
});

void rotateMesh; void translateMesh; void scaleMesh; void extrudeRings;
