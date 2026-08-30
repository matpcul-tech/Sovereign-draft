import { describe, it, expect } from 'vitest';
import { extractResponse, schemaToEntities, realizeResponse } from '../src/ai/draft.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

describe('constrained AI schema', () => {
  it('extracts a walls schema', () => {
    const { schema, legacy } = extractResponse('{"walls":[{"a":[0,0,24,0],"th":0.5}],"rooms":[],"dims":[]}');
    expect(legacy).toBe(false);
    expect(schema.walls.length).toBe(1);
  });
  it('schemaToEntities builds wall groups, hatches and dims', () => {
    const ents = schemaToEntities({
      walls: [
        { a: [0, 0, 24, 0], th: 0.5 },
        { a: [24, 0, 24, 16], th: 0.5 },
        { a: [24, 16, 0, 16], th: 0.5 },
        { a: [0, 16, 0, 0], th: 0.5 }
      ],
      openings: [{ kind: 'door', wall: 0, t: 0.4, w: 3, swing: 'L' }],
      rooms: [{ name: 'KITCHEN', pts: [[1, 1], [10, 1], [10, 10], [1, 10]] }],
      dims: [{ a: [0, 0, 24, 0] }],
      fixtures: [{ kind: 'Sink', x: 4, y: 4, rot: 0 }]
    }, idLayer);
    expect(ents.filter(e => e.kind === 'wall').length).toBeGreaterThan(4);
    expect(ents.some(e => e.type === 'hatch')).toBe(true);
    expect(ents.some(e => e.type === 'dim')).toBe(true);
    /* The room name now rides on a room entity; the geometry pass emits no
     * loose text, so the name is never stamped twice. */
    const kitchen = ents.find(e => e.type === 'room' && e.name === 'KITCHEN');
    expect(kitchen).toBeTruthy();
    expect(ents.some(e => e.type === 'text')).toBe(false);
    expect(ents.some(e => e.type === 'insert' && e.def === 'door')).toBe(true);
    expect(ents.some(e => e.type === 'insert' && e.def === 'sym:Sink')).toBe(true);
  });
  it('realizeResponse still accepts legacy raw items', () => {
    const ents = realizeResponse('{"e":[{"t":"l","ly":"WALLS","a":[0,0,10,0]}]}', idLayer);
    expect(ents[0].type).toBe('line');
  });
  it('snaps coordinates to a 6" grid', () => {
    const ents = schemaToEntities({
      walls: [{ a: [0.12, 0.12, 10.12, 0.12], th: 0.5 }]
    }, idLayer);
    const a = ents.find(e => e.role === 'a');
    expect(a.x1 % 0.5).toBeCloseTo(0);
  });
});
