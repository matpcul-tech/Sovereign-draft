import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Document } from "@gltf-transform/core";
import { finishModel, inspectModel } from "../src/assetapp/engine.js";
import { addPrimitive, boxData, io, merge, modelBytes, pngCodec, solidPng, sphereData } from "./assetapp-helpers.js";

const check = (result, id) => result.checks.find((c) => c.id === id);
const read = async (bytes) => (await io()).readBinary(bytes);

describe("Sovereign Asset engine: geometry cleanup", () => {
  it("removes empty and repeated triangles and leaves the rest alone", async () => {
    const box = boxData([0, 0, 0], [1, 1, 1]);
    box.idx.push(0, 0, 1);      // no area
    box.idx.push(0, 3, 2);      // a repeat of the first triangle
    const bytes = await modelBytes(box);
    const found = await inspectModel(bytes);
    expect(found.defects.degenerate).toBe(1);
    expect(found.defects.duplicate).toBe(1);
    const result = await finishModel(bytes, {});
    expect(result.after.triangles).toBe(12);
    expect(result.after.defects.degenerate + result.after.defects.duplicate).toBe(0);
    expect(check(result, "triangles-clean").status).toBe("pass");
    expect(result.ready).toBe(true);
  });

  it("never changes the source bytes", async () => {
    const bytes = await modelBytes(boxData([0, 0, 0], [1, 2, 3], true));
    const copy = Uint8Array.from(bytes);
    await finishModel(bytes, { size: { axis: "height", meters: 5 }, closeHoles: "all" });
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(copy))).toBe(0);
  });

  it("removes a small piece floating in space and reports it", async () => {
    const body = sphereData(1, 16);
    const speck = boxData([2.5, 0.2, 0], [2.52, 0.22, 0.02]);
    const bytes = await modelBytes(merge(body, { ...speck, nor: new Array(24).fill(0), uv: new Array(16).fill(0) }));
    expect((await inspectModel(bytes)).defects.debrisPieces).toBe(1);
    const result = await finishModel(bytes, {});
    expect(result.after.triangles).toBe(body.idx.length / 3);
    expect(check(result, "debris").status).toBe("pass");
    expect(result.log.join(" ")).toMatch(/Removed 1 small floating piece /);
  });

  it("keeps a small part that sits on the model, even in the middle of one big flat face", async () => {
    const slab = boxData([-2, 0, -2], [2, 0.2, 2]);       // each face is two big triangles
    const bolt = boxData([0.3, 0.2, 0.4], [0.33, 0.23, 0.43]); // rests on the middle of the top face
    const bytes = await modelBytes(merge(slab, bolt));
    const result = await finishModel(bytes, {});
    expect(result.after.triangles).toBe(24);
    expect(result.before.defects.debrisPieces).toBe(0);
  });

  it("leaves many loose pieces alone and says so", async () => {
    const parts = [sphereData(1, 6)];
    for (let i = 0; i < 40; i++) parts.push(sphereData(0.02, 4, [3 + i * 0.3, 2, 0]));
    const bytes = await modelBytes(merge(...parts));
    const result = await finishModel(bytes, {});
    expect(result.before.defects.debrisHeld).toBe(40);
    expect(result.after.defects.pieces).toBe(41);
    expect(check(result, "debris").status).toBe("note");
  });

  it("turns an inside-out shell the right way round", async () => {
    const bytes = await modelBytes(boxData([0, 0, 0], [1, 1, 1], true));
    expect((await inspectModel(bytes)).defects.inverted).toBe(1);
    const result = await finishModel(bytes, {});
    expect(result.after.defects.inverted).toBe(0);
    expect(result.after.defects.wrongNormals).toBe(0);
    expect(check(result, "facing").status).toBe("pass");
    const off = await finishModel(bytes, { fixFacing: false });
    expect(check(off, "facing").status).toBe("fail");
    expect(off.ready).toBe(false);
  });

  it("does not flip a hollow inside a closed shell", async () => {
    const bytes = await modelBytes(merge(boxData([0, 0, 0], [2, 2, 2]), boxData([0.5, 0.5, 0.5], [1.5, 1.5, 1.5], true)));
    const found = await inspectModel(bytes);
    expect(found.defects.inverted).toBe(0);
  });

  it("adds normals when there are none", async () => {
    const bytes = await modelBytes(boxData([0, 0, 0], [1, 1, 1]));
    expect((await inspectModel(bytes)).defects.missingNormals).toBe(1);
    const result = await finishModel(bytes, {});
    expect(result.after.defects.missingNormals).toBe(0);
    expect(check(result, "normals").status).toBe("pass");
  });

  it("rebuilds normals that point the wrong way", async () => {
    const ball = sphereData(1, 12);
    ball.nor = ball.nor.map((v) => -v);
    const bytes = await modelBytes(ball);
    expect((await inspectModel(bytes)).defects.wrongNormals).toBeGreaterThan(0);
    const result = await finishModel(bytes, {});
    expect(result.after.defects.wrongNormals).toBe(0);
  });

  it("repairs normals that have no length", async () => {
    const ball = sphereData(1, 12);
    for (const i of [30, 31, 32, 90, 91, 92]) ball.nor[i] = 0;
    const result = await finishModel(await modelBytes(ball), {});
    const doc = await read(result.bytes);
    const arr = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("NORMAL").getArray();
    for (let i = 0; i < arr.length; i += 3) expect(Math.hypot(arr[i], arr[i + 1], arr[i + 2])).toBeCloseTo(1, 3);
    expect(result.log.join(" ")).toMatch(/Repaired 2 normals/);
  });

  it("closes a pinhole and keeps the shell facing outward", async () => {
    const ball = sphereData(1, 48);
    ball.idx.splice(3000, 3); // one triangle gone
    const bytes = await modelBytes(ball);
    expect((await inspectModel(bytes)).defects.openEdges).toBe(3);
    const result = await finishModel(bytes, {});
    expect(result.after.defects.openEdges).toBe(0);
    expect(result.after.defects.inverted).toBe(0);
    expect(result.after.triangles).toBe(ball.idx.length / 3 + 1);
    expect(result.log.join(" ")).toMatch(/Closed 1 hole\./);
  });

  it("does not lay a second skin on the back of an open sheet", async () => {
    const sheet = { pos: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], idx: [0, 2, 1, 0, 3, 2] };
    const bytes = await modelBytes(merge(boxData([0, 0.5, 0], [1, 1.5, 1]), sheet));
    const result = await finishModel(bytes, { closeHoles: "all" });
    expect(result.after.triangles).toBe(14);
    expect(result.after.defects.duplicate).toBe(0);
    expect(result.log.join(" ")).toMatch(/1 opening left open/);
  });

  it("leaves a large opening alone unless asked, and fails a print check on it", async () => {
    const box = boxData([0, 0, 0], [1, 1, 1]);
    box.idx.splice(0, 6); // a whole face gone
    const bytes = await modelBytes(box);
    const kept = await finishModel(bytes, { requireClosed: true });
    expect(kept.after.defects.openEdges).toBe(4);
    expect(check(kept, "closed").status).toBe("fail");
    expect(kept.ready).toBe(false);
    const closed = await finishModel(bytes, { closeHoles: "all", requireClosed: true });
    expect(closed.after.defects.openEdges).toBe(0);
    expect(closed.after.triangles).toBe(12);
    expect(closed.after.defects.inverted).toBe(0);
    expect(closed.ready).toBe(true);
  });
});

