import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { paintTailLamps } from "../src/assetapp/lamps.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io } from "./assetapp-helpers.js";

// A box car, 2 wide, 1.4 tall, 4.5 long, front toward +Z. Its texture is body teal everywhere, with
// each face given its own square of the texture. The rear face square holds two gray lamps at the
// outer ends, a gray plate in the middle, and a bright chrome strip.
const N = 128;
function carBytes(lampColor = [70, 72, 74], bodyColor = null) {
  const rgba = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) rgba.set([24, 96, 104, 255], i * 4);
  const put = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([...c, 255], (y * N + x) * 4); };
  // rear face lives in the texture square x 0..64, y 0..64. u runs with car x, v runs down with height.
  put(2, 22, 14, 34, lampColor);    // left lamp
  put(50, 22, 62, 34, lampColor);   // right lamp
  put(24, 24, 40, 32, [80, 80, 80]);  // plate, in the middle
  put(0, 60, 64, 64, [240, 240, 240]); // bright chrome strip
  put(66, 22, 78, 34, [70, 72, 74]);  // the same gray on the FRONT face square: headlamp
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const green = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) green.set([0, 255, 0, 255], i * 4);
  const mat = doc.createMaterial("atlas").setBaseColorTexture(doc.createTexture("albedo").setImage(encodePng(N, N, rgba)).setMimeType("image/png"))
    .setEmissiveTexture(doc.createTexture("mask").setImage(encodePng(N, N, green)).setMimeType("image/png")).setEmissiveFactor([0, 0, 0]).setExtras({ kitMask: true });
  if (bodyColor) for (let i = 0; i < N * N; i++) if (rgba[i * 4] === 24 && rgba[i * 4 + 1] === 96) rgba.set([...bodyColor, 255], i * 4);
  if (bodyColor) mat.getBaseColorTexture().setImage(encodePng(N, N, rgba));
  const pos = [], uv = [], idx = [];
  const quad = (pts, u0, v0) => { const b = pos.length / 3; pts.forEach((p, i) => { pos.push(...p); uv.push(u0 + [0, 0.5, 0.5, 0][i], v0 + [0.5, 0.5, 0, 0][i]); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[1, 0, -2.25], [-1, 0, -2.25], [-1, 1.4, -2.25], [1, 1.4, -2.25]], 0, 0);     // rear, faces -Z
  quad([[-1, 0, 2.25], [1, 0, 2.25], [1, 1.4, 2.25], [-1, 1.4, 2.25]], 0.5, 0);       // front, faces +Z
  quad([[-1, 0, -2.25], [-1, 0, 2.25], [-1, 1.4, 2.25], [-1, 1.4, -2.25]], 0, 0.5);   // left
  quad([[1, 0, 2.25], [1, 0, -2.25], [1, 1.4, -2.25], [1, 1.4, 2.25]], 0.5, 0.5);     // right
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer));
  scene.addChild(doc.createNode("body").setMesh(doc.createMesh("body").addPrimitive(prim)));
  return { doc, rgba };
}
const pixel = (img, x, y) => Array.from(img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe("Sovereign Asset: tail lamps", () => {
  it("paints gray rear lamps red and leaves the plate, chrome, paint and front alone", async () => {
    const { doc, rgba } = carBytes();
    const result = await paintTailLamps(await (await io()).writeBinary(doc));
    expect(result.texels).toBe(2 * 12 * 12);
    const out = await (await io()).readBinary(result.bytes);
    const img = decodePng(out.getRoot().listMaterials()[0].getBaseColorTexture().getImage());
    const lamp = pixel(img, 8, 28);
    expect(lamp[0]).toBeGreaterThan(150);
    expect(lamp[1]).toBeLessThan(40);
    expect(pixel(img, 56, 28)).toEqual(lamp);
    expect(pixel(img, 32, 28)).toEqual([80, 80, 80]);      // plate
    expect(pixel(img, 30, 62)).toEqual([240, 240, 240]);   // chrome
    expect(pixel(img, 30, 10)).toEqual([24, 96, 104]);     // paint
    expect(pixel(img, 72, 28)).toEqual([70, 72, 74]);      // headlamp on the front face
    let changed = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] !== img.rgba[i] || rgba[i + 1] !== img.rgba[i + 1] || rgba[i + 2] !== img.rgba[i + 2]) changed++;
    expect(changed).toBe(result.texels);
  });

  it("paints nothing on a white car, where a gray lamp cannot be told from a door", async () => {
    const { doc } = carBytes([70, 72, 74], [228, 226, 216]);
    const bytes = await (await io()).writeBinary(doc);
    const result = await paintTailLamps(bytes);
    expect(result.texels).toBe(0);
    expect(result.reason).toMatch(/white, gray or black/);
    expect(result.bytes).toBe(bytes);
  });

  it("does nothing to lamps that already have a color", async () => {
    const { doc } = carBytes([190, 20, 24]);
    const bytes = await (await io()).writeBinary(doc);
    const result = await paintTailLamps(bytes);
    expect(result.texels).toBe(0);
    expect(result.bytes).toBe(bytes);
  });
});
