import * as THREE from "three";
import { MATERIAL_ROLES, STRUCTURES, structureById } from "./parts.js";
import { packGlb, sceneToDoc } from "./glb.js";
import { boundsOf } from "./inspect.js";

export function emptyEdit() {
  return {
    structure: {},
    material: {},
    paint: { hex: "#1c3d66", roughness: 0.45, metalness: 0.12 },
    tint: null,
    pivots: {},
    scale: 1,
    ground: false
  };
}

export function createSession(loaded) {
  return { loaded, edit: emptyEdit(), undo: [], redo: [] };
}

function copyEdit(edit) {
  return structuredClone(edit);
}

export function changeEdit(session, mutate) {
  session.undo.push(copyEdit(session.edit));
  if (session.undo.length > 30) session.undo.shift();
  session.redo.length = 0;
  mutate(session.edit);
}

export function undoEdit(session) {
  if (!session.undo.length) return false;
  session.redo.push(copyEdit(session.edit));
  session.edit = session.undo.pop();
  return true;
}

export function redoEdit(session) {
  if (!session.redo.length) return false;
  session.undo.push(copyEdit(session.edit));
  session.edit = session.redo.pop();
  return true;
}

function bucketFor(edit, kind, key) {
  if (!edit[kind][key]) edit[kind][key] = {};
  return edit[kind][key];
}

function stripFace(bucket, face) {
  for (const id of Object.keys(bucket)) {
    const next = bucket[id].filter((item) => item !== face);
    if (next.length) bucket[id] = next;
    else delete bucket[id];
  }
}

export function assignFaces(edit, selection, kind, partId) {
  for (const item of selection) {
    const bucket = bucketFor(edit, kind, item.key);
    stripFace(bucket, item.face);
    if (partId) {
      if (!bucket[partId]) bucket[partId] = [];
      bucket[partId].push(item.face);
    }
  }
  for (const key of Object.keys(edit[kind])) {
    if (!Object.keys(edit[kind][key]).length) delete edit[kind][key];
  }
}

export function countAssigned(edit, kind, partId) {
  let count = 0;
  for (const key of Object.keys(edit[kind] || {})) {
    const list = edit[kind][key][partId];
    if (list) count += list.length;
  }
  return count;
}

function indexFaces(bucket) {
  const map = new Map();
  if (!bucket) return map;
  for (const id of Object.keys(bucket)) {
    for (const face of bucket[id]) map.set(face, id);
  }
  return map;
}

function srgbChannel(byte) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearFactor(hex) {
  const body = hex.replace("#", "");
  return [
    srgbChannel(parseInt(body.slice(0, 2), 16)),
    srgbChannel(parseInt(body.slice(2, 4), 16)),
    srgbChannel(parseInt(body.slice(4, 6), 16)),
    1
  ];
}

function cloneVehicle(scene) {
  const clone = scene.clone(true);
  const materials = new Map();
  clone.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry = obj.geometry.clone();
    const source = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = source.map((material) => {
      if (!material) return material;
      if (materials.has(material.uuid)) return materials.get(material.uuid);
      const copy = material.clone();
      materials.set(material.uuid, copy);
      return copy;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });
  return clone;
}

function extractGeometry(mesh, faces) {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const count = faces.length * 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = uv ? new Float32Array(count * 2) : null;
  const indices = new Uint32Array(count);
  let write = 0;
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(face * 3 + corner) : face * 3 + corner;
      positions[write * 3] = position.getX(vertex);
      positions[write * 3 + 1] = position.getY(vertex);
      positions[write * 3 + 2] = position.getZ(vertex);
      if (normal) {
        normals[write * 3] = normal.getX(vertex);
        normals[write * 3 + 1] = normal.getY(vertex);
        normals[write * 3 + 2] = normal.getZ(vertex);
      }
      if (uvs) {
        uvs[write * 2] = uv.getX(vertex);
        uvs[write * 2 + 1] = uv.getY(vertex);
      }
      indices[write] = write;
      write += 1;
    }
  }
  const next = new THREE.BufferGeometry();
  next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  next.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  if (uvs) next.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  next.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!normal) next.computeVertexNormals();
  return next;
}

