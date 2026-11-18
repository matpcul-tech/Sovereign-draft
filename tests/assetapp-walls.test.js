import { describe, expect, it } from "vitest";
import { finishModel } from "../src/assetapp/engine.js";
import { colorOnly, copyPaint, findCourses, packWalls, spreadEdges, surfaceAt } from "../src/assetapp/walls.js";
import { decodePng, encodePng } from "../src/asset/finish/png.js";
import { io, modelBytes, pngCodec } from "./assetapp-helpers.js";

const check = (result, id) => result.checks.find((c) => c.id === id);
const read = async (bytes) => (await io()).readBinary(bytes);
const validate = async (bytes) => {
  const { validateBytes } = await import("gltf-validator");
  const report = await validateBytes(bytes, { maxIssues: 50 });
  const first = report.issues.messages.find((m) => m.severity === 0);
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: first ? first.code + " " + first.message : "" };
};

// A square texture painted by a function of (x, y) that returns [r, g, b].
const painted = (size, fn) => { const rgba = new Uint8Array(size * size * 4); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([...fn(x, y), 255], (y * size + x) * 4); return rgba; };
const full = (size) => new Uint8Array(size * size).fill(1);

describe("Sovereign Asset walls: layout", () => {
  it("fits every wall in the texture at one scale, with none overlapping", () => {
    const rects = [{ w: 4, h: 3 }, { w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 3 }, { w: 1, h: 0.5 }];
    const pack = packWalls(rects, 512);
    expect(pack.ppu).toBeGreaterThan(40);
    pack.spots.forEach((s, i) => {
      expect(s.x).toBeGreaterThanOrEqual(0); expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(512); expect(s.y + s.h).toBeLessThanOrEqual(512);
      expect(s.w).toBe(Math.ceil(rects[i].w * pack.ppu)); // the same pixels per unit for every wall
      for (let j = 0; j < i; j++) { const t = pack.spots[j]; expect(s.x >= t.x + t.w || t.x >= s.x + s.w || s.y >= t.y + t.h || t.y >= s.y + s.h).toBe(true); }
    });
    expect(packWalls([], 512)).toBe(null);
  });

  it("copies the old paint across through any old UV layout", () => {
    // old texture: left half red, right half blue. One quad whose old UVs are flipped left to right.
    const src = { width: 8, height: 8, rgba: painted(8, (x) => (x < 4 ? [200, 0, 0] : [0, 0, 200])) };
    const out = new Uint8Array(32 * 32 * 4);
    const uvNew = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), uvOld = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
    const mask = copyPaint(out, 32, uvNew, uvOld, new Uint32Array([0, 1, 2, 0, 2, 3]), src);
    expect(mask[16 * 32 + 4]).toBe(1);
    expect(out[(16 * 32 + 4) * 4 + 2]).toBeGreaterThan(150); // new left is old right: blue
    expect(out[(16 * 32 + 27) * 4]).toBeGreaterThan(150);    // new right is old left: red
  });
});

describe("Sovereign Asset walls: paint down to color", () => {
  it("drops thin lines and creases and keeps areas of color", () => {
    const size = 96;
    // cream above, tan below, with thin dark lines every 12 pixels and one diagonal crease
    const rgba = painted(size, (x, y) => (y % 12 === 0 || Math.abs(x - y) < 1 ? [40, 40, 40] : y < 48 ? [220, 200, 180] : [170, 130, 90]));
    const flat = colorOnly(rgba, full(size), size, { x: 0, y: 0, w: size, h: size }, 3);
    const at = (x, y) => [flat[(y * size + x) * 3], flat[(y * size + x) * 3 + 1], flat[(y * size + x) * 3 + 2]];
    for (const [x, y] of [[20, 12], [60, 24], [30, 30], [70, 36]]) expect(at(x, y)[0]).toBeGreaterThan(195); // on a line or the crease: still cream
    expect(at(40, 20)[0]).toBeGreaterThan(200);
    expect(at(40, 80)[0]).toBeLessThan(185); // the tan base is still tan
    expect(at(40, 80)[0]).toBeGreaterThan(150);
    expect(at(40, 80)[2]).toBeLessThan(110);
  });

  it("gives the wall's color to an opening with no wall in it", () => {
    const size = 64, mask = full(size);
    const rgba = painted(size, () => [180, 170, 160]);
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) { mask[y * size + x] = 0; rgba.set([0, 0, 0, 255], (y * size + x) * 4); }
    const flat = colorOnly(rgba, mask, size, { x: 0, y: 0, w: size, h: size }, 2);
    expect(flat[(32 * size + 32) * 3]).toBeGreaterThan(170);
  });

  it("spreads color into the margin round a wall", () => {
    const size = 16, rgba = new Uint8Array(size * size * 4), mask = new Uint8Array(size * size);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) { rgba.set([90, 80, 70, 255], (y * size + x) * 4); mask[y * size + x] = 1; }
    spreadEdges(rgba, mask, size, 3);
    expect(rgba[(8 * size + 3) * 4]).toBe(90);
    expect(rgba[(8 * size + 1) * 4]).toBe(0);
  });
});

