import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeInsert, expandInsert, snapWidth, locateInsert, insertGrips, flipInsert,
  syncHostWall, paramOnCl, clFromMembers
} from '../src/core/dynblock.js';
import { wallFrags, wallWithOpenings } from '../src/core/walls.js';
import { entHit, entBBox, gripPts, flattenEnt, translateEnt } from '../src/core/entities.js';
import { transformEnt, moveEntities, rotateEntities } from '../src/core/modify.js';
import { cabin24x36 } from '../src/core/demo.js';
import { buildDXF } from '../src/io/dxf.js';
import { defaultLayers, state, addEntity, selMembers } from '../src/core/state.js';
import { explodeSelection, applyProps } from '../src/actions.js';

describe('snapWidth', () => {
  it('clamps doors to 2–8 ft on a 1" grid', () => {
    expect(snapWidth(2.51, 'door')).toBeCloseTo(2.5);
    expect(snapWidth(1, 'door')).toBe(2);
    expect(snapWidth(12, 'window')).toBe(8);
  });
});

describe('expandInsert', () => {
  it('emits a door leaf + swing arc in world space', () => {
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', x: 10, y: 4, rot: 0 });
    const fr = expandInsert(e);
    expect(fr.some(f => f.type === 'line')).toBe(true);
    expect(fr.some(f => f.type === 'arc')).toBe(true);
    const leaf = fr.find(f => f.type === 'line');
    expect(leaf.x1).toBeCloseTo(10);
    expect(leaf.y1).toBeCloseTo(4);
    expect(leaf.y2).toBeCloseTo(7);
    expect(fr.every(f => f.layer === 'DOORS')).toBe(true);
  });
  it('places a window centered on the insertion point', () => {
    const e = makeInsert({ def: 'window', width: 4, x: 5, y: 0, rot: 0, th: 0.5 });
    const fr = expandInsert(e);
    const xs = fr.filter(f => f.type === 'line').flatMap(f => [f.x1, f.x2]);
    expect(Math.min(...xs)).toBeCloseTo(3);
    expect(Math.max(...xs)).toBeCloseTo(7);
  });
  it('expands a named fixture symbol', () => {
    const e = makeInsert({ def: 'sym:Stove', x: 2, y: 2 });
    const fr = expandInsert(e);
    expect(fr.length).toBeGreaterThan(1);
    expect(fr.some(f => f.type === 'circle' || f.type === 'poly')).toBe(true);
  });
});

describe('hosted door on a wall', () => {
  it('locates the hinge at the start of the opening', () => {
    const cl = { x1: 0, y1: 0, x2: 20, y2: 0, th: 0.5, layer: 'WALLS' };
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', host: 'w1', t: 0.5, cl });
    locateInsert(e, cl);
    expect(e.x).toBeCloseTo(8.5);
    expect(e.y).toBeCloseTo(0);
    expect(e.rot).toBeCloseTo(0);
  });
  it('syncHostWall punches jambs for every insert on the host', () => {
    const members = wallFrags(0, 0, 20, 0, 0.5, 'WALLS');
    members.forEach(f => { f.g = 'w1'; f.id = Math.random(); });
    const cl = clFromMembers(members);
    const a = makeInsert({ def: 'door', width: 3, host: 'w1', t: 0.3, cl, layer: 'DOORS' });
    const b = makeInsert({ def: 'window', width: 4, host: 'w1', t: 0.7, cl, layer: 'DOORS' });
    locateInsert(a, cl); locateInsert(b, cl);
    const state = { entities: members.concat([a, b]), idSeq: 1 };
    syncHostWall(state, 'w1');
    const walls = state.entities.filter(e => e.g === 'w1');
    expect(walls.filter(e => e.role === 'jamb').length).toBe(4);
    expect(state.entities.filter(e => e.type === 'insert').length).toBe(2);
  });
});

describe('grips', () => {
  it('door stretch grip changes width', () => {
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', x: 0, y: 0, rot: 0 });
    const gs = insertGrips(e);
    const stretch = gs.find(g => g.kind === 'stretch');
    expect(stretch).toBeTruthy();
    stretch.apply([0, 4]);
    expect(e.width).toBeCloseTo(4);
  });
  it('door flip grip toggles swing', () => {
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', x: 0, y: 0 });
    const gs = insertGrips(e);
    const flip = gs.find(g => g.kind === 'flip');
    expect(flip.once).toBe(true);
    flip.apply();
    expect(e.swing).toBe('R');
    flipInsert(e);
    expect(e.swing).toBe('L');
  });
  it('gripPts routes inserts to insertGrips', () => {
    const e = makeInsert({ def: 'door', width: 3, x: 0, y: 0 });
    expect(gripPts(e).some(g => g.kind === 'stretch')).toBe(true);
  });
});

