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

  it('slicing lands closed polylines on the SECTION layer, hatched as poche', () => {
    createSolid('box', [2, 3, 0, 10, 6, 8], 'M');
    const r = sliceSolidToPlan('M', 4);
    expect(r.made.length).toBe(2);
    expect(r.hatches).toBe(1);
    expect(r.made[0].layer).toBe('SECTION');
    expect(r.made[0].closed).toBe(true);
    expect(r.made[1].type).toBe('hatch');
    expect(r.made[1].pattern).toBe('ANSI31');
    expect(r.area).toBeCloseTo(60, 6);
    expect(state.entities.length).toBe(2);
  });

  it('poche of a hollow section hatches the wall and spares the cavity', async () => {
    const { hatchArea } = await import('../src/core/hatch.js');
    const { csgSubtract: sub } = await import('../src/core/csg.js');
    addSolid(sub(box(0, 0, 0, 10, 10, 8), box(2, 2, -1, 6, 6, 10)), 'TUBE');
    const r = sliceSolidToPlan('TUBE', 4);
    const rings = r.made.filter(e => e.type === 'poly');
    const hatches = r.made.filter(e => e.type === 'hatch');
    expect(rings.length).toBe(2);
    expect(hatches.length).toBe(1);
    expect(hatches[0].holes.length).toBe(1);
    expect(hatchArea(hatches[0])).toBeCloseTo(100 - 36, 6);
    expect(r.area).toBeCloseTo(64, 6);
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
    /* Two rings plus the poche hatch, whose hole is the drill. */
    expect(r.output[1]).toBe('section rings 3');
    expect(state.entities.filter(e => e.layer === 'SECTION').length).toBe(3);
    const hatches = state.entities.filter(e => e.type === 'hatch');
    expect(hatches.length).toBe(1);
    expect((hatches[0].holes || []).length).toBe(1);
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

describe('pitched roofs', () => {
  beforeEach(reset);

  it('gable and hip match their closed forms and are watertight, transposed too', async () => {
    const { makeGable, makeHip } = await import('../src/core/mesh.js');
    const g = makeGable(0, 0, 8, 30, 20, 5);
    expect(V(g)).toBeCloseTo(20 * 5 / 2 * 30, 9);
    expect(isWatertight(g)).toBe(true);
    /* Deep footprint: the ridge follows the long side. */
    expect(V(makeGable(4, 7, 0, 20, 30, 5))).toBeCloseTo(1500, 9);
    const h = makeHip(0, 0, 8, 30, 20, 5);
    expect(V(h)).toBeCloseTo(10 * (20 * 5 / 2) + 20 * 20 * 5 / 3, 9);
    expect(isWatertight(h)).toBe(true);
    /* A square hip is a pyramid. */
    const pyr = makeHip(0, 0, 0, 20, 20, 5);
    expect(V(pyr)).toBeCloseTo(20 * 20 * 5 / 3, 9);
    expect(isWatertight(pyr)).toBe(true);
  });

  it('ROOF fits the modelled massing: overhang, pitch, seated on top, re-roof ignores old roofs', async () => {
    const { roofOverModel } = await import('../src/core/model3d.js');
    const { meshBBox: bbOf } = await import('../src/core/mesh.js');
    addSolid(box(0, 0, 0, 30, 20, 8), 'WALL');
    const rec = roofOverModel('gable', 6, 1);
    expect(rec.name).toBe('ROOF');
    const bb = bbOf(rec.mesh);
    /* Footprint 32 x 22 at z 8; rise = 11 * 6/12 = 5.5. */
    expect(bb).toEqual([-1, -1, 8, 31, 21, 13.5]);
    expect(V(rec.mesh)).toBeCloseTo(22 * 5.5 / 2 * 32, 9);
    /* Re-roofing measures the massing, not the old hat. */
    const rec2 = roofOverModel('hip', 6, 1);
    expect(bbOf(rec2.mesh)[2]).toBe(8);
    expect(lookupCommand('ROOF').action).toBe('roof');
  });

  it('generated views never extrude back into the 3D model', async () => {
    const { extrudeDrawing } = await import('../src/core/solid.js');
    const drawn = extrudeDrawing([
      { type: 'poly', layer: 'SECTION', closed: true, pts: [[0, 0], [10, 0], [10, 8], [0, 8]] },
      { type: 'poly', layer: 'OPENINGS', closed: true, pts: [[2, 2], [5, 2], [5, 6], [2, 6]] },
      { type: 'hatch', layer: 'SECTION', pts: [[0, 0], [10, 0], [10, 8], [0, 8]] }
    ], { height: 8, layers: defaultLayers() });
    expect((drawn.meshes || []).length).toBe(0);
  });

  it('a gable roof draws its eave line across the elevation', async () => {
    const { roofOverModel, elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(box(0, 0, 0, 30, 20, 8), 'WALL');
    roofOverModel('gable', 6, 1);
    const r = elevationToPlan('S');
    /* The one interior line is the eave at the wall head, the roof's
     * bottom edge and the wall top drawn once. */
    expect(r.edges).toBe(1);
    const line = r.made.find(e => e.type === 'line');
    expect(line.y1).toBeCloseTo(8, 6);
    expect(line.y2).toBeCloseTo(8, 6);
    /* Outline: 30x8 of wall plus the 32 wide slope face to the ridge. */
    expect(r.area).toBeCloseTo(30 * 8 + 32 * 5.5, 1);
  });
});

describe('stacked stories', () => {
  beforeEach(reset);

  it('STACK replicates the storey, names levels, lifts the roof, refuses to stack twice', async () => {
    const { stackStories, roofOverModel, solidByName: byName } = await import('../src/core/model3d.js');
    const { meshBBox: bbOf } = await import('../src/core/mesh.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'WALL');
    addSolid(makeBox(8, 0.15, 4, 4, 0.2, 3), 'WINDOW');
    roofOverModel('gable', 6, 1);
    const r = stackStories(3);
    expect(r.stories).toBe(3);
    expect(r.storyHeight).toBeCloseTo(8, 9);
    expect(solidNames()).toContain('WALL-L2');
    expect(solidNames()).toContain('WINDOW-L3');
    expect(V(byName('WALL-L2').mesh)).toBeCloseTo(4800, 6);
    /* The roof rode to the top of the new massing. */
    expect(bbOf(byName('ROOF').mesh)[2]).toBeCloseTo(24, 9);
    expect(() => stackStories(2)).toThrow();
    expect(lookupCommand('STACK').action).toBe('stack');
  });

  it('a stacked elevation shows one window per storey at exact sills, and no floor seams', async () => {
    const { stackStories, elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 20, 10, 8), 'WALL');
    addSolid(makeBox(8, 0.15, 4, 4, 0.2, 3), 'WINDOW');
    stackStories(3, 8);
    const r = elevationToPlan('S');
    expect(r.openings).toBe(3);
    const sills = state.entities.filter(e => e.layer === 'OPENINGS')
      .map(o => Math.min(...o.pts.map(p => p[1]))).sort((a, b) => a - b);
    expect(sills[0]).toBeCloseTo(4, 6);
    expect(sills[1]).toBeCloseTo(12, 6);
    expect(sills[2]).toBeCloseTo(20, 6);
    /* Flush stacked walls are one facade: the coplanar suppression keeps
     * the storey joints off the drawing. */
    expect(r.edges).toBe(0);
    expect(r.area).toBeCloseTo(20 * 24, 1);
  });
});

describe('wing roofs over rectilinear plans', () => {
  beforeEach(reset);

  const hipVol = (w, d, pitch) => {
    const Ss = Math.min(w, d), L = Math.max(w, d), r = Ss / 2 * pitch / 12;
    return (L - Ss) * Ss * r / 2 + Ss * Ss * r / 3;
  };

  it('an L plan gets two wing hips whose union is exact at zero overhang', async () => {
    const { roofOverModel } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'A');
    addSolid(makeBox(0, 20, 0, 14, 16, 8), 'B');
    const roof = roofOverModel('hip', 6, 0);
    expect(Math.abs(V(roof.mesh))).toBeCloseTo(hipVol(30, 20, 6) + hipVol(14, 16, 6), 6);
  });

  it('with an overhang the union obeys inclusion-exclusion against the wing hips', async () => {
    const { roofOverModel } = await import('../src/core/model3d.js');
    const { makeHip } = await import('../src/core/mesh.js');
    const { csgIntersect: inter } = await import('../src/core/csg.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'A');
    addSolid(makeBox(0, 20, 0, 14, 16, 8), 'B');
    const roof = roofOverModel('hip', 6, 1);
    const m1 = makeHip(-1, -1, 8, 32, 22, 22 / 4);
    const m2 = makeHip(-1, 19, 8, 16, 18, 16 / 4);
    const rhs = Math.abs(V(m1)) + Math.abs(V(m2)) - Math.abs(V(inter(m1, m2)));
    expect(Math.abs(V(roof.mesh))).toBeCloseTo(rhs, 6);
  });

  it('the roof plan of an L draws its valleys, and a plain rectangle is unchanged', async () => {
    const { roofOverModel, roofPlanToPlan } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'A');
    addSolid(makeBox(0, 20, 0, 14, 16, 8), 'B');
    roofOverModel('hip', 6, 0);
    expect(roofPlanToPlan().edges).toBeGreaterThan(8);
    reset();
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'WALL');
    const r = roofOverModel('gable', 6, 1);
    expect(Math.abs(V(r.mesh))).toBeCloseTo(22 * 5.5 / 2 * 32, 6);
  });
});

describe('push-pull on the exact kernel', () => {
  beforeEach(reset);

  it('pull and push change the volume by patch area times distance, side faces too', async () => {
    const { pushPullSolid, facePatch, solidByName: byName } = await import('../src/core/model3d.js');
    addSolid(box(0, 0, 0, 10, 10, 10), 'B');
    const m = byName('B').mesh;
    const top = m.faces.findIndex(f => f.every(vi => m.verts[vi][2] === 10));
    expect(facePatch(m, top).area).toBeCloseTo(100, 9);
    pushPullSolid('B', top, 3);
    expect(V(byName('B').mesh)).toBeCloseTo(1300, 6);
    const m2 = byName('B').mesh;
    const top2 = m2.faces.findIndex(f => f.every(vi => m2.verts[vi][2] >= 13 - 1e-9));
    pushPullSolid('B', top2, -5);
    expect(V(byName('B').mesh)).toBeCloseTo(800, 6);
    const m3 = byName('B').mesh;
    const side = m3.faces.findIndex(f => f.every(vi => m3.verts[vi][0] === 10));
    pushPullSolid('B', side, 4);
    expect(V(byName('B').mesh)).toBeCloseTo(800 + 4 * 80, 6);
  });

  it('a holed face pulls with its hole, straight through T-junctioned CSG output', async () => {
    const { pushPullSolid, facePatch, solidByName: byName } = await import('../src/core/model3d.js');
    const plate = csgSubtract(makeBox(0, 40, 0, 20, 20, 4), makeBox(8, 48, -1, 4, 4, 6));
    addSolid(plate, 'P');
    const m = byName('P').mesh;
    const seed = m.faces.findIndex(f => f.every(vi => Math.abs(m.verts[vi][2] - 4) < 1e-9));
    const p = facePatch(m, seed);
    expect(p.rings.length).toBe(2);
    expect(p.area).toBeCloseTo(384, 6);
    pushPullSolid('P', seed, 2);
    expect(V(byName('P').mesh)).toBeCloseTo(400 * 4 - 16 * 4 + 384 * 2, 6);
  });

  it('pushing the whole solid away is refused, not corrupted', async () => {
    const { pushPullSolid, solidByName: byName } = await import('../src/core/model3d.js');
    addSolid(box(0, 0, 0, 10, 10, 10), 'B');
    expect(() => pushPullSolid('B', 0, -999)).toThrow();
    expect(V(byName('B').mesh)).toBeCloseTo(1000, 6);
  });
});

describe('model takeoff', () => {
  beforeEach(reset);

  it('QTO carries exact figures per solid with a total row', async () => {
    const { takeoffSolids } = await import('../src/core/model3d.js');
    addSolid(box(0, 0, 0, 10, 10, 10), 'A');
    addSolid(makeCylinder(30, 0, 0, 3, 10, 256), 'C');
    const r = takeoffSolids();
    expect(r.rows.length).toBe(3);
    expect(r.rows[0]).toEqual(['A', '100.0 SF', '600.0 SF', '1000.0 CF']);
    expect(r.rows[2][0]).toBe('TOTAL');
    expect(r.volume / (1000 + Math.PI * 90)).toBeCloseTo(1, 3);
    expect(lookupCommand('QTO').action).toBe('takeoff3d');
  });
});

describe('the roof plan', () => {
  beforeEach(reset);

  it('a hip roof plans to its ridge and four hips, exactly', async () => {
    const { roofPlanToPlan } = await import('../src/core/model3d.js');
    const { makeHip } = await import('../src/core/mesh.js');
    addSolid(makeHip(0, 0, 8, 30, 20, 5), 'ROOF');
    const r = roofPlanToPlan();
    expect(r.area).toBeCloseTo(600, 6);
    expect(r.edges).toBe(5);
    const lines = r.made.filter(e => e.type === 'line');
    const lens = lines.map(l => Math.hypot(l.x2 - l.x1, l.y2 - l.y1)).sort((a, b) => a - b);
    /* Four hips at sqrt(200) and the ridge at 10. */
    expect(lens[0]).toBeCloseTo(10, 6);
    for (let i = 1; i < 5; i++) expect(lens[i]).toBeCloseTo(Math.sqrt(200), 6);
    expect(lookupCommand('ROOFPLAN').action).toBe('roofplan');
  });

  it('a gable roof plans to just its ridge', async () => {
    const { roofPlanToPlan } = await import('../src/core/model3d.js');
    const { makeGable } = await import('../src/core/mesh.js');
    addSolid(makeGable(0, 0, 8, 30, 20, 5), 'ROOF');
    const r = roofPlanToPlan();
    expect(r.edges).toBe(1);
    const line = r.made.find(e => e.type === 'line');
    expect(Math.abs(line.y2 - line.y1)).toBeLessThan(1e-6);
    expect(Math.abs(line.x2 - line.x1)).toBeCloseTo(30, 0);
  });

  it('DRAWINGS adds the roof plan and marks the section cut on the plan', async () => {
    const { generateDrawings } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'WALL');
    const r = generateDrawings({ roof: 'hip', pitch: 6 });
    expect(r.roofPlan).toBeGreaterThan(0);
    expect(r.views.map(v => v.name)).toContain('ROOF PLAN');
    expect(state.entities.some(e => e.type === 'cutplane')).toBe(true);
  });
});

