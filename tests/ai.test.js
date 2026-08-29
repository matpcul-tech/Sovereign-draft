import { describe, it, expect } from 'vitest';
import { extractItems, itemsToEntities, serializeForAI } from '../src/ai/draft.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

describe('extractItems', () => {
  it('parses clean JSON', () => {
    const items = extractItems('{"e":[{"t":"l","ly":"WALLS","a":[0,0,1,1]}]}');
    expect(items.length).toBe(1);
  });
  it('strips code fences and surrounding prose', () => {
    const items = extractItems('Here you go:\n```json\n{"e":[{"t":"c","ly":"WALLS","a":[0,0,2]}]}\n```\nDone.');
    expect(items[0].t).toBe('c');
  });
  it('throws on responses with no JSON', () => {
    expect(() => extractItems('I cannot do that')).toThrow(/No JSON/);
  });
  it('throws on empty drawings', () => {
    expect(() => extractItems('{"e":[]}')).toThrow(/Empty drawing/);
  });
});

describe('itemsToEntities', () => {
  it('converts every item type', () => {
    const out = itemsToEntities([
      { t: 'l', ly: 'WALLS', a: [0, 0, 10, 0] },
      { t: 'c', ly: 'FIXTURES', a: [1, 1, 0.5] },
      { t: 'a', ly: 'DOORS', a: [0, 0, 3, 0, 90] },
      { t: 'p', ly: 'WALLS', a: [[0, 0], [5, 0], [5, 5]], cl: 1 },
      { t: 'x', a: [2, 2, 1.2], s: 'KITCHEN' },
      { t: 'd', a: [0, 0, 10, 0] }
    ], idLayer);
    expect(out.map(e => e.type)).toEqual(['line', 'circle', 'arc', 'poly', 'text', 'dim']);
    expect(out[3].closed).toBe(true);
    expect(out[4].content).toBe('KITCHEN');
  });
  it('skips malformed items and clamps sizes', () => {
    const out = itemsToEntities([
      { t: 'l', a: [0, 0] },              // too few coords
      { t: 'zz', a: [1] },                // unknown type
      null,
      { t: 'x', a: [0, 0, 99], s: 'BIG' } // size clamped to 4
    ], idLayer);
    expect(out.length).toBe(1);
    expect(out[0].size).toBe(4);
  });
  it('flips dimensions outward from the drawing body', () => {
    const out = itemsToEntities([
      { t: 'p', ly: 'WALLS', a: [[0, 0], [10, 0], [10, 10], [0, 10]], cl: 1 },
      { t: 'd', a: [0, 0, 10, 0] } // bottom edge; offset should point down (away from center)
    ], idLayer);
    const dim = out.find(e => e.type === 'dim');
    expect(dim.off).toBeLessThan(0);
  });
  it('throws when nothing is drawable', () => {
    expect(() => itemsToEntities([{ t: 'l', a: [0] }], idLayer)).toThrow(/Nothing drawable/);
  });
});

describe('serializeForAI', () => {
  it('writes one compact row per entity', () => {
    const s = serializeForAI([
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 10.123456, y2: 0 },
      { type: 'text', layer: 'TEXT', x: 1, y: 2, size: 1, content: 'BATH' }
    ]);
    const rows = s.split('\n');
    expect(rows.length).toBe(2);
    expect(rows[0]).toBe('l WALLS 0,0 10.12,0');
    expect(rows[1]).toContain('"BATH"');
  });
  it('truncates very large drawings', () => {
    const ents = Array.from({ length: 500 }, (_, i) => ({ type: 'line', layer: 'WALLS', x1: i, y1: 0, x2: i + 1, y2: 1 }));
    const s = serializeForAI(ents);
    expect(s.length).toBeLessThan(7100);
    expect(s).toContain('(truncated)');
  });
});
