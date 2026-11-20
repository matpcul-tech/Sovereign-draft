import { describe, it, expect } from "vitest";
import { Document } from "@gltf-transform/core";
import { checkModel, readModel } from "../src/assetapp/engine.js";
import { redrawOpenings } from "../src/assetapp/redraw.js";
import { cleanStretch, cutTriangle, freeBlock, layWall, markUsed, paintDoor, paintSign, textWidth } from "../src/assetapp/openings.js";
import { validate } from "../src/assetapp/validate.js";
import { encodePng } from "../src/asset/finish/png.js";
import { io, pngCodec } from "./assetapp-helpers.js";

// One wall, 6 m wide and 3 m tall, facing +Z at z = 2, painted from the left three quarters of a
// 256 px texture (the right quarter is free). A dark blotch sits on it at x 1..2, y 1..2. A
// second small part, material "door", lies on the wall at x -2.5..-1.5, y 0..2.
async function house() {
  const size = 256, rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, wx = -3 + (x / 192) * 6, wy = 3 - (y / size) * 3, blotch = x < 192 && wx > 1 && wx < 2 && wy > 1 && wy < 2;
    rgba.set(x >= 192 ? [10, 10, 10, 255] : blotch ? [60, 40, 30, 255] : [200 + (x % 3), 190 + (y % 3), 170, 255], i);
  }
  const doc = new Document(), buffer = doc.createBuffer();
  const tex = doc.createTexture("walls_color").setImage(encodePng(size, size, rgba)).setMimeType("image/png");
  const walls = doc.createMaterial("walls").setBaseColorTexture(tex), old = doc.createMaterial("Material_0").setBaseColorTexture(tex), door = old.clone().setName("door");
  const quad = (x0, x1, y0, y1, z, mat) => {
    const uv = (x, y) => [(x + 3) / 6 * 0.75, 1 - y / 3];
    const P = [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], T = [...uv(x0, y0), ...uv(x1, y0), ...uv(x1, y1), ...uv(x0, y1)];
    return doc.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(P)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(T)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  };
  const mesh = doc.createMesh("house").addPrimitive(quad(-3, 3, 0, 3, 2, walls)).addPrimitive(quad(-2.5, -1.5, 0, 2, 2.001, door));
  doc.createScene().addChild(doc.createNode("house").setMesh(mesh));
  return (await io()).writeBinary(doc);
}
const partsOf = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).map((p) => ({ name: p.getMaterial().getName(), mat: p.getMaterial(), tris: p.getIndices().getCount() / 3, prim: p }));
const areaOf = (prim) => {
  const p = prim.getAttribute("POSITION").getArray(), idx = prim.getIndices().getArray();
  let a = 0;
  for (let t = 0; t < idx.length; t += 3) { const i = idx[t] * 3, j = idx[t + 1] * 3, k = idx[t + 2] * 3; a += Math.abs((p[j] - p[i]) * (p[k + 1] - p[i + 1]) - (p[k] - p[i]) * (p[j + 1] - p[i + 1])) / 2; }
  return a;
};