describe('headers and sills over openings', () => {
  beforeEach(reset);

  /* One wall along x at y=0: runs 0..8, 11..14, 17..20, with a door
   * insert centred in the first gap and a window in the second. */
  const wallWithGaps = () => {
    const runs = [[0, 8], [11, 14], [17, 20]];
    const ents = [];
    runs.forEach(([x0, x1]) => {
      ents.push(
        { type: 'line', kind: 'wall', g: 'w1', role: 'a', th: 0.5, layer: 'WALLS', x1: x0, y1: 0.25, x2: x1, y2: 0.25 },
        { type: 'line', kind: 'wall', g: 'w1', role: 'b', th: 0.5, layer: 'WALLS', x1: x0, y1: -0.25, x2: x1, y2: -0.25 }
      );
    });
    ents.push({ type: 'insert', def: 'door', x: 9.5, y: 0, width: 3, layer: 'DOORS' });
    ents.push({ type: 'insert', def: 'window', x: 15.5, y: 0, width: 3, layer: 'DOORS' });
    return ents;
  };

  it('the wall carries back over the door and around the window, volumes exact', async () => {
    const { extrudeDrawing } = await import('../src/core/solid.js');
    const { sliceAreaAxis } = await import('../src/core/slice.js');
    const drawn = extrudeDrawing(wallWithGaps(), { height: 8, layers: defaultLayers() });
    const wallMesh = drawn.meshes.find(m => m.kind === 'wall');
    const verts = [];
    for (let i = 0; i + 2 < wallMesh.positions.length; i += 3){
      verts.push([wallMesh.positions[i], wallMesh.positions[i + 1], wallMesh.positions[i + 2]]);
    }
    const faces = [];
    for (let i = 0; i + 2 < wallMesh.indices.length; i += 3){
      faces.push([wallMesh.indices[i], wallMesh.indices[i + 1], wallMesh.indices[i + 2]]);
    }
    const mesh = { verts, faces };
    /* Runs 14 ft of full wall, plus the door header (8 - 6'-8" tall over
     * 3 ft) and the window sill and header. All at 0.5 thick. */
    const doorHeader = 3 * 0.5 * (8 - (6 + 8 / 12));
    const winSill = 3 * 0.5 * 3;
    const winHeader = 3 * 0.5 * (8 - (6 + 8 / 12));
    expect(Math.abs(V(mesh))).toBeCloseTo(14 * 0.5 * 8 + doorHeader + winSill + winHeader, 5);
    /* A section through the doorway shows exactly the header. */
    expect(sliceAreaAxis(mesh, 'x', 9.5)).toBeCloseTo(0.5 * (8 - (6 + 8 / 12)), 6);
    /* Through the window: sill wall below, header above. */
    expect(sliceAreaAxis(mesh, 'x', 15.5)).toBeCloseTo(0.5 * 3 + 0.5 * (8 - (6 + 8 / 12)), 6);
    /* A gap with no insert nearby stays open. */
    const bare = extrudeDrawing(wallWithGaps().filter(e => e.type !== 'insert'), { height: 8, layers: defaultLayers() });
    const bm = bare.meshes.find(m => m.kind === 'wall');
    let vol = 0;
    {
      const vs = [], fs = [];
      for (let i = 0; i + 2 < bm.positions.length; i += 3) vs.push([bm.positions[i], bm.positions[i + 1], bm.positions[i + 2]]);
      for (let i = 0; i + 2 < bm.indices.length; i += 3) fs.push([bm.indices[i], bm.indices[i + 1], bm.indices[i + 2]]);
      vol = V({ verts: vs, faces: fs });
    }
    expect(Math.abs(vol)).toBeCloseTo(14 * 0.5 * 8, 5);
  });
});

