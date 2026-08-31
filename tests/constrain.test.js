import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeConstraint, solveConstraints, validateConstraints, dropDanglingConstraints,
  constraintsOn, describeConstraint, SOLVE_TOL
} from '../src/core/constrain.js';
import { state, defaultLayers, pushUndo, doUndo, addEntity, deleteEntities } from '../src/core/state.js';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';
import { lookupCommand } from '../src/core/command.js';

function L(id, x1, y1, x2, y2){ return { id, type: 'line', layer: 'WALLS', x1, y1, x2, y2 }; }
function C(id, cx, cy, r){ return { id, type: 'circle', layer: 'WALLS', cx, cy, r }; }
function len(e){ return Math.hypot(e.x2 - e.x1, e.y2 - e.y1); }

describe('the solver drives geometry to its rules', () => {
  it('a skewed quad becomes an exact pinned rectangle', () => {
    const ents = [L(1, 0, 0, 9.7, 0.6), L(2, 9.7, 0.6, 10.4, 6.2), L(3, 10.4, 6.2, 0.3, 5.8), L(4, 0.3, 5.8, 0, 0)];
    const ks = [
      makeConstraint('coincident', { a: 1, ea: 2, b: 2, eb: 1 }),
      makeConstraint('coincident', { a: 2, ea: 2, b: 3, eb: 1 }),
      makeConstraint('coincident', { a: 3, ea: 2, b: 4, eb: 1 }),
      makeConstraint('coincident', { a: 4, ea: 2, b: 1, eb: 1 }),
      makeConstraint('horizontal', { a: 1 }), makeConstraint('horizontal', { a: 3 }),
      makeConstraint('vertical', { a: 2 }), makeConstraint('vertical', { a: 4 }),
      makeConstraint('distance', { a: 1, value: 10 }),
      makeConstraint('distance', { a: 2, value: 6 }),
      makeConstraint('fix', { a: 1, ea: 1, value: [0, 0] })
    ];
    const res = solveConstraints(ents, ks);
    expect(res.ok).toBe(true);
    expect(ents[0].x1).toBeCloseTo(0, 5);
    expect(ents[0].y1).toBeCloseTo(0, 5);
    expect(len(ents[0])).toBeCloseTo(10, 5);
    expect(len(ents[1])).toBeCloseTo(6, 5);
    expect(ents[0].y2).toBeCloseTo(ents[0].y1, 5);
    expect(ents[1].x2).toBeCloseTo(ents[1].x1, 5);
  });

  it('the rectangle survives a corner being dragged away', () => {
    const ents = [L(1, 0, 0, 10, 0), L(2, 10, 0, 10, 6), L(3, 10, 6, 0, 6), L(4, 0, 6, 0, 0)];
    const ks = [
      makeConstraint('coincident', { a: 1, ea: 2, b: 2, eb: 1 }),
      makeConstraint('coincident', { a: 2, ea: 2, b: 3, eb: 1 }),
      makeConstraint('coincident', { a: 3, ea: 2, b: 4, eb: 1 }),
      makeConstraint('coincident', { a: 4, ea: 2, b: 1, eb: 1 }),
      makeConstraint('horizontal', { a: 1 }), makeConstraint('horizontal', { a: 3 }),
      makeConstraint('vertical', { a: 2 }), makeConstraint('vertical', { a: 4 }),
      makeConstraint('distance', { a: 1, value: 10 }),
      makeConstraint('distance', { a: 2, value: 6 }),
      makeConstraint('fix', { a: 1, ea: 1, value: [0, 0] })
    ];
    /* Simulate a grip drag: yank the far corner. */
    ents[1].x2 = 14; ents[1].y2 = 9;
    ents[2].x1 = 14; ents[2].y1 = 9;
    const res = solveConstraints(ents, ks);
    expect(res.ok).toBe(true);
    expect(len(ents[0])).toBeCloseTo(10, 4);
    expect(len(ents[1])).toBeCloseTo(6, 4);
  });

  it('parallel and perpendicular hold together', () => {
    const ents = [L(1, 0, 0, 10, 0), L(2, 0, 2, 9, 3.5), L(3, 1, 0, 2.5, 8)];
    const ks = [
      makeConstraint('parallel', { a: 1, b: 2 }),
      makeConstraint('perpendicular', { a: 1, b: 3 }),
      makeConstraint('fix', { a: 1, ea: 1, value: [0, 0] }),
      makeConstraint('horizontal', { a: 1 })
    ];
    const res = solveConstraints(ents, ks);
    expect(res.ok).toBe(true);
    const d1 = [ents[0].x2 - ents[0].x1, ents[0].y2 - ents[0].y1];
    const d2 = [ents[1].x2 - ents[1].x1, ents[1].y2 - ents[1].y1];
    const d3 = [ents[2].x2 - ents[2].x1, ents[2].y2 - ents[2].y1];
    expect(Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (len(ents[0]) * len(ents[1]))).toBeLessThan(1e-4);
    expect(Math.abs(d1[0] * d3[0] + d1[1] * d3[1]) / (len(ents[0]) * len(ents[2]))).toBeLessThan(1e-4);
  });

  it('equal length equalizes', () => {
    const ents = [L(1, 0, 0, 10, 0), L(2, 0, 5, 4, 5)];
    const res = solveConstraints(ents, [
      makeConstraint('equal', { a: 1, b: 2 }),
      makeConstraint('distance', { a: 1, value: 8 })
    ]);
    expect(res.ok).toBe(true);
    expect(len(ents[0])).toBeCloseTo(8, 4);
    expect(len(ents[1])).toBeCloseTo(8, 4);
  });

  it('a radius constraint drives a circle', () => {
    const ents = [C(1, 5, 5, 2)];
    const res = solveConstraints(ents, [makeConstraint('radius', { a: 1, value: 3.25 })]);
    expect(res.ok).toBe(true);
    expect(ents[0].r).toBeCloseTo(3.25, 5);
  });

  it('tangent pulls a line onto a circle', () => {
    const ents = [L(1, -10, 4.7, 10, 5.6), C(2, 0, 0, 5)];
    const res = solveConstraints(ents, [
      makeConstraint('tangent', { a: 1, b: 2 }),
      makeConstraint('radius', { a: 2, value: 5 }),
      makeConstraint('fix', { a: 1, ea: 1, value: [-10, 5] })
    ]);
    expect(res.ok).toBe(true);
    /* Nothing pins the circle's centre, so the solver is free to move it.
     * Tangency is measured from where the centre actually ended up. */
    const [line, circ] = ents;
    const dxl = line.x2 - line.x1, dyl = line.y2 - line.y1;
    const Ln = Math.hypot(dxl, dyl);
    const d = Math.abs((circ.cx - line.x1) * dyl - (circ.cy - line.y1) * dxl) / Ln;
    expect(circ.r).toBeCloseTo(5, 4);
    expect(d).toBeCloseTo(circ.r, 4);
  });

  it('unconstrained entities are never touched', () => {
    const bystander = L(9, 100, 100, 110, 100);
    const before = JSON.stringify(bystander);
    const ents = [L(1, 0, 0, 10, 1), bystander];
    solveConstraints(ents, [makeConstraint('horizontal', { a: 1 })]);
    expect(JSON.stringify(bystander)).toBe(before);
  });

  it('conflicting constraints report failure instead of pretending', () => {
    /* Horizontal and vertical with a driven nonzero length cannot all hold. */
    const ents = [L(1, 0, 0, 10, 0)];
    const res = solveConstraints(ents, [
      makeConstraint('horizontal', { a: 1 }),
      makeConstraint('vertical', { a: 1 }),
      makeConstraint('distance', { a: 1, value: 10 })
    ]);
    expect(res.ok).toBe(false);
    expect(res.residual).toBeGreaterThan(SOLVE_TOL * 100);
  });

  it('no constraints is a clean no-op', () => {
    const res = solveConstraints([L(1, 0, 0, 1, 1)], []);
    expect(res).toEqual({ ok: true, iterations: 0, residual: 0, vars: 0, equations: 0 });
  });
});