describe("Sovereign Asset engine: size and placement", () => {
  it("sizes, grounds and centers a single mesh by writing it into the vertices", async () => {
    const bytes = await modelBytes(boxData([10, 5, -3], [11, 7, 1]), (doc, node) => { node.setTranslation([4, 4, 4]).setScale([2, 2, 2]); });
    const result = await finishModel(bytes, { size: { axis: "height", meters: 1.8 } });
    expect(result.after.size[1]).toBeCloseTo(1.8, 4);
    expect(result.after.size[0]).toBeCloseTo(0.9, 4);
    expect(result.after.min[1]).toBeCloseTo(0, 5);
    expect((result.after.min[0] + result.after.max[0]) / 2).toBeCloseTo(0, 5);
    expect(["size", "ground", "center"].map((id) => check(result, id).status)).toEqual(["pass", "pass", "pass"]);
    const doc = await read(result.bytes);
    const node = doc.getRoot().listNodes().find((n) => n.getMesh());
    expect(node.getMatrix().map((v) => +v.toFixed(6))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("turns a model that lies on its back", async () => {
    const bytes = await modelBytes(boxData([0, 0, 0], [1, 1, 4])); // 4 long on Z
    const up = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]; // Z becomes Y
    const result = await finishModel(bytes, { rotation: up });
    expect(result.after.size.map((v) => +v.toFixed(4))).toEqual([1, 4, 1]);
    expect(result.after.min[1]).toBeCloseTo(0, 5);
    expect(result.after.defects.inverted).toBe(0);
  });

  it("moves a model with several parts from one top node and keeps every pivot", async () => {
    const doc = new Document();
    const scene = doc.createScene();
    const mat = doc.createMaterial("mat");
    const body = doc.createNode("body").setMesh(doc.createMesh("body").addPrimitive(addPrimitive(doc, boxData([-1, 0.3, -2], [1, 1, 2]), mat)));
    const wheel = doc.createNode("wheel_fl").setTranslation([-1, 0.3, 1.4]).setExtras({ kitWheel: true })
      .setMesh(doc.createMesh("wheel").addPrimitive(addPrimitive(doc, boxData([-0.1, -0.3, -0.3], [0.1, 0.3, 0.3]), mat)));
    scene.addChild(body).addChild(wheel);
    const bytes = await (await io()).writeBinary(doc);
    const result = await finishModel(bytes, { size: { axis: "length", meters: 8 } });
    expect(result.after.size[2]).toBeCloseTo(8, 4);
    const out = await read(result.bytes);
    const w = out.getRoot().listNodes().find((n) => n.getName() === "wheel_fl");
    expect(w.getTranslation().map((v) => +v.toFixed(5))).toEqual([-1, 0.3, 1.4]); // its own transform is untouched
    expect(w.getExtras().kitWheel).toBe(true);
    expect(w.getWorldTranslation()[2]).toBeCloseTo(2.8, 4); // and it rides the top node to its new place
    expect(out.getRoot().listNodes().some((n) => n.getName() === "asset_root")).toBe(true);
  });
});

async function riggedBytes(withAnimation = true) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const data = boxData([-0.2, 0, -0.2], [0.2, 1, 0.2]);
  const prim = addPrimitive(doc, data, doc.createMaterial("skin"));
  const joints = new Uint8Array(8 * 4), weights = new Float32Array(8 * 4);
  for (let i = 0; i < 8; i++) { joints[i * 4] = data.pos[i * 3 + 1] > 0.5 ? 1 : 0; weights[i * 4] = 1; }
  prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(joints).setBuffer(buffer));
  prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buffer));
  const hips = doc.createNode("Hips"), spine = doc.createNode("Spine").setTranslation([0, 0.5, 0]);
  hips.addChild(spine);
  const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1]);
  const skin = doc.createSkin("rig").addJoint(hips).addJoint(spine).setSkeleton(hips)
    .setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer));
  const body = doc.createNode("Body").setMesh(doc.createMesh("body").addPrimitive(prim)).setSkin(skin);
  scene.addChild(hips).addChild(body);
  if (withAnimation) {
    const sampler = doc.createAnimationSampler()
      .setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer))
      .setOutput(doc.createAccessor().setType("VEC4").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0.3826834, 0.9238795])).setBuffer(buffer));
    doc.createAnimation("wave").addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(spine).setTargetPath("rotation").setSampler(sampler));
  }
  return (await io()).writeBinary(doc);
}

