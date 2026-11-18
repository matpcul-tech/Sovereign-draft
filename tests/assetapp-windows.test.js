import { describe, expect, it } from "vitest";
import { finishModel } from "../src/assetapp/engine.js";
import { findWindows, litPattern } from "../src/assetapp/windows.js";
import { encodePng } from "../src/asset/finish/png.js";
import { io, modelBytes, pngCodec } from "./assetapp-helpers.js";

const check = (result, id) => result.checks.find((c) => c.id === id);
const read = async (bytes) => (await io()).readBinary(bytes);
const validate = async (bytes) => {
  const { validateBytes } = await import("gltf-validator");
  const report = await validateBytes(bytes, { maxIssues: 50 });
  const first = report.issues.messages.find((m) => m.severity === 0);
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: first ? first.code + " " + first.message : "" };
};

// Paints, as linear color. Each one is a solid block of a small texture.
const PAINT = { wall: [0.5, 0.41, 0.32], glass: [0.2, 0.21, 0.23], frame: [0.3, 0.3, 0.3], door: [0.1, 0.058, 0.03], night: [0.008, 0.008, 0.008], sign: [0.6, 0.45, 0.08] };
const NAMES = Object.keys(PAINT);
const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
function paintTexture() {
  const cell = 8, w = cell * NAMES.length, rgba = new Uint8Array(w * cell * 4);
  NAMES.forEach((name, k) => { for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) rgba.set([...PAINT[name].map(srgb), 255], (y * w + k * cell + x) * 4); });
  return encodePng(w, cell, rgba);
}