describe('hit / bbox / explode', () => {
  it('entHit hits the swing arc of a door insert', () => {
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', x: 0, y: 0, rot: 0 });
    expect(entHit(e, [0, 1.5], 0.2)).toBe(true);
    expect(entHit(e, [10, 10], 0.2)).toBe(false);
  });
  it('entBBox covers the door swing', () => {
    const e = makeInsert({ def: 'door', width: 3, swing: 'L', x: 0, y: 0, rot: 0 });
    const bb = [1e9, 1e9, -1e9, -1e9];
    entBBox(e, bb);
    expect(bb[2]).toBeGreaterThan(2);
    expect(bb[3]).toBeGreaterThan(2);
  });
  it('flattenEnt explode yields ordinary geometry with no insert type', () => {
    const e = makeInsert({ def: 'door', width: 3, x: 1, y: 2, rot: 90 });
    const fr = flattenEnt(e);
    expect(fr.length).toBeGreaterThan(0);
    expect(fr.every(f => f.type !== 'insert')).toBe(true);
  });
});

describe('transforms', () => {
  it('translateEnt moves the insertion point', () => {
    const e = makeInsert({ def: 'sym:Sink', x: 1, y: 1 });
    translateEnt(e, 3, -2);
    expect(e.x).toBe(4); expect(e.y).toBe(-1);
  });
  it('rotateEntities adds to rot', () => {
    const e = makeInsert({ def: 'sym:Bed', x: 0, y: 0, rot: 0 });
    const out = rotateEntities([e], 0, 0, 90);
    expect(out[0].rot).toBeCloseTo(90);
  });
  it('moveEntities copies the insert', () => {
    const e = makeInsert({ def: 'door', width: 3, x: 0, y: 0 });
    const out = moveEntities([e], 5, 0);
    expect(out[0].x).toBe(5);
    expect(e.x).toBe(0);
  });
});

describe('sample cabin uses dynamic inserts', () => {
  const ents = cabin24x36();
  it('has door and window inserts plus a stove fixture', () => {
    const doors = ents.filter(e => e.type === 'insert' && e.def === 'door');
    const windows = ents.filter(e => e.type === 'insert' && e.def === 'window');
    expect(doors.length).toBe(3);
    expect(windows.length).toBe(2);
    expect(ents.some(e => e.type === 'insert' && e.def === 'sym:Stove')).toBe(true);
    expect(doors.every(d => d.host)).toBe(true);
  });
  it('punches jambs for hosted openings', () => {
    expect(ents.filter(e => e.role === 'jamb').length).toBeGreaterThanOrEqual(10);
  });
  it('exports the door swing as ARC in R12 DXF', () => {
    const dxf = buildDXF(ents, defaultLayers(), { ver: 'R12' });
    expect(dxf).toContain('ARC');
    expect(dxf).toContain('DOORS');
  });
});

void wallWithOpenings; void paramOnCl; void transformEnt;

describe('explodeSelection', () => {
  beforeEach(() => {
    globalThis.document = { getElementById(){ return null; } };
    state.entities = [];
    state.selIds = [];
    state.undoStack = [];
    state.redoStack = [];
    state.idSeq = 1;
    state.gSeq = 1;
    state.layers = defaultLayers();
  });
  it('turns a door insert into ordinary leaf + arc', () => {
    const e = addEntity(makeInsert({ def: 'door', width: 3, swing: 'L', x: 0, y: 0, layer: 'DOORS' }));
    state.selIds = [e.id];
    explodeSelection();
    expect(state.entities.some(x => x.type === 'insert')).toBe(false);
    expect(state.entities.some(x => x.type === 'line')).toBe(true);
    expect(state.entities.some(x => x.type === 'arc')).toBe(true);
    expect(selMembers().every(x => !x.g)).toBe(true);
  });
  it('applyProps width recuts a hosted door', () => {
    const members = wallFrags(0, 0, 20, 0, 0.5, 'WALLS');
    members.forEach(f => { f.g = 'w1'; addEntity(f); });
    const cl = clFromMembers(state.entities.filter(e => e.g === 'w1'));
    const door = addEntity(makeInsert({ def: 'door', width: 3, host: 'w1', t: 0.5, cl, layer: 'DOORS' }));
    locateInsert(door, cl);
    syncHostWall(state, 'w1');
    const jambsBefore = state.entities.filter(e => e.role === 'jamb').length;
    state.selIds = [door.id];
    applyProps({ width: 5 });
    expect(door.width).toBe(5);
    expect(state.entities.filter(e => e.role === 'jamb').length).toBe(jambsBefore);
    const faces = state.entities.filter(e => e.g === 'w1' && e.role === 'a');
    const opening = 20 - faces.reduce((s, f) => s + Math.abs(f.x2 - f.x1), 0);
    expect(opening).toBeGreaterThan(4.5);
  });
});