describe("Sovereign Asset openings: the pieces", () => {
  it("cuts a rectangle out of a triangle and keeps everything else", () => {
    const tri = [[0, 0, 5], [4, 0, 5], [0, 4, 5]];
    const area = (list) => list.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
    const left = cutTriangle(tri, 1, 1, 2, 2);
    expect(area(left)).toBeCloseTo(8 - 1, 6);
    expect(left.every((t) => t.every((corner) => corner[2] === 5))).toBe(true); // carried numbers reach the new corners
    expect(area(cutTriangle(tri, 10, 10, 11, 11))).toBeCloseTo(8, 6);
    expect(cutTriangle(tri, -1, -1, 5, 5)).toHaveLength(0);
  });

  it("letters a sign in the board's ink, shrinking a long line to fit", () => {
    const ink = (img) => { let n = 0; for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i] < 80) n++; return n; };
    const blank = paintSign(" ", 600, 100), pawn = paintSign("PAWN", 600, 100), long = paintSign("PAWN * LOANS * GOLD * CASH * GUNS * TOOLS", 600, 100);
    expect(ink(pawn)).toBeGreaterThan(ink(blank) + 500);
    expect(textWidth("PAWN SHOP")).toBeGreaterThan(textWidth("PAWN"));
    expect(long.cap).toBeLessThan(pawn.cap);
    expect(long.cap).toBeGreaterThan(8);
    const door = paintDoor();
    expect(door.width).toBe(512);
  });

  it("finds the free corner of a texture and the cleanest stretch of a wall", () => {
    const used = new Uint8Array(16 * 16);
    markUsed(used, 16, 16, [[0, 0], [0.7, 0], [0, 0.7]], 1);
    expect(used[0]).toBe(1);
    const spot = freeBlock(used, 16, 16, 4, 4);
    expect(spot).not.toBeNull();
    for (let j = spot.j; j < spot.j + 4; j++) for (let i = spot.i; i < spot.i + 4; i++) expect(used[j * 16 + i]).toBe(0);
    expect(freeBlock(new Uint8Array(16).fill(1), 4, 4, 2, 2)).toBeNull();

    // a wall 4 by 2, even on its left half and striped on its right
    const size = 64, rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set(x < 32 ? [180, 180, 180, 255] : (x % 4 < 2 ? [250, 250, 250, 255] : [20, 20, 20, 255]), (y * size + x) * 4);
    const lay = layWall([{ p: [[0, 0], [4, 0], [4, 2]], uv: [[0, 1], [1, 1], [1, 0]] }, { p: [[0, 0], [4, 2], [0, 2]], uv: [[0, 1], [1, 0], [0, 0]] }], 0, 0, 4, 2, 16);
    const best = cleanStretch(lay, { width: size, height: size, rgba }, 12, 12, [], 2);
    expect(best.i + 12).toBeLessThanOrEqual(32);
    expect(cleanStretch(lay, { width: size, height: size, rgba }, 12, 12, [[0, 0, 64, 32]], 2)).toBeNull();
  });
});

