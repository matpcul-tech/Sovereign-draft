import { describe, it, expect } from 'vitest';
import { schemaToEntities, normalizeDrawingType, realizeResponse } from '../src/ai/draft.js';
import { explodeForIO, entBBox } from '../src/core/entities.js';
import { closeChain, closeDimChains, polygonArea, textBox, boxesIntersect, rulesFor } from '../src/core/annotate.js';

const idLayer = n => (n ? String(n).toUpperCase() : 'WALLS');

/* Every text object the drawing finally renders, composites expanded. */
function textObjects(ents){
  const out = [];
  ents.forEach(e => explodeForIO(e).forEach(f => { if (f.type === 'text') out.push(f); }));
  return out;
}
function labeledEntities(ents){
  return ents.filter(e => (e.type === 'room' && e.name) || (e.type === 'callout' && e.content) || e.type === 'text');
}
function dimSpan(d){
  return Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
}

/* A rocket: an object with no building semantics, drawn in side elevation.
 * The schema deliberately also carries walls and openings, because the point
 * is that the code drops them even when the model ignores the prompt. */
const rocket = {
  drawingType: 'elevation',
  walls: [{ a: [0, 0, 8, 0], th: 0.5 }, { a: [8, 0, 8, 60], th: 0.5 }],
  openings: [{ kind: 'door', wall: 0, t: 0.5, w: 3, swing: 'L' },
             { kind: 'window', wall: 1, t: 0.5, w: 3 }],
  rooms: [{ name: 'STAGE ONE', pts: [[0, 0], [8, 0], [8, 30], [0, 30]] }],
  fixtures: [{ kind: 'Sink', x: 4, y: 4, rot: 0 }],
  profiles: [{ pts: [[0, 0], [8, 0], [8, 44], [4, 60], [0, 44]] }],
  centerlines: [{ pts: [[4, -2], [4, 62]] }],
  callouts: [{ anchor: [4, 60], text: 'NOSE CONE' }, { anchor: [0, 8], text: 'FIN' }],
  dims: [
    { a: [-4, 0, -4, 12] }, { a: [-4, 12, -4, 19] }, { a: [-4, 19, -4, 32] },
    { a: [-4, 32, -4, 45] }, { a: [-4, 45, -4, 60] }
  ]
};

const cabin = {
  walls: [
    { a: [0, 0, 24, 0], th: 0.5 }, { a: [24, 0, 24, 36], th: 0.5 },
    { a: [24, 36, 0, 36], th: 0.5 }, { a: [0, 36, 0, 0], th: 0.5 }
  ],
  openings: [{ kind: 'door', wall: 0, t: 0.5, w: 3, swing: 'L' }],
  rooms: [{ name: 'KITCHEN', pts: [[1, 1], [23, 1], [23, 17], [1, 17]] }],
  fixtures: [{ kind: 'Stove', x: 4, y: 4, rot: 0 }],
  dims: [{ a: [0, -2, 24, -2] }]
};

describe('1. rocket, side elevation, 60 feet tall', () => {
  const ents = schemaToEntities(rocket, idLayer);

  it('emits zero door entities', () => {
    expect(ents.filter(e => e.type === 'insert' && e.def === 'door').length).toBe(0);
  });
  it('emits zero window entities', () => {
    expect(ents.filter(e => e.type === 'insert' && e.def === 'window').length).toBe(0);
  });
  it('drops wall geometry entirely', () => {
    expect(ents.filter(e => e.kind === 'wall').length).toBe(0);
  });
  it('emits zero area tags', () => {
    expect(ents.filter(e => e.type === 'room').length).toBe(0);
    expect(textObjects(ents).some(t => /\bSF\b/.test(t.content || ''))).toBe(false);
  });
  it('draws the outline as a profile with a centerline, not as walls', () => {
    expect(ents.some(e => e.type === 'profile')).toBe(true);
    expect(ents.some(e => e.type === 'centerline')).toBe(true);
  });
  it('labels with leader callouts', () => {
    expect(ents.filter(e => e.type === 'callout').length).toBe(2);
  });
  it('dim chain sums to 60', () => {
    const dims = ents.filter(e => e.type === 'dim');
    expect(dims.length).toBe(5);
    const total = dims.reduce((s, d) => s + dimSpan(d), 0);
    expect(total).toBeCloseTo(60, 6);
  });
});

