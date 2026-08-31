import { describe, it, expect } from 'vitest';
import { cabin24x36 } from '../src/core/demo.js';
import {
  bodyBBox, parseQty, cleanPartName, collectParts, envelopeDims, partsToTable, specNotes, measureInBox
} from '../src/core/spec.js';
import { dimLabel } from '../src/core/dimStyle.js';

function falcon(){
  const parts = [
    ['NOSE CONE TIP', 220],
    ['PAYLOAD ADAPTER', 205],
    ['GRID FINS x4', 130],
    ['LANDING LEGS x4', 12],
    ['MERLIN 1D ENGINES x9', 4]
  ];
  const ents = [
    { type: 'line', layer: 'PROFILE', x1: 0, y1: 0, x2: 0, y2: 230 },
    { type: 'line', layer: 'PROFILE', x1: 12, y1: 0, x2: 12, y2: 230 },
    { type: 'line', layer: 'PROFILE', x1: 0, y1: 0, x2: 12, y2: 0 },
    { type: 'line', layer: 'PROFILE', x1: 0, y1: 230, x2: 12, y2: 230 }
  ];
  parts.forEach(([name, y]) => {
    const mark = /MERLIN/i.test(name) ? 'M1D' : null;
    ents.push({
      type: 'callout', layer: 'NOTES',
      anchor: [12, y], pts: [[12, y], [22, y]],
      content: name, textH: 0.8,
      mark: mark || undefined
    });
  });
  ents.push({
    type: 'poly', layer: 'PROFILE', closed: true, mark: 'M1D',
    pts: [[4, 0], [8, 0], [8, 6], [4, 6]]
  });
  return ents;
}

describe('parseQty / cleanPartName', () => {
  it('reads ×N off a callout and leaves attrs.qty in charge', () => {
    expect(parseQty('MERLIN 1D ENGINES x9')).toBe(9);
    expect(parseQty('GRID FINS x4')).toBe(4);
    expect(parseQty('NOSE CONE TIP')).toBe(1);
    expect(parseQty('TANK', { qty: 2 })).toBe(2);
    expect(cleanPartName('MERLIN 1D ENGINES x9')).toBe('MERLIN 1D ENGINES');
    expect(cleanPartName('GRID FINS x4')).toBe('GRID FINS');
  });
});

describe('collectParts', () => {
  it('schedules Falcon parts with qty and a size measured from the part', () => {
    const parts = collectParts(falcon());
    expect(parts.length).toBe(5);
    const merlin = parts.find(p => /MERLIN/i.test(p.desc));
    expect(merlin.qty).toBe(9);
    expect(merlin.size).toMatch(/'/);
    expect(merlin.size).toMatch(/×/);
    expect(merlin.size).not.toMatch(/230/);
    expect(merlin.size).toMatch(/4/);
    const fins = parts.find(p => /GRID FINS/i.test(p.desc));
    expect(fins.qty).toBe(4);
    expect(fins.size).not.toMatch(/230/);
    const table = partsToTable(parts);
    expect(table.title).toBe('PARTS SCHEDULE');
    expect(table.cells[0]).toEqual(['MARK', 'QTY', 'DESCRIPTION', 'SIZE']);
    expect(table.cells.some(r => r.includes('9') && /MERLIN/i.test(r.join(' ')))).toBe(true);
  });

  it('does not turn a floor plan into a parts list', () => {
    expect(collectParts(cabin24x36()).length).toBe(0);
  });

  it('measureInBox clips the silhouette to the station, not the envelope', () => {
    const bb = measureInBox(falcon(), [0, 0, 12, 8]);
    expect(bb[3] - bb[1]).toBeCloseTo(8);
    expect(bb[3] - bb[1]).toBeLessThan(20);
  });
});

describe('envelopeDims', () => {
  it('stamps overall height and width when the model has none', () => {
    const dims = envelopeDims(falcon());
    expect(dims.length).toBe(2);
    const labels = dims.map(dimLabel).join(' ');
    expect(labels).toMatch(/230/);
    expect(labels).toMatch(/12/);
  });

  it('leaves a drawing that already has dims alone', () => {
    expect(envelopeDims(cabin24x36()).length).toBe(0);
  });
});

describe('bodyBBox', () => {
  it('ignores callout leaders so a rocket stays skinny', () => {
    const bb = bodyBBox(falcon());
    expect(bb[2] - bb[0]).toBeCloseTo(12);
    expect(bb[3] - bb[1]).toBeCloseTo(230);
  });
});

describe('specNotes', () => {
  it('names the envelope and the part count', () => {
    const parts = collectParts(falcon());
    const notes = specNotes(bodyBBox(falcon()), parts);
    expect(notes.join(' ')).toMatch(/Envelope/);
    expect(notes.join(' ')).toMatch(/12/);
    expect(notes.join(' ')).toMatch(/230/);
    expect(notes.join(' ')).toMatch(/part/);
  });
});
