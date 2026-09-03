import { describe, it, expect } from 'vitest';
import { wallFrags } from '../src/core/walls.js';
import { healWalls } from '../src/core/cleanup.js';
import { detectRooms } from '../src/core/rooms.js';
import { makeInsert, syncHostWall, clFromMembers } from '../src/core/dynblock.js';
import { bindAllDims } from '../src/core/assoc.js';
import { wallCenterline } from '../src/core/walls.js';

/* From the timed real-job run: place a door in a closed plan and Detect
 * rooms answers "No closed wall loops yet". The wall the door went into
 * came back with a centerline the length of its first face segment. */
function plan(){
  const state = { entities: [], idSeq: 1, gSeq: 1 };
  const wall = (x1, y1, x2, y2) => {
    const g = 'g' + (state.gSeq++);
    wallFrags(x1, y1, x2, y2, 0.5, 'WALLS').forEach(f => { f.g = g; f.id = state.idSeq++; state.entities.push(f); });
    const res = healWalls(state.entities);
    if (res.ok) state.entities = res.entities;
    return g;
  };
  const south = wall(0, 0, 36, 0); wall(36, 0, 36, 24); wall(36, 24, 0, 24); wall(0, 24, 0, 0); wall(18, 0, 18, 24);
  return { state, south };
}

describe('a door in a wall does not break the room loop', () => {
  it('two rooms before the door, two rooms after it', () => {
    const { state, south } = plan();
    expect(detectRooms(state.entities).length).toBe(2);
    const members = state.entities.filter(e => e.g === south);
    console.log('south members before door:', JSON.stringify(members.map(m => [m.role, +m.x1.toFixed(2), +m.x2.toFixed(2), m.ocl ? [+m.ocl.x1.toFixed(2), +m.ocl.x2.toFixed(2)] : null])));
    const cl = clFromMembers(members);
    console.log('cl chosen:', JSON.stringify([cl.x1, cl.x2]));
    expect(Math.abs(cl.x2 - cl.x1)).toBeCloseTo(36, 6);
    const door = makeInsert({ def: 'door', width: 3, host: south, t: 0.25, cl, layer: 'DOORS' });
    door.id = state.idSeq++;
    state.entities.push(door);
    syncHostWall(state, south);
    /* The app heals the wall graph after every stroke; a heal after the
     * door must not shrink the wall's centerline to its first face pair. */
    const healed = healWalls(state.entities);
    if (healed.ok) state.entities = healed.entities;
    /* The app rebinds after every change, which restamps each wall's
     * centerline from its faces. This is the call that broke it. */
    bindAllDims(state.entities);
    const after = state.entities.filter(e => e.g === south);
    /* The wall's own centerline is the whole wall, whatever was cut out of it. */
    const cl2 = clFromMembers(after);
    expect(Math.abs(cl2.x2 - cl2.x1), 'centerline shrank to ' + JSON.stringify([cl2.x1, cl2.x2])).toBeCloseTo(36, 6);
    expect(detectRooms(state.entities).length).toBe(2);
  });
});

describe('wallCenterline reads the whole wall, not its first face pair', () => {
  it('a wall split by a door still reports its full run', () => {
    const th = 0.5;
    const mk = (role, x1, x2, y) => ({ type: 'line', layer: 'WALLS', kind: 'wall', role, th, x1, y1: y, x2, y2: y });
    const members = [mk('a', 0, 7.5, 0.25), mk('b', 0, 7.5, -0.25), mk('a', 10.5, 36, 0.25), mk('b', 10.5, 36, -0.25),
      { type: 'line', layer: 'WALLS', kind: 'wall', role: 'jamb', th, x1: 7.5, y1: 0.25, x2: 7.5, y2: -0.25 }];
    const cl = wallCenterline(members);
    expect(cl.x1).toBeCloseTo(0, 9); expect(cl.x2).toBeCloseTo(36, 9);
    expect(cl.y1).toBeCloseTo(0, 9); expect(cl.y2).toBeCloseTo(0, 9);
    expect(cl.th).toBeCloseTo(0.5, 9);
  });
  it('a plain wall is unchanged: same centerline as before', () => {
    const mk = (role, x1, x2, y) => ({ type: 'line', layer: 'WALLS', kind: 'wall', role, th: 0.5, x1, y1: y, x2, y2: y });
    const cl = wallCenterline([mk('a', 2, 20, 5.25), mk('b', 2, 20, 4.75)]);
    expect([cl.x1, cl.y1, cl.x2, cl.y2].map(v => +v.toFixed(9))).toEqual([2, 5, 20, 5]);
  });
});