// One wall, 10 wide and 6 tall, facing +Z, with openings cut into it. Each opening is
// { x0, x1, y0, y1, depth, paint }: depth below zero is set back, above zero stands proud.
// A set-back opening gets a reveal on all four sides, the way a real window sits in its frame.
function facade(openings, opts = {}) {
  const pos = [], nor = [], uv = [], idx = [], paintOf = [];
  const quad = (a, b, c, d, paint) => {
    const at = pos.length / 3, k = NAMES.indexOf(paint);
    for (const p of [a, b, c, d]) { pos.push(...p); nor.push(0, 0, 1); }
    const u0 = (k + 0.3) / NAMES.length, u1 = (k + 0.7) / NAMES.length;
    uv.push(u0, 0.3, u1, 0.3, u1, 0.7, u0, 0.7);
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
    paintOf.push(paint, paint);
  };
  const W = opts.width || 10, H = opts.height || 6;
  const xs = [...new Set([0, W, ...openings.flatMap((o) => [o.x0, o.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([0, H, ...openings.flatMap((o) => [o.y0, o.y1])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
    const inside = openings.find((o) => x0 >= o.x0 && x1 <= o.x1 && y0 >= o.y0 && y1 <= o.y1);
    if (!inside) quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], "wall");
  }
  for (const o of openings) {
    const z = o.depth;
    quad([o.x0, o.y0, z], [o.x1, o.y0, z], [o.x1, o.y1, z], [o.x0, o.y1, z], o.paint);
    quad([o.x0, o.y0, 0], [o.x0, o.y0, z], [o.x0, o.y1, z], [o.x0, o.y1, 0], "frame");
    quad([o.x1, o.y0, z], [o.x1, o.y0, 0], [o.x1, o.y1, 0], [o.x1, o.y1, z], "frame");
    quad([o.x0, o.y0, 0], [o.x1, o.y0, 0], [o.x1, o.y0, z], [o.x0, o.y0, z], "frame");
    quad([o.x0, o.y1, z], [o.x1, o.y1, z], [o.x1, o.y1, 0], [o.x0, o.y1, 0], "frame");
  }
  return { pos, nor, uv, idx, paintOf };
}

const diagOf = (data) => { let a = [1e9, 1e9, 1e9], b = [-1e9, -1e9, -1e9]; for (let i = 0; i < data.pos.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], data.pos[i + k]); b[k] = Math.max(b[k], data.pos[i + k]); } return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); };
const find = (data, opts) => findWindows(new Float32Array(data.pos), new Uint32Array(data.idx), diagOf(data), (t) => PAINT[data.paintOf[t]], opts);

const WINDOW = { x0: 2, x1: 3.5, y0: 2.5, y1: 4.5, depth: -0.15, paint: "glass" };

describe("Sovereign Asset windows: finding the glass", () => {
  it("finds a pane that is set back in a frame, and only its own triangles", () => {
    const data = facade([WINDOW]);
    const found = find(data);
    expect(found.windows.length).toBe(1);
    const w = found.windows[0];
    expect(w.width).toBeCloseTo(1.5, 3);
    expect(w.height).toBeCloseTo(2, 3);
    expect(w.bottom).toBeCloseTo(2.5, 3);
    expect(Array.from(w.tris).map((t) => data.paintOf[t])).toEqual(["glass", "glass"]);
  });

  it("does not take a plain wall, however it is cut into pieces", () => {
    expect(find(facade([])).windows.length).toBe(0);
    expect(find(facade([{ ...WINDOW, depth: 0, paint: "wall" }])).windows.length).toBe(0);
  });

  it("does not take a sign or a panel that stands proud of the wall", () => {
    expect(find(facade([{ x0: 2, x1: 6, y0: 4, y1: 5, depth: 0.12, paint: "sign" }])).windows.length).toBe(0);
    expect(find(facade([{ ...WINDOW, depth: 0.12 }])).windows.length).toBe(0);
  });

  it("does not take a door: set back, but painted, or reaching the ground", () => {
    expect(find(facade([{ x0: 4, x1: 5.2, y0: 1, y1: 3.5, depth: -0.15, paint: "door" }])).windows.length).toBe(0);
    expect(find(facade([{ x0: 4, x1: 5.2, y0: 0, y1: 2.4, depth: -0.15, paint: "glass" }])).windows.length).toBe(0);
  });

  it("takes dark glass and pale glass alike, since it goes by shape", () => {
    expect(find(facade([{ ...WINDOW, paint: "night" }])).windows.length).toBe(1);
    expect(findWindows(new Float32Array(facade([WINDOW]).pos), new Uint32Array(facade([WINDOW]).idx), diagOf(facade([WINDOW])), null).windows.length).toBe(1);
  });

  it("joins two panes either side of a mullion into one window, and keeps separate windows apart", () => {
    const pair = find(facade([{ ...WINDOW, x0: 2, x1: 2.9 }, { ...WINDOW, x0: 3.05, x1: 3.95 }]));
    expect(pair.windows.length).toBe(1);
    expect(pair.windows[0].tris.length).toBe(4);
    expect(pair.windows[0].width).toBeCloseTo(1.95, 2);
    const apart = find(facade([{ ...WINDOW, x0: 1, x1: 2.2 }, { ...WINDOW, x0: 6, x1: 7.2 }]));
    expect(apart.windows.length).toBe(2);
  });

  it("joins the strips of glass behind a row of bars", () => {
    const strips = [];
    for (let k = 0; k < 6; k++) strips.push({ x0: 2 + k * 0.5, x1: 2.38 + k * 0.5, y0: 2, y1: 4.5, depth: -0.2, paint: "night" });
    const found = find(facade(strips));
    expect(found.windows.length).toBe(1);
    expect(found.windows[0].tris.length).toBe(12);
    expect(found.windows[0].width).toBeCloseTo(2.88, 2);
  });

  it("joins the lights above a crossbar to the window below, and keeps separate floors apart", () => {
    const stacked = find(facade([{ ...WINDOW, y0: 2, y1: 3.6 }, { ...WINDOW, y0: 3.75, y1: 4.3 }]));
    expect(stacked.windows.length).toBe(1);
    expect(stacked.windows[0].tris.length).toBe(4);
    expect(stacked.windows[0].height).toBeCloseTo(2.3, 2);
    const floors = find(facade([{ ...WINDOW, y0: 0.8, y1: 2.2 }, { ...WINDOW, y0: 3.6, y1: 5 }]));
    expect(floors.windows.length).toBe(2);
  });

  it("finds a painted sign, proud of the wall, and not a band that runs the whole width", () => {
    const sign = find(facade([{ x0: 2, x1: 7, y0: 4, y1: 5, depth: 0.12, paint: "sign" }]));
    expect(sign.signs.length).toBe(1);
    expect(sign.signs[0].width).toBeCloseTo(5, 3);
    expect(sign.windows.length).toBe(0);
    expect(find(facade([{ x0: 0.2, x1: 9.8, y0: 4, y1: 5, depth: 0.12, paint: "sign" }])).signs.length).toBe(0);  // a cornice
    expect(find(facade([{ x0: 2, x1: 7, y0: 4, y1: 5, depth: 0.12, paint: "glass" }])).signs.length).toBe(0);     // not painted
    expect(find(facade([{ x0: 2, x1: 7, y0: 0.5, y1: 1.1, depth: 0.12, paint: "sign" }])).signs.length).toBe(0);  // down by the ground
  });

  it("names a door: set back and reaching the ground, or painted and tall upstairs", () => {
    const ground = find(facade([{ x0: 4, x1: 5.2, y0: 0, y1: 2.4, depth: -0.15, paint: "glass" }]));
    expect(ground.doors.length).toBe(1);
    expect(ground.doors[0].height).toBeCloseTo(2.4, 3);
    const upstairs = find(facade([{ x0: 4, x1: 5.2, y0: 1, y1: 3.5, depth: -0.15, paint: "door" }]));
    expect(upstairs.doors.length).toBe(1);
    expect(find(facade([WINDOW])).doors.length).toBe(0);
    expect(find(facade([{ x0: 3, x1: 6, y0: 2, y1: 3, depth: -0.15, paint: "door" }])).doors.length).toBe(0); // painted but wide: a panel
  });

  it("ignores a recess too small to be a window", () => {
    expect(find(facade([{ x0: 2, x1: 2.12, y0: 3, y1: 3.12, depth: -0.1, paint: "glass" }])).windows.length).toBe(0);
  });

  it("lights the same windows every time, and about two in three of them", () => {
    const windows = [];
    for (let floor = 0; floor < 10; floor++) for (let col = 0; col < 12; col++) windows.push({ left: col * 1.7 - 9, bottom: 1 + floor * 3, normal: [0, 0, 1] });
    const a = litPattern(windows), b = litPattern(windows);
    expect(a).toEqual(b);
    const share = a.filter(Boolean).length / a.length;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.8);
  });
});

