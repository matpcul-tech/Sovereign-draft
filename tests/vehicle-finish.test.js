import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lookupCommand } from '../src/core/command.js';
import { parseLine } from '../src/asset/grammar.js';
import { growFaces } from '../src/asset/finish/select.js';
import { loadVehicle, readGlb, sha256Hex } from '../src/asset/finish/glb.js';
import { inspectVehicle } from '../src/asset/finish/inspect.js';
import { RANGES, fusedShellGlb } from '../src/asset/finish/fixture.js';
import { decodePng } from '../src/asset/finish/png.js';
import { unzipStore } from '../src/asset/finish/zip.js';
import { finishZip } from '../src/asset/finish/review.js';
import {
  applyPreview,
  assignFaces,
  buildVehicle,
  changeEdit,
  countAssigned,
  createSession,
  disposeVehicle,
  exportVehicle,
  innerOf,
  linearFactor,
  restoreEdit,
  serializeEdit,
  undoEdit,
  worldToInner
} from '../src/asset/finish/edit.js';

const SEDAN_SHA = 'ab53f2e923f97ce9c8af5bf3e47c48ecf5655f6330244ba3d8e7dccffc2e1d09';

function span(key, start, end) {
  const faces = [];
  for (let face = start; face < end; face++) faces.push({ key, face });
  return faces;
}

function material(doc, name) {
  return doc.materials.find((item) => item.name === name);
}

function hash(bytes) {
  let value = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    value ^= bytes[i];
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function worldVertex(mesh, index) {
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), index);
  return mesh.localToWorld(point);
}

function firstMesh(root, predicate) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isMesh && predicate(obj)) found = obj;
  });
  return found;
}