describe('per-storey plans', () => {
  beforeEach(reset);

  it('PLANS cuts every level with exact poche and titles', async () => {
    const { stackStories, storyPlans } = await import('../src/core/model3d.js');
    const { csgSubtract: sub } = await import('../src/core/csg.js');
    const { hatchArea } = await import('../src/core/hatch.js');
    /* A hollow tube of walls, 2 ft thick, stacked twice. */
    addSolid(sub(makeBox(0, 0, 0, 20, 20, 8), makeBox(2, 2, -1, 16, 16, 10)), 'WALL');
    stackStories(2, 8);
    const r = storyPlans();
    expect(r.levels).toBe(2);
    expect(r.plans.map(p => p.cutZ)).toEqual([4, 12]);
    for (const pl of r.plans){
      expect(pl.rings).toBe(2);
      const hatch = pl.made.find(e => e.type === 'hatch');
      expect(hatch.holes.length).toBe(1);
      expect(hatchArea(hatch)).toBeCloseTo(400 - 256, 6);
    }
    const titles = state.entities.filter(e => e.type === 'text').map(e => e.content);
    expect(titles).toContain('LEVEL 1 PLAN');
    expect(titles).toContain('LEVEL 2 PLAN');
    expect(lookupCommand('PLANS').action).toBe('plans');
  });

  it('DRAWINGS on a stacked model folds level plans into the views', async () => {
    const { stackStories, generateDrawings } = await import('../src/core/model3d.js');
    const { viewSheets } = await import('../src/core/sheetset.js');
    addSolid(makeBox(0, 0, 0, 30, 20, 8), 'WALL');
    stackStories(3, 8);
    const r = generateDrawings({});
    expect(r.storyPlans).toBe(3);
    const names = r.views.map(v => v.name);
    expect(names).toContain('LEVEL 3 PLAN');
    /* The sheet ladder numbers the plans first. */
    const sheets = viewSheets(r.views);
    const planNums = sheets.filter(s => /PLAN/.test(s.name)).map(s => s.sheetNumber);
    expect(planNums).toEqual(['A-101', 'A-102', 'A-103']);
  });
});

