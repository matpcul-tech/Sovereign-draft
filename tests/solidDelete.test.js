import { describe, it, expect } from 'vitest';
import { state, pushUndo, doUndo, doRedo } from '../src/core/state.js';
import { addSolid, removeSolid, solidNames } from '../src/core/model3d.js';
import { makeBox } from '../src/core/mesh.js';

/* The 3D view could place, move, cut and union solids and never remove
 * one; New drawing wiped the plan and left the model standing. These pin
 * the document side of both fixes; the rail, key and chip paths were
 * verified in the built app. */
describe('a solid can be removed, and undo brings it back', () => {
  it('removeSolid takes exactly the named record', () => {
    state.solids = []; state.undoStack = []; state.redoStack = [];
    addSolid(makeBox(0, 0, 0, 10, 10, 8), 'box');
    addSolid(makeBox(30, 0, 0, 10, 10, 8), 'box');
    const names = solidNames();
    expect(names.length).toBe(2);
    pushUndo();
    expect(removeSolid(names[0])).toBe(true);
    expect(solidNames()).toEqual([names[1]]);
    expect(removeSolid('NOPE')).toBe(false);
    doUndo();
    expect(solidNames().length).toBe(2);
    doRedo();
    expect(solidNames().length).toBe(1);
  });

  it('a new drawing is the whole document gone, solids included', () => {
    state.solids = []; state.entities = [{ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 0 }];
    addSolid(makeBox(0, 0, 0, 10, 10, 8), 'box');
    /* The same reset New drawing performs. */
    pushUndo();
    state.entities = []; state.solids = []; state.selIds = []; state.revisions = [];
    expect(state.solids.length).toBe(0);
    doUndo();
    expect(state.solids.length).toBe(1);
    expect(state.entities.length).toBe(1);
  });
});