function keepFaces(mesh, faces) {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const next = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(faces[i] * 3 + corner) : faces[i] * 3 + corner;
      next[i * 3 + corner] = vertex;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(next, 1));
  mesh.userData.faceMap = faces.slice();
}

function applyBoxUv(geometry) {
  const position = geometry.getAttribute("position");
  const count = position.count;
  const raw = new Float32Array(count * 2);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let face = 0; face < count / 3; face++) {
    const get = (corner) => [
      position.getX(face * 3 + corner),
      position.getY(face * 3 + corner),
      position.getZ(face * 3 + corner)
    ];
    const a = get(0);
    const b = get(1);
    const c = get(2);
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let mode = 0;
    if (ay >= ax && ay >= az) mode = 1;
    else if (az >= ax && az >= ay) mode = 2;
    for (let corner = 0; corner < 3; corner++) {
      const point = get(corner);
      const u = mode === 0 ? point[1] : point[0];
      const v = mode === 2 ? point[1] : point[2];
      const slot = (face * 3 + corner) * 2;
      raw[slot] = u;
      raw[slot + 1] = v;
      if (u < minU) minU = u;
      if (v < minV) minV = v;
      if (u > maxU) maxU = u;
      if (v > maxV) maxV = v;
    }
  }
  const spanU = maxU - minU || 1;
  const spanV = maxV - minV || 1;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = (raw[i * 2] - minU) / spanU;
    uv[i * 2 + 1] = (raw[i * 2 + 1] - minV) / spanV;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function paintMaterial(edit) {
  const factor = linearFactor(edit.paint.hex);
  const material = new THREE.MeshStandardMaterial({
    name: "se_paint",
    color: edit.paint.hex,
    metalness: edit.paint.metalness,
    roughness: edit.paint.roughness
  });
  material.userData.sePaint = { tintable: true };
  material.userData.gltfPbr = {
    baseColorFactor: factor,
    metallicFactor: edit.paint.metalness,
    roughnessFactor: edit.paint.roughness,
    emissiveFactor: [0, 0, 0],
    alphaMode: "OPAQUE",
    doubleSided: true,
    images: { baseColor: "white" }
  };
  return material;
}

function roleMaterial(source, role) {
  const material = source.clone();
  material.name = "se_" + role;
  return material;
}

function ensureDoor(root, part) {
  let node = root.getObjectByName(part.id);
  if (!node) {
    node = new THREE.Group();
    node.name = part.id;
    node.userData.seDoor = part.seDoor;
    node.userData.axis = "Y";
    node.userData.hinge = "front";
    root.add(node);
  }
  return node;
}

function ensureWheel(root, part) {
  const spinName = part.id + "_spin";
  let spin = root.getObjectByName(spinName);
  if (spin) return spin;
  let outer = root.getObjectByName(part.id);
  if (!outer) {
    outer = new THREE.Group();
    outer.name = part.id;
    outer.userData.kitWheel = true;
    root.add(outer);
  }
  let parent = outer;
  if (part.steer) {
    const steerName = part.id + "_steer";
    let steer = root.getObjectByName(steerName);
    if (!steer) {
      steer = new THREE.Group();
      steer.name = steerName;
      steer.userData.sePivot = "steer";
      steer.userData.axis = "Y";
      parent.add(steer);
    }
    parent = steer;
  }
  spin = new THREE.Group();
  spin.name = spinName;
  spin.userData.sePivot = "spin";
  spin.userData.axis = "X";
  parent.add(spin);
  return spin;
}

function destinationNode(root, mesh, structureId) {
  if (!structureId) return mesh.parent;
  const part = structureById(structureId);
  if (!part) return mesh.parent;
  if (part.seDoor) return ensureDoor(root, part);
  if (part.steer != null) return ensureWheel(root, part);
  return mesh.parent;
}