describe("Sovereign Asset engine: rigged models", () => {
  it("keeps the skeleton and the animation, and sizes the character through the rig", async () => {
    const bytes = await riggedBytes();
    const result = await finishModel(bytes, { size: { axis: "height", meters: 1.8 }, requireSkeleton: true });
    expect(result.after.skins).toBe(1);
    expect(result.after.joints).toBe(2);
    expect(result.after.animations).toBe(1);
    expect(result.after.size[1]).toBeCloseTo(1.8, 3);
    expect(check(result, "kept").status).toBe("pass");
    expect(check(result, "skeleton").status).toBe("pass");
    expect(result.ready).toBe(true);
    const out = await read(result.bytes);
    expect(out.getRoot().listNodes().find((n) => n.getName() === "Spine").getTranslation()).toEqual([0, 0.5, 0]);
  });

  it("drops animations only when asked", async () => {
    const result = await finishModel(await riggedBytes(), { dropAnimations: true });
    expect(result.after.animations).toBe(0);
    expect(result.after.skins).toBe(1);
    expect(check(result, "kept").status).toBe("pass");
  });

  it("fails a character with no skeleton when one is required", async () => {
    const result = await finishModel(await modelBytes(boxData([0, 0, 0], [0.5, 1.8, 0.3])), { requireSkeleton: true });
    expect(check(result, "skeleton").status).toBe("fail");
    expect(result.banner).toBe("NOT READY");
  });
});

