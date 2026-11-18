import { describe, expect, it } from "vitest";
import { finishModel } from "../src/assetapp/engine.js";
import { STANDARD, applyGain, colorStats, coverageMask, fitBakedLight, gainFrom, gainMap, holdToStandard, insideStandard, normalFromColor, paintOf, roughnessFromColor, texelDensity } from "../src/assetapp/surface.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io, modelBytes, pngCodec, solidPng } from "./assetapp-helpers.js";

const check = (result, id) => result.checks.find((c) => c.id === id);
const read = async (bytes) => (await io()).readBinary(bytes);
const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.min(1, v), 1 / 2.4) - 0.055));
const validate = async (bytes) => {
  const { validateBytes } = await import("gltf-validator");
  const report = await validateBytes(bytes, { maxIssues: 50 });
  const first = report.issues.messages.find((m) => m.severity === 0);
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: first ? first.code + " " + first.message : "" };
};

// A sphere whose UV seam has its own column of vertices, so no triangle wraps across the texture.
function ball(radius, rings) {
  const segs = rings * 2, pos = [], nor = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const phi = Math.PI * r / rings;
    for (let s = 0; s <= segs; s++) {
      const th = 2 * Math.PI * s / segs;
      const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      pos.push(n[0] * radius, n[1] * radius, n[2] * radius); nor.push(...n); uv.push(s / segs, r / rings);
    }
  }
  const at = (r, s) => r * (segs + 1) + s;
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    if (r > 0) idx.push(at(r, s), at(r, s + 1), at(r + 1, s));
    if (r < rings - 1) idx.push(at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
  }
  return { pos, nor, uv, idx };
}

// The ball's texture: paint decides the color, light decides how bright it is where a face points.
function ballTexture(size, paint, light) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    const phi = Math.PI * v, th = 2 * Math.PI * u;
    const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
    const base = paint(u, v), k = light(n);
    const o = (y * size + x) * 4;
    rgba[o] = srgb(base[0] * k); rgba[o + 1] = srgb(base[1] * k); rgba[o + 2] = srgb(base[2] * k); rgba[o + 3] = 255;
  }
  return rgba;
}

const TEAL = [0.1, 0.3, 0.32], RED = [0.4, 0.05, 0.04], BLACK = [0.004, 0.004, 0.004];
const stripes = (u) => (Math.floor(u * 8) % 2 ? RED : TEAL);
const sun = (n) => Math.exp(0.5 * (0.3 * n[0] + 0.9 * n[1] + 0.3 * n[2])); // lit side about 2.6 times the dark side

// How uneven one paint is across the texture: standard deviation of brightness over its mean.
function unevenness(rgba, size, paint, want) {
  let s = 0, s2 = 0, k = 0;
  for (let y = 8; y < size - 8; y++) for (let x = 0; x < size; x++) {
    if (paint((x + 0.5) / size, (y + 0.5) / size) !== want) continue;
    if (Math.abs(((x + 0.5) / size * 8) % 1 - 0.5) > 0.35) continue; // stay off the stripe edges
    const o = (y * size + x) * 4;
    const l = 0.2126 * linear(rgba[o]) + 0.7152 * linear(rgba[o + 1]) + 0.0722 * linear(rgba[o + 2]);
    s += l; s2 += l * l; k++;
  }
  const mean = s / k;
  return Math.sqrt(Math.max(0, s2 / k - mean * mean)) / mean;
}

async function texturedBall(rgba, size, setup) {
  return modelBytes(ball(1, 24), async (doc, node, mat) => {
    mat.setBaseColorTexture(doc.createTexture("color").setImage(encodePng(size, size, rgba)).setMimeType("image/png"));
    if (setup) setup(doc, mat);
  });
}