function applyFaceEdits(root, edit) {
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj.userData.surfaceKey) meshes.push(obj);
  });
  const paint = paintMaterial(edit);
  const roleCache = new Map();
  for (const mesh of meshes) {
    const key = mesh.userData.surfaceKey;
    const structures = indexFaces(edit.structure[key]);
    const materials = indexFaces(edit.material[key]);
    if (!structures.size && !materials.size) continue;
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute("position");
    const faceCount = index ? index.count / 3 : position.count / 3;
    const stay = [];
    const groups = new Map();
    for (let face = 0; face < faceCount; face++) {
      const structure = structures.get(face) || "";
      const material = materials.get(face) || "";
      if (!structure && !material) {
        stay.push(face);
        continue;
      }
      const id = structure + "|" + material;
      if (!groups.has(id)) groups.set(id, { structure, material, faces: [] });
      groups.get(id).faces.push(face);
    }
    for (const group of groups.values()) {
      const geometry = extractGeometry(mesh, group.faces);
      mesh.updateWorldMatrix(true, false);
      geometry.applyMatrix4(mesh.matrixWorld);
      const parent = destinationNode(root, mesh, group.structure);
      parent.updateWorldMatrix(true, false);
      geometry.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert());
      let material = sourceMaterial;
      if (group.material === "paint") {
        material = paint;
        applyBoxUv(geometry);
      } else if (group.material) {
        const cacheKey = sourceMaterial.uuid + ":" + group.material;
        if (!roleCache.has(cacheKey)) roleCache.set(cacheKey, roleMaterial(sourceMaterial, group.material));
        material = roleCache.get(cacheKey);
      }
      const piece = new THREE.Mesh(geometry, material);
      piece.name = (group.structure || mesh.name || "part") + (group.material ? "_" + group.material : "_keep");
      piece.userData.surfaceKey = key;
      piece.userData.faceMap = group.faces.slice();
      piece.castShadow = true;
      piece.receiveShadow = true;
      parent.add(piece);
    }
    if (stay.length) keepFaces(mesh, stay);
    else {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
  }
}

function nodeDepth(node) {
  let depth = 0;
  let current = node;
  while (current.parent) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function applyPivots(root, edit) {
  const entries = Object.entries(edit.pivots || {}).sort((a, b) => {
    const left = root.getObjectByName(a[0]);
    const right = root.getObjectByName(b[0]);
    return nodeDepth(left || root) - nodeDepth(right || root);
  });
  for (const [name, point] of entries) {
    const node = root.getObjectByName(name);
    if (!node || !node.parent) continue;
    root.updateMatrixWorld(true);
    const saved = [];
    node.traverse((obj) => {
      if (obj === node) return;
      saved.push({ obj, world: obj.matrixWorld.clone() });
    });
    const target = node.parent.worldToLocal(new THREE.Vector3(point[0], point[1], point[2]));
    node.position.copy(target);
    node.updateWorldMatrix(true, true);
    for (const item of saved) {
      const parent = item.obj.parent;
      parent.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(item.world);
      local.decompose(item.obj.position, item.obj.quaternion, item.obj.scale);
    }
  }
}

function applyTint(root, edit) {
  if (!edit.tint || !edit.tint.name || !edit.tint.hex) return;
  const factor = linearFactor(edit.tint.hex);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!material || material.name !== edit.tint.name) continue;
      material.color.set(edit.tint.hex);
      const pbr = material.userData.gltfPbr || {
        metallicFactor: material.metalness,
        roughnessFactor: material.roughness,
        emissiveFactor: [0, 0, 0],
        alphaMode: material.transparent ? "BLEND" : "OPAQUE",
        doubleSided: material.side === THREE.DoubleSide,
        images: {}
      };
      const alpha = pbr.baseColorFactor ? pbr.baseColorFactor[3] : 1;
      material.userData.gltfPbr = { ...pbr, baseColorFactor: [factor[0], factor[1], factor[2], alpha] };
    }
  });
}

export function applyPreview(root, preview) {
  if (!preview) return;
  const door = THREE.MathUtils.degToRad(preview.door || 0);
  const spin = THREE.MathUtils.degToRad(preview.spin || 0);
  const steer = THREE.MathUtils.degToRad(preview.steer || 0);
  root.traverse((obj) => {
    if (/^door_(fl|fr|rl|rr)$/.test(obj.name)) {
      const outward = /r$/.test(obj.name) ? -door : door;
      obj.rotation.y = outward;
    }
    if (obj.userData.sePivot === "spin" || /_spin$/.test(obj.name)) obj.rotation.x = spin;
    if (obj.userData.sePivot === "steer" || /_steer$/.test(obj.name)) obj.rotation.y = steer;
  });
  root.updateMatrixWorld(true);
}