describe('the whole set from one command', () => {
  beforeEach(reset);

  it('DRAWINGS models the plan, roofs it, elevates all four sides and cuts a section', async () => {
    const { generateDrawings } = await import('../src/core/model3d.js');
    /* A bare plan: one closed footprint. */
    state.entities.push({
      id: state.idSeq++, type: 'poly', layer: 'WALLS', closed: true,
      pts: [[0, 0], [30, 0], [30, 20], [0, 20]]
    });
    const r = generateDrawings({ roof: 'hip', pitch: 6 });
    expect(r.modelled).toBeGreaterThan(0);
    expect(r.roof).toBe('ROOF');
    expect(r.elevations.length).toBe(4);
    const titles = state.entities.filter(e => e.type === 'text').map(e => e.content);
    for (const t of ['SOUTH ELEVATION', 'EAST ELEVATION', 'NORTH ELEVATION', 'WEST ELEVATION']){
      expect(titles).toContain(t);
    }
    expect(titles.some(t => /^SECTION Y AT /.test(t))).toBe(true);
    /* The section cuts through the middle of the mass and carries poche. */
    expect(r.section.hatches).toBeGreaterThan(0);
    expect(lookupCommand('DRAWINGS').action).toBe('drawings');
  });

  it('DRAWINGS with nothing to draw refuses instead of littering', async () => {
    const { generateDrawings } = await import('../src/core/model3d.js');
    expect(() => generateDrawings({})).toThrow();
    expect(state.entities.length).toBe(0);
    expect(state.solids.length).toBe(0);
  });
});

