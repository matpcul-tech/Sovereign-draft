import { describe, expect, it } from "vitest";
import { finishModel } from "../src/assetapp/engine.js";
import { findAwnings, stripeColors, stripeCount } from "../src/assetapp/awnings.js";
import { levelGrain } from "../src/assetapp/walls.js";
import { litPattern } from "../src/assetapp/windows.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io, modelBytes, pngCodec } from "./assetapp-helpers.js";

// A wall 4 wide and 6 tall facing -z, with an awning 3 wide hanging off it: a sloping top and a
// valance below its outer edge. The awning's old UVs cover the whole texture.
function shop() {
  const pos = [-2, 0, -2, 2, 0, -2, 2, 6, -2, -2, 6, -2, /* awning top */ -1.5, 3, -2, 1.5, 3, -2, 1.5, 2.5, -2.6, -1.5, 2.5, -2.6, /* valance, a separate strip the way a generator leaves it */ -1.5, 2.5, -2.61, 1.5, 2.5, -2.61, 1.5, 2.3, -2.61, -1.5, 2.3, -2.61];
  const nor = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0.77, -0.64, 0, 0.77, -0.64, 0, 0.77, -0.64, 0, 0.77, -0.64, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const uv = [0, 0, 0.01, 0, 0.01, 0.01, 0, 0.01, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
  return { pos, nor, uv, idx };
}
const painted = (size, fn) => { const rgba = new Uint8Array(size * size * 4); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([...fn(x, y), 255], (y * size + x) * 4); return rgba; };
// stripes that wander: red, white and blue bands whose edges slide with the row
const torn = (size) => painted(size, (x, y) => { const k = Math.floor((x + 9 * Math.sin(y / 5)) / 12) % 4; return k === 0 ? [150, 25, 30] : k === 2 ? [25, 35, 110] : [225, 220, 215]; });

describe("Sovereign Asset awnings: finding one", () => {
  it("takes a sloping panel off a wall with its valance, and leaves the wall", () => {
    const s = shop();
    const found = findAwnings(Float32Array.from(s.pos), Uint32Array.from(s.idx), 8, 0, 6);
    expect(found.length).toBe(1);
    expect(found[0].tris.slice().sort()).toEqual([2, 3, 4, 5]);
    expect(found[0].top.slice().sort()).toEqual([2, 3]);
    expect(found[0].a1 - found[0].a0).toBeCloseTo(3, 5);
    expect(Math.abs(found[0].along[0])).toBeCloseTo(1, 5); // its width runs along the wall
  });

  it("does not take a roof at the top of the building or a slab near the ground", () => {
    const high = shop(), low = shop();
    for (let i = 13; i < high.pos.length; i += 3) high.pos[i] += 2.9;
    for (let i = 13; i < low.pos.length; i += 3) low.pos[i] -= 1.9;
    expect(findAwnings(Float32Array.from(high.pos), Uint32Array.from(high.idx), 8, 0, 6).length).toBe(0);
    expect(findAwnings(Float32Array.from(low.pos), Uint32Array.from(low.idx), 8, 0, 6).length).toBe(0);
  });
});

describe("Sovereign Asset awnings: reading the stripes", () => {
  const mix = (...parts) => parts.flatMap(([color, n]) => Array.from({ length: n }, (v, i) => color.map((c) => c + (i % 5) - 2)));

  it("puts the white between the two colors", () => {
    const colors = stripeColors(mix([[150, 25, 30], 40], [[225, 220, 215], 80], [[25, 35, 110], 40]));
    expect(colors.length).toBe(4);
    expect(colors[1]).toEqual(colors[3]);
    expect(colors[1][0]).toBeGreaterThan(200);
    expect(colors[0][0] > 120 || colors[2][0] > 120).toBe(true); // a red
    expect(colors[0][2] > 90 || colors[2][2] > 90).toBe(true);   // and a blue
  });

  it("reads two colors as two", () => {
    const colors = stripeColors(mix([[20, 110, 50], 60], [[230, 225, 215], 60]));
    expect(colors.length).toBe(2);
  });

  it("is not fooled by one color, or by brown on brown", () => {
    expect(stripeColors(mix([[150, 25, 30], 100]))).toBe(null);
    expect(stripeColors(mix([[110, 95, 85], 60], [[70, 60, 55], 60]))).toBe(null); // a shingle porch roof
  });

  it("fits whole repeats and one more stripe, so both ends match", () => {
    expect(stripeCount(3, 0.2, 4)).toBe(17);
    expect(stripeCount(3, 0.2, 2)).toBe(15);
    expect(stripeCount(0.1, 0.2, 2)).toBe(3);
  });
});

describe("Sovereign Asset awnings: in the finished file", () => {
  const build = (rgba, size) => modelBytes(shop(), async (doc, node, mat) => { mat.setName("old").setBaseColorTexture(doc.createTexture("color").setImage(encodePng(size, size, rgba)).setMimeType("image/png")); });

  it("draws torn stripes again, straight and even, in the awning's own colors", async () => {
    const result = await finishModel(await build(torn(128), 128), { walls: "stucco", maxTexture: 512, size: { axis: "height", meters: 6 } }, { codec: pngCodec });
    expect(result.log.join(" ")).toMatch(/Awnings: 1 striped awning drawn again/);
    const doc = await (await io()).readBinary(result.bytes);
    const cloth = doc.getRoot().listMaterials().find((m) => m.getName() === "awning");
    expect(cloth).toBeTruthy();
    const img = decodePng(cloth.getBaseColorTexture().getImage());
    expect(img.width).toBe(512); // 3 m at about 0.2 m a stripe: 17 stripes, 16 pixels or more each
    // every column is one color top to bottom
    for (let x = 0; x < img.width; x++) for (let c = 0; c < 3; c++) expect(img.rgba[x * 4 + c]).toBe(img.rgba[((img.height - 1) * img.width + x) * 4 + c]);
    // 17 even stripes: 16 changes of color, evenly spaced, and both ends match
    const changes = [];
    for (let x = 1; x < img.width; x++) if (img.rgba[x * 4] !== img.rgba[(x - 1) * 4] || img.rgba[x * 4 + 2] !== img.rgba[(x - 1) * 4 + 2]) changes.push(x);
    expect(changes.length).toBe(16);
    for (let k = 1; k < changes.length; k++) expect(Math.abs(changes[k] - changes[k - 1] - 512 / 17)).toBeLessThan(1.01);
    for (let c = 0; c < 3; c++) expect(img.rgba[c]).toBe(img.rgba[(img.width - 1) * 4 + c]);
    // its triangles all moved to the new part, each corner inside the texture
    const prim = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial() === cloth);
    expect(prim.getIndices().getCount()).toBe(12);
    for (const v of prim.getAttribute("TEXCOORD_0").getArray()) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it("leaves a plain awning and a shingle porch roof as they are", async () => {
    for (const fn of [() => [150, 25, 30], (x, y) => ((x + y) % 7 < 3 ? [110, 95, 85] : [70, 60, 55])]) {
      const result = await finishModel(await build(painted(64, fn), 64), { walls: "stucco", maxTexture: 256 }, { codec: pngCodec });
      expect(result.log.join(" ")).not.toMatch(/Awnings/);
    }
  });
});

describe("Sovereign Asset: fine brick and the shop window", () => {
  it("tells level courses from plain paint by which way the paint changes", () => {
    const size = 64, mask = new Uint8Array(size * size).fill(1), spot = { x: 0, y: 0, w: size, h: size };
    const brick = painted(size, (x, y) => (y % 4 === 0 ? [90, 70, 60] : [150, 80, 60]));
    const noise = painted(size, (x, y) => { const v = 120 + ((x * 37 + y * 91) % 23); return [v, v, v]; });
    expect(levelGrain(brick, mask, size, spot)).toBeGreaterThan(3);
    expect(levelGrain(noise, mask, size, spot)).toBeLessThan(1.5);
    expect(levelGrain(brick, new Uint8Array(size * size), size, spot)).toBe(0);
    const bands = painted(size, (x, y) => (y > 40 ? [170, 130, 90] : [220, 200, 180]));
    expect(levelGrain(bands, mask, size, spot)).toBe(0); // one edge between two bands of paint is not courses
  });

  it("always lights the biggest window on the ground floor", () => {
    // found by search: a shop window the scatter leaves dark
    let shopWindow = null;
    for (let left = 0; left < 40 && !shopWindow; left++) {
      const w = { left: left * 0.37, bottom: 0.4, width: 2, height: 1.5, normal: [0, 0, 1] };
      const scatter = ((Math.round(w.left * 37.1) * 73856093 ^ Math.round(w.bottom * 53.3) * 19349663 ^ Math.round(Math.atan2(0, 1) * 2) * 83492791) >>> 0) % 100 < 66;
      if (!scatter) shopWindow = w;
    }
    expect(shopWindow).toBeTruthy();
    const upstairs = { left: shopWindow.left, bottom: 3.4, width: 3, height: 2, normal: [0, 0, 1] };
    const small = { left: shopWindow.left + 5, bottom: 0.5, width: 0.5, height: 0.5, normal: [0, 0, 1] };
    const on = litPattern([upstairs, shopWindow, small]);
    expect(on[1]).toBe(true);
    expect(litPattern([])).toEqual([]);
  });
});