function addHighlights(root, selection) {
  if (!selection) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.surfaceKey || obj.userData.helper) return;
    const picked = selection.get(obj.userData.surfaceKey);
    if (!picked || !picked.size) return;
    const index = obj.geometry.getIndex();
    const position = obj.geometry.getAttribute("position");
    if (!position) return;
    const faceCount = index ? index.count / 3 : position.count / 3;
    const faces = [];
    for (let face = 0; face < faceCount; face++) {
      const source = obj.userData.faceMap ? obj.userData.faceMap[face] : face;
      if (picked.has(source)) faces.push(face);
    }
    if (!faces.length) return;
    const positions = new Float32Array(faces.length * 9);
    let write = 0;
    for (const face of faces) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = index ? index.getX(face * 3 + corner) : face * 3 + corner;
        positions[write++] = position.getX(vertex);
        positions[write++] = position.getY(vertex);
        positions[write++] = position.getZ(vertex);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({
      color: 0xd4a843,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const wire = new THREE.Mesh(geometry, material);
    wire.userData.helper = true;
    wire.raycast = function () {};
    wire.renderOrder = 4;
    obj.add(wire);
  });
}

export function buildVehicle(loaded, edit, options = {}) {
  const inner = cloneVehicle(loaded.scene);
  applyFaceEdits(inner, edit);
  applyPivots(inner, edit);
  applyTint(inner, edit);
  if (options.preview) applyPreview(inner, options.preview);
  if (options.selection) addHighlights(inner, options.selection);
  const rig = new THREE.Group();
  rig.name = "vehicle_root";
  rig.add(inner);
  if (edit.scale && edit.scale !== 1) rig.scale.setScalar(edit.scale);
  if (edit.ground) {
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    if (Number.isFinite(box.min.y)) rig.position.y -= box.min.y;
  }
  return rig;
}

export function innerOf(rig) {
  return rig.children.find((child) => child.userData && child.userData.vehicleInner) || rig.children[0];
}

function fmt(value) {
  return Number(value).toFixed(3);
}

function hashBytes(bytes) {
  let hash = 2166136261;
  const data = bytes || new Uint8Array();
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function measureRig(rig) {
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  const min = box.isEmpty() ? new THREE.Vector3() : box.min;
  let triangles = 0;
  const materials = new Map();
  rig.traverse((obj) => {
    if (!obj.isMesh || (obj.userData && obj.userData.helper)) return;
    const index = obj.geometry.getIndex();
    const position = obj.geometry.getAttribute("position");
    const count = index ? index.count / 3 : position ? position.count / 3 : 0;
    triangles += count;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) {
      const name = material ? material.name : "material";
      materials.set(name, (materials.get(name) || 0) + count);
    }
  });
  const wheels = {};
  for (const part of STRUCTURES.filter((item) => item.steer != null)) {
    const spin = rig.getObjectByName(part.id + "_spin");
    const steer = rig.getObjectByName(part.id + "_steer");
    if (!spin) {
      wheels[part.id] = null;
      continue;
    }
    const bounds = new THREE.Box3().setFromObject(spin);
    const center = bounds.getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3().setFromMatrixPosition(spin.matrixWorld);
    const span = bounds.getSize(new THREE.Vector3()).length();
    wheels[part.id] = {
      distance: origin.distanceTo(center),
      minY: bounds.min.y,
      span,
      steer: !!steer && steer.getObjectByName(spin.name) === spin,
      triangles: countUnder(spin)
    };
  }
  const doors = {};
  for (const part of STRUCTURES.filter((item) => item.seDoor)) {
    const node = rig.getObjectByName(part.id);
    if (!node) {
      doors[part.id] = null;
      continue;
    }
    const origin = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    doors[part.id] = {
      origin: [origin.x, origin.y, origin.z],
      seDoor: node.userData.seDoor || null,
      triangles: countUnder(node)
    };
  }
  let shellMinY = Infinity;
  rig.traverse((obj) => {
    if (!obj.isMesh || (obj.userData && obj.userData.helper)) return;
    let parent = obj;
    let underWheel = false;
    while (parent) {
      if (/^wheel_/.test(parent.name || "")) underWheel = true;
      parent = parent.parent;
    }
    if (underWheel) return;
    const bounds = new THREE.Box3().setFromObject(obj);
    if (Number.isFinite(bounds.min.y)) shellMinY = Math.min(shellMinY, bounds.min.y);
  });
  return {
    triangles,
    materials: [...materials.entries()].map(([name, count]) => ({ name, triangles: count })),
    bounds: {
      min: [min.x, min.y, min.z],
      size: [size.x, size.y, size.z]
    },
    wheels,
    doors,
    shellMinY: Number.isFinite(shellMinY) ? shellMinY : null
  };
}

