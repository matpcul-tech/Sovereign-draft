import { describe, it, expect } from 'vitest';
import { state, addEntity } from '../src/core/state.js';
import { hitTest } from '../src/actions.js';
import { vp } from '../src/core/viewport.js';

/* From the timed real-job run (scripts/job.mjs): after the wall loop
 * closed and the live room appeared, every tap selected the room, so no
 * wall could be selected and no door placed by tapping it. */
describe('a tap on a wall selects the wall, not the room around it', () => {
  it('anything drawn wins over a room; empty floor still picks the room', () => {
    state.entities = []; state.selIds = [];
    state.view = { x: 18, y: 12, scale: 18 };
    vp.CW = 1000; vp.CH = 800;
    const wall = addEntity({ type: 'line', layer: 'WALLS', kind: 'wall', x1: 0, y1: 0.25, x2: 36, y2: 0.25 });
    addEntity({ type: 'room', layer: 'ROOMS', name: 'HALL', area: 864,
      pts: [[0, 0], [36, 0], [36, 24], [0, 24]], cx: 18, cy: 12 });
    const sx = (x, y) => [(x - state.view.x) * state.view.scale + vp.CW / 2, vp.CH / 2 - (y - state.view.y) * state.view.scale];
    const onWall = sx(9, 0.25);
    expect(hitTest(onWall[0], onWall[1]).id).toBe(wall.id);
    const floor = sx(18, 12);
    expect(hitTest(floor[0], floor[1]).type).toBe('room');
  });
});
