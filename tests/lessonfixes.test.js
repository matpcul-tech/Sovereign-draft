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

/* Lesson 8 on a phone: zoomed out, a tap on the floor of a small room
 * lands within reach of a wall, so the hit is the wall, not the room.
 * HATCH still fills the room the tap is inside. */
describe('HATCH on a floor near a wall', () => {
  it('fills the room the tap is inside even when the hit is a wall', async () => {
    const { state, addEntity } = await import('../src/core/state.js');
    const { hatchTap, hitTest } = await import('../src/actions.js');
    const { vp } = await import('../src/core/viewport.js');
    const { ix } = await import('../src/interaction.js');
    if (typeof globalThis.document === 'undefined') globalThis.document = { getElementById: () => null };
    state.entities = []; state.selIds = []; ix.polyPts = [];
    state.view = { x: 18, y: 12, scale: 4 };
    vp.CW = 390; vp.CH = 700;
    const wall = addEntity({ type: 'line', layer: 'WALLS', kind: 'wall', x1: 0, y1: 0.25, x2: 36, y2: 0.25 });
    addEntity({ type: 'room', layer: 'ROOMS', name: 'BATH', area: 60,
      pts: [[0.5, 0.5], [10, 0.5], [10, 7], [0.5, 7]], cx: 5, cy: 3 });
    const sx = (x, y) => [(x - state.view.x) * state.view.scale + vp.CW / 2, vp.CH / 2 - (y - state.view.y) * state.view.scale];
    const p = sx(5, 1.5);
    expect(hitTest(p[0], p[1]).id).toBe(wall.id);
    hatchTap(p[0], p[1]);
    const h = state.entities.filter(e => e.type === 'hatch');
    expect(h.length).toBe(1);
    expect(ix.polyPts.length).toBe(0);
  });
});