export function trianglesUnder(scene, name) {
  const node = scene.getObjectByName(name);
  if (!node) return 0;
  return countUnder(node);
}

function countUnder(node) {
  let count = 0;
  node.traverse((obj) => {
    if (!obj.isMesh || (obj.userData && obj.userData.helper)) return;
    const index = obj.geometry.getIndex();
    const position = obj.geometry.getAttribute("position");
    count += index ? index.count / 3 : position ? position.count / 3 : 0;
  });
  return count;
}

export function validateExport(loaded, edit, doc, stats) {
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: !!pass, detail });
  add("triangles", stats.triangles > 0, stats.triangles + " triangles exported.");
  let degenerate = 0;
  let duplicate = 0;
  let nonManifold = 0;
  for (const surface of loaded.surfaces || []) {
    const topology = surface.topology;
    if (!topology) continue;
    degenerate += topology.degenerate;
    duplicate += topology.duplicate;
    nonManifold += topology.nonManifold;
  }
  add("degenerate", degenerate === 0, degenerate + " source triangles have no area. Export keeps them. It does not repair them.");
  add("duplicate", duplicate === 0, duplicate + " source triangles repeat the same corners within 0.5 mm. Export keeps them.");
  add("nonmanifold", nonManifold === 0, nonManifold + " source edges are shared by more than two triangles. Export keeps them.");
  add("meshopt", true, "Export writes plain glTF geometry. Meshopt is not required.");
  const webp = doc.materials.some((material) =>
    [material.baseColorImage, material.metallicRoughnessImage, material.emissiveImage].some((image) => image && image.mime === "image/webp")
  );
  add(
    "textures",
    !webp,
    webp
      ? "Some textures are still the original WebP images. A loader without EXT_texture_webp will not show those images."
      : "Embedded color textures are PNG."
  );
  const paintFaces = countAssigned(edit, "material", "paint");
  const paint = doc.materials.find((material) => material.name === "se_paint");
  if (!paintFaces && !edit.tint) {
    add("paint", true, "No faces were assigned to paint, and no material tint was saved. A whole-mesh color was not applied.");
  } else if (paintFaces) {
    const paintHash = paint && paint.baseColorImage ? hashBytes(paint.baseColorImage.bytes) : null;
    const shared = doc.materials.some((material) => material !== paint && material.baseColorImage && hashBytes(material.baseColorImage.bytes) === paintHash);
    add(
      "paint-split",
      !!paint && !shared,
      paint
        ? "se_paint has its own texture and color factor. Shared with another material: " + (shared ? "yes" : "no") + "."
        : "Paint faces were assigned, but se_paint is missing."
    );
    const factor = linearFactor(edit.paint.hex);
    const close = paint && factor.every((value, index) => Math.abs(value - paint.baseColorFactor[index]) < 1e-4);
    add("paint-color", !!close, "Paint factor targets " + edit.paint.hex + ".");
  }
  if (edit.tint) {
    const tinted = doc.materials.find((material) => material.name === edit.tint.name);
    const factor = linearFactor(edit.tint.hex);
    const close = tinted && factor.slice(0, 3).every((value, index) => Math.abs(value - tinted.baseColorFactor[index]) < 1e-4);
    add(
      "tint",
      !!close,
      "Tint changes every face that already uses " + edit.tint.name + ". It does not split faces."
    );
  }
  for (const part of STRUCTURES.filter((item) => item.seDoor)) {
    const door = stats.doors[part.id];
    const assigned = countAssigned(edit, "structure", part.id);
    if (!door && !assigned) {
      add(part.id, false, part.id + " is not in this export.");
    } else if (!door) {
      add(part.id, false, part.id + " was assigned but the node is missing.");
    } else {
      const placed = !!edit.pivots[part.id];
      add(
        part.id,
        door.triangles > 0,
        part.id + " origin " + door.origin.map(fmt).join(", ") + ", seDoor " + door.seDoor + ", " + door.triangles + " triangles. " +
        (placed ? "You set this hinge." : "Origin is the node already in the file, or the part center if this node was created here.")
      );
    }
  }
  for (const part of STRUCTURES.filter((item) => item.steer != null)) {
    const wheel = stats.wheels[part.id];
    const assigned = countAssigned(edit, "structure", part.id);
    if (!wheel && !assigned) {
      add(part.id, false, part.id + " is not in this export.");
      continue;
    }
    if (!wheel) {
      add(part.id, false, part.id + " has no spin node.");
      continue;
    }
    const limit = Math.max(0.01, wheel.span * 0.08);
    add(
      part.id + "-spin",
      wheel.distance <= limit,
      part.id + " spin origin is " + fmt(wheel.distance) + " m from the wheel bounds center (limit " + fmt(limit) + " m)."
    );
    if (part.steer) {
      add(part.id + "-steer", wheel.steer, wheel.steer ? part.id + " has a steer parent around the spin node." : part.id + " has no steer parent.");
    }
  }
  if (edit.ground) {
    add("ground", Math.abs(stats.bounds.min[1]) < 0.002, "Lowest point after the ground move is Y " + fmt(stats.bounds.min[1]) + " m.");
  } else if (stats.bounds.min[1] < -0.01) {
    add("ground", false, "Lowest point is still Y " + fmt(stats.bounds.min[1]) + " m. Sit on ground was not used.");
  }
  const sourceLength = boundsOf(loaded.surfaces).size[2] || 1;
  if (edit.scale !== 1) {
    const expected = sourceLength * edit.scale;
    add(
      "scale",
      Math.abs(stats.bounds.size[2] - expected) < Math.max(0.02, expected * 0.02),
      "Root scale " + edit.scale.toFixed(3) + " makes Z " + fmt(stats.bounds.size[2]) + " m. Source Z was " + fmt(sourceLength) + " m."
    );
  }
  return checks;
}