describe('constraint housekeeping', () => {
  it('finds and drops constraints on deleted entities', () => {
    const ents = [L(1, 0, 0, 1, 0)];
    const ks = [makeConstraint('horizontal', { a: 1 }), makeConstraint('parallel', { a: 1, b: 99 })];
    expect(validateConstraints(ents, ks).length).toBe(1);
    expect(dropDanglingConstraints(ents, ks).length).toBe(1);
  });
  it('constraintsOn scopes by entity', () => {
    const ks = [makeConstraint('horizontal', { a: 1 }), makeConstraint('parallel', { a: 2, b: 3 })];
    expect(constraintsOn(ks, 1).length).toBe(1);
    expect(constraintsOn(ks, 3).length).toBe(1);
    expect(constraintsOn(ks, 4).length).toBe(0);
  });
  it('describes itself', () => {
    expect(describeConstraint(makeConstraint('distance', { a: 1, value: 10 }))).toBe('distance 10');
    expect(describeConstraint(makeConstraint('parallel', { a: 1, b: 2 }))).toBe('parallel');
  });
});

describe('constraints live in the document', () => {
  beforeEach(() => {
    state.layers = defaultLayers();
    state.entities = [];
    state.constraints = [];
    state.selIds = [];
    state.undoStack = [];
    state.redoStack = [];
    state.idSeq = 1;
  });

  it('survive save, load, save', () => {
    addEntity(L(undefined, 0, 0, 10, 0));
    state.entities[0].id = 1;
    state.constraints = [makeConstraint('horizontal', { a: 1 })];
    const first = serializeProject(state, true);
    const p = validateProject(JSON.parse(first));
    expect(p.constraints.length).toBe(1);
    const target = { ...state };
    applyProject(target, p);
    expect(target.constraints.length).toBe(1);
    expect(serializeProject(target, true)).toBe(first);
  });

  it('a legacy file with no constraints loads with an empty list', () => {
    const raw = JSON.parse(serializeProject(state, true));
    delete raw.constraints;
    expect(validateProject(raw).constraints).toEqual([]);
  });

  it('undo restores the constraint list', () => {
    pushUndo();
    state.constraints.push(makeConstraint('horizontal', { a: 1 }));
    expect(state.constraints.length).toBe(1);
    doUndo();
    expect(state.constraints.length).toBe(0);
  });

  it('deleting an entity drops its constraints', () => {
    const e = addEntity(L(undefined, 0, 0, 5, 0));
    state.constraints.push(makeConstraint('horizontal', { a: e.id }));
    deleteEntities([e.id]);
    expect(state.constraints.length).toBe(0);
  });
});

describe('the command line reaches the solver', () => {
  it('registers every constraint command', () => {
    expect(lookupCommand('HOR').action).toBe('con:horizontal');
    expect(lookupCommand('VERT').action).toBe('con:vertical');
    expect(lookupCommand('PAR').action).toBe('con:parallel');
    expect(lookupCommand('PERP').action).toBe('con:perpendicular');
    expect(lookupCommand('CEQ').action).toBe('con:equal');
    expect(lookupCommand('COIN').action).toBe('con:coincident');
    expect(lookupCommand('CDIST').action).toBe('con:distance');
    expect(lookupCommand('CRAD').action).toBe('con:radius');
    expect(lookupCommand('CTAN').action).toBe('con:tangent');
    expect(lookupCommand('CFIX').action).toBe('con:fix');
    expect(lookupCommand('SOLVE').action).toBe('csolve');
    expect(lookupCommand('CDEL').action).toBe('cdel');
  });
});
