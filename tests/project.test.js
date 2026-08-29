import { describe, it, expect } from 'vitest';
import { serializeProject, validateProject, applyProject } from '../src/io/project.js';

function freshState(){
  return {
    projectName: 'My Cabin',
    layers: [{ name: 'WALLS', color: '#fff', aci: 2, visible: true }],
    currentLayer: 'WALLS',
    entities: [{ id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1, y2: 1 }],
    userBlocks: [{ name: 'island', frags: [{ type: 'circle', layer: 'FIXTURES', cx: 0, cy: 0, r: 1 }] }],
    idSeq: 2,
    gSeq: 1,
    selIds: []
  };
}

describe('project round trip', () => {
  it('serialize → validate → apply preserves the document', () => {
    const s = freshState();
    const p = validateProject(JSON.parse(serializeProject(s)));
    const target = { ...freshState(), projectName: '', entities: [], layers: [], userBlocks: [] };
    applyProject(target, p);
    expect(target.projectName).toBe('My Cabin');
    expect(target.entities.length).toBe(1);
    expect(target.userBlocks[0].name).toBe('island');
    expect(target.idSeq).toBe(2);
  });
  it('opens legacy v3 files without a name', () => {
    const legacy = { app: 'sovereign-draft', v: 3, idSeq: 5, gSeq: 2, layers: [{ name: 'WALLS' }], entities: [] };
    const p = validateProject(legacy);
    expect(p.name).toBe('Untitled');
    expect(p.idSeq).toBe(5);
    expect(p.userBlocks).toEqual([]);
  });
  it('rejects non-project JSON', () => {
    expect(() => validateProject({ foo: 1 })).toThrow(/Not a Sovereign Draft project/);
    expect(() => validateProject(null)).toThrow();
    expect(() => validateProject({ entities: [], layers: 'nope' })).toThrow();
  });
  it('fixes a missing currentLayer on apply', () => {
    const target = { ...freshState(), currentLayer: 'GONE' };
    applyProject(target, validateProject(JSON.parse(serializeProject(freshState()))));
    expect(target.currentLayer).toBe('WALLS');
  });
});