describe("Sovereign Asset windows: in the finished file", () => {
  const building = (openings) => modelBytes(facade(openings), async (doc, node, mat) => {
    mat.setName("stucco").setBaseColorTexture(doc.createTexture("color").setImage(paintTexture()).setMimeType("image/png"));
  });
  const row = [0, 1, 2, 3].map((k) => ({ ...WINDOW, x0: 0.8 + k * 2.3, x1: 2.2 + k * 2.3 })).concat([0, 1, 2, 3].map((k) => ({ ...WINDOW, x0: 0.8 + k * 2.3, x1: 2.2 + k * 2.3, y0: 0.6, y1: 1.9 })));

  it("is off unless asked for", async () => {
    const result = await finishModel(await building(row), {}, { codec: pngCodec });
    expect((await read(result.bytes)).getRoot().listMaterials().map((m) => m.getName())).toEqual(["stucco"]);
    expect(check(result, "windows")).toBe(undefined);
  });

  it("moves the glass to lit and dark materials and leaves the wall alone", async () => {
    const bytes = await building(row), copy = Uint8Array.from(bytes);
    const result = await finishModel(bytes, { windowLights: true }, { codec: pngCodec, validate });
    expect(Array.from(bytes)).toEqual(Array.from(copy));
    expect(result.ready).toBe(true);
    expect(check(result, "valid").status).toBe("pass");
    expect(check(result, "windows").status).toBe("pass");
    expect(result.after.windows.found).toBe(8);
    expect(result.after.windows.litTris + result.after.windows.darkTris).toBe(16);
    expect(result.after.windows.litTris).toBe(result.after.windows.lit * 2);
    expect(result.after.triangles).toBe(result.before.triangles);

    const doc = await read(result.bytes);
    const mats = Object.fromEntries(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
    expect(Object.keys(mats).sort()).toEqual(["stucco", "windows_dark", "windows_lit"]);
    expect(mats.windows_lit.getEmissiveFactor()[0]).toBeGreaterThan(0.9);
    expect(mats.windows_lit.getEmissiveFactor()[2]).toBeLessThan(mats.windows_lit.getEmissiveFactor()[0]); // a warm light
    expect(mats.windows_dark.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(mats.stucco.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(mats.windows_lit.getRoughnessFactor()).toBeLessThanOrEqual(0.25);
    expect(mats.windows_lit.getBaseColorTexture()).toBe(mats.stucco.getBaseColorTexture()); // by day it looks as it did
    expect(result.log.join(" ")).toMatch(/Windows: found 8 windows by shape/);
  });

  it("keeps every window through a triangle target, with no gap at the frame", async () => {
    const result = await finishModel(await building(row), { windowLights: true, triangles: 60 }, { codec: pngCodec, validate });
    expect(check(result, "windows").status).toBe("pass");
    expect(result.after.windows.litTris + result.after.windows.darkTris).toBe(16);
    expect(check(result, "valid").status).toBe("pass");
  });

  it("gives a sign a material that glows with its own paint, and a door a material of its own", async () => {
    const result = await finishModel(await building([...row, { x0: 2, x1: 7, y0: 5, y1: 5.7, depth: 0.12, paint: "sign" }, { x0: 9.2, x1: 9.9, y0: 0, y1: 2.2, depth: -0.15, paint: "door" }]), { windowLights: true }, { codec: pngCodec, validate });
    expect(result.ready).toBe(true);
    expect(check(result, "panels").status).toBe("pass");
    expect(result.after.windows.signs).toBe(1);
    expect(result.after.windows.doors).toBe(1);
    const mats = Object.fromEntries((await read(result.bytes)).getRoot().listMaterials().map((m) => [m.getName(), m]));
    expect(mats.sign_lit.getEmissiveTexture()).toBe(mats.sign_lit.getBaseColorTexture());
    expect(mats.sign_lit.getEmissiveFactor()).toEqual([1, 1, 1]);
    expect(mats.door.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(result.after.windows.signTris).toBe(2);
    expect(result.after.windows.doorTris).toBe(2);
    expect(result.log.join(" ")).toMatch(/Signs and doors: 1 sign .* material sign_lit\. 1 door/);
    expect(check(result, "valid").status).toBe("pass");
  });

  it("says so plainly when a model has no windows, and when textures cannot be read", async () => {
    const none = await finishModel(await building([]), { windowLights: true }, { codec: pngCodec });
    expect(check(none, "windows").status).toBe("note");
    expect(none.log.join(" ")).toMatch(/Windows: none found/);
    expect(none.ready).toBe(true);
    const blind = await finishModel(await building(row), { windowLights: true }, {});
    expect(blind.log.join(" ")).toMatch(/Windows: textures cannot be read on this device/);
    expect((await read(blind.bytes)).getRoot().listMaterials().length).toBe(1);
  });

  it("works together with flatten, surface maps and the color standard", async () => {
    const result = await finishModel(await building(row), { windowLights: true, flatten: "light", surfaceMaps: "light", colorStandard: true, size: { axis: "height", meters: 9 } }, { codec: pngCodec, validate });
    expect(result.ready).toBe(true);
    expect(check(result, "windows").status).toBe("pass");
    expect(result.after.windows.found).toBe(8);
    expect(check(result, "valid").status).toBe("pass");
  });
});

describe("Sovereign Asset: baked light on a box of walls", () => {
  it("does not guess at light on a building, where a darker base is paint", async () => {
    // a tall box: four walls, darker toward the ground, the way a painted base course looks
    const pos = [], nor = [], uv = [], idx = [];
    const size = 64, rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = y < size / 2 ? 190 : 110; rgba.set([v, v * 0.9, v * 0.8, 255], (y * size + x) * 4); }
    const steps = 12;
    const walls = [[[-1, -1], [1, -1], [0, 0, -1]], [[1, -1], [1, 1], [1, 0, 0]], [[1, 1], [-1, 1], [0, 0, 1]], [[-1, 1], [-1, -1], [-1, 0, 0]]];
    for (const [a, b, n] of walls) for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
      const at = pos.length / 3;
      for (const [s, t] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) {
        const f = s / steps, h = t / steps;
        pos.push(a[0] + (b[0] - a[0]) * f, h * 3, a[1] + (b[1] - a[1]) * f); nor.push(...n); uv.push(0.05 + 0.9 * f, 0.95 - 0.9 * h);
      }
      idx.push(at, at + 2, at + 1, at, at + 3, at + 2);
    }
    const bytes = await modelBytes({ pos, nor, uv, idx }, async (doc, node, mat) => { mat.setBaseColorTexture(doc.createTexture("color").setImage(encodePng(size, size, rgba)).setMimeType("image/png")); });
    const source = (await read(bytes)).getRoot().listTextures()[0].getImage();
    const result = await finishModel(bytes, { delight: "strong" }, { codec: pngCodec });
    expect(result.log.join(" ")).toMatch(/Baked light: 1 color texture left as painted\. The model is mostly flat walls/);
    expect(Array.from((await read(result.bytes)).getRoot().listTextures()[0].getImage())).toEqual(Array.from(source));
  });
});
