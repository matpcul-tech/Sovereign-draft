import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { finishCar } from "../src/assetapp/car.js";
import { decodePng } from "../src/asset/finish/png.js";
import { io, pngCodec } from "./assetapp-helpers.js";

describe("Sovereign Asset: Street Empire car", () => {
  it("finishes the raw Meshy sedan into a car the game importer takes", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/vehicle/sedan-01-textured.glb", import.meta.url)));
    const result = await finishCar(bytes, "sedan.glb", { frontConfirmed: true, length: 4.9 }, { codec: pngCodec });
    console.log(result.report);
    expect(result.bytes).toBeTruthy();
    expect(result.ready).toBe(result.checks.every((c) => c.status !== "fail"));
    expect(result.ready).toBe(true);
    const doc = await (await io()).readBinary(result.bytes);
    const root = doc.getRoot();
    // one material, tagged, with the mask in the emissive slot and emissive factor 0
    expect(root.listMaterials().length).toBe(1);
    const mat = root.listMaterials()[0];
    expect(mat.getExtras().kitMask).toBe(true);
    expect(mat.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(/paint|body|carpaint|exterior|shell/i.test(mat.getName())).toBe(false);
    // four tagged wheels, each with its origin off the ground, on its own side and end of the car
    const wheels = root.listNodes().filter((n) => n.getExtras().kitWheel);
    expect(wheels.map((n) => n.getName()).sort()).toEqual(["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]);
    for (const w of wheels) {
      const t = w.getWorldTranslation();
      expect(Math.abs(t[0])).toBeGreaterThan(0.5);
      expect(t[1]).toBeGreaterThan(0.2);
      expect(Math.sign(t[0])).toBe(w.getName().endsWith("l") ? -1 : 1);
      expect(Math.sign(t[2])).toBe(w.getName().startsWith("wheel_f") ? 1 : -1);
    }
    expect(result.after.size[2]).toBeCloseTo(4.9, 1);
    // the mask marks every texel a body face uses, and nothing is left half transparent
    const mask = decodePng(mat.getEmissiveTexture().getImage());
    let paint = 0, glass = 0, mixed = 0;
    for (let i = 0; i < mask.rgba.length; i += 4) {
      const on = (mask.rgba[i] > 127) + (mask.rgba[i + 1] > 127) + (mask.rgba[i + 2] > 127);
      if (on > 1 || mask.rgba[i + 3] !== 255) mixed++;
      if (mask.rgba[i + 1] > 127) paint++;
      if (mask.rgba[i] > 127) glass++;
    }
    expect(mixed).toBe(0);
    expect(glass).toBeGreaterThan(0);
    expect(paint).toBeGreaterThan(mask.width * mask.height * 0.3);
    const cover = result.checks.find((c) => c.id === "mask-cover");
    expect(cover.status).toBe("pass");
    expect(result.report).not.toMatch(/does not read|declared check/);
    // the two findings that come with every AI car are shown, and do not block
    expect(result.checks.filter((c) => c.status === "note").map((c) => c.id).sort()).toEqual(["manifold", "mask-clean"]);
  }, 180000);

  it("does not call a car ready when the front was not confirmed", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/vehicle/sedan-01-textured.glb", import.meta.url)));
    const result = await finishCar(bytes, "sedan.glb", { frontConfirmed: false }, { codec: pngCodec });
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === "front").status).toBe("fail");
  }, 180000);
});
