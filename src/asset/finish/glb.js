import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { faceTopology } from "./select.js";
import { whitePng } from "./png.js";

const KEEP = ["seDoor", "sePivot", "kitWheel", "axis", "hinge", "sePaint", "seWheel"];

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readGlb(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 20) throw new Error("Not a GLB.");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB.");
  if (view.getUint32(4, true) !== 2) throw new Error("Only glTF 2 GLB files can be read.");
  const length = view.getUint32(8, true);
  let offset = 12;
  let json = null;
  let bin = new Uint8Array();
  while (offset + 8 <= buf.length && offset < length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const slice = buf.subarray(start, start + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(slice));
    else if (chunkType === 0x004e4942) bin = slice;
    offset = start + chunkLength;
  }
  if (!json) throw new Error("GLB has no JSON chunk.");
  return { json, bin };
}

export function readImages(bytes) {
  const { json, bin } = readGlb(bytes);
  return (json.images || []).map((image, index) => {
    if (image.bufferView == null) {
      return { index, name: image.name || "image-" + index, mime: image.mimeType || "application/octet-stream", bytes: new Uint8Array() };
    }
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    return {
      index,
      name: image.name || "image-" + index,
      mime: image.mimeType || "application/octet-stream",
      bytes: new Uint8Array(bin.slice(start, start + view.byteLength))
    };
  });
}

function imageOfTexture(json, textureIndex) {
  const texture = json.textures && json.textures[textureIndex];
  if (!texture) return null;
  if (texture.source != null) return texture.source;
  const webp = texture.extensions && texture.extensions.EXT_texture_webp;
  if (webp && webp.source != null) return webp.source;
  return null;
}

function pbrFromDef(json, def) {
  const pbr = def.pbrMetallicRoughness || {};
  const images = {};
  if (pbr.baseColorTexture) images.baseColor = imageOfTexture(json, pbr.baseColorTexture.index);
  if (pbr.metallicRoughnessTexture) images.metallicRoughness = imageOfTexture(json, pbr.metallicRoughnessTexture.index);
  if (def.emissiveTexture) images.emissive = imageOfTexture(json, def.emissiveTexture.index);
  return {
    baseColorFactor: pbr.baseColorFactor ? pbr.baseColorFactor.slice() : [1, 1, 1, 1],
    metallicFactor: pbr.metallicFactor != null ? pbr.metallicFactor : 1,
    roughnessFactor: pbr.roughnessFactor != null ? pbr.roughnessFactor : 1,
    emissiveFactor: def.emissiveFactor ? def.emissiveFactor.slice() : [0, 0, 0],
    alphaMode: def.alphaMode || "OPAQUE",
    doubleSided: !!def.doubleSided,
    images
  };
}

function tagMaterials(scene, json) {
  const byName = new Map();
  for (const def of json.materials || []) byName.set(def.name, def);
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!material || material.userData.gltfPbr) continue;
      const def = byName.get(material.name);
      if (def) material.userData.gltfPbr = pbrFromDef(json, def);
    }
  });
}

function surfacePath(obj) {
  const names = [];
  let current = obj;
  while (current) {
    names.push(current.name || current.type);
    current = current.parent;
  }
  return names.reverse().join("/");
}

export function extractSurfaces(scene) {
  scene.updateMatrixWorld(true);
  const surfaces = [];
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geometry = obj.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    const faceCount = index ? index.count / 3 : position.count / 3;
    const world = new Float32Array(faceCount * 9);
    const uvs = uv ? new Float32Array(faceCount * 6) : null;
    const normals = new Float32Array(faceCount * 3);
    const point = new THREE.Vector3();
    for (let face = 0; face < faceCount; face++) {
      const ids = [0, 1, 2].map((corner) => index ? index.getX(face * 3 + corner) : face * 3 + corner);
      const xyz = [];
      for (let corner = 0; corner < 3; corner++) {
        point.fromBufferAttribute(position, ids[corner]).applyMatrix4(obj.matrixWorld);
        world[face * 9 + corner * 3] = point.x;
        world[face * 9 + corner * 3 + 1] = point.y;
        world[face * 9 + corner * 3 + 2] = point.z;
        xyz.push(point.x, point.y, point.z);
        if (uvs) {
          uvs[face * 6 + corner * 2] = uv.getX(ids[corner]);
          uvs[face * 6 + corner * 2 + 1] = uv.getY(ids[corner]);
        }
      }
      const abx = xyz[3] - xyz[0];
      const aby = xyz[4] - xyz[1];
      const abz = xyz[5] - xyz[2];
      const acx = xyz[6] - xyz[0];
      const acy = xyz[7] - xyz[1];
      const acz = xyz[8] - xyz[2];
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[face * 3] = nx / length;
      normals[face * 3 + 1] = ny / length;
      normals[face * 3 + 2] = nz / length;
    }
    const key = surfacePath(obj);
    obj.userData.surfaceKey = key;
    const material = Array.isArray(obj.material) ? obj.material.map((item) => item.name).join("+") : (obj.material && obj.material.name) || "material";
    const topology = faceTopology(world);
    surfaces.push({ key, name: obj.name, material, faceCount, world, uvs, normals, topology });
  });
  return surfaces;
}

