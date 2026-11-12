import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadVehicle, packGlb, readGlb, sha256Hex } from '../src/asset/finish/glb.js';
import { atlasPng, crossingCarGlb, singleAtlasCarGlb, solidCarGlb } from '../src/asset/finish/fixture.js';
import { decodePng, encodePng } from '../src/asset/finish/png.js';
import { unzipStore } from '../src/asset/finish/zip.js';
import { resolveProfile } from '../src/asset/finish/profiles.js';
import { faceTopology, growFaces, seamBlocks, wheelSurfaceBlocks } from '../src/asset/finish/select.js';
import { runFinish } from '../src/asset/finish/pipeline.js';

async function run(bytes, profile, options) {
  const loaded = await loadVehicle(bytes, 'car.glb');
  return { loaded, result: await runFinish(loaded, profile, options) };
}

function pushBox(dst, min, max, uv) {
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
  const cornerUv = uv
    ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]], [uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]
    : null;
  verts.forEach((vert, index) => {
    dst.p.push(...vert);
    dst.u.push(cornerUv ? cornerUv[index][0] : 0.2, cornerUv ? cornerUv[index][1] : 0.2);
    dst.n.push(0, 1, 0);
  });
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
    pushBox(dst, [-0.35, 0, -1], [0.35, 1, 1], [0.05, 0.2, 0.48, 0.75]);
    glassBand(dst, body + 3, -0.35, 1, 1.28);
    pushBox(dst, [-0.72, 0.02, 0.55], [-0.48, 0.26, 0.82], [0.78, 0.05, 0.95, 0.22]);
    pushBox(dst, [0.48, 0.02, 0.55], [0.72, 0.26, 0.82], [0.78, 0.05, 0.95, 0.22]);
    pushBox(dst, [-0.72, 0.02, -0.82], [-0.48, 0.26, -0.55], [0.78, 0.05, 0.95, 0.22]);
    pushBox(dst, [0.48, 0.02, -0.82], [0.72, 0.26, -0.55], [0.78, 0.05, 0.95, 0.22]);
  }, encodePng(32, 32, rgba));
}

function glassBand(dst, a, x, y0, y1) {
  const start = dst.p.length / 3;
  const x2 = x - 0.04;
  dst.p.push(x2, y0, -1, x2, y0, 1, x2, y1, 1, x2, y1, -1, x2, (y0 + y1) / 2, 0);
  dst.u.push(0.48, 0.35, 0.7, 0.35, 0.7, 0.72, 0.48, 0.72, 0.59, 0.52);
  dst.n.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
  dst.i.push(a, start, start + 1, start, start + 1, start + 4, start + 1, start + 2, start + 4, start + 2, start + 3, start + 4, start + 3, start, start + 4);
}

function blockGlb(min, max) {
  return meshGlb((dst) => pushBox(dst, min, max));
}

function gridFace(dst, corners, n, uv) {
  const start = dst.p.length / 3;
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const a = x / n;
      const b = y / n;
      const p = [0, 1, 2].map((axis) => {
        const p00 = corners[0][axis];
        const p10 = corners[1][axis];
        const p11 = corners[2][axis];
        const p01 = corners[3][axis];
        return p00 * (1 - a) * (1 - b) + p10 * a * (1 - b) + p11 * a * b + p01 * (1 - a) * b;
      });
      dst.p.push(p[0], p[1], p[2]);
      dst.u.push(uv[0], uv[1]);
      dst.n.push(0, 1, 0);
    }
  }
  const row = n + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = start + y * row + x;
      dst.i.push(i, i + 1, i + row + 1, i, i + row + 1, i + row);
    }
  }
}

function denseBox(dst, min, max, n) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces = [
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
  ];
  for (const face of faces) gridFace(dst, face, n, [0.2, 0.2]);
}

