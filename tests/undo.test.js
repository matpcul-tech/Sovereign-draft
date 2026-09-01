import { describe, it, expect, beforeEach } from 'vitest';
import {
  state, defaultLayers, pushUndo, undoScope, doUndo, doRedo,
  addEntity, deleteEntities, afterChange, UNDO_LIMIT
} from '../src/core/state.js';
import { translateEnt } from '../src/core/entities.js';
import { solveConstraints, makeConstraint } from '../src/core/constrain.js';
import { defaultTextStyles } from '../src/core/textstyle.js';

/* The whole document as one comparable string. selIds is cleared by undo and
 * redo, so it is compared separately where it matters. */
const canon = () => JSON.stringify({
  e: state.entities,
  c: state.constraints,
  idSeq: state.idSeq,
  gSeq: state.gSeq
});

function reset(){
  state.layers = defaultLayers();
  state.entities = [];
  state.constraints = [];
  state.selIds = [];
  state.undoStack = [];
  state.redoStack = [];
  state.idSeq = 1;
  state.gSeq = 1;
  state.autoRooms = false;
  state.textStyles = defaultTextStyles();
}

const L = (x1, y1, x2, y2, extra) => addEntity(Object.assign({ type: 'line', layer: 'WALLS', x1, y1, x2, y2 }, extra || {}));

describe('a sparse record restores exactly what a full snapshot would', () => {
  beforeEach(reset);

  it('undoes a move of some entities among many untouched ones', () => {
    for (let i = 0; i < 30; i++) L(i, 0, i, 5);
    const moved = state.entities.slice(10, 13);
    const before = canon();
    pushUndo(undoScope(moved.map(e => e.id)));
    moved.forEach(e => translateEnt(e, 100, -7));
    afterChange();
    expect(canon()).not.toBe(before);
    doUndo();
    expect(canon()).toBe(before);
  });

  it('undoes a deletion, restoring draw order exactly', () => {
    for (let i = 0; i < 12; i++) L(i, 0, i, 5);
    /* Delete from the middle so reinsertion order actually matters. */
    const victims = [state.entities[3], state.entities[7], state.entities[8]];
    const before = canon();
    pushUndo(undoScope(victims.map(e => e.id)));
    deleteEntities(victims.map(e => e.id));
    afterChange();
    doUndo();
    expect(canon()).toBe(before);
  });

  it('undoes a creation through the id counter alone', () => {
    L(0, 0, 5, 0);
    const before = canon();
    pushUndo(undoScope([]));
    L(1, 1, 2, 2);
    L(3, 3, 4, 4);
    afterChange();
    doUndo();
    expect(canon()).toBe(before);
  });

  it('redo replays a sparse undo exactly', () => {
    for (let i = 0; i < 10; i++) L(i, 0, i, 5);
    const before = canon();
    const ms = [state.entities[2], state.entities[5]];
    pushUndo(undoScope(ms.map(e => e.id)));
    ms.forEach(e => translateEnt(e, 9, 9));
    L(50, 50, 60, 60);
    afterChange();
    const after = canon();
    doUndo();
    expect(canon()).toBe(before);
    doRedo();
    expect(canon()).toBe(after);
    doUndo();
    expect(canon()).toBe(before);
  });

  it('an operation that both deletes and creates round trips', () => {
    /* The shape of a host wall regeneration: members die, replacements are
     * born with fresh ids in the same group. */
    const g = 'W' + state.gSeq++;
    for (let i = 0; i < 4; i++) L(i, 0, i + 1, 0, { g });
    L(100, 100, 101, 101);
    const before = canon();
    const members = state.entities.filter(e => e.g === g);
    pushUndo(undoScope(members.map(e => e.id)));
    state.entities = state.entities.filter(e => e.g !== g);
    for (let i = 0; i < 5; i++) L(i, 2, i + 1, 2, { g });
    afterChange();
    const after = canon();
    doUndo();
    expect(canon()).toBe(before);
    doRedo();
    expect(canon()).toBe(after);
  });
});