function stubImages() {
  if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
  if (typeof globalThis.createImageBitmap !== "function") {
    globalThis.createImageBitmap = async function () {
      return { width: 1, height: 1, close() {} };
    };
  }
}

function padChunk(bytes, fill) {
  const extra = (4 - (bytes.length % 4)) % 4;
  if (!extra) return bytes;
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

export function sourceCensus(json, byteLength = 0) {
  const meshes = json.meshes || [];
  let primitives = 0;
  const users = new Map();
  for (const node of json.nodes || []) {
    if (node.mesh != null) users.set(node.mesh, (users.get(node.mesh) || 0) + 1);
  }
  for (const mesh of meshes) primitives += (mesh.primitives || []).length;
  const scene = (json.scenes || [])[json.scene || 0] || { nodes: [] };
  return {
    meshes: meshes.length,
    primitives,
    sharedMeshes: [...users.values()].filter((count) => count > 1).length,
    roots: (scene.nodes || []).map((index) => (json.nodes[index] && json.nodes[index].name) || String(index)),
    extensionsRequired: json.extensionsRequired || [],
    extensionsUsed: json.extensionsUsed || [],
    bytes: byteLength
  };
}

export function patchSourceGlb(bytes, { scale = 1, groundOffsetY = 0 } = {}) {
  const { json, bin } = readGlb(bytes);
  const copy = structuredClone(json);
  const scene = copy.scenes[copy.scene || 0];
  const roots = scene.nodes || [];
  for (const index of roots) {
    const node = copy.nodes[index];
    if (node.matrix) return null;
  }
  for (const index of roots) {
    const node = copy.nodes[index];
    const translation = node.translation ? node.translation.slice() : [0, 0, 0];
    translation[0] *= scale;
    translation[1] = translation[1] * scale + groundOffsetY;
    translation[2] *= scale;
    node.translation = translation;
    if (scale !== 1) {
      const nodeScale = node.scale ? node.scale.slice() : [1, 1, 1];
      node.scale = nodeScale.map((value) => value * scale);
    }
  }
  return { bytes: glbFromParts(copy, bin), json: copy };
}

function glbFromParts(json, bin) {
  const jsonBytes = padChunk(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = padChunk(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binAt = 20 + jsonBytes.length;
  view.setUint32(binAt, binBytes.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(binBytes, binAt + 8);
  return out;
}

function withoutTextures(bytes) {
  const { json, bin } = readGlb(bytes);
  const copy = structuredClone(json);
  delete copy.images;
  delete copy.textures;
  for (const material of copy.materials || []) {
    const pbr = material.pbrMetallicRoughness;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
    delete material.emissiveTexture;
  }
  copy.extensionsUsed = (json.extensionsUsed || []).filter((name) => name !== "EXT_texture_webp");
  copy.extensionsRequired = (json.extensionsRequired || []).filter((name) => name !== "EXT_texture_webp");
  if (!copy.extensionsUsed.length) delete copy.extensionsUsed;
  if (!copy.extensionsRequired.length) delete copy.extensionsRequired;
  return glbFromParts(copy, bin);
}

async function parseScene(bytes) {
  stubImages();
  if (MeshoptDecoder.ready) await MeshoptDecoder.ready;
  const parse = (data) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const view = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return loader.parseAsync(view, "");
  };
  try {
    return await parse(bytes);
  } catch (error) {
    if (typeof globalThis !== "undefined") globalThis.__vehicleLoadError = String(error && error.message ? error.message : error);
    return parse(withoutTextures(bytes));
  }
}

export async function loadVehicle(bytes, fileName = "vehicle.glb") {
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const { json } = readGlb(source);
  const images = readImages(source);
  const gltf = await parseScene(source);
  tagMaterials(gltf.scene, json);
  gltf.scene.userData.vehicleInner = true;
  const surfaces = extractSurfaces(gltf.scene);
  const census = sourceCensus(json, source.length);
  return {
    bytes: source,
    sha256: await sha256Hex(source),
    fileName,
    json,
    images,
    scene: gltf.scene,
    surfaces,
    census
  };
}

function pad(bytes, modulo, fill) {
  const extra = (modulo - (bytes.length % modulo)) % modulo;
  if (!extra) return bytes;
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

class BinWriter {
  constructor() {
    this.parts = [];
    this.size = 0;
  }
  add(data) {
    const padCount = (4 - (this.size % 4)) % 4;
    const offset = this.size + padCount;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.parts.push({ padCount, bytes });
    this.size = offset + bytes.byteLength;
    return offset;
  }
  toBuffer() {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const part of this.parts) {
      offset += part.padCount;
      out.set(part.bytes, offset);
      offset += part.bytes.byteLength;
    }
    return out;
  }
}

function componentMinMax(data, components) {
  const min = Array(components).fill(Infinity);
  const max = Array(components).fill(-Infinity);
  for (let i = 0; i < data.length; i += components) {
    for (let c = 0; c < components; c++) {
      const value = data[i + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  }
  return { min, max };
}

export function packGlb(doc) {
  const bin = new BinWriter();
  const bufferViews = [];
  const accessors = [];
  const images = [];
  const textures = [];
  const materials = [];
  const meshes = [];
  const nodes = [];
  let webp = false;

  function viewOf(data, target) {
    const byteOffset = bin.add(data);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const view = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    if (target) view.target = target;
    bufferViews.push(view);
    return bufferViews.length - 1;
  }

  function accessorOf(data, type, components, target) {
    const bufferView = viewOf(data, target);
    const { min, max } = componentMinMax(data, components);
    const componentType = data instanceof Uint32Array ? 5125 : data instanceof Uint16Array ? 5123 : 5126;
    accessors.push({
      bufferView,
      componentType,
      count: data.length / components,
      type,
      min,
      max
    });
    return accessors.length - 1;
  }

  const imageIndex = new Map();
  function useImage(image) {
    const key = image.mime + ":" + image.name + ":" + image.bytes.length;
    if (imageIndex.has(key)) return imageIndex.get(key);
    const bufferView = viewOf(image.bytes);
    const index = images.length;
    images.push({ name: image.name, mimeType: image.mime, bufferView });
    imageIndex.set(key, index);
    if (image.mime === "image/webp") webp = true;
    return index;
  }

  const sampler = [{ wrapS: 10497, wrapT: 10497 }];

  function textureOf(image) {
    const source = useImage(image);
    const def = { sampler: 0 };
    if (image.mime === "image/webp") {
      webp = true;
      def.extensions = { EXT_texture_webp: { source } };
    } else def.source = source;
    textures.push(def);
    return textures.length - 1;
  }

  const textureCache = new Map();
  function textureIndex(image) {
    const key = image.name + ":" + image.bytes.byteLength + ":" + image.mime;
    if (textureCache.has(key)) return textureCache.get(key);
    const index = textureOf(image);
    textureCache.set(key, index);
    return index;
  }

  for (const material of doc.materials) {
    const pbr = {
      baseColorFactor: material.baseColorFactor || [1, 1, 1, 1],
      metallicFactor: material.metallicFactor != null ? material.metallicFactor : 1,
      roughnessFactor: material.roughnessFactor != null ? material.roughnessFactor : 1
    };
    if (material.baseColorImage) pbr.baseColorTexture = { index: textureIndex(material.baseColorImage) };
    if (material.metallicRoughnessImage) pbr.metallicRoughnessTexture = { index: textureIndex(material.metallicRoughnessImage) };
    const def = {
      name: material.name || "material",
      doubleSided: material.doubleSided !== false,
      pbrMetallicRoughness: pbr
    };
    if (material.alphaMode && material.alphaMode !== "OPAQUE") def.alphaMode = material.alphaMode;
    if (material.emissiveImage) {
      def.emissiveTexture = { index: textureIndex(material.emissiveImage) };
      def.emissiveFactor = material.emissiveFactor || [0, 0, 0];
    } else if (material.emissiveFactor && material.emissiveFactor.some((value) => value > 0)) {
      def.emissiveFactor = material.emissiveFactor;
    }
    if (material.extras) def.extras = material.extras;
    materials.push(def);
  }

  for (const mesh of doc.meshes) {
    const primitives = [];
    for (const prim of mesh.primitives) {
      const position = accessorOf(prim.position, "VEC3", 3, 34962);
      const attributes = { POSITION: position };
      if (prim.normal) attributes.NORMAL = accessorOf(prim.normal, "VEC3", 3, 34962);
      if (prim.uv) attributes.TEXCOORD_0 = accessorOf(prim.uv, "VEC2", 2, 34962);
      let indexArray = prim.indices;
      if (!(indexArray instanceof Uint16Array) && !(indexArray instanceof Uint32Array)) {
        let maxIndex = 0;
        for (let i = 0; i < prim.indices.length; i++) if (prim.indices[i] > maxIndex) maxIndex = prim.indices[i];
        indexArray = maxIndex > 65535 ? new Uint32Array(prim.indices) : new Uint16Array(prim.indices);
      }
      primitives.push({
        attributes,
        indices: accessorOf(indexArray, "SCALAR", 1, 34963),
        material: prim.material,
        mode: 4
      });
    }
    meshes.push({ name: mesh.name, primitives });
  }

  for (const node of doc.nodes) {
    const def = { name: node.name };
    if (node.mesh != null) def.mesh = node.mesh;
    if (node.children && node.children.length) def.children = node.children;
    if (node.translation && node.translation.some((value) => Math.abs(value) > 1e-8)) def.translation = node.translation;
    if (node.rotation && (Math.abs(node.rotation[0]) > 1e-8 || Math.abs(node.rotation[1]) > 1e-8 || Math.abs(node.rotation[2]) > 1e-8 || Math.abs(node.rotation[3] - 1) > 1e-8)) {
      def.rotation = node.rotation;
    }
    if (node.scale && node.scale.some((value) => Math.abs(value - 1) > 1e-8)) def.scale = node.scale;
    if (node.extras) def.extras = node.extras;
    nodes.push(def);
  }

  const json = {
    asset: { version: "2.0", generator: "Sovereign Draft vehicle finish" },
    scene: 0,
    scenes: [{ name: doc.sceneName || "vehicle", nodes: doc.roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    samplers: sampler
  };
  if (textures.length) json.textures = textures;
  if (images.length) json.images = images;
  if (webp) {
    json.extensionsUsed = ["EXT_texture_webp"];
    json.extensionsRequired = ["EXT_texture_webp"];
  }
  const binBytes = bin.toBuffer();
  json.buffers = [{ byteLength: binBytes.length }];
  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 4, 0x20);
  const binChunk = pad(binBytes, 4, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binChunk.length;
  const out = new Uint8Array(total);
  const header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonBytes.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  header.setUint32(binStart, binChunk.length, true);
  header.setUint32(binStart + 4, 0x004e4942, true);
  out.set(binChunk, binStart + 8);
  return out;
}

function keptExtras(userData) {
  const extras = {};
  for (const key of KEEP) if (userData && userData[key] != null) extras[key] = userData[key];
  return Object.keys(extras).length ? extras : undefined;
}

function nearly(a, b) {
  return Math.abs(a - b) < 1e-6;
}

export function sceneToDoc(root, sourceImages, options = {}) {
  const images = sourceImages.map((image) => ({ name: image.name, mime: image.mime, bytes: image.bytes }));
  let white = null;
  function imageById(id) {
    if (id == null) return null;
    if (id === "white") {
      if (!white) white = { name: "se_paint", mime: "image/png", bytes: whitePng(8) };
      return white;
    }
    return images[id] || null;
  }
  const materialList = [];
  const materialIndex = new Map();
  function useMaterial(material) {
    if (materialIndex.has(material.uuid)) return materialIndex.get(material.uuid);
    const pbr = material.userData.gltfPbr || {};
    const factor = pbr.baseColorFactor || [material.color.r, material.color.g, material.color.b, material.opacity];
    const record = {
      name: material.name || "material",
      baseColorFactor: factor.slice ? factor.slice() : factor,
      metallicFactor: pbr.metallicFactor != null ? pbr.metallicFactor : material.metalness,
      roughnessFactor: pbr.roughnessFactor != null ? pbr.roughnessFactor : material.roughness,
      emissiveFactor: pbr.emissiveFactor || [0, 0, 0],
      alphaMode: pbr.alphaMode || (material.transparent ? "BLEND" : "OPAQUE"),
      doubleSided: pbr.doubleSided != null ? pbr.doubleSided : material.side === THREE.DoubleSide,
      baseColorImage: imageById(pbr.images && pbr.images.baseColor),
      metallicRoughnessImage: imageById(pbr.images && pbr.images.metallicRoughness),
      emissiveImage: imageById(pbr.images && pbr.images.emissive),
      extras: material.userData.sePaint ? { sePaint: material.userData.sePaint } : undefined
    };
    const index = materialList.length;
    materialList.push(record);
    materialIndex.set(material.uuid, index);
    return index;
  }
  const meshList = [];
  const nodeList = [];
  const roots = [];
  function writeNode(obj) {
    if (obj.userData && obj.userData.helper) return null;
    const index = nodeList.length;
    const node = {
      name: obj.name || "node",
      translation: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      extras: keptExtras(obj.userData),
      children: []
    };
    nodeList.push(node);
    if (obj.isMesh && obj.geometry && obj.geometry.getAttribute("position")) {
      const geometry = obj.geometry;
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      const indexAttr = geometry.getIndex();
      const count = position.count;
      const positions = new Float32Array(count * 3);
      const normals = normal ? new Float32Array(count * 3) : null;
      const uvs = uv ? new Float32Array(count * 2) : null;
      for (let i = 0; i < count; i++) {
        positions[i * 3] = position.getX(i);
        positions[i * 3 + 1] = position.getY(i);
        positions[i * 3 + 2] = position.getZ(i);
        if (normals) {
          normals[i * 3] = normal.getX(i);
          normals[i * 3 + 1] = normal.getY(i);
          normals[i * 3 + 2] = normal.getZ(i);
        }
        if (uvs) {
          uvs[i * 2] = uv.getX(i);
          uvs[i * 2 + 1] = uv.getY(i);
        }
      }
      let indices;
      if (indexAttr) {
        indices = count > 65535 ? new Uint32Array(indexAttr.count) : new Uint16Array(indexAttr.count);
        for (let i = 0; i < indexAttr.count; i++) indices[i] = indexAttr.getX(i);
      } else {
        indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
      }
      if (indices.length) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const meshIndex = meshList.length;
        meshList.push({
          name: obj.name || "mesh",
          primitives: [{
            position: positions,
            normal: normals,
            uv: uvs,
            indices,
            material: useMaterial(materials[0])
          }]
        });
        node.mesh = meshIndex;
      }
    }
    for (const child of obj.children) {
      const childIndex = writeNode(child);
      if (childIndex != null) node.children.push(childIndex);
    }
    if (!node.children.length) delete node.children;
    if (node.rotation && nearly(node.rotation[0], 0) && nearly(node.rotation[1], 0) && nearly(node.rotation[2], 0) && nearly(node.rotation[3], 1)) delete node.rotation;
    return index;
  }
  const top = options.wrap === false ? root.children : [root];
  const exportNodes = root.userData && root.userData.exportRoot ? [root] : top.filter((child) => !(child.userData && child.userData.helper));
  for (const child of exportNodes) {
    const index = writeNode(child);
    if (index != null) roots.push(index);
  }
  return {
    sceneName: options.sceneName || root.name || "vehicle",
    roots,
    nodes: nodeList,
    meshes: meshList,
    materials: materialList
  };
}

export function summarizeTree(scene) {
  const nodes = [];
  scene.traverse((obj) => {
    if (!obj.parent) return;
    if (obj.userData && obj.userData.helper) return;
    const materials = obj.isMesh ? (Array.isArray(obj.material) ? obj.material : [obj.material]).map((material) => material && material.name) : [];
    let triangles = 0;
    if (obj.isMesh && obj.geometry) {
      const index = obj.geometry.getIndex();
      const position = obj.geometry.getAttribute("position");
      triangles = index ? index.count / 3 : position ? position.count / 3 : 0;
    }
    nodes.push({
      name: obj.name,
      parent: obj.parent.name || "",
      extras: keptExtras(obj.userData) || null,
      materials,
      triangles
    });
  });
  return nodes;
}