describe('2. 24x36 cabin floor plan (regression guard)', () => {
  const ents = schemaToEntities(cabin, idLayer);

  it('defaults to plan when drawingType is absent', () => {
    expect(normalizeDrawingType(cabin.drawingType)).toBe('plan');
    expect(rulesFor('plan').building).toBe(true);
  });
  it('keeps door swings', () => {
    const door = ents.find(e => e.type === 'insert' && e.def === 'door');
    expect(door).toBeTruthy();
    expect(door.swing).toBe('L');
    expect(door.noSwing).toBeFalsy();
  });
  it('keeps area tags', () => {
    const room = ents.find(e => e.type === 'room');
    expect(room).toBeTruthy();
    expect(room.area).toBeGreaterThan(0);
    expect(textObjects(ents).some(t => /\bSF\b/.test(t.content || ''))).toBe(true);
  });
  it('keeps walls, implied hatch and fixtures', () => {
    expect(ents.filter(e => e.kind === 'wall').length).toBeGreaterThan(4);
    expect(ents.some(e => e.type === 'hatch')).toBe(true);
    expect(ents.some(e => e.type === 'insert' && e.def === 'sym:Stove')).toBe(true);
  });
  it('still accepts legacy raw items', () => {
    const legacy = realizeResponse('{"e":[{"t":"l","ly":"WALLS","a":[0,0,10,0]}]}', idLayer);
    expect(legacy[0].type).toBe('line');
  });
});

describe('3. text object count equals labeled entity count', () => {
  it('holds for the plan', () => {
    const ents = schemaToEntities(cabin, idLayer);
    expect(textObjects(ents).length).toBe(labeledEntities(ents).length);
  });
  it('holds for the elevation', () => {
    const ents = schemaToEntities(rocket, idLayer);
    expect(textObjects(ents).length).toBe(labeledEntities(ents).length);
  });
  it('no entity yields more than one text object', () => {
    const ents = schemaToEntities(cabin, idLayer);
    labeledEntities(ents).forEach(e => {
      const n = explodeForIO(e).filter(f => f.type === 'text').length;
      expect(n).toBe(1);
    });
  });
});

describe('4. no two text bounding boxes intersect', () => {
  function noOverlap(ents){
    const boxes = textObjects(ents).map(t => textBox(t.x, t.y, t.content, t.size));
    for (let i = 0; i < boxes.length; i++){
      for (let j = i + 1; j < boxes.length; j++){
        if (boxesIntersect(boxes[i], boxes[j])) return [i, j];
      }
    }
    return null;
  }
  it('holds for the plan', () => {
    expect(noOverlap(schemaToEntities(cabin, idLayer))).toBeNull();
  });
  it('holds for the elevation', () => {
    expect(noOverlap(schemaToEntities(rocket, idLayer))).toBeNull();
  });
  it('holds when many callouts crowd one anchor', () => {
    const crowded = {
      drawingType: 'part',
      profiles: [{ pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
      callouts: Array.from({ length: 8 }, (_, i) => ({ anchor: [5, 5], text: 'PART ' + i }))
    };
    expect(noOverlap(schemaToEntities(crowded, idLayer))).toBeNull();
  });
});

describe('5. area is the polygon, not the bounding box', () => {
  /* Same 10 x 10 extents, very different enclosed area. */
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const chevron = [[0, 0], [10, 0], [10, 10], [5, 2], [0, 10]];

  it('two shapes with identical bounding boxes report different areas', () => {
    const bbA = [1e9, 1e9, -1e9, -1e9], bbB = [1e9, 1e9, -1e9, -1e9];
    entBBox({ type: 'poly', closed: true, pts: square }, bbA);
    entBBox({ type: 'poly', closed: true, pts: chevron }, bbB);
    expect(bbA).toEqual(bbB);
    expect(polygonArea(square)).toBeCloseTo(100, 6);
    expect(polygonArea(chevron)).not.toBeCloseTo(polygonArea(square), 3);
    expect(polygonArea(chevron)).toBeLessThan(polygonArea(square));
  });
  it('area is reported for plan only', () => {
    expect(rulesFor('plan').areaTags).toBe(true);
    ['elevation', 'section', 'part', 'diagram'].forEach(t => {
      expect(rulesFor(t).areaTags).toBe(false);
    });
  });
});

describe('dimension chain closure', () => {
  it('the overall is the sum of the segments', () => {
    const r = closeChain([12, 7, 13, 13, 15]);
    expect(r.overall).toBeCloseTo(60, 9);
    expect(r.display.reduce((s, v) => s + v, 0)).toBeCloseTo(60, 9);
  });
  it('the last segment absorbs the rounding remainder so the chain closes', () => {
    const odd = [10.01, 10.01, 10.01];
    const r = closeChain(odd);
    expect(r.corrected).toBe(true);
    expect(r.display.reduce((s, v) => s + v, 0)).toBeCloseTo(r.overall, 9);
  });
  it('reconciled segments stay contiguous', () => {
    const segs = [
      { a: [0, 0], b: [12.01, 0] },
      { a: [12.01, 0], b: [19.02, 0] },
      { a: [19.02, 0], b: [32.03, 0] }
    ];
    const out = closeDimChains(segs);
    for (let i = 1; i < out.length; i++){
      expect(out[i].a[0]).toBeCloseTo(out[i - 1].b[0], 9);
    }
    const total = out.reduce((s, d) => s + Math.abs(d.b[0] - d.a[0]), 0);
    expect(total).toBeCloseTo(out[0].chainOverall, 9);
  });
});
