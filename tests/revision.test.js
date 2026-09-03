import { describe, it, expect } from 'vitest';
import {
  makeRevision, nextRevNumber, addRevision, makeDelta, expandDelta,
  revisionsOnSheet, revisionRows, cloudAround, todayStamp
} from '../src/core/revision.js';
import { revisionBlockModel } from '../src/core/titleblock.js';
import { explodeForIO, entBBox } from '../src/core/entities.js';
import { buildDXF, openDXF } from '../src/io/dxf.js';
import { buildAllSheetsPDF } from '../src/io/pdf.js';
import { defaultLayers } from '../src/core/state.js';
import { cabin24x36 } from '../src/core/demo.js';
import { generateSheetSet } from '../src/core/sheetset.js';
import { serializeProject, validateProject } from '../src/io/project.js';
import { roomRows } from '../src/core/schedule.js';

describe('revisions are numbered once and never reused', () => {
  it('numbers run up from one', () => {
    let list = [];
    list = addRevision(list, { note: 'first' });
    list = addRevision(list, { note: 'second' });
    expect(list.map(r => r.num)).toEqual([1, 2]);
  });

  it('deleting a revision does not renumber the ones already issued', () => {
    /* A sheet went out stamped 2. Reusing that number would put two
     * different drawings in the field claiming to be revision 2. */
    let list = addRevision(addRevision(addRevision([], {}), {}), {});
    list = list.filter(r => r.num !== 2);
    expect(list.map(r => r.num)).toEqual([1, 3]);
    expect(nextRevNumber(list)).toBe(4);
  });

  it('a date is stamped when none is given', () => {
    expect(addRevision([], {})[0].date).toBe(todayStamp());
  });

  it('fields are bounded, so a hostile file cannot run a note off the sheet', () => {
    const r = makeRevision({ num: 3.7, note: 'x'.repeat(500), date: 'y'.repeat(80) });
    expect(r.num).toBe(4);
    expect(r.note.length).toBe(120);
    expect(r.date.length).toBe(24);
  });
});