describe('undoScope finds the blast radius', () => {
  beforeEach(reset);

  it('pulls in the whole group of a selected member', () => {
    const a = L(0, 0, 1, 0, { g: 'G1' });
    L(1, 0, 2, 0, { g: 'G1' });
    L(50, 50, 51, 51);
    const scope = undoScope([a.id]);
    expect(scope.length).toBe(2);
  });

  it('pulls in the host wall of a selected door', () => {
    L(0, 0, 4, 0, { g: 'W9' });
    L(4, 0, 8, 0, { g: 'W9' });
    const door = addEntity({ type: 'insert', layer: 'DOORS', def: 'door', x: 2, y: 0, host: 'W9' });
    const scope = undoScope([door.id]);
    expect(scope.length).toBe(3);
  });

  it('pulls in dims associated with the moved entity, and unbound dims', () => {
    const wall = L(0, 0, 10, 0);
    const boundDim = addEntity({ type: 'dim', layer: 'DIMS', x1: 0, y1: 0, x2: 10, y2: 0, off: -2, assoc: [{ id: wall.id, end: 1 }, { id: wall.id, end: 2 }] });
    const freeDim = addEntity({ type: 'dim', layer: 'DIMS', x1: 40, y1: 40, x2: 50, y2: 40, off: -2, assoc: [{ id: 999, end: 1 }, { id: 999, end: 2 }] });
    const unbound = addEntity({ type: 'dim', layer: 'DIMS', x1: 60, y1: 60, x2: 70, y2: 60, off: -2 });
    const scope = new Set(undoScope([wall.id]));
    expect(scope.has(wall.id)).toBe(true);
    expect(scope.has(boundDim.id)).toBe(true);
    /* A dim bound to something else does not ride along... */
    expect(scope.has(freeDim.id)).toBe(false);
    /* ...but one with no binding yet can gain one, so it must. */
    expect(scope.has(unbound.id)).toBe(true);
  });

  it('pulls in every constrained entity once any constraint exists', () => {
    const a = L(0, 0, 10, 0);
    const b = L(0, 5, 10, 5);
    const c = L(50, 50, 60, 50);
    state.constraints.push(makeConstraint('parallel', { a: b.id, b: c.id }));
    const scope = new Set(undoScope([a.id]));
    expect(scope.has(b.id)).toBe(true);
    expect(scope.has(c.id)).toBe(true);
  });

  it('refuses to guess when auto rooms are on', () => {
    state.autoRooms = true;
    L(0, 0, 1, 1);
    expect(undoScope([state.entities[0].id])).toBe(null);
    /* And a null scope is a full snapshot, which is always safe. */
    pushUndo(undoScope([state.entities[0].id]));
    expect(state.undoStack[0].sparse).toBeUndefined();
  });
});

describe('a solve after a scoped edit stays undoable', () => {
  beforeEach(reset);

  it('the solver moving a constrained neighbour is inside the record', () => {
    const a = L(0, 0, 10, 0.5);
    const b = L(0, 5, 10, 6.5);
    state.constraints.push(makeConstraint('horizontal', { a: a.id }));
    state.constraints.push(makeConstraint('parallel', { a: a.id, b: b.id }));
    const before = canon();
    /* The user only selected `a`, but solving drags `b` with it. */
    pushUndo(undoScope([a.id]));
    translateEnt(a, 0, 2);
    solveConstraints(state.entities, state.constraints);
    afterChange();
    expect(canon()).not.toBe(before);
    doUndo();
    expect(canon()).toBe(before);
  });
});

describe('randomised operations against a full snapshot oracle', () => {
  beforeEach(reset);

  it('600 random ops with interleaved undo and redo never diverge', () => {
    let seed = 424242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    /* The oracle mirrors the undo semantics with full document strings, so
     * it cannot share a bug with the sparse implementation. */
    const oracleUndo = [], oracleRedo = [];

    const opCreate = () => {
      pushUndo(undoScope([]));
      oracleUndo.push(canon()); oracleRedo.length = 0;
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++){
        if (rnd() < 0.7) L(rnd() * 100, rnd() * 100, rnd() * 100, rnd() * 100, rnd() < 0.2 ? { g: 'G' + Math.floor(rnd() * 5) } : {});
        else addEntity({ type: 'circle', layer: 'WALLS', cx: rnd() * 100, cy: rnd() * 100, r: 1 + rnd() * 4 });
      }
      afterChange();
    };
    const opMove = () => {
      if (!state.entities.length) return;
      const seedIds = [pick(state.entities).id];
      const scope = undoScope(seedIds);
      pushUndo(scope);
      oracleUndo.push(canon()); oracleRedo.length = 0;
      const idSet = new Set(scope);
      state.entities.forEach(e => { if (idSet.has(e.id)) translateEnt(e, rnd() * 10 - 5, rnd() * 10 - 5); });
      afterChange();
    };
    const opDelete = () => {
      if (state.entities.length < 3) return;
      const victim = pick(state.entities);
      const scope = undoScope([victim.id]);
      pushUndo(scope);
      oracleUndo.push(canon()); oracleRedo.length = 0;
      deleteEntities([victim.id]);
      afterChange();
    };
    const opRegen = () => {
      /* delete-and-recreate, the host wall shape */
      const g = 'G' + Math.floor(rnd() * 5);
      const members = state.entities.filter(e => e.g === g);
      if (!members.length) return;
      pushUndo(undoScope(members.map(e => e.id)));
      oracleUndo.push(canon()); oracleRedo.length = 0;
      state.entities = state.entities.filter(e => e.g !== g);
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) L(rnd() * 100, rnd() * 100, rnd() * 100, rnd() * 100, { g });
      afterChange();
    };
    const opUndo = () => {
      if (!state.undoStack.length){ expect(doUndo()).toBe(false); return; }
      oracleRedo.push(canon());
      const want = oracleUndo.pop();
      expect(doUndo()).toBe(true);
      expect(canon()).toBe(want);
    };
    const opRedo = () => {
      if (!state.redoStack.length){ expect(doRedo()).toBe(false); return; }
      oracleUndo.push(canon());
      const want = oracleRedo.pop();
      expect(doRedo()).toBe(true);
      expect(canon()).toBe(want);
    };

    /* Mirror the stack limit so long runs stay in step. */
    const trim = () => { while (oracleUndo.length > UNDO_LIMIT) oracleUndo.shift(); };

    const ops = [opCreate, opCreate, opMove, opMove, opMove, opDelete, opRegen, opUndo, opUndo, opRedo];
    for (let i = 0; i < 600; i++){
      pick(ops)();
      trim();
      expect(state.undoStack.length).toBe(oracleUndo.length);
      expect(state.redoStack.length).toBe(oracleRedo.length);
    }
  });
});

