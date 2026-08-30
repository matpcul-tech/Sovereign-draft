import { describe, it, expect, beforeEach } from 'vitest';
import { state, defaultLayers, pushUndo, doUndo, doRedo, ensureLayer, addEntity, selMembers, replaceEntity, layerByName, UNDO_LIMIT } from '../src/core/state.js';
import { applyProps } from '../src/actions.js';

beforeEach(() => {
  state.layers = defaultLayers();
  state.currentLayer = 'WALLS';
  state.entities = [];
  state.selIds = [];
  state.undoStack = [];
  state.redoStack = [];
  state.idSeq = 1;
  state.gSeq = 1;
  state.currentLt = 'CONTINUOUS';
  state.currentLw = 0;
});

describe('undo/redo', () => {
  it('restores entities', () => {
    pushUndo();
    addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(state.entities.length).toBe(1);
    doUndo();
    expect(state.entities.length).toBe(0);
    doRedo();
    expect(state.entities.length).toBe(1);
  });
  it('restores layers too (layer created by an undone import disappears)', () => {
    pushUndo();
    ensureLayer('SITE');
    expect(layerByName('SITE')).toBeTruthy();
    doUndo();
    expect(layerByName('SITE')).toBeNull();
  });
  it('caps the undo stack', () => {
    for (let i = 0; i < UNDO_LIMIT + 10; i++) pushUndo();
    expect(state.undoStack.length).toBe(UNDO_LIMIT);
  });
  it('a new edit clears the redo stack', () => {
    pushUndo();
    addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 1 });
    doUndo();
    expect(state.redoStack.length).toBe(1);
    pushUndo();
    expect(state.redoStack.length).toBe(0);
  });
});

describe('layers', () => {
  it('ensureLayer canonicalizes and creates once', () => {
    const before = state.layers.length;
    expect(ensureLayer('walls')).toBe('WALLS');
    expect(state.layers.length).toBe(before);
    expect(ensureLayer('electrical')).toBe('ELECTRICAL');
    expect(state.layers.length).toBe(before + 1);
    ensureLayer('ELECTRICAL');
    expect(state.layers.length).toBe(before + 1);
  });
  it('ensureLayer defaults to WALLS for empty names', () => {
    expect(ensureLayer('')).toBe('WALLS');
    expect(ensureLayer(null)).toBe('WALLS');
  });
});

describe('selection and groups', () => {
  it('selMembers expands a block from a single member', () => {
    const a = addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 0, g: 'g1' });
    addEntity({ type: 'line', layer: 'WALLS', x1: 1, y1: 0, x2: 1, y2: 1, g: 'g1' });
    addEntity({ type: 'line', layer: 'WALLS', x1: 5, y1: 5, x2: 6, y2: 6 });
    state.selIds = [a.id];
    expect(selMembers().length).toBe(2);
  });
  it('replaceEntity swaps in new entities with fresh ids', () => {
    const a = addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10, y2: 0 });
    replaceEntity(a, [
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: 'line', layer: 'WALLS', x1: 6, y1: 0, x2: 10, y2: 0 }
    ]);
    expect(state.entities.length).toBe(2);
    expect(state.entities.every(e => e.id !== a.id)).toBe(true);
    doUndo();
    expect(state.entities.length).toBe(1);
    expect(state.entities[0].x2).toBe(10);
  });
});

describe('current style and applyProps', () => {
  it('addEntity inherits current linetype and the CENTER layer linetype', () => {
    state.currentLt = 'DASHED';
    const a = addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 0 });
    expect(a.lt).toBe('DASHED');
    state.currentLt = 'CONTINUOUS';
    const b = addEntity({ type: 'line', layer: 'CENTER', x1: 0, y1: 0, x2: 1, y2: 0 });
    expect(b.lt).toBe('CENTER');
  });
  it('applyProps sets linetype and layer on the selection and is undoable', () => {
    const a = addEntity({ type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 4, y2: 0 });
    state.selIds = [a.id];
    applyProps({ lt: 'HIDDEN', layer: 'DIMS' });
    expect(a.lt).toBe('HIDDEN');
    expect(a.layer).toBe('DIMS');
    doUndo();
    expect(state.entities[0].lt).toBeUndefined();
    expect(state.entities[0].layer).toBe('WALLS');
  });
});