describe('vehicle finish', () => {
  it('keeps drafting commands and adds VEHICLE', () => {
    expect(lookupCommand('BOX').action).toBe('prim:box');
    expect(lookupCommand('LINE').tool).toBe('line');
    expect(lookupCommand('VEHICLE').action).toBe('assetvehicle');
    expect(parseLine('VEHICLE').meta).toBe('vehicle');
    expect(parseLine('SEDAN').meta).toBe('recipe');
  });

  it('finishes a fused one-material shell without tinting the other faces', async () => {
    const source = fusedShellGlb();
    const sourceSha = await sha256Hex(source);
    const loaded = await loadVehicle(source, 'fused-shell.glb');
    expect(loaded.sha256).toBe(sourceSha);
    expect(loaded.surfaces).toHaveLength(1);
    expect(loaded.surfaces[0].faceCount).toBe(65);
    const info = inspectVehicle(loaded);
    expect(info.materials).toHaveLength(1);
    expect(info.degenerate).toBe(1);
    expect(info.duplicate).toBe(1);
    expect(info.issues.some((line) => line.includes('1 material'))).toBe(true);

    const key = loaded.surfaces[0].key;
    const surface = loaded.surfaces[0];
    const island = growFaces(surface.topology, surface.normals, [0], Infinity);
    expect(island.size).toBe(12);
    const grown = growFaces(surface.topology, surface.normals, [0], 35 * Math.PI / 180);
    expect(grown.size).toBe(2);

    const session = createSession(loaded);
    changeEdit(session, (edit) => {
      assignFaces(edit, span(key, 0, 8).concat(span(key, 10, 12)), 'material', 'paint');
      assignFaces(edit, span(key, 8, 10), 'structure', 'door_fl');
      assignFaces(edit, span(key, 8, 10), 'material', 'paint');
      assignFaces(edit, span(key, RANGES.glass[0], RANGES.glass[1]), 'material', 'glass');
      assignFaces(edit, span(key, RANGES.wheel_fl[0], RANGES.wheel_fl[1]), 'structure', 'wheel_fl');
      assignFaces(edit, span(key, RANGES.wheel_fr[0], RANGES.wheel_fr[1]), 'structure', 'wheel_fr');
      assignFaces(edit, span(key, RANGES.wheel_rl[0], RANGES.wheel_rl[1]), 'structure', 'wheel_rl');
      assignFaces(edit, span(key, RANGES.wheel_rr[0], RANGES.wheel_rr[1]), 'structure', 'wheel_rr');
      edit.paint.hex = '#ff0000';
      edit.pivots.door_fl = [-0.85, 0.8, 0.2];
    });
    expect(countAssigned(session.edit, 'material', 'paint')).toBe(12);
    undoEdit(session);
    expect(countAssigned(session.edit, 'material', 'paint')).toBe(0);
    changeEdit(session, (edit) => {
      assignFaces(edit, span(key, 0, 8).concat(span(key, 10, 12)), 'material', 'paint');
      assignFaces(edit, span(key, 8, 10), 'structure', 'door_fl');
      assignFaces(edit, span(key, 8, 10), 'material', 'paint');
      assignFaces(edit, span(key, RANGES.glass[0], RANGES.glass[1]), 'material', 'glass');
      assignFaces(edit, span(key, RANGES.wheel_fl[0], RANGES.wheel_fl[1]), 'structure', 'wheel_fl');
      assignFaces(edit, span(key, RANGES.wheel_fr[0], RANGES.wheel_fr[1]), 'structure', 'wheel_fr');
      assignFaces(edit, span(key, RANGES.wheel_rl[0], RANGES.wheel_rl[1]), 'structure', 'wheel_rl');
      assignFaces(edit, span(key, RANGES.wheel_rr[0], RANGES.wheel_rr[1]), 'structure', 'wheel_rr');
      edit.paint.hex = '#ff0000';
      edit.pivots.door_fl = [-0.85, 0.8, 0.2];
    });

    let rig = buildVehicle(loaded, session.edit);
    const inner = innerOf(rig);
    for (const id of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const spin = rig.getObjectByName(id + '_spin');
      const center = new THREE.Box3().setFromObject(spin).getCenter(new THREE.Vector3());
      const point = worldToInner(inner, center);
      session.edit.pivots[id + '_spin'] = point;
      if (id === 'wheel_fl' || id === 'wheel_fr') session.edit.pivots[id + '_steer'] = point.slice();
    }
    disposeVehicle(rig);

    const restored = restoreEdit(loaded, serializeEdit(loaded, session.edit));
    expect(restored.paint.hex).toBe('#ff0000');
    session.edit = restored;

    rig = buildVehicle(loaded, session.edit, { preview: { door: 0, spin: 0, steer: 0 } });
    const doorMesh = firstMesh(rig, (obj) => obj.name.startsWith('door_fl'));
    const glassMesh = firstMesh(rig, (obj) => obj.material && obj.material.name === 'se_glass');
    const wheelMesh = firstMesh(rig.getObjectByName('wheel_fl_spin'), () => true);
    const doorBefore = worldVertex(doorMesh, 0);
    const glassBefore = worldVertex(glassMesh, 0);
    const wheelBefore = worldVertex(wheelMesh, 0);
    const hinge = new THREE.Vector3().setFromMatrixPosition(rig.getObjectByName('door_fl').matrixWorld);
    const doorRadius = Math.hypot(doorBefore.x - hinge.x, doorBefore.z - hinge.z);
    applyPreview(rig, { door: 40, spin: 90, steer: 15 });
    const doorAfter = worldVertex(doorMesh, 0);
    const glassAfter = worldVertex(glassMesh, 0);
    const wheelAfter = worldVertex(wheelMesh, 0);
    expect(doorAfter.distanceTo(doorBefore)).toBeGreaterThan(0.02);
    expect(glassAfter.distanceTo(glassBefore)).toBeLessThan(1e-4);
    expect(Math.abs(Math.hypot(doorAfter.x - hinge.x, doorAfter.z - hinge.z) - doorRadius)).toBeLessThan(1e-3);
    expect(wheelAfter.distanceTo(wheelBefore)).toBeGreaterThan(0.01);
    disposeVehicle(rig);

    const exported = exportVehicle(loaded, session.edit);
    expect(await sha256Hex(loaded.bytes)).toBe(sourceSha);
    const paint = material(exported.doc, 'se_paint');
    const glass = material(exported.doc, 'se_glass');
    const atlas = material(exported.doc, 'atlas');
    expect(paint.baseColorFactor.map((value) => Number(value.toFixed(5)))).toEqual(linearFactor('#ff0000').map((value) => Number(value.toFixed(5))));
    expect(glass.baseColorFactor.slice(0, 3).every((value) => Math.abs(value - 1) < 1e-6)).toBe(true);
    expect(sameBytes(atlas.baseColorImage.bytes, loaded.images[0].bytes)).toBe(true);
    expect(sameBytes(glass.baseColorImage.bytes, loaded.images[0].bytes)).toBe(true);
    expect(sameBytes(paint.baseColorImage.bytes, loaded.images[0].bytes)).toBe(false);
    expect(paint.baseColorImage.mime).toBe('image/png');
    const paintUv = exported.doc.meshes.flatMap((mesh) => mesh.primitives).find((prim) => exported.doc.materials[prim.material].name === 'se_paint').uv;
    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < paintUv.length; i += 2) {
      minU = Math.min(minU, paintUv[i]);
      maxU = Math.max(maxU, paintUv[i]);
    }
    expect(maxU - minU).toBeGreaterThan(0.2);

    const again = await loadVehicle(exported.bytes, 'fused-finish.glb');
    const door = again.scene.getObjectByName('door_fl');
    expect(door.userData.seDoor).toBe('fl');
    expect(again.scene.getObjectByName('wheel_fl_steer').getObjectByName('wheel_fl_spin')).toBeTruthy();
    expect(again.scene.getObjectByName('wheel_rl_spin')).toBeTruthy();
    expect(again.scene.getObjectByName('wheel_rl_steer')).toBeFalsy();
    const spin = again.scene.getObjectByName('wheel_fl_spin');
    const center = new THREE.Box3().setFromObject(spin).getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3().setFromMatrixPosition(spin.matrixWorld);
    expect(origin.distanceTo(center)).toBeLessThan(0.01);
    const paintAgain = [];
    again.scene.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.name === 'se_paint') paintAgain.push(obj);
    });
    expect(paintAgain.length).toBeGreaterThan(0);
    const failed = exported.checks.filter((check) => !check.pass).map((check) => check.id);
    expect(failed).not.toContain('paint-split');
    expect(failed).not.toContain('door_fl');
    expect(failed).not.toContain('wheel_fl-spin');

    const zip = unzipStore(finishZip(loaded, session.edit, exported.bytes, exported.checks));
    const names = zip.map((file) => file.name);
    expect(names).toContain('mapping.json');
    expect(names).toContain('validation.txt');
    expect(names.some((name) => name.endsWith('.glb'))).toBe(true);
    const notes = new TextDecoder().decode(zip.find((file) => file.name === 'validation.txt').data);
    expect(notes).toContain(sourceSha);
    expect(notes).toContain('does not rebuild topology');
    expect(notes.toLowerCase()).not.toContain('game ready');
    for (const view of ['review-front.png', 'review-side.png', 'review-top.png', 'review-parts.png']) {
      const image = decodePng(zip.find((file) => file.name === view).data);
      expect(image.width).toBe(320);
      let ink = 0;
      for (let i = 0; i < image.rgba.length; i += 4) {
        if (image.rgba[i] !== 7 || image.rgba[i + 1] !== 16 || image.rgba[i + 2] !== 31) ink += 1;
      }
      expect(ink).toBeGreaterThan(20);
    }
    const mapping = JSON.parse(new TextDecoder().decode(zip.find((file) => file.name === 'mapping.json').data));
    expect(mapping.sha256).toBe(sourceSha);
  }, 30000);

  it('roundtrips the supplied sedan and keeps paint off the other materials', async () => {
    const source = new Uint8Array(readFileSync('fixtures/vehicle/sedan-review.glb'));
    expect(await sha256Hex(source)).toBe(SEDAN_SHA);
    const loaded = await loadVehicle(source, 'sedan-review.glb');
    expect(await sha256Hex(loaded.bytes)).toBe(SEDAN_SHA);
    const info = inspectVehicle(loaded);
    expect(info.triangles).toBe(47821);
    expect(info.materials.map((item) => item.name).sort()).toEqual(['body_paint', 'sedan_atlas', 'sedan_glass', 'sedan_lamps']);
    const text = info.issues.join('\n');
    expect(text).toContain('0.956');
    expect(text).toContain('Nothing was rescaled');
    expect(text).toContain('Lowest point');
    expect(text).toContain('meshopt');
    expect(text).toContain('WebP');

    const untouched = exportVehicle(loaded, createSession(loaded).edit);
    expect(await sha256Hex(loaded.bytes)).toBe(SEDAN_SHA);
    const back = await loadVehicle(untouched.bytes, 'sedan-roundtrip.glb');
    expect(back.scene.getObjectByName('door_fl').userData.seDoor).toBe('fl');
    expect(back.scene.getObjectByName('door_rr').userData.seDoor).toBe('rr');
    expect(back.scene.getObjectByName('wheel_fl_steer').getObjectByName('wheel_fl_spin').getObjectByName('wheel_fl_mesh')).toBeTruthy();
    expect(back.scene.getObjectByName('wheel_fr_steer')).toBeTruthy();
    let triangles = 0;
    back.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const index = obj.geometry.getIndex();
      triangles += index.count / 3;
    });
    expect(triangles).toBe(47821);
    const sourceGlass = loaded.json.materials.find((item) => item.name === 'sedan_glass').pbrMetallicRoughness.baseColorFactor;
    expect(material(untouched.doc, 'sedan_glass').baseColorFactor).toEqual(sourceGlass);
    const albedo = loaded.images.find((image) => image.name === 'albedo').bytes;
    expect(sameBytes(material(untouched.doc, 'sedan_atlas').baseColorImage.bytes, albedo)).toBe(true);
    expect(untouched.checks.some((check) => check.id === 'textures' && check.pass === false)).toBe(true);
    expect(untouched.checks.some((check) => /game ready/i.test(check.detail))).toBe(false);

    const atlas = loaded.surfaces.find((surface) => surface.material === 'sedan_atlas' && surface.faceCount > 6);
    const session = createSession(loaded);
    changeEdit(session, (edit) => {
      assignFaces(edit, span(atlas.key, 0, 6), 'material', 'paint');
      edit.paint.hex = '#00aa44';
    });
    const edited = exportVehicle(loaded, session.edit);
    expect(await sha256Hex(source)).toBe(SEDAN_SHA);
    const paint = material(edited.doc, 'se_paint');
    expect(paint.baseColorFactor.map((value) => Number(value.toFixed(5)))).toEqual(linearFactor('#00aa44').map((value) => Number(value.toFixed(5))));
    expect(material(edited.doc, 'sedan_glass').baseColorFactor).toEqual(sourceGlass);
    expect(sameBytes(material(edited.doc, 'sedan_atlas').baseColorImage.bytes, albedo)).toBe(true);
    expect(sameBytes(material(edited.doc, 'sedan_lamps').emissiveImage.bytes, albedo) || material(edited.doc, 'sedan_lamps').emissiveImage.name === 'albedo').toBe(true);
    expect(hash(paint.baseColorImage.bytes)).not.toBe(hash(albedo));
    const paintTris = edited.stats.materials.find((item) => item.name === 'se_paint').triangles;
    const atlasBefore = info.materials.find((item) => item.name === 'sedan_atlas').triangles;
    const atlasAfter = edited.stats.materials.find((item) => item.name === 'sedan_atlas').triangles;
    expect(paintTris).toBe(6);
    expect(atlasAfter).toBe(atlasBefore - 6);
    const reloaded = await loadVehicle(edited.bytes, 'sedan-paint.glb');
    const names = new Set();
    reloaded.scene.traverse((obj) => { if (obj.isMesh && obj.material) names.add(obj.material.name); });
    expect(names.has('se_paint')).toBe(true);
    expect(names.has('sedan_glass')).toBe(true);
    const readBack = readGlb(edited.bytes);
    expect(readBack.json.extensionsRequired || []).not.toContain('EXT_meshopt_compression');
    const packedGlass = readBack.json.materials.find((item) => item.name === 'sedan_glass').pbrMetallicRoughness.baseColorFactor;
    expect(packedGlass).toEqual(sourceGlass);
  }, 60000);
});