describe("Sovereign Asset surface: texture detail", () => {
  const quad = (w, h, u = 1, v = 1) => ({ pos: new Float32Array([0, 0, 0, w, 0, 0, w, h, 0, 0, h, 0]), uv: new Float32Array([0, 0, u, 0, u, v, 0, v]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) });

  it("counts texture pixels per meter", () => {
    const d = texelDensity([{ ...quad(2, 2), width: 512, height: 512 }]);
    expect(d.median).toBeCloseTo(256, 3);
    expect(d.stretched).toBe(0);
    expect(d.area).toBeCloseTo(4, 5);
  });

  it("reports the share of the surface that is stretched thin", () => {
    // 3 square meters at full detail, 1 square meter squeezed into a tenth of the texture
    const d = texelDensity([{ ...quad(3, 1), width: 300, height: 100 }, { ...quad(1, 1, 0.1, 0.1), width: 300, height: 100 }]);
    expect(d.median).toBeCloseTo(100, 3);
    expect(d.stretched).toBeCloseTo(0.25, 5);
  });

  it("has nothing to say about a model with no UVs", () => {
    expect(texelDensity([{ pos: new Float32Array(9), uv: null, indices: new Uint32Array([0, 1, 2]), width: 64, height: 64 }])).toBe(null);
  });

  it("shows up as a check on the finished file, and fails only when a minimum is set", async () => {
    const bytes = await texturedBall(ballTexture(256, stripes, () => 1), 256);
    const noted = await finishModel(bytes, {}, { codec: pngCodec });
    expect(check(noted, "detail").status).toBe("note");
    expect(check(noted, "detail").detail).toMatch(/^\d+ texture pixels per meter/);
    const strict = await finishModel(bytes, { minTexelDensity: 5000 }, { codec: pngCodec });
    expect(check(strict, "detail").status).toBe("fail");
    expect(strict.ready).toBe(false);
    const easy = await finishModel(bytes, { minTexelDensity: 10 }, { codec: pngCodec });
    expect(check(easy, "detail").status).toBe("pass");
  });
});

