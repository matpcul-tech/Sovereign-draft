import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadVehicle, packGlb } from "../src/asset/finish/glb.js";
import { crossingCarGlb, singleAtlasCarGlb, solidCarGlb } from "../src/asset/finish/fixture.js";
import { encodePng } from "../src/asset/finish/png.js";
import { resolveProfile } from "../src/asset/finish/profiles.js";
import { runFinish } from "../src/asset/finish/pipeline.js";
import { unzipStore } from "../src/asset/finish/zip.js";

function windowCarGlb() {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const index = (y * 32 + x) * 4;
      const glass = x >= 16;
      rgba[index] = glass ? 34 : 40;
      rgba[index + 1] = glass ? 34 : 90;
      rgba[index + 2] = glass ? 34 : 180;
      rgba[index + 3] = 255;
    }
  }
  const dst = { p: [], u: [], n: [], i: [] };
  const pushBox = (min, max) => {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const verts = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
    const start = dst.p.length / 3;
    for (const vert of verts) {
      dst.p.push(vert[0], vert[1], vert[2]);
      dst.u.push(0.2, 0.2);
      dst.n.push(0, 1, 0);
    }
    for (const face of faces) dst.i.push(start + face[0], start + face[1], start + face[2]);
  };
  pushBox([-0.35, 0, -1], [0.35, 1, 1]);
  const a = 3;
  const start = dst.p.length / 3;
  const x2 = -0.39;
  dst.p.push(x2, 1, -1, x2, 1, 1, x2, 1.28, 1, x2, 1.28, -1, x2, 1.14, 0);
  dst.u.push(0.7, 0.35, 0.9, 0.35, 0.9, 0.7, 0.7, 0.7, 0.8, 0.5);
  dst.n.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
  dst.i.push(a, start, start + 1, start, start + 1, start + 4, start + 1, start + 2, start + 4, start + 2, start + 3, start + 4, start + 3, start, start + 4);
  pushBox([-0.72, 0.02, 0.55], [-0.48, 0.26, 0.82]);
  pushBox([0.48, 0.02, 0.55], [0.72, 0.26, 0.82]);
  pushBox([-0.72, 0.02, -0.82], [-0.48, 0.26, -0.55]);
  pushBox([0.48, 0.02, -0.82], [0.72, 0.26, -0.55]);
  return packGlb({
    sceneName: "window-car",
    roots: [0],
    materials: [{
      name: "atlas",
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      baseColorImage: { name: "atlas", mime: "image/png", bytes: encodePng(32, 32, rgba) }
    }],
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

const outDir = "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });

const jobs = [
  ["sedan-review", readFileSync("fixtures/vehicle/sedan-review.glb"), "sedan-review.glb"],
  ["single-atlas", singleAtlasCarGlb(), "single-atlas.glb"],
  ["solid-shell", solidCarGlb(), "solid-shell.glb"],
  ["crossing-wheel", crossingCarGlb(), "crossing-wheel.glb"],
  ["window-car", windowCarGlb(), "window-car.glb"]
];
writeFileSync("/tmp/window-car-source.glb", jobs[4][1]);

for (const [name, bytes, fileName] of jobs) {
  const loaded = await loadVehicle(bytes, fileName);
  const result = await runFinish(loaded, resolveProfile("CAR"), { frontConfirmed: true });
  if (!result.zip) {
    console.log(name, result.banner, "no zip");
    continue;
  }
  const zipPath = outDir + "/finish-" + name + ".zip";
  writeFileSync(zipPath, result.zip);
  const files = unzipStore(result.zip);
  for (const file of files) {
    if (!file.name.endsWith(".png") && file.name !== "validation.txt" && file.name !== "mapping.json") continue;
    const dest = outDir + "/finish-" + name + "-" + file.name.replace(/\//g, "-");
    writeFileSync(dest, file.data);
  }
  console.log(name, result.banner, "zip", zipPath, "files", files.map((file) => file.name).join(", "));
}