describe('vertical sections and elevations', () => {
  beforeEach(reset);

  const tower = () => {
    const base = csgUnion(makeBox(0, 0, 0, 40, 30, 4), makeCylinder(20, 15, 4, 8, 30, 48));
    return csgSubtract(base, makeBox(16, 11, -2, 8, 8, 40));
  };

  it('a vertical cut of a box is its cross section, in section coordinates', async () => {
    const { sliceMeshAxis, sliceAreaAxis } = await import('../src/core/slice.js');
    const box3 = makeBox(0, 0, 0, 40, 30, 10);
    expect(sliceAreaAxis(box3, 'y', 15)).toBeCloseTo(400, 9);
    expect(sliceAreaAxis(box3, 'x', 20)).toBeCloseTo(300, 9);
    const s = sliceMeshAxis(box3, 'y', 15);
    const xs = s.rings[0].map(p => p[0]), zs = s.rings[0].map(p => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(40, 9);
    expect(Math.max(...zs)).toBeCloseTo(10, 9);
  });

  it('the tower section through the shaft is exact despite CSG seams', async () => {
    const { sliceAreaAxis } = await import('../src/core/slice.js');
    /* slab strip 40x4 minus 8x4, plus cylinder band 16x30 minus 8x30 */
    expect(sliceAreaAxis(tower(), 'y', 15)).toBeCloseTo(128 + 240, 6);
  });

  it('the silhouette is the massing outline with interior voids hidden', async () => {
    const { silhouette } = await import('../src/core/slice.js');
    const { polyBoolean, ringsArea } = await import('../src/core/boolean.js');
    const sil = silhouette(tower(), 'y', (A, B, op) => polyBoolean(A, B, op));
    expect(sil.length).toBe(1);
    expect(ringsArea(sil)).toBeCloseTo(40 * 4 + 16 * 30, 1);
  });

  it('sliceSolidToPlan lands a vertical section beside the drawing, not on it', () => {
    addSolid(makeBox(0, 0, 0, 40, 30, 10), 'M');
    state.entities.push({ id: state.idSeq++, type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [40, 0], [40, 30], [0, 30]] });
    const r = sliceSolidToPlan('M', 15, undefined, 'y');
    expect(r.made.filter(e => e.type === 'poly').length).toBe(1);
    expect(r.made.some(e => e.type === 'hatch')).toBe(true);
    const xs = r.made[0].pts.map(p => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(40);
    expect(r.area).toBeCloseTo(400, 6);
    /* The section arrives as a drawing: titled and dimensioned. */
    const title = r.made.find(e => e.type === 'text');
    expect(title.content).toBe('SECTION Y AT 15\'-0"');
    const lens = r.made.filter(e => e.type === 'dim')
      .map(d => Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).sort((a, b) => a - b);
    expect(lens.length).toBe(2);
    expect(lens[0]).toBeCloseTo(10, 6);
    expect(lens[1]).toBeCloseTo(40, 6);
  });

  it('elevations show door and window openings inside the massing', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 20, 1, 10), 'WALL');
    addSolid(makeBox(8, 0.4, 4, 4, 0.2, 3), 'WINDOW');
    const r = elevationToPlan('S');
    expect(r.openings).toBe(1);
    const open = state.entities.filter(e => e.layer === 'OPENINGS');
    expect(open.length).toBe(1);
    /* The opening ring is the window face: 4 wide, sill 4 to head 7. */
    const ys = open[0].pts.map(p => p[1]);
    const xs = open[0].pts.map(p => p[0]);
    expect(Math.min(...ys)).toBeCloseTo(4, 6);
    expect(Math.max(...ys)).toBeCloseTo(7, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6);
    /* The massing outline is untouched by the opening. */
    expect(r.area).toBeCloseTo(200, 1);
    /* Title and dims arrive with the view: overall 20 wide and 10 tall,
     * and the window's own height, sill 4 to head 7. */
    expect(r.made.find(e => e.type === 'text').content).toBe('SOUTH ELEVATION');
    const lens = r.made.filter(e => e.type === 'dim')
      .map(d => Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).sort((a, b) => a - b);
    expect(lens.length).toBe(3);
    expect(lens[0]).toBeCloseTo(3, 6);
    expect(lens[1]).toBeCloseTo(10, 6);
    expect(lens[2]).toBeCloseTo(20, 6);
  });

  it('hidden line: only openings facing the viewer are drawn', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    const { mergeMeshes } = await import('../src/core/mesh.js');
    addSolid(makeBox(0, 0, 0, 20, 0.5, 10), 'WALL');
    addSolid(makeBox(0, 24, 0, 20, 0.5, 10), 'WALL-N');
    /* One merged WINDOW bucket holding a near window (4 wide) and a far
     * one (3 wide), the way the plan-to-solids bridge builds it. */
    addSolid(mergeMeshes([
      makeBox(8, 0.15, 4, 4, 0.2, 3),
      makeBox(2, 24.15, 3, 3, 0.2, 3)
    ]), 'WINDOW');
    /* An interior door, hidden from every compass side. */
    addSolid(makeBox(3, 11.8, 0, 3, 0.4, 7), 'DOOR');
    const s = elevationToPlan('S');
    expect(s.openings).toBe(1);
    const sOpen = state.entities.filter(e => e.layer === 'OPENINGS');
    const xs = sOpen[0].pts.map(p => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6);
    const n = elevationToPlan('N');
    expect(n.openings).toBe(1);
    const nOpen = state.entities.filter(e => e.layer === 'OPENINGS').slice(sOpen.length);
    const nxs = nOpen[0].pts.map(p => p[0]);
    expect(Math.max(...nxs) - Math.min(...nxs)).toBeCloseTo(3, 6);
  });

  it('massing hidden line: the parapet of a lower front mass draws, and only from the front', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    /* A lower mass in front of a taller one. From the south the front
     * mass's roof line at 8 ft crosses the taller silhouette; from the
     * north it is entirely hidden. */
    addSolid(makeBox(0, 0, 0, 20, 10, 8), 'FRONT');
    addSolid(makeBox(0, 10, 0, 20, 10, 14), 'BACK');
    const s = elevationToPlan('S');
    expect(s.edges).toBe(1);
    const line = s.made.find(e => e.type === 'line');
    expect(line.y1).toBeCloseTo(8, 6);
    expect(line.y2).toBeCloseTo(8, 6);
    /* The clip trims a hair where the line meets the outline. */
    expect(Math.abs(line.x2 - line.x1)).toBeCloseTo(20, 0);
    const n = elevationToPlan('N');
    expect(n.edges).toBe(0);
  });

  it('massing hidden line: flush solids get no seam, a setback corner gets its line', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 10, 10, 8), 'A');
    addSolid(makeBox(10, 0, 0, 10, 10, 8), 'B');
    expect(elevationToPlan('S').edges).toBe(0);
    reset();
    addSolid(makeBox(0, 0, 0, 10, 10, 8), 'A');
    addSolid(makeBox(10, 4, 0, 10, 6, 8), 'B');
    const r = elevationToPlan('S');
    expect(r.edges).toBe(1);
    const line = r.made.find(e => e.type === 'line');
    expect(line.x1).toBeCloseTo(line.x2, 6);
    expect(Math.abs(line.y2 - line.y1)).toBeCloseTo(8, 0);
  });

  it('hidden line reads east and west depths correctly too', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(makeBox(0, 0, 0, 0.5, 20, 10), 'WALL');
    addSolid(makeBox(24, 0, 0, 0.5, 20, 10), 'WALL-E');
    addSolid(makeBox(0.15, 8, 4, 0.2, 4, 3), 'WINDOW');
    expect(elevationToPlan('W').openings).toBe(1);
    expect(elevationToPlan('E').openings).toBe(0);
  });

  it('a section sees beyond the cut: the tower behind rises above the cut mass', async () => {
    addSolid(makeBox(0, 0, 0, 40, 30, 10), 'M');
    addSolid(makeBox(10, 35, 0, 8, 8, 20), 'TOWER');
    const r = sliceSolidToPlan('M', 15, undefined, 'y');
    expect(r.beyond).toBe(3);
    const lines = r.made.filter(e => e.type === 'line');
    const horiz = lines.filter(l => Math.abs(l.y1 - l.y2) < 1e-6);
    const verts = lines.filter(l => Math.abs(l.x1 - l.x2) < 1e-6);
    /* The tower's roof line, exactly its 8 ft width at 20 ft. */
    expect(horiz.length).toBe(1);
    expect(horiz[0].y1).toBeCloseTo(20, 6);
    expect(Math.abs(horiz[0].x2 - horiz[0].x1)).toBeCloseTo(8, 6);
    /* Its two verticals, visible only where the tower rises above the
     * 10 ft mass in front of it. */
    expect(verts.length).toBe(2);
    verts.forEach(l => {
      expect(Math.min(l.y1, l.y2)).toBeCloseTo(10, 0);
      expect(Math.max(l.y1, l.y2)).toBeCloseTo(20, 6);
    });
  });

  it('elevationToPlan draws all four compass outlines', async () => {
    const { elevationToPlan } = await import('../src/core/model3d.js');
    addSolid(tower(), 'TOWER');
    for (const d of ['N', 'S', 'E', 'W']){
      const r = elevationToPlan(d);
      expect(r.made.length).toBeGreaterThan(0);
      expect(r.area).toBeGreaterThan(500);
    }
    expect(state.entities.filter(e => e.layer === 'SECTION').length).toBeGreaterThanOrEqual(4);
  });
});