describe("Sovereign Asset surface: baked light", () => {
  const sampleBall = (size, rgba, data) => {
    const count = data.pos.length / 3;
    const luma = new Float32Array(count), paint = new Uint8Array(count), height = new Float32Array(count), weight = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      const x = Math.min(size - 1, Math.floor(data.uv[i * 2] * size)), y = Math.min(size - 1, Math.floor(data.uv[i * 2 + 1] * size));
      const o = (y * size + x) * 4;
      const c = [linear(rgba[o]), linear(rgba[o + 1]), linear(rgba[o + 2])];
      luma[i] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      paint[i] = paintOf(c[0], c[1], c[2]);
      height[i] = (data.pos[i * 3 + 1] + 1) / 2;
    }
    return { count, normal: new Float32Array(data.nor), height, luma, paint, weight };
  };

  it("tells paints apart by color, not by how bright they are", () => {
    expect(paintOf(...TEAL)).toBe(paintOf(TEAL[0] * 0.3, TEAL[1] * 0.3, TEAL[2] * 0.3));
    expect(paintOf(...TEAL)).not.toBe(paintOf(...RED));
    expect(paintOf(0.5, 0.5, 0.5)).toBe(12);
    expect(paintOf(...BLACK)).toBe(13);
  });

  it("measures light painted onto a two-color ball", () => {
    const data = ball(1, 24);
    const fit = fitBakedLight(sampleBall(256, ballTexture(256, stripes, sun), data));
    expect(fit.found).toBe(true);
    expect(fit.range).toBeGreaterThan(2.2);
    expect(fit.range).toBeLessThan(3.0);
  });

  it("finds none on a ball that is only painted, even with a black underside", () => {
    const data = ball(1, 24);
    const tires = (u, v) => (v > 0.7 ? BLACK : stripes(u));
    const fit = fitBakedLight(sampleBall(256, ballTexture(256, tires, () => 1), data));
    expect(fit.range).toBeLessThan(1.08);
  });

  it("evens the color back out and keeps the overall brightness", () => {
    const size = 256, data = ball(1, 24);
    const lit = ballTexture(size, stripes, sun);
    const fit = fitBakedLight(sampleBall(size, lit, data));
    const map = gainMap(size, size, new Float32Array(data.uv), new Uint32Array(data.idx), gainFrom(fit, 1, 2.5));
    const fixed = applyGain(lit, map);
    expect(unevenness(lit, size, (u) => stripes(u), TEAL)).toBeGreaterThan(0.25);
    expect(unevenness(fixed, size, (u) => stripes(u), TEAL)).toBeLessThan(0.06);
    expect(unevenness(fixed, size, (u) => stripes(u), RED)).toBeLessThan(0.06);
    let before = 0, after = 0;
    for (let i = 0; i < lit.length; i += 4) { before += linear(lit[i + 1]); after += linear(fixed[i + 1]); }
    expect(after / before).toBeGreaterThan(0.85);
    expect(after / before).toBeLessThan(1.15);
  });

  it("never brightens a color until it washes out", () => {
    const rgba = new Uint8Array([250, 200, 180, 255, 20, 20, 20, 255]);
    const out = applyGain(rgba, new Float32Array([2.5, 2.5]));
    expect(out[0]).toBeLessThanOrEqual(250);
    expect(out[4]).toBeGreaterThan(20);
    expect(out[3]).toBe(255);
  });

  it("is off unless asked for, and then rewrites only the color texture", async () => {
    const size = 256, lit = ballTexture(size, stripes, sun);
    const bytes = await texturedBall(lit, size);
    const copy = Uint8Array.from(bytes);
    const off = await finishModel(bytes, {}, { codec: pngCodec });
    const kept = decodePng((await read(off.bytes)).getRoot().listTextures()[0].getImage());
    expect(Array.from(kept.rgba.slice(0, 4000))).toEqual(Array.from(lit.slice(0, 4000)));
    expect(off.log.join(" ")).not.toMatch(/Baked light/);

    const on = await finishModel(bytes, { delight: "strong" }, { codec: pngCodec, validate });
    expect(Array.from(bytes)).toEqual(Array.from(copy));
    expect(on.ready).toBe(true);
    expect(on.log.join(" ")).toMatch(/Baked light: 1 color texture had light painted in/);
    const doc = await read(on.bytes);
    expect(doc.getRoot().listTextures().length).toBe(1);
    const fixed = decodePng(doc.getRoot().listTextures()[0].getImage());
    expect(unevenness(fixed.rgba, size, (u) => stripes(u), TEAL)).toBeLessThan(0.08);
    expect(check(on, "valid").status).toBe("pass");
  });

  it("takes out part of the light on Light and leaves a clean texture alone", async () => {
    const size = 256, lit = ballTexture(size, stripes, sun);
    const light = await finishModel(await texturedBall(lit, size), { delight: "light" }, { codec: pngCodec });
    const some = decodePng((await read(light.bytes)).getRoot().listTextures()[0].getImage());
    const left = unevenness(some.rgba, size, (u) => stripes(u), TEAL);
    expect(left).toBeLessThan(unevenness(lit, size, (u) => stripes(u), TEAL) * 0.7);
    expect(left).toBeGreaterThan(0.06);

    const plain = ballTexture(size, stripes, () => 1);
    const clean = await finishModel(await texturedBall(plain, size), { delight: "strong" }, { codec: pngCodec });
    expect(clean.log.join(" ")).toMatch(/Baked light: none found/);
    const same = decodePng((await read(clean.bytes)).getRoot().listTextures()[0].getImage());
    expect(Array.from(same.rgba.slice(0, 4000))).toEqual(Array.from(plain.slice(0, 4000)));
  });

  it("says so when textures cannot be read on the device", async () => {
    const bytes = await texturedBall(ballTexture(64, stripes, sun), 64);
    const result = await finishModel(bytes, { delight: "strong", surfaceMaps: "light" }, {});
    expect(result.log.join(" ")).toMatch(/textures cannot be read on this device/);
    expect(result.bytes).toBeTruthy();
  });
});