export function exportVehicle(loaded, edit, images = null) {
  const rig = buildVehicle(loaded, edit);
  const target = edit.scale !== 1 || edit.ground ? rig : innerOf(rig);
  if (edit.scale !== 1 || edit.ground) target.userData.exportRoot = true;
  const doc = sceneToDoc(target, images || loaded.images, { sceneName: loaded.scene.name || "vehicle" });
  const bytes = packGlb(doc);
  const stats = measureRig(rig);
  const checks = validateExport(loaded, edit, doc, stats);
  disposeVehicle(rig);
  return { bytes, doc, stats, checks };
}

export function disposeVehicle(root) {
  if (!root) return;
  const materials = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export function worldToInner(inner, point) {
  return inner.worldToLocal(point.clone()).toArray();
}

export function selectionList(selection) {
  const list = [];
  selection.forEach((faces, key) => {
    for (const face of faces) list.push({ key, face });
  });
  return list;
}

export const ROLE_IDS = MATERIAL_ROLES.map((role) => role.id);

export function serializeEdit(loaded, edit) {
  return {
    kind: "sovereign-vehicle-finish",
    version: 1,
    sha256: loaded.sha256,
    fileName: loaded.fileName,
    edit
  };
}

export function restoreEdit(loaded, saved) {
  if (!saved || saved.kind !== "sovereign-vehicle-finish") throw new Error("That file is not a vehicle edit.");
  if (saved.sha256 !== loaded.sha256) throw new Error("These edits belong to a different GLB.");
  return saved.edit;
}