describe("Sovereign Asset openings: redrawn on a finished file", () => {
  it("letters a sign that glows with its own paint", async () => {
    const out = await redrawOpenings(await house(), { openings: [{ kind: "sign", face: "+z", span: [-1, 1], y: [2.4, 2.8], text: "Pawn * Loans" }] }, { codec: pngCodec });
    const doc = await readModel(out.bytes), sign = partsOf(doc).find((p) => p.name === "sign_lit");
    expect(out.done.sign).toBe(1);
    expect(sign.tris).toBe(2);
    expect(sign.mat.getEmissiveTexture()).toBe(sign.mat.getBaseColorTexture());
    expect(sign.mat.getEmissiveFactor()).toEqual([1, 1, 1]);
    // the board stands proud of the wall it was found on, and the wall under it is gone
    const z = sign.prim.getAttribute("POSITION").getArray()[2];
    expect(z).toBeGreaterThan(2);
    expect(z).toBeLessThan(2.05);
    const wall = partsOf(doc).find((p) => p.name === "walls");
    expect(areaOf(wall.prim)).toBeLessThan(18 - 0.6);
    expect(out.log.join(" ")).toContain("PAWN · LOANS");
  });

  it("redraws a window and a door, and retires the door found before", async () => {
    const plan = { openings: [
      { kind: "window", face: "+z", at: 2, span: [0, 1], y: [1, 2], lit: true },
      { kind: "window", face: "+z", at: 2, span: [-1.2, -0.4], y: [1, 2], lit: false, sashes: 1 },
      { kind: "door", face: "+z", at: 2, span: [2, 2.9], y: [0, 2.1] }
    ] };
    const out = await redrawOpenings(await house(), plan, { codec: pngCodec });
    const doc = await readModel(out.bytes), parts = partsOf(doc), names = parts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["windows_lit", "windows_dark", "trim", "door", "walls"]));
    expect(names.filter((n) => n === "door")).toHaveLength(1);
    const door = parts.find((p) => p.name === "door");
    expect(door.mat.getBaseColorTexture().getName()).toBe("door_color");
    expect(door.tris).toBe(2);
    const lit = parts.find((p) => p.name === "windows_lit");
    expect(lit.mat.getEmissiveFactor()[0]).toBeGreaterThan(0);
    expect(parts.find((p) => p.name === "windows_dark").mat.getEmissiveFactor()).toEqual([0, 0, 0]);
    // the old door went back to plain paint, still where it was
    expect(parts.some((p) => p.name === "Material_0" && p.tris === 2)).toBe(true);
    expect(out.log.join(" ")).toContain("went back to plain paint");
    const verdict = await checkModel(out.bytes, {}, { codec: pngCodec, validate });
    expect(verdict.checks.find((c) => c.id === "valid").status).toBe("pass");
    expect(verdict.ready).toBe(true);
  });

  it("patches a wall with its own clean paint, in a free corner of its texture", async () => {
    const out = await redrawOpenings(await house(), { openings: [{ kind: "wall", face: "+z", at: 2, span: [0.8, 2.2], y: [0.8, 2.2] }] }, { codec: pngCodec });
    const doc = await readModel(out.bytes), walls = partsOf(doc).filter((p) => p.name === "walls");
    expect(walls).toHaveLength(2);
    const patch = walls.find((p) => p.tris === 2 && Math.abs(areaOf(p.prim) - 1.96) < 0.01);
    expect(patch).toBeTruthy();
    const uv = patch.prim.getAttribute("TEXCOORD_0").getArray();
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (let i = 0; i < uv.length; i += 2) { u0 = Math.min(u0, uv[i]); u1 = Math.max(u1, uv[i]); v0 = Math.min(v0, uv[i + 1]); v1 = Math.max(v1, uv[i + 1]); }
    expect(u0).toBeGreaterThan(0.75); // the free quarter
    const img = await pngCodec.decode(patch.mat.getBaseColorTexture().getImage(), "image/png");
    const at = (u, v) => { const i = (Math.floor(v * img.height) * img.width + Math.floor(u * img.width)) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
    const middle = at((u0 + u1) / 2, (v0 + v1) / 2);
    expect(middle[0]).toBeGreaterThan(180); // wall color, not the blotch
    expect(at(0.9, 0.98)[0]).toBeLessThan(30); // the rest of the free quarter is untouched
    expect(out.log.join(" ")).toContain("Wall patch");
  });

  it("cuts a hole, clears stray sheets, and says what is wrong with a bad plan", async () => {
    const cut = await redrawOpenings(await house(), { openings: [{ kind: "cut", face: "+z", at: 2, span: [0, 1], y: [0, 1] }] }, { codec: pngCodec });
    expect(areaOf(partsOf(await readModel(cut.bytes)).find((p) => p.name === "walls").prim)).toBeCloseTo(17, 4);
    // found parts are left alone: the sheet named "door" stays
    const kept = await redrawOpenings(await house(), { openings: [{ kind: "clear", face: "+z", at: 2, span: [-3, 3], y: [0, 3] }] }, { codec: pngCodec });
    expect(partsOf(await readModel(kept.bytes)).map((p) => p.name)).toEqual(["walls", "door"]);
    // once a redrawn door has retired it to plain paint, it is a stray sheet on the wall and goes
    const clear = await redrawOpenings(await house(), { openings: [{ kind: "door", face: "+z", at: 2, span: [2, 2.9], y: [0, 2.1] }, { kind: "clear", face: "+z", at: 2, span: [-3, 3], y: [0, 3] }] }, { codec: pngCodec });
    expect(partsOf(await readModel(clear.bytes)).some((p) => p.name === "Material_0")).toBe(false);
    expect(clear.log.join(" ")).toContain("Cleared: 2 loose triangles");
    await expect(redrawOpenings(await house(), { openings: [] }, { codec: pngCodec })).rejects.toThrow("no openings");
    await expect(redrawOpenings(await house(), { openings: [{ kind: "sign", face: "+z", span: [0, 1], y: [1, 2] }] }, { codec: pngCodec })).rejects.toThrow("needs its text");
    await expect(redrawOpenings(await house(), { openings: [{ kind: "window", face: "up", span: [0, 1], y: [1, 2] }] }, { codec: pngCodec })).rejects.toThrow("face");
  });
});