describe("Sovereign Asset surface: normal and roughness maps", () => {
  const image = (size, fn) => {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = fn(x, y); rgba.set([v, v, v, 255], (y * size + x) * 4); }
    return rgba;
  };

  it("leaves an even color perfectly flat", () => {
    const made = normalFromColor(image(64, () => 140), 64, 64, null, 4);
    expect(made.bumps).toBe(0);
    expect(Array.from(made.rgba.slice(0, 4))).toEqual([128, 128, 255, 255]);
  });

  it("reads a dark line as a groove: the surface leans in from both sides", () => {
    const size = 64;
    const made = normalFromColor(image(size, (x) => (x === 31 || x === 32 ? 40 : 180)), size, size, null, 4);
    const red = (x) => made.rgba[(32 * size + x) * 4];
    expect(red(30)).toBeGreaterThan(128); // left bank faces right, into the groove
    expect(red(33)).toBeLessThan(128);    // right bank faces left
    expect(made.rgba[(32 * size + 10) * 4]).toBe(128);
    expect(made.bumps).toBeGreaterThan(0.02);
  });

  it("points green up the image, the way glTF reads it", () => {
    const size = 64;
    const made = normalFromColor(image(size, (x, y) => (y === 31 || y === 32 ? 40 : 180)), size, size, null, 4);
    const green = (y) => made.rgba[(y * size + 32) * 4 + 1];
    expect(green(30)).toBeLessThan(128);    // upper bank faces down the image
    expect(green(33)).toBeGreaterThan(128); // lower bank faces up the image
  });

  it("keeps the edge of a UV piece and everything outside it flat", () => {
    const size = 64;
    const uv = new Float32Array([0.1, 0.1, 0.5, 0.1, 0.5, 0.9, 0.1, 0.9]), indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const mask = coverageMask(size, size, uv, indices);
    // the piece is bright, and just past its right edge the unused gutter is black
    const rgba = image(size, (x) => (x < 34 ? 200 : 0));
    const made = normalFromColor(rgba, size, size, mask, 4);
    for (let x = 28; x < 40; x++) expect(made.rgba[(32 * size + x) * 4]).toBe(128);
    expect(mask[32 * size + 20]).toBe(1);
    expect(mask[32 * size + 50]).toBe(0);
  });

  it("makes roughness that stays near the material's own value", () => {
    const size = 64;
    const out = roughnessFromColor(image(size, (x) => (x === 31 || x === 32 ? 40 : 180)), size, size, 0.6);
    const g = (x) => out[(32 * size + x) * 4 + 1] / 255;
    expect(g(10)).toBeCloseTo(0.6, 1);
    expect(g(31)).toBeGreaterThan(g(10)); // the groove is rougher
    expect(g(31)).toBeLessThanOrEqual(0.76);
    expect(out[(32 * size + 10) * 4 + 2]).toBe(255); // metallic is left to the material
  });

  it("adds both maps to a material that has only a color texture", async () => {
    const size = 128;
    const grain = ballTexture(size, (u, v) => (Math.floor(u * 64) % 2 ^ Math.floor(v * 32) % 2 ? [0.3, 0.3, 0.3] : [0.2, 0.2, 0.2]), () => 1);
    const bytes = await texturedBall(grain, size, (doc, mat) => mat.setRoughnessFactor(0.5));
    const result = await finishModel(bytes, { surfaceMaps: "strong" }, { codec: pngCodec, validate });
    expect(result.ready).toBe(true);
    expect(check(result, "valid").status).toBe("pass");
    const mat = (await read(result.bytes)).getRoot().listMaterials()[0];
    expect(mat.getNormalTexture()).toBeTruthy();
    expect(mat.getMetallicRoughnessTexture()).toBeTruthy();
    expect(mat.getRoughnessFactor()).toBe(1);
    expect(mat.getBaseColorTexture().getSize()).toEqual(mat.getNormalTexture().getSize());
    const rough = decodePng(mat.getMetallicRoughnessTexture().getImage());
    let mean = 0;
    for (let i = 1; i < rough.rgba.length; i += 4) mean += rough.rgba[i];
    expect(mean / (size * size) / 255).toBeCloseTo(0.5, 1);
    expect(result.log.join(" ")).toMatch(/Surface maps: made 1 normal map link and 1 roughness map link/);
    expect(check(result, "kept").status).toBe("pass");
  });

  it("keeps a normal map the model came with", async () => {
    const size = 64;
    const own = solidPng(size, [128, 128, 255]);
    const bytes = await texturedBall(ballTexture(size, stripes, () => 1), size, (doc, mat) => mat.setNormalTexture(doc.createTexture("own").setImage(own).setMimeType("image/png")));
    const result = await finishModel(bytes, { surfaceMaps: "light" }, { codec: pngCodec });
    const mat = (await read(result.bytes)).getRoot().listMaterials()[0];
    expect(mat.getNormalTexture().getName()).toBe("own");
    expect(Array.from(mat.getNormalTexture().getImage())).toEqual(Array.from(own));
    expect(result.log.join(" ")).toMatch(/1 material kept the normal map it came with/);
  });

  it("makes no normal map from a color with nothing in it, and is off by default", async () => {
    const bytes = await modelBytes(ball(1, 12), async (doc, node, mat) => { mat.setBaseColorTexture(doc.createTexture("color").setImage(solidPng(64)).setMimeType("image/png")); });
    const flat = await finishModel(bytes, { surfaceMaps: "strong" }, { codec: pngCodec });
    expect((await read(flat.bytes)).getRoot().listMaterials()[0].getNormalTexture()).toBe(null);
    expect(flat.log.join(" ")).toMatch(/too even to read any relief from/);
    const off = await finishModel(bytes, {}, { codec: pngCodec });
    expect((await read(off.bytes)).getRoot().listTextures().length).toBe(1);
  });
});

