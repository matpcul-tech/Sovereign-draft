/* DRAWINGS at scale: how the drawing set generator behaves as the model
 * grows. The campus is k x k copies of the sample cabin, which multiplies
 * walls, openings, fixtures and floor plates the way a real portfolio
 * would. Run with: node scripts/drawbench.mjs
 *
 * The hidden line pass was quadratic before the depth probe: at 16 cabins
 * one elevation cost 8.2 seconds; with the probe it costs under 100ms and
 * a 100 cabin town elevates in about a second per side.
 */
import { cabin24x36 } from '../src/core/demo.js';
import { translateEnt } from '../src/core/entities.js';
import { state, defaultLayers } from '../src/core/state.js';
import { planToSolids, roofOverModel, elevationToPlan, sliceSolidToPlan, allSolidsMesh, solidByName } from '../src/core/model3d.js';
import { meshBBox } from '../src/core/mesh.js';

function campus(k){
  const ents = [];
  for (let i = 0; i < k; i++){
    for (let j = 0; j < k; j++){
      const c = cabin24x36();
      c.forEach(e => { translateEnt(e, i * 50, j * 40); ents.push(e); });
    }
  }
  return ents;
}

for (const k of [1, 2, 4, 7, 10]){
  state.entities = campus(k);
  state.layers = defaultLayers();
  state.solids = [];
  state.idSeq = 100000;
  const T = {};
  let t = performance.now();
  planToSolids(); T.model = performance.now() - t;
  t = performance.now();
  roofOverModel('hip', 6, 1); T.roof = performance.now() - t;
  const faces = allSolidsMesh().faces.length;
  t = performance.now();
  elevationToPlan('S'); T.elevS = performance.now() - t;
  t = performance.now();
  elevationToPlan('E'); T.elevE = performance.now() - t;
  t = performance.now();
  const wall = solidByName('WALL');
  const bb = meshBBox(wall.mesh);
  sliceSolidToPlan('WALL', (bb[1] + bb[4]) / 2, undefined, 'y'); T.section = performance.now() - t;
  console.log(k * k, 'cabins,', faces, 'faces | model', T.model.toFixed(0) + 'ms | roof', T.roof.toFixed(0) + 'ms | elev S',
    T.elevS.toFixed(0) + 'ms | elev E', T.elevE.toFixed(0) + 'ms | section', T.section.toFixed(0) + 'ms');
}
