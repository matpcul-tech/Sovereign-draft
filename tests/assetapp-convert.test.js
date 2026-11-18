import { describe, expect, it } from "vitest";
import { zipSync } from "three/addons/libs/fflate.module.js";
import { ACCEPT, toGlb } from "../src/assetapp/convert.js";
import { modelBytes } from "./assetapp-helpers.js";

const tri = { pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1], idx: [0, 1, 2] };
const file = (bytes, name) => new File([bytes], name);

describe("Sovereign Asset: reading whatever shows up", () => {
  it("offers every format it reads in the file picker", () => {
    for (const e of [".glb", ".gltf", ".fbx", ".obj", ".dae", ".3ds", ".3mf", ".usdz", ".stl", ".ply", ".zip", ".tga"]) expect(ACCEPT.split(",")).toContain(e);
  });

  it("passes a GLB through untouched", async () => {
    const bytes = await modelBytes(tri);
    const got = await toGlb([file(bytes, "thing.glb")]);
    expect(Array.from(got.bytes)).toEqual(Array.from(bytes));
    expect(got.name).toBe("thing");
    expect(got.note).toBe("");
  });

  it("opens a ZIP and reads the model inside, whatever folder it is in", async () => {
    const bytes = await modelBytes(tri);
    const zip = zipSync({ "download/": new Uint8Array(0), "download/model/house.glb": bytes, "download/readme.txt": new Uint8Array([104, 105]), "__MACOSX/._house.glb": new Uint8Array([1]) });
    const got = await toGlb([file(zip, "meshy-download.zip")]);
    expect(Array.from(got.bytes)).toEqual(Array.from(bytes));
    expect(got.name).toBe("house");
    expect(got.note).toBe("Opened the ZIP and read house.glb.");
  });

  it("says plainly what it was given when there is no model to read", async () => {
    await expect(toGlb([file(zipSync({ "readme.txt": new Uint8Array([104, 105]) }), "notes.zip")])).rejects.toThrow(/The ZIP holds no model this app reads \(it has \.txt\)\. Pick a GLB, glTF, FBX/);
    await expect(toGlb([file(new Uint8Array([1, 2, 3]), "scan.xyz")])).rejects.toThrow(/This app does not read \.xyz as a model/);
    await expect(toGlb([file(new Uint8Array([1, 2, 3]), "broken.zip")])).rejects.toThrow(/The ZIP broken\.zip could not be opened/);
    await expect(toGlb([])).rejects.toThrow(/^Pick a GLB, glTF, FBX, OBJ, DAE, 3DS, 3MF, USDZ, STL or PLY file, or a ZIP that holds one\.$/);
  });
});
