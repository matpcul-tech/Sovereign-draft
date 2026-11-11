import { describe, expect, it } from 'vitest';
import { loadVehicle, packGlb, readGlb, sha256Hex } from '../src/asset/finish/glb.js';
import { atlasPng, singleAtlasCarGlb, solidCarGlb } from '../src/asset/finish/fixture.js';
import { encodePng } from '../src/asset/finish/png.js';
import { unzipStore } from '../src/asset/finish/zip.js';
import { resolveProfile } from '../src/asset/finish/profiles.js';
import { growFaces, seamBlocks } from '../src/asset/finish/select.js';
import { runFinish } from '../src/asset/finish/pipeline.js';

async function run(bytes, profile, options) {
  const loaded = await loadVehicle(bytes, 'car.glb');
  return { loaded, result: await runFinish(loaded, profile, options) };
}

function pushBox(dst, min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const verts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
  ];
  const start = dst.p.length / 3;
  for (const vert of verts) {
    dst.p.push(...vert);
    dst.u.push(0.2, 0.2);
    dst.n.push(0, 1, 0);
  }
  for (const face of faces) dst.i.push(start + face[0], start + face[1], start + face[2]);
}

function meshGlb(fill, image) {
  const dst = { p: [], u: [], n: [], i: [] };
  fill(dst);
  return packGlb({
    sceneName: 'piece',
    roots: [0],
    materials: [{
      name: 'atlas',
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      baseColorImage: { name: 'atlas', mime: 'image/png', bytes: image || atlasPng() }
    }],
    meshes: [{
      name: 'shell',
      primitives: [{
        material: 0,
        position: new Float32Array(dst.p),
        normal: new Float32Array(dst.n),
        uv: new Float32Array(dst.u),
        indices: new Uint32Array(dst.i)
      }]
    }],
    nodes: [{ name: 'shell', mesh: 0 }]
  });
}

function figureGlb(armsOut) {
  return meshGlb((dst) => {
    pushBox(dst, [-0.15, 0.25, -0.1], [0.15, 1.05, 0.1]);
    pushBox(dst, [-0.22, 1.05, -0.12], [0.22, 1.7, 0.12]);
    pushBox(dst, [-0.12, 1.7, -0.1], [0.12, 2.15, 0.1]);
    if (armsOut) {
      pushBox(dst, [-1.05, 1.42, -0.08], [-0.22, 1.58, 0.08]);
      pushBox(dst, [0.22, 1.42, -0.08], [1.05, 1.58, 0.08]);
    } else {
      pushBox(dst, [-0.18, 0.7, -0.08], [0.18, 1.45, 0.08]);
    }
  });
}

function windowCarGlb() {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const index = (y * 32 + x) * 4;
      const glass = x >= 16;
      rgba[index] = glass ? 34 : 40;
      rgba[index + 1] = glass ? 34 : 90;
      rgba[index + 2] = glass ? 34 : 180;
      rgba[index + 3] = 255;
    }
  }
  return meshGlb((dst) => {
    const body = dst.p.length / 3;
    pushBox(dst, [-0.35, 0, -1], [0.35, 1, 1]);
    glassBand(dst, body + 3, -0.35, 1, 1.28);
    pushBox(dst, [-0.72, 0.02, 0.55], [-0.48, 0.26, 0.82]);
    pushBox(dst, [0.48, 0.02, 0.55], [0.72, 0.26, 0.82]);
    pushBox(dst, [-0.72, 0.02, -0.82], [-0.48, 0.26, -0.55]);
    pushBox(dst, [0.48, 0.02, -0.82], [0.72, 0.26, -0.55]);
  }, encodePng(32, 32, rgba));
}

