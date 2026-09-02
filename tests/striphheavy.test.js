import { describe, it, expect } from 'vitest';
import { serializeProject } from '../src/io/project.js';
import { state, defaultLayers } from '../src/core/state.js';

function proj(entities){
  state.entities = entities;
  state.layers = defaultLayers();
  state.solids = [];
  state.idSeq = entities.length + 1;
  return state;
}

const IMG = (len, x) => ({
  type: 'image', layer: 'RENDER', x: x || 0, y: 0, w: 40, h: 22, rot: 0,
  src: 'data:image/jpeg;base64,' + 'A'.repeat(len)
});

describe('compact serialization carries what it can and says what it cannot', () => {
  it('the file save keeps every image whatever its size', () => {
    const p = JSON.parse(serializeProject(proj([IMG(400000)]), true));
    expect(p.entities[0].src.length).toBeGreaterThan(400000);
    expect(p.entities[0].srcOmitted).toBeUndefined();
  });

  it('the compact form keeps images under the cap', () => {
    const p = JSON.parse(serializeProject(proj([IMG(200000)]), false));
    expect(p.entities[0].src.length).toBeGreaterThan(200000);
    expect(p.entities[0].srcOmitted).toBeUndefined();
  });

  it('an image past the per-image cap is stripped and marked', () => {
    const p = JSON.parse(serializeProject(proj([IMG(400000)]), false));
    expect(p.entities[0].src).toBeUndefined();
    expect(p.entities[0].srcOmitted).toBe(true);
    /* The frame geometry survives so the drawing still shows where it was. */
    expect(p.entities[0].w).toBe(40);
  });

  it('past the total budget the largest images go first', () => {
    /* Twelve at 240k chars total 2.88M, over the 2.5M budget. The two
     * largest go; the ten smaller survive. */
    const ents = [];
    for (let i = 0; i < 10; i++) ents.push(IMG(230000, i * 50));
    ents.push(IMG(290000, 600));
    ents.push(IMG(295000, 650));
    const p = JSON.parse(serializeProject(proj(ents), false));
    const kept = p.entities.filter(e => e.src);
    const dropped = p.entities.filter(e => e.srcOmitted);
    expect(dropped.length).toBe(2);
    expect(kept.length).toBe(10);
    /* The dropped ones are exactly the two largest. */
    dropped.forEach(e => expect(e.x).toBeGreaterThanOrEqual(600));
  });

  it('non-image entities pass through untouched', () => {
    const p = JSON.parse(serializeProject(proj([
      { type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 }, IMG(400000)
    ]), false));
    expect(p.entities[0].x2).toBe(24);
    expect(p.entities[0].srcOmitted).toBeUndefined();
  });
});