describe("Sovereign Asset walls: reading what a wall is made of", () => {
  const spot = (size) => ({ x: 0, y: 0, w: size, h: size });

  it("finds level courses and where the joints fall", () => {
    const size = 200;
    const rgba = painted(size, (x, y) => { const v = (y + 3) % 20 < 2 ? 70 : 150 + ((x * 7 + y * 13) % 9); return [v, v, v]; });
    const found = findCourses(rgba, full(size), size, spot(size), 4, 60);
    expect(found.period).toBe(20);
    expect(found.phase === 17 || found.phase === 18).toBe(true);
    expect(found.strength).toBeGreaterThan(0.5);
  });

  it("finds none on plain or blotchy paint", () => {
    const size = 200;
    expect(findCourses(painted(size, () => [150, 150, 150]), full(size), size, spot(size), 4, 60)).toBe(null);
    const blotchy = painted(size, (x, y) => { const v = 150 + 30 * Math.sin(y / 37) + 10 * Math.sin(x / 11); return [v, v, v]; });
    expect(findCourses(blotchy, full(size), size, spot(size), 4, 60)).toBe(null);
  });

  it("makes stucco that leaves the color where it was, and block with darker sunken joints", () => {
    const at = [0, 0, 0];
    let sum = 0, n = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) { surfaceAt("stucco", x * 3, y * 3, 20, 0, 0, 5, at); sum += at[0]; n++; expect(at[2]).toBeGreaterThan(0.7); }
    expect(sum / n).toBeGreaterThan(0.96);
    expect(sum / n).toBeLessThan(1.04);
    surfaceAt("block", 55, 120, 20, 40, 0, 5, at); // exactly on a joint between courses
    const joint = at.slice();
    surfaceAt("block", 55, 100, 20, 40, 0, 5, at); // the middle of a course
    expect(joint[0]).toBeLessThan(at[0]);
    expect(joint[1]).toBeLessThan(at[1] - 0.3);
    expect(joint[2]).toBeGreaterThan(at[2]);
  });
});

// A box of four walls, 4 by 4 and 6 tall, each a grid of quads. The four walls share one old
// texture, and every quad is its own scrap of it, the way a generator lays them out.
function box(steps = 8) {
  const pos = [], nor = [], uv = [], idx = [];
  const walls = [[[-2, -2], [2, -2], [0, 0, -1]], [[2, -2], [2, 2], [1, 0, 0]], [[2, 2], [-2, 2], [0, 0, 1]], [[-2, 2], [-2, -2], [-1, 0, 0]]];
  for (const [a, b, n] of walls) for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
    const at = pos.length / 3;
    for (const [s, t] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) {
      const f = s / steps, h = t / steps;
      pos.push(a[0] + (b[0] - a[0]) * f, h * 6, a[1] + (b[1] - a[1]) * f); nor.push(...n); uv.push(0.02 + 0.96 * f, 0.98 - 0.96 * h);
    }
    idx.push(at, at + 2, at + 1, at, at + 3, at + 2);
  }
  return { pos, nor, uv, idx };
}
const building = (rgba, size) => modelBytes(box(), async (doc, node, mat) => { mat.setName("old").setBaseColorTexture(doc.createTexture("color").setImage(encodePng(size, size, rgba)).setMimeType("image/png")); });
const cream = (size) => painted(size, (x, y) => (y > size * 0.7 ? [170, 130, 90] : [220, 200, 180]));
const coursed = (size) => painted(size, (x, y) => { const v = y % 16 < 2 ? 60 : 130; return [v, v, v]; });

