import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { openTouch } from "../src/assetapp/touchcore.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io } from "./assetapp-helpers.js";

// One wall of a car: the plane x = -1, 4.5 long (z) and 1.4 tall (y), on the left 60 px of a 128 px texture.
// A second wall at x = +1 uses the right 60 px. Between them is a gutter no face uses.
// On the left wall: red paint, a white window the mask calls paint, and a small orange speck in the paint.
const N = 128, K = 60 / N;
function car() {
  const rgba = new Uint8Array(N * N * 4), mask = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { rgba.set([150, 30, 30, 255], i * 4); mask.set([0, 255, 0, 255], i * 4); }
  const put = (img, x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.set([...c, 255], (y * N + x) * 4); };
  put(rgba, 60, 0, 68, 128, [235, 235, 235]); put(mask, 60, 0, 68, 128, [0, 0, 0]);
  put(rgba, 20, 6, 40, 16, [230, 232, 235]);   // white window, wrongly paint
  put(rgba, 30, 40, 33, 43, [230, 140, 20]);   // speck
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const mat = doc.createMaterial("atlas").setBaseColorTexture(doc.createTexture("albedo").setImage(encodePng(N, N, rgba)).setMimeType("image/png"))
    .setEmissiveTexture(doc.createTexture("mask").setImage(encodePng(N, N, mask)).setMimeType("image/png")).setEmissiveFactor([0, 0, 0]).setExtras({ kitMask: true });
  const pos = [], uv = [], idx = [];
  const quad = (pts, u0) => { const b = pos.length / 3; pts.forEach((p, i) => { pos.push(...p); uv.push(u0 + [0, K, K, 0][i], [K, K, 0, 0][i]); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[-1, 0, -2.25], [-1, 0, 2.25], [-1, 1.4, 2.25], [-1, 1.4, -2.25]], 0);
  quad([[1, 0, 2.25], [1, 0, -2.25], [1, 1.4, -2.25], [1, 1.4, 2.25]], 68 / N);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer));
  scene.addChild(doc.createNode("body").setMesh(doc.createMesh("body").addPrimitive(prim)));
  return doc;
}
// the point on the left wall that texel (x, y) shows
const at = (x, y) => [-1, 1.4 - (y + 0.5) / 60 * 1.4, -2.25 + (x + 0.5) / 60 * 4.5];
const texel = (t, img, x, y) => Array.from(img.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 3));
const open = async () => openTouch(await (await io()).writeBinary(car()));

describe("Sovereign Asset: touch up", () => {
  it("marks a white window as glass without spilling onto the paint around it", async () => {
    const t = await open();
    expect(t.bodyColor).toEqual([150, 30, 30]);
    expect(t.begin(at(30, 11), "glass", { radius: 0.4, similar: true })).toBe(null);
    t.move(at(22, 11)); t.move(at(38, 11));
    expect(t.end()).toBeGreaterThan(150);
    expect(texel(t, t.mask, 30, 11)).toEqual([255, 0, 0]);
    expect(texel(t, t.mask, 21, 7)).toEqual([255, 0, 0]);
    expect(Math.max(...texel(t, t.base, 30, 11))).toBeLessThan(70);     // dark glass tone now
    expect(texel(t, t.mask, 30, 20)).toEqual([0, 255, 0]);              // paint under the window, inside the brush, untouched
    expect(texel(t, t.base, 30, 20)).toEqual([150, 30, 30]);
    expect(texel(t, t.mask, 100, 11)).toEqual([0, 255, 0]);             // the other wall, next to it in the texture, untouched
  });

  it("without similar-only the brush takes everything in reach", async () => {
    const t = await open();
    t.begin(at(30, 11), "chrome", { radius: 0.4, similar: false });
    t.end();
    expect(texel(t, t.mask, 30, 11)).toEqual([0, 0, 255]);
    expect(texel(t, t.mask, 30, 20)).toEqual([0, 0, 255]);
    expect(texel(t, t.base, 30, 20)).toEqual([150, 30, 30]);            // chrome changes the mask only
  });

  it("cleans a speck with the color around it and leaves the mask alone", async () => {
    const t = await open();
    expect(t.begin(at(31, 41), "clean", { radius: 0.12 })).toBe(null);
    t.end();
    expect(texel(t, t.base, 31, 41)).toEqual([150, 30, 30]);
    expect(texel(t, t.base, 30, 42)).toEqual([150, 30, 30]);
    expect(texel(t, t.mask, 31, 41)).toEqual([0, 255, 0]);
  });

  it("paint puts the body color back where glass was marked by mistake", async () => {
    const t = await open();
    t.begin(at(30, 11), "glass", { radius: 0.4 }); t.end();
    t.begin(at(30, 11), "paint", { radius: 0.4 }); t.end();
    expect(texel(t, t.mask, 30, 11)).toEqual([0, 255, 0]);
    expect(texel(t, t.base, 30, 11)).toEqual([150, 30, 30]);
  });

  it("undo steps back one stroke at a time, and a cancelled stroke leaves no trace", async () => {
    const t = await open();
    t.begin(at(30, 11), "glass", { radius: 0.4 }); t.end();
    t.begin(at(31, 41), "clean", { radius: 0.12 }); t.end();
    expect(t.strokes()).toBe(2);
    expect(t.undo()).toBe(true);
    expect(texel(t, t.base, 31, 41)).toEqual([230, 140, 20]);
    expect(texel(t, t.mask, 30, 11)).toEqual([255, 0, 0]);
    expect(t.undo()).toBe(true);
    expect(texel(t, t.mask, 30, 11)).toEqual([0, 255, 0]);
    expect(texel(t, t.base, 30, 11)).toEqual([230, 232, 235]);
    expect(t.undo()).toBe(false);
    t.begin(at(30, 11), "trim", { radius: 0.4 }); t.cancel();
    expect(texel(t, t.mask, 30, 11)).toEqual([0, 255, 0]);
    expect(t.strokes()).toBe(0);
  });

  it("refuses a point that is not on the car, and says why clean cannot start on a plain panel", async () => {
    const t = await open();
    expect(t.begin([5, 5, 5], "glass", { radius: 0.1 })).toMatch(/not on the textured car/);
    expect(t.begin(at(50, 50), "clean", { radius: 0.1 })).toMatch(/no color to clean it with/);
    expect(t.strokes()).toBe(0);
  });

  it("writes the edits into the file, padded into the gutter", async () => {
    const t = await open();
    t.begin(at(58, 30), "trim", { radius: 0.2, similar: false }); t.end();
    const out = await (await io()).readBinary(await t.bytes()), m = out.getRoot().listMaterials()[0];
    const mask = decodePng(m.getEmissiveTexture().getImage());
    const px = (x, y) => Array.from(mask.rgba.slice((y * N + x) * 4, (y * N + x) * 4 + 3));
    expect(m.getExtras().kitMask).toBe(true);
    expect(px(58, 30)).toEqual([0, 0, 0]);
    expect(px(61, 30)).toEqual([0, 0, 0]);   // 2 px into the gutter
    expect(px(40, 30)).toEqual([0, 255, 0]);
  });

  it("is not offered for a model without a window mask", async () => {
    const doc = car();
    doc.getRoot().listMaterials()[0].setExtras({});
    expect(await openTouch(await (await io()).writeBinary(doc))).toBe(null);
  });
});