describe("Sovereign Asset surface: one color standard", () => {
  const px = (...colors) => { const out = new Uint8Array(colors.length * 4); colors.forEach((c, i) => out.set([c[0], c[1], c[2], 255], i * 4)); return out; };
  const lum = (rgba, i = 0) => 0.2126 * linear(rgba[i * 4]) + 0.7152 * linear(rgba[i * 4 + 1]) + 0.0722 * linear(rgba[i * 4 + 2]);
  const hue = (rgba, i = 0) => { const r = linear(rgba[i * 4]), g = linear(rgba[i * 4 + 1]), b = linear(rgba[i * 4 + 2]); return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b); };

  it("does not touch the middle of the range", () => {
    const mid = px([120, 110, 100], [90, 140, 150], [160, 150, 140], [70, 70, 70]);
    const held = holdToStandard(mid);
    expect(Array.from(held.rgba)).toEqual(Array.from(mid));
    expect(held.changed).toBe(0);
  });

  it("lifts pure black to the floor and eases white under the ceiling", () => {
    const held = holdToStandard(px([0, 0, 0], [255, 255, 255], [8, 8, 8]));
    expect(lum(held.rgba, 0)).toBeCloseTo(STANDARD.floor, 2);
    expect(lum(held.rgba, 1)).toBeLessThanOrEqual(STANDARD.ceiling + 0.01);
    expect(lum(held.rgba, 1)).toBeGreaterThan(0.7);
    expect(lum(held.rgba, 2)).toBeGreaterThan(lum(held.rgba, 0)); // order is kept: darker stays darker
    expect(held.rgba[3]).toBe(255);
  });

  it("eases off a pure primary and keeps its hue", () => {
    const red = px([230, 0, 0], [0, 60, 230]);
    const held = holdToStandard(red);
    for (const i of [0, 1]) {
      const r = linear(held.rgba[i * 4]), g = linear(held.rgba[i * 4 + 1]), b = linear(held.rgba[i * 4 + 2]);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      expect((max - min) / max).toBeLessThanOrEqual(STANDARD.vividMax + 0.02);
      expect((max - min) / max).toBeGreaterThan(STANDARD.vivid);
      expect(Math.abs(hue(held.rgba, i) - hue(red, i))).toBeLessThan(0.06);
    }
  });

  it("does not let near-black pixels come out vivid once they are lifted", () => {
    // dark, noisy, fully saturated pixels, the way a generator paints tires and glass, next to a bright yellow body
    const colors = [];
    for (let i = 0; i < 300; i++) colors.push(i % 3 ? [12 + (i % 7), 0, 0] : [240, 205, 0]);
    const held = holdToStandard(px(...colors));
    const stats = colorStats(held.rgba, null);
    expect(insideStandard(stats)).toBe(true);
    expect(stats.vivid).toBeLessThanOrEqual(STANDARD.vividMax + 0.02);
    expect(stats.low).toBeGreaterThanOrEqual(STANDARD.floor * 0.8);
  });

  it("reads the range from the pixels the model uses, not the gutter", () => {
    const rgba = px([0, 0, 0], [128, 128, 128], [128, 128, 128], [255, 255, 255]);
    const all = colorStats(rgba, null), used = colorStats(rgba, new Uint8Array([0, 1, 1, 0]));
    expect(insideStandard(all)).toBe(false);
    expect(insideStandard(used)).toBe(true);
    expect(used.mid).toBeCloseTo(linear(128), 2);
    expect(colorStats(rgba, new Uint8Array(4))).toBe(null);
  });

  it("brings a harsh texture inside the range and passes the check on the finished file", async () => {
    const size = 128;
    const harsh = ballTexture(size, (u, v) => (v < 0.3 ? [1, 1, 1] : v > 0.7 ? [0, 0, 0] : Math.floor(u * 8) % 2 ? [0.9, 0, 0] : TEAL), () => 1);
    const bytes = await texturedBall(harsh, size);
    const off = await finishModel(bytes, {}, { codec: pngCodec });
    expect(check(off, "color").status).toBe("note");
    expect(check(off, "color").detail).toMatch(/This asset is outside it/);
    const kept = decodePng((await read(off.bytes)).getRoot().listTextures()[0].getImage());
    expect(Array.from(kept.rgba.slice(0, 4000))).toEqual(Array.from(harsh.slice(0, 4000)));

    const on = await finishModel(bytes, { colorStandard: true }, { codec: pngCodec, validate });
    expect(on.ready).toBe(true);
    expect(check(on, "color").status).toBe("pass");
    expect(on.log.join(" ")).toMatch(/Color standard: 1 color texture brought inside the shared range/);
    expect(insideStandard(on.after.color)).toBe(true);
    expect(on.after.color.high).toBeLessThan(off.after.color.high);
    expect(on.after.color.low).toBeGreaterThan(off.after.color.low);
  });

  it("leaves a texture that is already inside the range byte for byte", async () => {
    const size = 64;
    const fine = ballTexture(size, stripes, () => 1);
    const bytes = await texturedBall(fine, size);
    const source = (await read(bytes)).getRoot().listTextures()[0].getImage();
    const on = await finishModel(bytes, { colorStandard: true }, { codec: pngCodec });
    expect(on.log.join(" ")).toMatch(/already inside the shared range/);
    expect(Array.from((await read(on.bytes)).getRoot().listTextures()[0].getImage())).toEqual(Array.from(source));
    expect(check(on, "color").status).toBe("pass");
  });

  it("gives two very different textures the same limits", async () => {
    const size = 64;
    const dark = await texturedBall(ballTexture(size, () => [0.001, 0.001, 0.001], () => 1), size);
    const bright = await texturedBall(ballTexture(size, (u) => (Math.floor(u * 8) % 2 ? [1, 1, 1] : [1, 0, 0]), () => 1), size);
    const a = await finishModel(dark, { colorStandard: true }, { codec: pngCodec });
    const b = await finishModel(bright, { colorStandard: true }, { codec: pngCodec });
    for (const r of [a, b]) expect(insideStandard(r.after.color)).toBe(true);
    expect(a.after.color.low).toBeGreaterThanOrEqual(STANDARD.floor * 0.8);
    expect(b.after.color.high).toBeLessThanOrEqual(STANDARD.ceiling * 1.05);
    expect(b.after.color.vivid).toBeLessThanOrEqual(STANDARD.vividMax * 1.03);
  });
});

