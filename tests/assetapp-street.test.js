import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { clipTriangle, cutSpecifiedWheels, settleCylinderBleed, exportedBleed } from "../src/asset/finish/clip.js";
import { encodePng } from "../src/asset/finish/png.js";
import { packGlb, readGlb } from "../src/asset/finish/glb.js";
import { sideViewGlassCheck } from "../src/asset/finish/mask.js";
import { runFinish } from "../src/asset/finish/pipeline.js";
import { loadVehicle } from "../src/asset/finish/glb.js";
import { resolveProfile } from "../src/asset/finish/profiles.js";
import { checkStatus, finishMotorcycle } from "../src/assetapp/car.js";
import { presetById } from "../src/assetapp/presets.js";
import { pngCodec } from "./assetapp-helpers.js";

function vert(p, uv) {
  return { p, uv, n: [1, 0, 0] };
}

function facesOk(faces) {
  expect(faces.length).toBeGreaterThan(0);
  for (const face of faces) {
    expect(face).toHaveLength(3);
    for (const corner of face) expect(corner.p).toHaveLength(3);
  }
}

function pushGridBox(dst, min, max, n) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const tris = [[0, 1, 2], [0, 2, 3]];
  const axes = [
    { u: 0, v: 1, w: 2, sign: -1 },
    { u: 0, v: 1, w: 2, sign: 1 },
    { u: 2, v: 1, w: 0, sign: -1 },
    { u: 2, v: 1, w: 0, sign: 1 },
    { u: 0, v: 2, w: 1, sign: -1 },
    { u: 0, v: 2, w: 1, sign: 1 }
  ];
  const span = [x1 - x0, y1 - y0, z1 - z0];
  const origin = [x0, y0, z0];
  for (const axis of axes) {
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const corners = [];
        for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const p = origin.slice();
          p[axis.u] += span[axis.u] * (ix + du) / n;
          p[axis.v] += span[axis.v] * (iy + dv) / n;
          p[axis.w] += axis.sign > 0 ? span[axis.w] : 0;
          corners.push(p);
        }
        for (const tri of tris) {
          const start = dst.p.length / 3;
          for (const index of tri) {
            dst.p.push(...corners[index]);
            dst.u.push(0.2 + (dst.p.length % 7) * 0.01, 0.3);
            dst.n.push(0, 1, 0);
          }
          dst.i.push(start, start + 1, start + 2);
        }
      }
    }
  }
}

function meshGlb(fill, image, extraImage) {
  const dst = { p: [], u: [], n: [], i: [] };
  fill(dst);
  const material = {
    name: "atlas",
    baseColorFactor: [1, 1, 1, 1],
    metallicFactor: 0,
    roughnessFactor: 1,
    baseColorImage: { name: "base", mime: image.mime, bytes: image.bytes }
  };
  if (extraImage) material.metallicRoughnessImage = extraImage;
  return packGlb({
    sceneName: "piece",
    roots: [0],
    materials: [material],
    meshes: [{
      name: "shell",
      primitives: [{
        material: 0,
        position: new Float32Array(dst.p),
        normal: new Float32Array(dst.n),
        uv: new Float32Array(dst.u),
        indices: new Uint32Array(dst.i)
      }]
    }],
    nodes: [{ name: "shell", mesh: 0 }]
  });
}

function solidPng() {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 40;
    rgba[i + 1] = 90;
    rgba[i + 2] = 180;
    rgba[i + 3] = 255;
  }
  return { mime: "image/png", bytes: encodePng(16, 16, rgba) };
}

function pushBox(dst, min, max, uv) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const verts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  const start = dst.p.length / 3;
  verts.forEach((point, index) => {
    dst.p.push(...point);
    const u = uv ? (index % 2 === 0 ? uv[0] : uv[2]) : 0.2;
    const v = uv ? (index < 4 ? uv[1] : uv[3]) : 0.2;
    dst.u.push(u, v);
    dst.n.push(0, 1, 0);
  });
  for (const face of faces) dst.i.push(start + face[0], start + face[1], start + face[2]);
}