describe("Sovereign Asset engine: triangle target and textures", () => {
  it("reduces a dense mesh to the target and keeps it closed", async () => {
    const ball = sphereData(1, 48);
    const bytes = await modelBytes(ball);
    const result = await finishModel(bytes, { triangles: 1500 });
    expect(result.before.triangles).toBe(ball.idx.length / 3);
    expect(result.after.triangles).toBeLessThanOrEqual(1530);
    expect(result.after.triangles).toBeGreaterThan(700);
    expect(result.after.defects.openEdges).toBe(0);
    expect(result.after.size[1]).toBeGreaterThan(1.95);
    expect(check(result, "budget").status).toBe("pass");
  });

  it("fails the budget instead of wrecking the shape", async () => {
    const result = await finishModel(await modelBytes(boxData([0, 0, 0], [1, 1, 1])), { triangles: 4 });
    expect(result.after.triangles).toBe(12);
    expect(check(result, "budget").status).toBe("fail");
    expect(result.ready).toBe(false);
    expect(result.summary).toMatch(/Triangle target/);
  });

  it("resizes an oversized texture and keeps every material", async () => {
    const ball = sphereData(1, 8);
    const bytes = await modelBytes(ball, (doc, node, mat) => {
      mat.setBaseColorTexture(doc.createTexture("albedo").setImage(solidPng(64)).setMimeType("image/png"));
      const second = doc.createMaterial("second").setBaseColorFactor([0, 1, 0, 1]);
      node.getMesh().addPrimitive(addPrimitive(doc, sphereData(0.5, 6, [0, 1.4, 0]), second));
    });
    const result = await finishModel(bytes, { maxTexture: 16 }, { codec: pngCodec });
    expect(result.before.maxTexture).toBe(64);
    expect(result.after.maxTexture).toBe(16);
    expect(result.after.materials).toBe(2);
    expect(check(result, "textures").status).toBe("pass");
    const doc = await read(result.bytes);
    const px = (await pngCodec.decode(doc.getRoot().listTextures()[0].getImage(), "image/png")).rgba;
    expect([px[0], px[1], px[2], px[3]]).toEqual([200, 40, 30, 255]);
  });

  it("fails the texture check when a texture cannot be resized here", async () => {
    const bytes = await modelBytes(sphereData(1, 8), (doc, node, mat) => {
      mat.setBaseColorTexture(doc.createTexture("albedo").setImage(solidPng(64)).setMimeType("image/png"));
    });
    const result = await finishModel(bytes, { maxTexture: 16 }); // no codec
    expect(check(result, "textures").status).toBe("fail");
    expect(result.ready).toBe(false);
  });

  it("writes a compressed file that reads back the same", async () => {
    const ball = sphereData(1, 16);
    const result = await finishModel(await modelBytes(ball), { compress: true });
    expect(result.after.triangles).toBe(ball.idx.length / 3);
    expect(result.after.extensions).toContain("EXT_meshopt_compression");
    expect(result.after.size[1]).toBeCloseTo(2, 2);
    expect(result.ready).toBe(true);
  });
});

describe("Sovereign Asset engine: real files", () => {
  const validate = async (bytes) => {
    const { validateBytes } = await import("gltf-validator");
    const report = await validateBytes(bytes, { maxIssues: 50 });
    const first = report.issues.messages.find((m) => m.severity === 0);
    return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: first ? first.code + " " + first.message : "" };
  };
  for (const name of ["sedan-01-textured.glb", "sedan-review.glb", "taxi-v1.glb", "single-atlas-car.glb", "solid-car.glb"]) {
    it("finishes " + name + " with a verdict that matches its checks", async () => {
      const bytes = new Uint8Array(readFileSync(new URL("../fixtures/vehicle/" + name, import.meta.url)));
      const result = await finishModel(bytes, { triangles: 30000, maxTexture: 1024 }, { validate });
      expect(result.bytes).toBeTruthy();
      expect(result.ready).toBe(result.checks.every((c) => c.status !== "fail"));
      expect(result.after.defects.degenerate + result.after.defects.duplicate).toBe(0);
      expect(result.after.triangles).toBeLessThanOrEqual(30600);
      expect(check(result, "valid").status).not.toBe("note");
      console.log(name + "\n" + result.report + "\n");
    }, 120000);
  }
});