function glassBand(dst, a, x, y0, y1) {
  const start = dst.p.length / 3;
  const x2 = x - 0.04;
  dst.p.push(x2, y0, -1, x2, y0, 1, x2, y1, 1, x2, y1, -1, x2, (y0 + y1) / 2, 0);
  dst.u.push(0.7, 0.35, 0.9, 0.35, 0.9, 0.7, 0.7, 0.7, 0.8, 0.5);
  dst.n.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
  dst.i.push(a, start, start + 1, start, start + 1, start + 4, start + 1, start + 2, start + 4, start + 2, start + 3, start + 4, start + 3, start, start + 4);
}

function blockGlb(min, max) {
  return meshGlb((dst) => pushBox(dst, min, max));
}

describe('finish pipeline', () => {
  it('scales a single-atlas car, splits real wheel islands, and does not issue READY', async () => {
    const source = singleAtlasCarGlb();
    const sourceSha = await sha256Hex(source);
    const { loaded, result } = await run(source, resolveProfile('CAR'), { frontConfirmed: true });
    expect(loaded.sha256).toBe(sourceSha);
    expect(result.issuedReady).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.banner).toBe('NOT READY');
    expect(result.checks.find((check) => check.id === 'mask').pass).toBe(false);
    expect(result.before.triangles).toBeGreaterThan(result.after.triangles);
    expect(result.after.size[2]).toBeGreaterThan(4.4);
    expect(result.after.size[2]).toBeLessThan(4.6);
    expect(Math.abs(result.after.minY)).toBeLessThan(0.001);
    expect(Math.abs(result.after.center[0])).toBeLessThan(0.001);
    const { json } = readGlb(result.bytes);
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0].name).toBe('atlas');
    const names = json.nodes.map((node) => node.name).sort();
    expect(names).toEqual(['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);
    for (const node of json.nodes) {
      if (node.name.startsWith('wheel_')) expect(node.extras.kitWheel).toBe(true);
      expect(node.scale).toBeUndefined();
      expect(node.rotation).toBeUndefined();
    }
    expect(json.meshes).toHaveLength(5);
    expect(result.log.some((line) => line.includes('Simplify skipped'))).toBe(true);
    expect(result.summary).toMatch(/declared checks failed/);
    expect(result.sourceSha).toBe(sourceSha);
  });

  it('simplifies toward a low target and only downsamples an oversized PNG', async () => {
    const source = singleAtlasCarGlb();
    const profile = resolveProfile('CAR', { triangleTarget: 30, triangleCeiling: 50, maxTexture: 2 });
    const { result } = await run(source, profile, { frontConfirmed: true });
    expect(result.banner).toBe('NOT READY');
    expect(result.checks.find((check) => check.id === 'budget').pass).toBe(false);
    expect(result.checks.find((check) => check.id === 'budget').action).toMatch(/not unlocked/);
    expect(result.log.some((line) => line.includes('Simplified'))).toBe(true);
    expect(result.log.some((line) => line.includes('resized'))).toBe(true);
    const { json } = readGlb(result.bytes);
    expect(json.materials[0].name).toBe('atlas');
  });

  it('does not invent wheels or simplify a solid shell', async () => {
    const { result } = await run(solidCarGlb(), resolveProfile('CAR'), { frontConfirmed: true });
    expect(result.banner).toBe('NOT READY');
    expect(result.bytes).toBeNull();
    expect(result.summary).toMatch(/wheel/i);
    expect(result.log.some((line) => /simplify did not run/i.test(line))).toBe(true);
  });

  it('does not bake a multi-material sedan into one atlas', async () => {
    const bytes = await import('node:fs').then((fs) => fs.readFileSync('fixtures/vehicle/sedan-review.glb'));
    const { result } = await run(bytes, resolveProfile('CAR'), { frontConfirmed: true });
    expect(result.banner).toBe('NOT READY');
    expect(result.bytes).toBeNull();
    expect(result.summary).toMatch(/4 materials/);
    expect(result.summary).toMatch(/not baked/);
  });

  it('accepts a T pose and rejects a narrow character without rigging', async () => {
    const posed = await run(figureGlb(true), resolveProfile('CHARACTER'), { frontConfirmed: true });
    expect(posed.result.checks.find((check) => check.id === 'pose').pass).toBe(true);
    expect(posed.result.after.size[1]).toBeGreaterThan(1.75);
    expect(posed.result.after.size[1]).toBeLessThan(1.85);
    expect(Math.abs(posed.result.after.minY)).toBeLessThan(0.001);
    const { json } = readGlb(posed.result.bytes);
    expect(json.skins).toBeUndefined();
    const narrow = await run(figureGlb(false), resolveProfile('CHARACTER'), { frontConfirmed: true });
    expect(narrow.result.banner).toBe('NOT READY');
    expect(narrow.result.checks.find((check) => check.id === 'pose').pass).toBe(false);
    expect(narrow.result.checks.find((check) => check.id === 'pose').action).toMatch(/does not rig/);
  });

  it('grounds a long building and refuses a square footprint', async () => {
    const raised = await run(blockGlb([-3, 0.4, -2], [3, 4.4, 2]), resolveProfile('BUILDING'), { frontConfirmed: true });
    expect(raised.result.checks.find((check) => check.id === 'base').pass).toBe(true);
    expect(raised.result.after.size[1]).toBeGreaterThan(3.9);
    expect(raised.result.after.size[1]).toBeLessThan(4.1);
    expect(Math.abs(raised.result.after.minY)).toBeLessThan(0.001);
    const square = await run(blockGlb([-2, 0, -2], [2, 4, 2]), resolveProfile('BUILDING'), { frontConfirmed: true });
    expect(square.result.banner).toBe('NOT READY');
    expect(square.result.summary).toMatch(/Forward is ambiguous/);
  });

  it('issues READY only when the declared car checks pass', async () => {
    const { result } = await run(windowCarGlb(), resolveProfile('CAR'), { frontConfirmed: true });
    expect(result.banner).toBe('READY');
    expect(result.ready).toBe(true);
    expect(result.summary).toMatch(/not a gameplay/);
    expect(result.summary).toMatch(/does not read the mask/);
    const { json } = readGlb(result.bytes);
    expect(json.materials[0].extras.kitMask).toBe(true);
    expect(json.materials[0].emissiveFactor).toEqual([0, 0, 0]);
    expect(json.materials[0].emissiveTexture).toBeTruthy();
    const files = unzipStore(result.zip);
    const names = files.map((file) => file.name);
    expect(names).toContain('validation.txt');
    expect(names).toContain('model.glb');
    const note = new TextDecoder().decode(files.find((file) => file.name === 'validation.txt').data);
    expect(note.startsWith('READY')).toBe(true);
  });

  it('stops grow on a UV seam and a sampled color edge', () => {
    const world = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0
    ]);
    const uvs = new Float32Array([
      0, 0, 0.1, 0, 0, 0.1,
      0.9, 0, 1, 0, 0.9, 0.1
    ]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const topology = { neighbors: [[1], [0]] };
    const blocks = seamBlocks(world, uvs, null, 0, 0);
    expect(growFaces(topology, normals, [0], Infinity).size).toBe(2);
    expect(growFaces(topology, normals, [0], Infinity, blocks).size).toBe(1);
    const splitUv = new Float32Array([
      0.1, 0.1, 0.2, 0.1, 0.1, 0.2,
      0.8, 0.8, 0.9, 0.8, 0.8, 0.9
    ]);
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const x = i % 4;
      rgba[i * 4] = x < 2 ? 220 : 10;
      rgba[i * 4 + 1] = 10;
      rgba[i * 4 + 2] = x < 2 ? 10 : 220;
      rgba[i * 4 + 3] = 255;
    }
    const colorBlocks = seamBlocks(world, splitUv, rgba, 4, 4);
    expect(colorBlocks.size).toBe(1);
  });
});