describe('the delta is an entity like any other', () => {
  const d = () => makeDelta({ x: 10, y: 5, num: 2, layer: 'NOTES' });

  it('explodes to a triangle and its number', () => {
    const parts = explodeForIO(d());
    expect(parts.map(p => p.type)).toEqual(['poly', 'text']);
    expect(parts[0].pts.length).toBe(3);
    expect(parts[1].content).toBe('2');
  });

  it('has extents, so a sheet fit cannot cut it off', () => {
    const bb = [1e9, 1e9, -1e9, -1e9];
    entBBox(d(), bb);
    expect(bb[0]).toBeLessThan(10);
    expect(bb[2]).toBeGreaterThan(10);
    expect(bb[3]).toBeGreaterThan(5);
  });

  it('survives the DXF round trip as drawn geometry', () => {
    const back = openDXF(buildDXF([d()], defaultLayers(), { ver: 'R2000' }), n => n).entities;
    expect(back.length).toBeGreaterThan(0);
    expect(back.some(e => e.type === 'poly' || e.type === 'lwpolyline')).toBe(true);
    expect(back.some(e => e.type === 'text' && String(e.content).trim() === '2')).toBe(true);
  });

  it('the triangle sits on its base with the number inside it', () => {
    const [tri, txt] = expandDelta(makeDelta({ x: 0, y: 0, num: 7, h: 1 }));
    const ys = tri.pts.map(p => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
    expect(txt.y).toBeGreaterThan(0);
    expect(txt.y).toBeLessThan(1);
  });
});

describe('a sheet claims only the revisions drawn on it', () => {
  const revs = [makeRevision({ num: 1, note: 'a' }), makeRevision({ num: 2, note: 'b' })];

  it('a sheet with a rev 2 delta carries rev 2 and not rev 1', () => {
    const on = revisionsOnSheet([makeDelta({ num: 2 })], revs);
    expect(on.map(r => r.num)).toEqual([2]);
  });

  it('a sheet with nothing clouded carries no revisions', () => {
    expect(revisionsOnSheet(cabin24x36(), revs)).toEqual([]);
    expect(revisionBlockModel('archd', [])).toBe(null);
  });

  it('rows read newest first, the way the block is read', () => {
    expect(revisionRows(revs).map(r => r[0])).toEqual(['2', '1']);
  });
});

describe('the revision block reaches issued paper', () => {
  const revs = [makeRevision({ num: 1, date: '2026-09-03', note: 'Window moved 2ft east' }),
    makeRevision({ num: 2, date: '2026-09-10', note: 'Header size revised at kitchen wall' })];
  const ents = cabin24x36().concat([makeDelta({ x: 20, y: 12, num: 2, layer: 'NOTES' })]);
  const sheets = () => generateSheetSet(ents, defaultLayers(), {});

  it('prints the block when a delta is on the sheet', () => {
    const pdf = buildAllSheetsPDF(ents, { sheets: sheets(), projectName: 'C', revisions: revs, dateStr: '2026-01-01' }).pdf;
    expect(pdf).toContain('DESCRIPTION');
    expect(pdf).toContain('Header size revised');
  });

  it('prints no block, and no claim, when nothing is clouded', () => {
    const clean = cabin24x36();
    const pdf = buildAllSheetsPDF(clean, {
      sheets: generateSheetSet(clean, defaultLayers(), {}),
      projectName: 'C', revisions: revs, dateStr: '2026-01-01' }).pdf;
    expect(pdf).not.toContain('DESCRIPTION');
  });

  it('the block fits inside every sheet size, above the title block', () => {
    const rows = revisionRows(revs);
    for (const key of ['archd', 'archdp', 'tabloid', 'letter']){
      const m = revisionBlockModel(key, rows);
      expect(m.x, key + ' runs off the left').toBeGreaterThanOrEqual(0);
      expect(m.x + m.w, key + ' runs off the right').toBeLessThanOrEqual(
        key === 'archd' ? 36 : key === 'archdp' ? 24 : key === 'tabloid' ? 17 : 11);
      /* Above the title block, which is 1.65in tall off a 0.5in margin. */
      expect(m.y, key + ' overlaps the title block').toBeGreaterThanOrEqual(2.15 - 1e-9);
    }
  });
});

describe('revisions travel with the project file', () => {
  it('a saved job reopens with its revision history intact', () => {
    const st = { projectName: 'C', entities: [], layers: defaultLayers(), userBlocks: [],
      revisions: [makeRevision({ num: 1, date: '2026-09-03', note: 'first' })] };
    const back = validateProject(JSON.parse(serializeProject(st, true)));
    expect(back.revisions.length).toBe(1);
    expect(back.revisions[0].note).toBe('first');
  });

  it('junk in the revisions of a file somebody else edited is dropped', () => {
    const back = validateProject({ entities: [], layers: [],
      revisions: [null, { num: 0 }, { num: 'x' }, { num: 2, note: 'ok' }] });
    expect(back.revisions.map(r => r.num)).toEqual([2]);
  });
});

describe('the room schedule FINISH column is a finish', () => {
  it('never prints the internal LIVE marker onto issued paper', () => {
    /* This reached a builder's sheet as "FINISH: LIVE". */
    const rows = roomRows([{ type: 'room', name: 'DEN', area: 64,
      pts: [[0, 0], [8, 0], [8, 8], [0, 8]], cx: 4, cy: 4 }]);
    expect(rows[0][3]).toBe('-');
    expect(rows[0]).not.toContain('LIVE');
  });

  it('prints the room own finish when it has one', () => {
    const rows = roomRows([{ type: 'room', name: 'DEN', area: 64, finish: 'oak',
      pts: [[0, 0], [8, 0], [8, 8], [0, 8]], cx: 4, cy: 4 }]);
    expect(rows[0][3]).toBe('OAK');
  });
});

describe('a cloud wraps what it is given', () => {
  it('stands off the work by the pad on every side', () => {
    expect(cloudAround([0, 0, 10, 6], 0.5)).toEqual([[-0.5, -0.5], [10.5, -0.5], [10.5, 6.5], [-0.5, 6.5]]);
  });
});

describe('undo takes back the whole revision, not half of it', () => {
  it('the revision row goes with its cloud and delta', async () => {
    const { state, pushUndo, doUndo, doRedo } = await import('../src/core/state.js');
    state.entities = []; state.undoStack = []; state.redoStack = [];
    state.revisions = [];
    pushUndo();
    state.revisions = addRevision(state.revisions, { note: 'clouded by mistake' });
    state.entities.push(makeDelta({ num: 1 }));
    expect(state.revisions.length).toBe(1);
    doUndo();
    /* A revision row nothing on any sheet points at is not a record,
     * it is a wrong count in the block. */
    expect(state.revisions.length).toBe(0);
    expect(state.entities.filter(e => e.type === 'delta').length).toBe(0);
    doRedo();
    expect(state.revisions.length).toBe(1);
  });
});