describe('solids are part of the document undo', () => {
  beforeEach(reset);

  it('undoing an extrusion removes the mesh, redo brings it back', () => {
    state.solids = [];
    L(0, 0, 10, 0);
    pushUndo(undoScope([]));
    state.solids = state.solids.concat([{ verts: [[0, 0, 0]], faces: [] }]);
    afterChange();
    expect(state.solids.length).toBe(1);
    doUndo();
    expect(state.solids.length).toBe(0);
    doRedo();
    expect(state.solids.length).toBe(1);
  });

  it('clearing solids is undoable through a full record too', () => {
    state.solids = [{ verts: [], faces: [] }, { verts: [], faces: [] }];
    pushUndo();
    state.solids = [];
    afterChange();
    doUndo();
    expect(state.solids.length).toBe(2);
  });
});

describe('the point of all this: cost no longer scales with the drawing', () => {
  beforeEach(reset);

  function bigDrawing(n){
    for (let i = 0; i < n; i++){
      const x = (i % 500) * 3, y = Math.floor(i / 500) * 3;
      state.entities.push({ id: state.idSeq++, type: 'line', layer: 'WALLS', x1: x, y1: y, x2: x + 2, y2: y + 2 });
    }
  }

  it('a scoped push at 200,000 entities is millisecond scale', () => {
    bigDrawing(200000);
    const ids = state.entities.slice(1000, 1010).map(e => e.id);
    const t = Date.now();
    for (let k = 0; k < 100; k++){
      pushUndo(undoScope(ids));
      state.undoStack.pop();
    }
    const ms = Date.now() - t;
    /* Measured at 10.4 ms per push: still one light walk of the drawing,
     * because the blast radius and the copies each need a pass, but no deep
     * copy of anything outside the scope. The full snapshot this replaces
     * measured 522 ms. The bound is three times the measurement, for slow
     * runners, and still seventeenfold under the old cost per single push. */
    expect(ms).toBeLessThan(3000);
  });

  it('a sparse record holds only the scope, not the drawing', () => {
    bigDrawing(5000);
    const ids = state.entities.slice(0, 7).map(e => e.id);
    pushUndo(undoScope(ids));
    const rec = state.undoStack[state.undoStack.length - 1];
    expect(rec.sparse).toBe(true);
    expect(rec.copies.length).toBe(7);
  });

  it('undo of a scoped edit is also millisecond scale', () => {
    bigDrawing(100000);
    const ids = state.entities.slice(50, 60).map(e => e.id);
    pushUndo(undoScope(ids));
    const idSet = new Set(ids);
    state.entities.forEach(e => { if (idSet.has(e.id)) translateEnt(e, 5, 5); });
    const t = Date.now();
    doUndo();
    const ms = Date.now() - t;
    /* afterChange walks the drawing once, which dominates; the restore
     * itself is the filter plus ten splices. */
    expect(ms).toBeLessThan(400);
    expect(state.entities[50].x1).toBeCloseTo((50 % 500) * 3, 9);
  });
});
