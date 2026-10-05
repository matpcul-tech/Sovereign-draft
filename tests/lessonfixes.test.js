import { describe, it, expect } from 'vitest';
import { wallFrags } from '../src/core/walls.js';
import { syncAutoRooms } from '../src/core/rooms.js';
import { mergeViewSheets, viewSheets, generateSheetSet } from '../src/core/sheetset.js';
import { freeBand, vp } from '../src/core/viewport.js';

function boxWalls(w, h){
  const ents = [];
  const wall = (x1, y1, x2, y2, g) => wallFrags(x1, y1, x2, y2, 0.5, 'WALLS').forEach(f => { f.g = g; ents.push(f); });
  wall(0, 0, w, 0, 's'); wall(w, 0, w, h, 'e'); wall(w, h, 0, h, 'n'); wall(0, h, 0, 0, 'w');
  return ents;
}

describe('rooms named after the walls close', () => {
  it('a label typed inside a live room renames it', () => {
    const st = { autoRooms: true, idSeq: 1, entities: boxWalls(20, 12) };
    syncAutoRooms(st);
    expect(st.entities.find(e => e.type === 'room').name).toBe('ROOM 1');
    st.entities.push({ type: 'text', x: 10, y: 6, size: 1, content: 'STUDIO' });
    syncAutoRooms(st);
    expect(st.entities.find(e => e.type === 'room').name).toBe('STUDIO');
  });

  it('a room with no label keeps the name it had', () => {
    const st = { autoRooms: true, idSeq: 1, entities: boxWalls(20, 12) };
    syncAutoRooms(st);
    st.entities.find(e => e.type === 'room').name = 'DEN';
    syncAutoRooms(st);
    expect(st.entities.find(e => e.type === 'room').name).toBe('DEN');
  });
});

describe('DRAWINGS SHEETS numbering', () => {
  const views = [{ name: 'FLOOR PLAN', bbox: [0, 0, 36, 24] }, { name: 'SOUTH ELEVATION', bbox: [0, 0, 36, 14] }, { name: 'SECTION A-A', bbox: [0, 0, 24, 14] }];
  const nums = Ls => Ls.map(L => L.sheetNumber);

  it('running it twice replaces its own sheets', () => {
    let L = mergeViewSheets([], viewSheets(views));
    L = mergeViewSheets(L, viewSheets(views));
    expect(nums(L)).toEqual(['A-101', 'A-201', 'A-301']);
  });

  it('after a sheet set, a taken number moves to the next free one', () => {
    const set = generateSheetSet(boxWalls(36, 24), [], {});
    const L = mergeViewSheets(set, viewSheets(views));
    const all = nums(L);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain('G-001');
    const plan = L.find(x => /FLOOR PLAN/.test(x.name));
    expect(plan.sheetNumber).not.toBe('A-101');
    expect(plan.name.startsWith(plan.sheetNumber)).toBe(true);
  });
});

describe('fit band', () => {
  it('without a page it keeps the old margins', () => {
    vp.CH = 800;
    expect(freeBand()).toEqual({ top: 80, bottom: 660 });
  });
});

describe('cover index after DRAWINGS SHEETS', () => {
  it('lists every sheet, the new ones too', () => {
    const set = generateSheetSet(boxWalls(36, 24), [], {});
    const L = mergeViewSheets(set, viewSheets([{ name: 'SOUTH ELEVATION', bbox: [0, 0, 36, 14] }]));
    const cover = L.find(x => x.kind === 'cover');
    const idx = cover.annotations.find(a => a.kind === 'table' && a.table.title === 'DRAWING INDEX').table;
    expect(idx.cells.slice(1).map(r => r[0])).toEqual(L.map(x => x.sheetNumber));
    expect(idx.cells[idx.cells.length - 1][1]).toBe('SOUTH ELEVATION');
  });
});
