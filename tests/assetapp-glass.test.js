import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { evenGlass } from "../src/assetapp/glass.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io } from "./assetapp-helpers.js";

// A box car, 2 wide, 1.4 tall, 4.5 long. Each side face has its own square of a 128 px texture, v running
// down with height, so the top half of a square is the top half of the car. The left side holds a dark window
// the mask knows about, a pale window it missed, a gray door handle below the belt, and a gutter of texels no
// face uses is left pale between the squares.
const N = 128;
function car(body = [150, 30, 30]) {
  const rgba = new Uint8Array(N * N * 4), mask = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { rgba.set([...body, 255], i * 4); mask.set([0, 255, 0, 255], i * 4); }
  const put = (img, x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.set([...c, 255], (y * N + x) * 4); };
  put(rgba, 60, 0, 68, 128, [235, 235, 235]); put(mask, 60, 0, 68, 128, [0, 0, 0]);   // gutter: no face uses it
  put(rgba, 4, 4, 24, 16, [30, 34, 40]); put(mask, 4, 4, 24, 16, [255, 0, 0]);        // dark window, in the mask
  put(rgba, 30, 4, 56, 16, [205, 208, 210]);                                           // pale window, missed
  put(rgba, 20, 40, 28, 44, [120, 120, 120]);                                          // gray handle, below the belt
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const mat = doc.createMaterial("atlas").setBaseColorTexture(doc.createTexture("albedo").setImage(encodePng(N, N, rgba)).setMimeType("image/png"))
    .setEmissiveTexture(doc.createTexture("mask").setImage(encodePng(N, N, mask)).setMimeType("image/png")).setEmissiveFactor([0, 0, 0]).setExtras({ kitMask: true });
  const pos = [], uv = [], idx = [];
  // u 0..60/128 across the length, v 0 at the roof, 60/128 at the ground
  const quad = (pts, u0) => { const b = pos.length / 3, k = 60 / N; pts.forEach((p, i) => { pos.push(...p); uv.push(u0 + [0, k, k, 0][i], [k, k, 0, 0][i]); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[-1, 0, -2.25], [-1, 0, 2.25], [-1, 1.4, 2.25], [-1, 1.4, -2.25]], 0);        // left side
  quad([[1, 0, 2.25], [1, 0, -2.25], [1, 1.4, -2.25], [1, 1.4, 2.25]], 68 / N);       // right side
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer));
  scene.addChild(doc.createNode("body").setMesh(doc.createMesh("body").addPrimitive(prim)));
  return doc;
}
const pixel = (img, x, y) => Array.from(img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
async function run(doc) {
  const result = await evenGlass(await (await io()).writeBinary(doc));
  const out = await (await io()).readBinary(result.bytes), m = out.getRoot().listMaterials()[0];
  return { result, base: decodePng(m.getBaseColorTexture().getImage()), mask: decodePng(m.getEmissiveTexture().getImage()) };
}

describe("Sovereign Asset: even glass", () => {
  it("marks a pale window the mask missed as glass and gives all glass one dark tone", async () => {
    const { result, base, mask } = await run(car());
    expect(result.added).toBe(26 * 12);
    expect(pixel(mask, 40, 10)).toEqual([255, 0, 0]);          // the pale window is glass now
    expect(pixel(mask, 10, 10)).toEqual([255, 0, 0]);          // the dark one still is
    const pale = pixel(base, 40, 10), dark = pixel(base, 10, 10);
    expect(Math.max(...pale)).toBeLessThan(70);                // no longer white
    expect(Math.max(...dark)).toBeLessThan(70);
    expect(pale[2]).toBeGreaterThan(pale[0]);                  // slightly blue
    expect(pixel(base, 24, 42)).toEqual([120, 120, 120]);      // handle below the belt is untouched
    expect(pixel(mask, 24, 42)).toEqual([0, 255, 0]);
    expect(pixel(base, 40, 40)).toEqual([150, 30, 30]);        // paint is untouched
    expect(pixel(base, 64, 100)).toEqual([235, 235, 235]);     // gutter away from glass is untouched
  });

  it("adds no glass on a white car, and still evens the glass the mask has", async () => {
    const { result, base, mask } = await run(car([228, 226, 220]));
    expect(result.added).toBe(0);
    expect(result.reason).toMatch(/white, gray or black/);
    expect(pixel(mask, 40, 10)).toEqual([0, 255, 0]);
    expect(pixel(base, 40, 10)).toEqual([205, 208, 210]);
    expect(Math.max(...pixel(base, 10, 10))).toBeLessThan(70);
  });

  it("leaves a car without a mask alone", async () => {
    const doc = car();
    doc.getRoot().listMaterials()[0].setExtras({}).setEmissiveTexture(null);
    const bytes = await (await io()).writeBinary(doc), result = await evenGlass(bytes);
    expect(result.added).toBe(0);
    expect(result.bytes).toBe(bytes);
  });
});