describe("Sovereign Asset surface: with the rest of the finish", () => {
  it("runs with flatten, a triangle target, sizing and a texture limit, and the file is valid", async () => {
    const size = 256;
    const bytes = await texturedBall(ballTexture(size, stripes, sun), size);
    const result = await finishModel(bytes, { flatten: "light", delight: "strong", surfaceMaps: "strong", triangles: 600, maxTexture: 128, size: { axis: "height", meters: 3 } }, { codec: pngCodec, validate });
    expect(result.ready).toBe(true);
    expect(check(result, "valid").status).toBe("pass");
    const doc = await read(result.bytes);
    const mat = doc.getRoot().listMaterials()[0];
    for (const tex of [mat.getBaseColorTexture(), mat.getNormalTexture(), mat.getMetallicRoughnessTexture()]) expect(tex.getSize()).toEqual([128, 128]);
    expect(result.after.triangles).toBeLessThanOrEqual(612);
    // 128 px around a ball 3 m tall: the equator is about 9.4 m, so detail is in the low tens of pixels per meter
    expect(result.after.detail.median).toBeGreaterThan(8);
    expect(result.after.detail.median).toBeLessThan(40);
  });

  for (const name of ["sedan-01-textured.glb", "taxi-v1.glb"]) {
    it("finishes " + name + " with baked light out and surface maps made, and the validator passes", async () => {
      const { readFileSync } = await import("node:fs");
      const bytes = new Uint8Array(readFileSync(new URL("../fixtures/vehicle/" + name, import.meta.url)));
      const result = await finishModel(bytes, { maxTexture: 1024, delight: "light", surfaceMaps: "light" }, { codec: pngCodec, validate });
      expect(result.bytes).toBeTruthy();
      expect(check(result, "valid").status).toBe("pass");
      expect(check(result, "kept").status).toBe("pass");
      // the taxi's texture is not a PNG, which is all this test codec reads: it must be left alone and said so
      expect(result.log.join(" ")).toMatch(name === "taxi-v1.glb" ? /1 texture could not be read or written here and was left alone/ : /Baked light: /);
      console.log(name + "\n" + result.report + "\n");
    }, 120000);
  }
});
