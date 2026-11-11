import { describe, expect, it } from 'vitest';
import { loadVehicle, readGlb, sha256Hex } from '../src/asset/finish/glb.js';
import { singleAtlasCarGlb, solidCarGlb } from '../src/asset/finish/fixture.js';
import { resolveProfile } from '../src/asset/finish/profiles.js';
import { growFaces, seamBlocks } from '../src/asset/finish/select.js';
import { runFinish } from '../src/asset/finish/pipeline.js';

async function run(bytes, profile, options) {
  const loaded = await loadVehicle(bytes, 'car.glb');
  return { loaded, result: await runFinish(loaded, profile, options) };
}

describe('finish pipeline', () => {
  it('scales a single-atlas car, splits real wheel islands, and does not issue READY', async () => {
    const source = singleAtlasCarGlb();
    const sourceSha = await sha256Hex(source);
    const { loaded, result } = await run(source, resolveProfile('CAR'), { frontConfirmed: true });
    expect(loaded.sha256).toBe(sourceSha);
    expect(result.issuedReady).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.banner).toBe('LOGGED');
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
    expect(result.log.some((line) => line.includes('does not read a window mask'))).toBe(true);
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
