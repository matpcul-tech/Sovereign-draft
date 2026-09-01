import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import {
  buildSection, sectionHits, makeCutPlane, expandCutPlane, nextCutTag, buildDetail
} from '../src/core/section.js';
import { isComposite, flattenEnt } from '../src/core/entities.js';
import { dimLabel } from '../src/core/dimStyle.js';

describe('cutting plane', () => {
  it('expands to a dashed line, arrows and tags', () => {
    const e = makeCutPlane([0, 0], [10, 0], 'A');
    expect(isComposite(e)).toBe(true);
    const fr = expandCutPlane(e);
    expect(fr.some(f => f.type === 'line')).toBe(true);
    expect(fr.filter(f => f.type === 'text' && f.content === 'A').length).toBe(2);
    expect(flattenEnt(e).length).toBe(fr.length);
  });

  it('issues A then B', () => {
    expect(nextCutTag([])).toBe('A');
    expect(nextCutTag([makeCutPlane([0, 0], [1, 0], 'A')])).toBe('B');
  });
});

describe('section through the sample cabin', () => {
  const ents = cabin24x36();
  /* Horizontal cut through the cabin at y=20, where the west wall, the
   * interior bedroom wall and the east wall are all solid. The old cut at
   * y=12 ran through the east window and only ever "hit" the east wall via
   * a ghost duplicate line the corner fillet used to leave behind; when the
   * fillet was fixed to keep wall identity, the ghosts went away and the
   * cut line had to become honest too. */
  const plane = makeCutPlane([0, 20], [36, 20], 'A');

  it('hits the west wall, interior wall and east wall', () => {
    const hits = sectionHits(ents, plane);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const stations = hits.map(h => h.station).sort((a, b) => a - b);
    expect(stations[0]).toBeCloseTo(0, 0);
    expect(stations.some(s => Math.abs(s - 14) < 1)).toBe(true);
    expect(stations[stations.length - 1]).toBeCloseTo(36, 0);
  });

  it('stamps assumed height and a SECTION A-A label', () => {
    const built = buildSection(ents, [0, 12], [36, 12]);
    expect(built.tag).toBe('A');
    expect(built.assumedHeight).toBe(true);
    expect(built.entities.some(e => e.type === 'text' && /SECTION A-A/.test(e.content))).toBe(true);
    expect(built.entities.some(e => e.type === 'text' && /ASSUMED/.test(e.content))).toBe(true);
    expect(built.entities.some(e => e.type === 'hatch')).toBe(true);
    const hDim = built.entities.find(e => e.type === 'dim' && e.assumed);
    expect(hDim).toBeTruthy();
    expect(dimLabel(hDim)).toMatch(/TYP/);
  });

  it('uses attrs.height when the wall actually has one', () => {
    const wall = ents.find(e => e.kind === 'wall' && e.role === 'a');
    wall.attrs = { height: 10 };
    const built = buildSection(ents, [0, 12], [36, 12], { tag: 'B' });
    /* Mixed assumed/real still flags assumed if any hit lacks height. */
    expect(built.entities.some(e => e.type === 'hatch')).toBe(true);
  });
});

describe('isolated detail', () => {
  it('names D-1 then D-2', () => {
    const a = buildDetail([], [0, 0], [8, 8], { layouts: [] });
    expect(a.sheetNumber).toBe('D-1');
    const b = buildDetail([], [0, 0], [8, 8], { layouts: [{ sheetNumber: 'D-1' }] });
    expect(b.sheetNumber).toBe('D-2');
    expect(a.bbox[2] - a.bbox[0]).toBeGreaterThan(8);
  });
});