describe("Sovereign Asset walls: in the finished file", () => {
  it("is off unless asked for", async () => {
    const result = await finishModel(await building(cream(128), 128), {}, { codec: pngCodec });
    expect((await read(result.bytes)).getRoot().listMaterials().map((m) => m.getName())).toEqual(["old"]);
    expect(check(result, "walls")).toBe(undefined);
  });

  it("moves the walls to a clean texture of their own and keeps the painted base", async () => {
    const bytes = await building(cream(128), 128), copy = Uint8Array.from(bytes);
    const result = await finishModel(bytes, { walls: "auto", maxTexture: 256 }, { codec: pngCodec, validate });
    expect(Array.from(bytes)).toEqual(Array.from(copy));
    if (!result.ready) console.log(result.report);
    expect(result.ready).toBe(true);
    expect(check(result, "valid").status).toBe("pass");
    expect(check(result, "walls").status).toBe("pass");
    expect(result.after.walls.count).toBe(4);
    expect(result.after.walls.kind).toBe("stucco");
    expect(result.after.walls.tris).toBe(result.before.triangles);
    expect(result.after.walls.stretched).toBe(0);
    expect(result.after.triangles).toBe(result.before.triangles);

    const doc = await read(result.bytes);
    const mat = doc.getRoot().listMaterials().find((m) => m.getName() === "walls");
    expect(mat.getBaseColorTexture().getSize()).toEqual([256, 256]);
    expect(mat.getNormalTexture()).toBeTruthy();
    expect(mat.getMetallicRoughnessTexture()).toBeTruthy();
    // the darker base course is still there: bottom of a wall is tan, top is cream
    const prim = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial() === mat);
    const pos = prim.getAttribute("POSITION").getArray(), uv = prim.getAttribute("TEXCOORD_0").getArray();
    const img = decodePng(mat.getBaseColorTexture().getImage());
    const red = (v) => img.rgba[(Math.min(255, Math.floor(uv[v * 2 + 1] * 256)) * 256 + Math.min(255, Math.floor(uv[v * 2] * 256))) * 4];
    let low = 0, lows = 0, high = 0, highs = 0;
    for (let v = 0; v < pos.length / 3; v++) { const y = pos[v * 3 + 1]; if (y > 0.4 && y < 1.2) { low += red(v); lows++; } if (y > 3.5 && y < 5.5) { high += red(v); highs++; } }
    expect(high / highs).toBeGreaterThan(200);
    expect(low / lows).toBeLessThan(190);
    expect(low / lows).toBeGreaterThan(140);
    expect(result.log.join(" ")).toMatch(/Walls: 4 walls moved to a 256 px texture of their own/);
  });

  it("reads level courses in the old paint as block, and takes a named surface when told", async () => {
    const auto = await finishModel(await building(coursed(128), 128), { walls: "auto", maxTexture: 512 }, { codec: pngCodec });
    expect(auto.after.walls.kind).toBe("block");
    expect(auto.log.join(" ")).toMatch(/new block surface was laid over it, with courses where the old paint had them/);
    const told = await finishModel(await building(cream(128), 128), { walls: "brick", maxTexture: 256 }, { codec: pngCodec });
    expect(told.after.walls.kind).toBe("brick");
  });

  it("runs with flatten, windows, the color standard and a triangle target, and the file is valid", async () => {
    const result = await finishModel(await building(cream(128), 128), { walls: "auto", flatten: "light", windowLights: true, colorStandard: true, surfaceMaps: "light", triangles: 200, maxTexture: 256 }, { codec: pngCodec, validate });
    expect(check(result, "valid").status).toBe("pass");
    expect(check(result, "walls").status).toBe("pass");
    expect(check(result, "color").status).toBe("pass");
    expect(result.after.triangles).toBeLessThan(result.before.triangles); // flat walls with one clean rectangle each reduce freely
    expect(result.log.join(" ")).toMatch(/Surface maps: every material already has its own/);
  });

  it("says so when there is no wall to work on, or textures cannot be read", async () => {
    const ball = await modelBytes({ pos: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1, 1, 1], idx: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3] }, async (doc, node, mat) => { mat.setBaseColorTexture(doc.createTexture("c").setImage(encodePng(8, 8, painted(8, () => [100, 100, 100]))).setMimeType("image/png")); });
    const none = await finishModel(ball, { walls: "auto" }, { codec: pngCodec });
    expect(none.log.join(" ")).toMatch(/Walls: no large flat upright wall was found/);
    expect(check(none, "walls").status).toBe("note");
    const blind = await finishModel(await building(cream(64), 64), { walls: "auto" }, {});
    expect(blind.log.join(" ")).toMatch(/Walls: textures cannot be read on this device/);
  });
});