describe('the plan becomes solids and the solids reach DXF', () => {
  beforeEach(reset);

  it('planToSolids turns drawn walls into a named, cuttable solid', async () => {
    const { planToSolids, solidByName: byName2 } = await import('../src/core/model3d.js');
    /* a simple room of wall entities the extruder understands */
    state.entities.push({ id: state.idSeq++, type: 'poly', layer: 'WALLS', closed: true, pts: [[0, 0], [20, 0], [20, 15], [0, 15]] });
    state.storyHeight = 9;
    state.heightAssumed = false;
    const made = planToSolids();
    expect(made.length).toBeGreaterThan(0);
    const total = made.reduce((v, r) => v + Math.abs(meshVolume(r.mesh)), 0);
    expect(total).toBeGreaterThan(0);
    expect(byName2(made[0].name)).toBeTruthy();
  });

  it('solidsToFaceEntities emits 3DFACE records the DXF writer understands', async () => {
    const { solidsToFaceEntities } = await import('../src/core/model3d.js');
    const { buildDXF } = await import('../src/io/dxf.js');
    addSolid(makeBox(0, 0, 0, 4, 4, 4), 'CUBE');
    const faces = solidsToFaceEntities(state.solids);
    expect(faces.length).toBe(12);
    const dxf = buildDXF(faces, [{ name: 'SECTION', aci: 4, visible: true }], { ver: 'R2000' });
    expect((dxf.match(/\n3DFACE\r?\n/g) || []).length).toBe(12);
  });
});

describe('the new commands are registered', () => {
  it('ELEV and MODEL reach the command line, SLICE takes an axis', () => {
    expect(lookupCommand('ELEV').action).toBe('elev');
    expect(lookupCommand('ELEVATION').action).toBe('elev');
    expect(lookupCommand('MODEL').action).toBe('modelplan');
    expect(lookupCommand('PLAN2SOLID').action).toBe('modelplan');
  });
});

describe('sample bracket', () => {
  beforeEach(reset);
  it('is a closed L with a hole', async () => {
    const { sampleBracket } = await import('../src/core/model3d.js');
    const rec = sampleBracket();
    expect(rec.name).toBe('BRACKET');
    expect(isWatertight(rec.mesh)).toBe(true);
    const v = Math.abs(meshVolume(rec.mesh));
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(3);
  });
});
