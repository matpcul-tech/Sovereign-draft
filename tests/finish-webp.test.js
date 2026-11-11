import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import enc from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions } from '@jsquash/webp/meta.js';
import { loadVehicle, readImages } from '../src/asset/finish/glb.js';
import { singleAtlasCarGlb } from '../src/asset/finish/fixture.js';
import { decodeRaster } from '../src/asset/finish/raster.js';
import { resolveProfile } from '../src/asset/finish/profiles.js';
import { runFinish } from '../src/asset/finish/pipeline.js';

describe('webp textures', () => {
  it('measures the sedan WebP and resizes a larger WebP', async () => {
    const images = readImages(readFileSync('fixtures/vehicle/sedan-review.glb'));
    const sedan = await decodeRaster(images[0].bytes, images[0].mime);
    expect(sedan.width).toBe(1024);
    expect(sedan.height).toBe(1024);
    const wasm = await readFile('node_modules/@jsquash/webp/codec/enc/webp_enc.wasm');
    const encoder = await enc({ wasmBinary: wasm });
    const rgba = new Uint8ClampedArray(1600 * 8 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 40;
      rgba[i + 1] = 90;
      rgba[i + 2] = 180;
      rgba[i + 3] = 255;
    }
    const webp = encoder.encode(rgba, 1600, 8, defaultOptions);
    const decoded = await decodeRaster(webp, 'image/webp');
    expect(decoded.width).toBe(1600);
    expect(decoded.rgba[2]).toBeGreaterThan(100);
    const loaded = await loadVehicle(singleAtlasCarGlb({ name: 'atlas', mime: 'image/webp', bytes: webp }), 'webp.glb');
    const result = await runFinish(loaded, resolveProfile('CAR'), { frontConfirmed: true });
    const texture = result.checks.find((check) => check.id === 'texture');
    expect(texture.pass).toBe(true);
    expect(result.log.join('\n')).toMatch(/resized from 1600x8 to 1024x5/);
  });
});
