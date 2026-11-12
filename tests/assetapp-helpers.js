// Small models built in memory for the Sovereign Asset tests.
import { Document, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { decodePng, encodePng } from "../src/asset/finish/png.js";

export async function io() {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

// PNG only, which is all the tests need. The browser codec adds JPEG and WebP.
export const pngCodec = {
  async decode(bytes, mime) { return mime === "image/png" ? decodePng(bytes) : null; },
  async encode(rgba, width, height, mime) { return mime === "image/png" ? encodePng(width, height, rgba) : null; }
};

// A closed box, 12 triangles, faces outward. flip turns it inside out.
export function boxData(min, max, flip = false) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const pos = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  const idx = [];
  for (const q of quads) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  if (flip) for (let i = 0; i < idx.length; i += 3) { const s = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = s; }
  return { pos, idx };
}

// A closed sphere with real normals and UVs.
export function sphereData(radius, rings, center = [0, 0, 0]) {
  const pos = [], nor = [], uv = [], idx = [];
  const segs = rings * 2;
  for (let r = 0; r <= rings; r++) {
    const phi = Math.PI * r / rings;
    for (let s = 0; s < segs; s++) {
      const th = 2 * Math.PI * s / segs;
      const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      if (r === 0 || r === rings) { n[0] = 0; n[2] = 0; }
      pos.push(center[0] + n[0] * radius, center[1] + n[1] * radius, center[2] + n[2] * radius);
      nor.push(...n); uv.push(s / segs, r / rings);
    }
  }
  const at = (r, s) => r * segs + (s % segs);
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    if (r > 0) idx.push(at(r, s), at(r, s + 1), at(r + 1, s));
    if (r < rings - 1) idx.push(at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
  }
  return { pos, nor, uv, idx };
}

export function merge(...parts) {
  const out = { pos: [], nor: [], uv: [], idx: [] };
  for (const p of parts) {
    const base = out.pos.length / 3;
    out.pos.push(...p.pos);
    out.nor.push(...(p.nor || new Array(p.pos.length).fill(0)));
    out.uv.push(...(p.uv || new Array(p.pos.length / 3 * 2).fill(0)));
    out.idx.push(...p.idx.map((i) => i + base));
  }
  if (!parts.every((p) => p.nor)) delete out.nor;
  if (!parts.every((p) => p.uv)) delete out.uv;
  return out;
}

export function addPrimitive(doc, data, material) {
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(data.pos)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(data.idx)).setBuffer(buffer));
  if (data.nor) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(data.nor)).setBuffer(buffer));
  if (data.uv) prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(data.uv)).setBuffer(buffer));
  if (material) prim.setMaterial(material);
  return prim;
}

// One node, one mesh, one primitive.
export async function modelBytes(data, setup) {
  const doc = new Document();
  const scene = doc.createScene("scene");
  const mat = doc.createMaterial("mat");
  const node = doc.createNode("model").setMesh(doc.createMesh("model").addPrimitive(addPrimitive(doc, data, mat)));
  scene.addChild(node);
  if (setup) await setup(doc, node, mat, scene);
  return (await io()).writeBinary(doc);
}

export function solidPng(size, rgb = [200, 40, 30]) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) rgba.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return encodePng(size, size, rgba);
}