function glassBand(dst, anchor, x, y0, y1) {
  const start = dst.p.length / 3;
  const x2 = x - 0.04;
  dst.p.push(x2, y0, -1, x2, y0, 1, x2, y1, 1, x2, y1, -1, x2, (y0 + y1) / 2, 0);
  dst.u.push(0.55, 0.35, 0.75, 0.35, 0.75, 0.72, 0.55, 0.72, 0.65, 0.52);
  dst.n.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
  dst.i.push(anchor, start, start + 1, start, start + 1, start + 4, start + 1, start + 2, start + 4, start + 2, start + 3, start + 4, start + 3, start, start + 4);
}

function corner(signX, signZ, kind) {
  const x = signX * (kind === "tire" ? 0.9 : 0.72);
  const z = signZ * 1.45;
  if (kind === "tire") return [x - 0.11, 0, z - 0.33, x + 0.11, 0.66, z + 0.33];
  return [x - 0.025, 0.16, z - 0.18, x + 0.025, 0.52, z + 0.18];
}

describe("street finish fixes", () => {
  it("keeps a triangle that only touches the cylinder, which is what crashed the taxi", () => {
    const cyl = { cx: 0, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 1 };
    const touching = clipTriangle([
      vert([0, 0, 0], [0, 0]),
      vert([0, 1, 0], [1, 0]),
      vert([0, 0.4, 0.2], [0.2, 0.8])
    ], cyl);
    expect(touching.ok).toBe(true);
    facesOk(touching.inside);
    const crossing = clipTriangle([
      vert([0, 2, 2], [0, 0]),
      vert([0, -2, 2], [1, 0]),
      vert([0, 0, -3], [0.5, 1])
    ], { ...cyl, radius: 0.3, capUv: [0.08, 0.08] });
    expect(crossing.ok).toBe(true);
    facesOk(crossing.inside);
    facesOk(crossing.outside);
    const wheel = {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const bodyPositions = [];
    const bodyUvs = [];
    const bodyNormals = [];
    const tri = [
      vert([0, 2, 2], [0.2, 0.2]),
      vert([0, -2, 2], [0.4, 0.2]),
      vert([0, 0, -3], [0.3, 0.5])
    ];
    for (const cornerVert of tri) {
      bodyPositions.push(...cornerVert.p);
      bodyUvs.push(...cornerVert.uv);
      bodyNormals.push(0, 1, 0);
    }
    const parts = [
      { name: "body", wheel: false, mesh: { positions: new Float32Array(bodyPositions), uvs: new Float32Array(bodyUvs), normals: new Float32Array(bodyNormals), indices: new Uint32Array([0, 1, 2]) } },
      { name: "wheel_fl", wheel: true, center: [-1, 0.3, 1], mesh: wheel },
      { name: "wheel_fr", wheel: true, center: [1, 0.3, 1], mesh: wheel },
      { name: "wheel_rl", wheel: true, center: [-1, 0.3, -1], mesh: wheel },
      { name: "wheel_rr", wheel: true, center: [1, 0.3, -1], mesh: wheel }
    ];
    const cyls = [
      { name: "wheel_fl", cx: 0, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.3, half: 2 },
      { name: "wheel_fr", cx: 4, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.3, half: 0.2 },
      { name: "wheel_rl", cx: 8, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.3, half: 0.2 },
      { name: "wheel_rr", cx: 12, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.3, half: 0.2 }
    ];
    expect(() => cutSpecifiedWheels(parts, { cylinders: cyls, capUv: [0.08, 0.08], keepInsideOnBody: true })).not.toThrow();
  });

  it("fails a new non-manifold edge and notes one that was already there", () => {
    expect(checkStatus({ id: "manifold", pass: false, detail: "12 edges are shared by more than two triangles. 0 are new after the cut. 12 non-manifold edges were already on the split parts." })).toBe("note");
    expect(checkStatus({ id: "manifold", pass: false, detail: "4 edges are shared by more than two triangles. 4 are new after the cut. 0 non-manifold edges were already on the split parts." })).toBe("fail");
    expect(checkStatus({ id: "manifold", pass: false, detail: "14 edges are shared by more than two triangles. 10 are new after the cut." })).toBe("fail");
    expect(checkStatus({ id: "mask-clean", pass: false, detail: "packed too close" })).toBe("note");
    expect(checkStatus({ id: "bleed", pass: false, detail: "2 exported triangles cross a wheel cylinder." })).toBe("fail");
  });

  it("accepts cabin glass on a long side that is under 8 percent of the whole silhouette", () => {
    const samples = [];
    for (let i = 0; i < 900; i++) samples.push({ onCar: true, kind: "paint", y: 0.2, iy: 2, iz: i % 40 });
    for (let z = 0; z < 20; z++) samples.push({ onCar: true, kind: "paint", y: 1.1, iy: 8, iz: z });
    for (let y = 10; y < 18; y++) {
      for (let z = 4; z < 12; z++) samples.push({ onCar: true, kind: "glass", y: 1.3, iy: y, iz: z });
    }
    const area = sideViewGlassCheck(samples, 0.8);
    expect(area.ratio).toBeLessThan(0.08);
    expect(area.pass).toBe(true);
    expect(area.detail).toMatch(/Cabin glass is/);
    const fringe = sideViewGlassCheck([{ onCar: true, kind: "glass", y: 1.2, iy: 3, iz: 3 }], 0.8);
    expect(fringe.pass).toBe(false);
  });

  it("gives the coupe its own length and makes the van 5.2 m", () => {
    const car = presetById("se-car");
    expect(car.slots).toContain("coupe");
    expect(car.lengths.coupe).toBe(4.7);
    expect(car.lengths.van).toBe(5.2);
    expect(car.lengths.muscle).toBe(4.8);
    const bike = presetById("se-motorcycle");
    expect(bike.lengths).toEqual({ cruiser: 2.2, dirt: 2.2, sport: 2.2 });
    expect(resolveProfile("MOTORCYCLE").outputNodes).toEqual(["body", "wheel_f", "wheel_r"]);
    expect(resolveProfile("MOTORCYCLE", { lengthZ: 2.2 }).lengthZ).toBe(2.2);
  });

  it("pulls a vertex that barely crosses a tire back onto the cylinder", () => {
    const cyl = { name: "wheel_fl", cx: 0, cy: 0.33, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.33, half: 0.2 };
    const positions = [0, 0.33, 0.35, 0, 0.33, 0.328, 0.1, 0.33, 0.33];
    const parts = [{
      name: "body",
      wheel: false,
      mesh: {
        positions: new Float32Array(positions),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        normals: new Float32Array(9),
        indices: new Uint32Array([0, 1, 2])
      }
    }];
    expect(exportedBleed(parts, [cyl])).toBe(1);
    expect(settleCylinderBleed(parts, [cyl])).toBe(1);
    expect(exportedBleed(parts, [cyl])).toBe(0);
  });

  it("keeps the lower tire when a denser hub shares the corner, which is the police failure", async () => {
    const png = solidPng();
    const bytes = meshGlb((dst) => {
      pushGridBox(dst, [-0.55, 0.4, -2.05], [0.55, 1.35, 2.05], 2);
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          const hub = corner(x, z, "hub");
          const tire = corner(x, z, "tire");
          pushGridBox(dst, hub.slice(0, 3), hub.slice(3), 3);
          pushGridBox(dst, tire.slice(0, 3), tire.slice(3), 2);
        }
      }
    }, png);
    const loaded = await loadVehicle(bytes, "police-shape.glb");
    const result = await runFinish(loaded, resolveProfile("CAR", { lengthZ: 4.9 }), { frontConfirmed: true });
    expect(result.checks.find((check) => check.id === "wheels").pass).toBe(true);
    expect(result.checks.find((check) => check.id === "wheels").detail).not.toMatch(/not one piece/);
    const { json } = readGlb(result.bytes);
    const names = json.nodes.map((node) => node.name).sort();
    expect(names).toEqual(["body", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]);
    for (const node of json.nodes) {
      if (!node.extras || !node.extras.kitWheel) continue;
      expect(node.translation[1]).toBeGreaterThan(0.2);
      expect(node.translation[1]).toBeLessThan(0.5);
    }
  }, 60000);

  it("decodes a JPEG atlas and stores the kit mask, which is the high-detail sedan failure", async () => {
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const glass = x >= 16;
        rgba[i] = glass ? 34 : 40;
        rgba[i + 1] = glass ? 34 : 90;
        rgba[i + 2] = glass ? 34 : 180;
        rgba[i + 3] = 255;
      }
    }
    const jpg = jpeg.encode({ data: rgba, width: 32, height: 32 }, 95);
    const image = { mime: "image/jpeg", bytes: jpg.data };
    const bytes = meshGlb((dst) => {
      const body = dst.p.length / 3;
      pushBox(dst, [-0.35, 0, -1], [0.35, 1, 1], [0.05, 0.2, 0.4, 0.75]);
      glassBand(dst, body + 3, -0.35, 1, 1.28);
      pushBox(dst, [-0.72, 0.02, 0.55], [-0.48, 0.26, 0.82], [0.1, 0.05, 0.3, 0.22]);
      pushBox(dst, [0.48, 0.02, 0.55], [0.72, 0.26, 0.82], [0.1, 0.05, 0.3, 0.22]);
      pushBox(dst, [-0.72, 0.02, -0.82], [-0.48, 0.26, -0.55], [0.1, 0.05, 0.3, 0.22]);
      pushBox(dst, [0.48, 0.02, -0.82], [0.72, 0.26, -0.55], [0.1, 0.05, 0.3, 0.22]);
    }, image, { name: "rough", mime: "image/jpeg", bytes: jpg.data });
    const loaded = await loadVehicle(bytes, "sedan-jpeg.glb");
    expect(loaded.images.some((item) => item.mime === "image/jpeg")).toBe(true);
    const result = await runFinish(loaded, resolveProfile("CAR", { lengthZ: 4.9 }), { frontConfirmed: true });
    const texture = result.checks.find((check) => check.id === "texture");
    const mask = result.checks.find((check) => check.id === "mask");
    expect(texture.pass).toBe(true);
    expect(mask ? mask.pass : true).toBe(true);
    expect(result.log.join("\n")).not.toMatch(/not a PNG or a WebP/);
    const { json } = readGlb(result.bytes);
    expect(json.materials[0].extras.kitMask).toBe(true);
    expect(json.materials[0].emissiveTexture.index).toBeGreaterThanOrEqual(0);
    expect(json.materials[0].emissiveFactor).toEqual([0, 0, 0]);
  }, 60000);

  it("finishes a two-wheel bike and refuses to invent wheels on a solid frame", async () => {
    const png = solidPng();
    const bike = meshGlb((dst) => {
      pushGridBox(dst, [-0.12, 0.5, -0.85], [0.12, 1.05, 0.85], 1);
      pushGridBox(dst, [-0.06, 0, 0.45], [0.06, 0.64, 1.09], 2);
      pushGridBox(dst, [-0.05, 0, -1.05], [0.05, 0.6, -0.42], 2);
    }, png);
    const result = await finishMotorcycle(bike, "cruiser.glb", { frontConfirmed: true, length: 2.2 }, { codec: pngCodec });
    expect(result.bytes).toBeTruthy();
    expect(result.ready).toBe(true);
    const { json } = readGlb(result.bytes);
    expect(json.nodes.map((node) => node.name).sort()).toEqual(["body", "wheel_f", "wheel_r"]);
    for (const node of json.nodes) {
      if (node.name === "body") continue;
      expect(node.extras.kitWheel).toBe(true);
      expect(Math.abs(node.translation[0])).toBeLessThan(0.2);
      expect(node.translation[1]).toBeGreaterThan(0.15);
    }
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0].name).toBe("atlas");
    expect(json.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(json.materials[0].extras.kitMask).toBe(true);
    expect(json.materials[0].emissiveTexture).toBeTruthy();
    if (json.materials[0].emissiveFactor) expect(json.materials[0].emissiveFactor).toEqual([0, 0, 0]);
    expect(result.after.size[2]).toBeGreaterThan(2.09);
    expect(result.after.size[2]).toBeLessThan(2.31);
    expect(result.after.triangles).toBeLessThanOrEqual(40000);
    const again = await finishMotorcycle(result.bytes, "cruiser.glb", { frontConfirmed: true, length: 2.2 }, { codec: pngCodec });
    expect(again.log[0]).toMatch(/wheel split was not run again/);
    const fused = meshGlb((dst) => pushGridBox(dst, [-0.2, 0, -1], [0.2, 1.1, 1], 1), png);
    const refused = await finishMotorcycle(fused, "fused.glb", { frontConfirmed: true, length: 2.2 }, { codec: pngCodec });
    expect(refused.ready).toBe(false);
    expect(refused.bytes).toBeFalsy();
    expect(refused.checks.find((check) => check.id === "wheels").detail).toMatch(/No wheel was invented/);
  }, 60000);
});