function widePng() {
  const width = 1200;
  const height = 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const glass = (i % width) >= width / 2;
    rgba[i * 4] = glass ? 34 : 40;
    rgba[i * 4 + 1] = glass ? 34 : 90;
    rgba[i * 4 + 2] = glass ? 34 : 180;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

function denseWindowCar() {
  return meshGlb((dst) => {
    denseBox(dst, [-0.35, 0, -1], [0.35, 1, 1], 58);
    const body = 0;
    glassBand(dst, body + 3, -0.35, 1, 1.28);
    pushBox(dst, [-0.72, 0.02, 0.55], [-0.48, 0.26, 0.82]);
    pushBox(dst, [0.48, 0.02, 0.55], [0.72, 0.26, 0.82]);
    pushBox(dst, [-0.72, 0.02, -0.82], [-0.48, 0.26, -0.55]);
    pushBox(dst, [0.48, 0.02, -0.82], [0.72, 0.26, -0.55]);
    for (let i = 0; i < dst.p.length; i += 3) {
      dst.p[i] *= 0.5;
      dst.p[i + 1] = dst.p[i + 1] * 0.5 + 0.45;
      dst.p[i + 2] *= 0.5;
    }
  }, widePng());
}

function denseBlock(minTris, min = [-2, 0, -5], max = [2, 2, 5]) {
  let n = 8;
  while (12 * n * n < minTris) n += 1;
  return meshGlb((dst) => {
    denseBox(dst, min, max, n);
    for (let i = 1; i < dst.p.length; i += 3) dst.p[i] += 0.5;
  }, widePng());
}

function denseFigure(minTris) {
  return meshGlb((dst) => {
    let n = 8;
    while (12 * n * n < minTris) n += 1;
    denseBox(dst, [-0.2, 0.2, -0.15], [0.2, 1.5, 0.15], n);
    pushBox(dst, [-1.1, 1.2, -0.08], [-0.2, 1.38, 0.08]);
    pushBox(dst, [0.2, 1.2, -0.08], [1.1, 1.38, 0.08]);
    pushBox(dst, [-0.12, 1.5, -0.1], [0.12, 1.9, 0.1]);
  }, widePng());
}

function fusedConnectedGlb() {
  return meshGlb((dst) => {
    const start = dst.p.length / 3;
    pushBox(dst, [-0.35, 0.2, -1], [0.35, 0.9, 1]);
    dst.p.push(0.7, 0.15, 0.7, 0.95, 0.15, 0.7, 0.8, 0.4, 0.7);
    dst.u.push(0.2, 0.2, 0.2, 0.2, 0.2, 0.2);
    dst.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    dst.i.push(start, dst.p.length / 3 - 3, dst.p.length / 3 - 2);
  });
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

  it('measures a 1 to 2 px glass edge on a continuous atlas and counts the pad conflict', async () => {
    const { result } = await run(windowCarGlb(), resolveProfile('CAR'), { frontConfirmed: true });
    const edge = result.checks.find((check) => check.id === 'mask-edge');
    const clean = result.checks.find((check) => check.id === 'mask-clean');
    const area = result.checks.find((check) => check.id === 'mask-area');
    expect(edge.pass).toBe(true);
    expect(edge.detail).toMatch(/1 to [12] px/);
    expect(area.pass).toBe(true);
    expect(area.detail).toMatch(/Side view glass is/);
    expect(clean.pass).toBe(false);
    expect(clean.detail).toMatch(/[1-9][0-9]* unique texels/);
    expect(clean.detail).toMatch(/island pairs/);
    expect(Number(clean.detail.match(/(\d+) unique/)[1])).toBeLessThan(1024 * 1024);
    expect(result.banner).toBe('NOT READY');
    expect(result.summary).toMatch(/declared checks failed/);
    const { json } = readGlb(result.bytes);
    expect(json.materials[0].extras.kitMask).toBe(true);
    expect(json.materials[0].emissiveFactor).toEqual([0, 0, 0]);
    const files = unzipStore(result.zip);
    const review = decodePng(files.find((file) => file.name === 'review-mask-4x.png').data);
    expect(review.width).toBe(160 * 4);
    expect(review.height).toBe(160 * 4);
    let teal = 0;
    let gold = 0;
    for (let i = 0; i < review.rgba.length; i += 4) {
      if (review.rgba[i + 1] > 180 && review.rgba[i] < 40) teal += 1;
      if (review.rgba[i] > 180 && review.rgba[i + 1] > 140 && review.rgba[i + 2] < 90) gold += 1;
    }
    expect(teal).toBeGreaterThan(1000);
    expect(gold).toBeGreaterThan(1000);
    const note = new TextDecoder().decode(files.find((file) => file.name === 'validation.txt').data);
    expect(note).toMatch(/boundary edges/);
    expect(note).toMatch(/Street Empire src\/kit.js does not read/);
  });

  it('cuts a large triangle through a specified wheel cylinder and keeps the exported border', async () => {
    const { result } = await run(crossingCarGlb(), resolveProfile('CAR'), { frontConfirmed: true });
    const text = result.log.join('\n');
    expect(text).toMatch(/Cut [1-9]/);
    expect(text).toMatch(/interpolate UV and normals/);
    const border = result.checks.find((check) => check.id === 'border');
    const bleed = result.checks.find((check) => check.id === 'bleed');
    expect(border.pass).toBe(true);
    expect(bleed.pass).toBe(true);
    expect(bleed.detail.startsWith('0 exported')).toBe(true);
    const { json, bin } = readGlb(result.bytes);
    const mesh = json.meshes.find((item) => item.name === 'body') || json.meshes[0];
    const uvView = json.bufferViews[json.accessors[mesh.primitives[0].attributes.TEXCOORD_0].bufferView];
    const uvStart = uvView.byteOffset || 0;
    const uvs = new Float32Array(bin.buffer, bin.byteOffset + uvStart, uvView.byteLength / 4);
    let interpolated = 0;
    for (let i = 0; i < uvs.length; i += 2) {
      const plain = Math.abs(uvs[i] - 0.2) < 1e-4 && Math.abs(uvs[i + 1] - 0.2) < 1e-4;
      const zero = Math.abs(uvs[i]) < 1e-4 && Math.abs(uvs[i + 1]) < 1e-4;
      if (!plain && !zero) interpolated += 1;
    }
    expect(interpolated).toBeGreaterThan(8);
  });

  it('finishes bad scale, ground, budget, and texture for each type', async () => {
    const car = await run(denseWindowCar(), resolveProfile('CAR'), { frontConfirmed: true });
    expect(car.result.before.triangles).toBeGreaterThan(40000);
    expect(car.result.before.minY).toBeGreaterThan(0.05);
    expect(car.result.checks.find((check) => check.id === 'budget').pass).toBe(true);
    expect(car.result.after.triangles).toBeLessThanOrEqual(40000);
    expect(car.result.after.size[2]).toBeGreaterThan(4.4);
    expect(car.result.after.size[2]).toBeLessThan(4.6);
    expect(Math.abs(car.result.after.minY)).toBeLessThan(0.001);

    const building = await run(denseBlock(9000), resolveProfile('BUILDING'), { frontConfirmed: true });
    expect(building.result.before.triangles).toBeGreaterThan(8000);
    expect(building.result.banner).toBe('READY');
    expect(building.result.after.triangles).toBeLessThanOrEqual(8000);
    expect(building.result.after.size[1]).toBeGreaterThan(3.9);

    const character = await run(denseFigure(16000), resolveProfile('CHARACTER'), { frontConfirmed: true });
    expect(character.result.before.triangles).toBeGreaterThan(15000);
    expect(character.result.banner).toBe('READY');
    expect(character.result.after.triangles).toBeLessThanOrEqual(15000);
    expect(character.result.checks.find((check) => check.id === 'pose').pass).toBe(true);

    const prop = await run(denseBlock(5000, [0, 0.4, 0], [2, 0.8, 0.4]), resolveProfile('PROP'), { frontConfirmed: true });
    expect(prop.result.before.triangles).toBeGreaterThan(4000);
    expect(prop.result.banner).toBe('READY');
    expect(prop.result.after.triangles).toBeLessThanOrEqual(4000);
    expect(Math.max(...prop.result.after.size)).toBeGreaterThan(0.95);
    expect(Math.max(...prop.result.after.size)).toBeLessThan(1.05);
  }, 60000);

  it('refuses a connected shell instead of inventing wheels', async () => {
    const { result } = await run(fusedConnectedGlb(), resolveProfile('CAR'), { frontConfirmed: true });
    expect(result.banner).toBe('NOT READY');
    expect(result.bytes).toBeNull();
    expect(result.summary + ' ' + result.checks.map((check) => check.action).join(' ')).toMatch(/VEHICLE/);
    expect(result.summary).toMatch(/wheel/i);
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
    const blocks = seamBlocks(world, uvs, null, 0, 0, ['shell', 'wheel']);
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

  it('stops grow on a wheel surface before any part is assigned', () => {
    const world = [];
    const push = (a, b, c) => world.push(...a, ...b, ...c);
    push([-0.4, 0.85, -0.3], [0.2, 0.85, -0.3], [0.0, 1.15, 0.2]);
    push([0.2, 0.85, -0.3], [0.55, 0.08, 0.62], [0.88, 0.08, 0.62]);
    push([0.55, 0.08, 0.62], [0.88, 0.08, 0.62], [0.72, 0.28, 0.95]);
    push([0.55, 0.08, 0.62], [0.72, 0.28, 0.95], [0.55, 0.28, 0.95]);
    push([0.88, 0.08, 0.62], [0.88, 0.28, 0.95], [0.72, 0.28, 0.95]);
    const corners = new Float32Array(world);
    const topology = faceTopology(corners);
    const blocks = wheelSurfaceBlocks(corners);
    const partIds = new Array(5).fill('shell');
    expect(seamBlocks(corners, null, null, 0, 0, partIds).size).toBe(0);
    expect(blocks.size).toBeGreaterThan(0);
    const open = growFaces(topology, new Float32Array(15), [1], Infinity);
    const grown = growFaces(topology, new Float32Array(15), [1], Infinity, blocks);
    expect(open.has(2)).toBe(true);
    expect(grown.has(1)).toBe(true);
    expect(grown.has(2)).toBe(false);
  });

  it('keeps the named wheels of the installed taxi atlas', async () => {
    const bytes = readFileSync('fixtures/vehicle/taxi-v1.glb');
    const { result } = await run(bytes, resolveProfile('CAR'), { frontConfirmed: true });
    expect(result.before.triangles).toBeGreaterThan(25000);
    const text = result.log.join('\n');
    expect(text).toMatch(/Positions were not moved/);
    expect(text).toMatch(/1024/);
    expect(result.checks.find((check) => check.id === 'wheels').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'border').detail).toMatch(/No shared cut was required/);
    expect(result.checks.find((check) => check.id === 'mesh-hit').detail).toMatch(/0 are new/);
    const area = result.checks.find((check) => check.id === 'mask-area');
    expect(area.pass).toBe(true);
    expect(area.detail).toMatch(/0 glass pixels sit below the belt/);
    const clean = result.checks.find((check) => check.id === 'mask-clean');
    const unique = Number((clean.detail.match(/(\d+) unique/) || [0, '0'])[1]);
    expect(unique).toBeGreaterThan(0);
    expect(unique).toBeLessThan(1024 * 1024);
    expect(result.checks.find((check) => check.id === 'manifold').detail).toMatch(/0 are new after the cut/);
    expect(result.checks.find((check) => check.id === 'open-edges').detail).toMatch(/not a closed-shell certificate/);
    expect(text).toMatch(/does not read that mask/);
    expect(result.banner).toBe('NOT READY');
  }, 60000);

  it('names four real wheel islands in the raw single-node sedan and does not keep a cut that adds intersections', async () => {
    const bytes = readFileSync('fixtures/vehicle/sedan-01-textured.glb');
    expect(await sha256Hex(bytes)).toBe('9e896daa94cd06ee47582c953f183cd26ab66a23ba3c856d7de74529d9c9cb8c');
    const { loaded, result } = await run(bytes, resolveProfile('CAR'), { frontConfirmed: true });
    expect(loaded.sha256).toBe('9e896daa94cd06ee47582c953f183cd26ab66a23ba3c856d7de74529d9c9cb8c');
    expect(result.before.triangles).toBe(30710);
    expect(result.banner).toBe('NOT READY');
    const text = result.log.join('\n');
    expect(text).toMatch(/One node was not treated as one island/);
    expect(text).toMatch(/Cut [1-9]/);
    expect(text).toMatch(/2048x2048 to 1024x1024/);
    expect(text).toMatch(/does not read that mask/);
    expect(result.checks.find((check) => check.id === 'wheels').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'mesh-hit').detail).toMatch(/0 are new/);
    expect(result.checks.find((check) => check.id === 'bleed').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'border').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'mask-area').detail).toMatch(/have glass on all four sides/);
    expect(result.checks.find((check) => check.id === 'mask-area').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'channels').detail).toMatch(/within 0 levels/);
    expect(result.checks.find((check) => check.id === 'channels').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'mask-edge').pass).toBe(true);
    expect(result.checks.find((check) => check.id === 'mask-clean').pass).toBe(false);
    expect(result.checks.find((check) => check.id === 'budget').pass).toBe(true);
    expect(result.after.triangles).toBeGreaterThan(30000);
    expect(result.after.triangles).toBeLessThanOrEqual(40000);
    expect(result.after.size[2]).toBeGreaterThan(4.45);
    expect(result.after.size[2]).toBeLessThan(4.55);
    expect(Math.abs(result.after.minY)).toBeLessThan(0.001);
    expect(result.checks.find((check) => check.id === 'manifold').detail).toMatch(/0 are new after the cut/);
    const review = decodePng(result.files.find((file) => file.name === 'review-mask-4x.png').data);
    expect(review.width).toBe(160 * 4);
    expect(review.height).toBe(160 * 4);
    const names = readGlb(result.bytes).json.nodes.map((node) => node.name).sort();
    expect(names).toEqual(['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);
  }, 60000);
});
