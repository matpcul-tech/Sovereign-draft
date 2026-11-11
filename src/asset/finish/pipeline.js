import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";
import { GAME_TINT, carSourceCheck, drawCallCheck } from "./profiles.js";
import { decodePng, encodePng } from "./png.js";
import { buildCarMask } from "./mask.js";
import { zipStore } from "./zip.js";
import { packGlb, sha256Hex, sourceCensus } from "./glb.js";

const WELD = 2000;

export async function runFinish(loaded, profile, options = {}) {
  const sourceSha = loaded.sha256 || await sha256Hex(loaded.bytes);
  const before = measureFile(loaded);
  const log = [];
  const checks = [];
  const names = (loaded.json.materials || []).map((material) => material.name || "");
  if ((loaded.json.skins && loaded.json.skins.length) || (loaded.json.animations && loaded.json.animations.length) || hasMorph(loaded.json)) {
    return finishResult({
      sourceSha,
      before,
      log,
      checks,
      banner: "NOT READY",
      summary: "This file has a skin, a morph, or an animation. None of those were removed, and no rewrite was written."
    });
  }
  if (profile.id === "CAR") {
    const source = carSourceCheck({
      materialNames: names,
      materialCount: names.length,
      imageCount: (loaded.images || []).length
    });
    if (source.unsupported) {
      log.push("Source. " + source.detail);
      return finishResult({
        sourceSha,
        before,
        log,
        checks: [{ id: "source", pass: false, detail: source.detail, action: source.action || "" }],
        banner: "NOT READY",
        summary: source.detail
      });
    }
  }
  const census = sourceCensus(loaded.json, loaded.bytes.length);
  if (census.sharedMeshes) {
    return finishResult({
      sourceSha,
      before,
      log: ["Shared meshes were left as they are. Baking would copy them, so no rewrite was written."],
      checks: [{ id: "share", pass: false, detail: "A mesh is used more than once.", action: "Separate the shared mesh by hand, or keep the source file." }],
      banner: "NOT READY",
      summary: "Shared mesh data was not split."
    });
  }

  let mesh = soupFrom(loaded.surfaces);
  const dropped = dropBadFaces(mesh);
  mesh = compact(mesh);
  log.push("Removed " + dropped.zero + " zero-area triangles and " + dropped.duplicate + " repeated triangles.");
  const orient = orientMesh(mesh, profile, options);
  log.push(orient.detail);
  if (!orient.ok) {
    checks.push({ id: "orient", pass: false, detail: orient.detail, action: orient.action });
    return finishResult({ sourceSha, before, log, checks, banner: "NOT READY", summary: orient.detail });
  }
  checks.push({ id: "front", pass: !!options.frontConfirmed, detail: options.frontConfirmed ? "+Z was confirmed as the front." : "Which end is the front was not confirmed.", action: options.frontConfirmed ? "" : "Confirm the +Z end is the front. The long axis was not treated as a known front by itself." });

  const target = targetLength(profile, mesh);
  const current = measureMesh(mesh).size[target.axis];
  const factor = current > 1e-8 ? target.length / current : 1;
  scaleMesh(mesh, factor);
  log.push("Scale " + factor.toFixed(4) + " so " + "XYZ"[target.axis] + " is " + target.length + " m.");

  const placed = groundMesh(mesh);
  log.push("Center XZ is 0 and the lowest Y is 0. Moved by " + placed.map((value) => value.toFixed(3)).join(", ") + ".");
  if (profile.id === "CHARACTER") {
    const pose = poseCheck(mesh);
    checks.push(pose);
    log.push(pose.detail);
  }
  if (profile.id === "BUILDING") {
    const base = baseCheck(mesh);
    checks.push(base);
    log.push(base.detail);
  }

  const welded = weldMesh(mesh);
  mesh = welded.mesh;
  log.push("Welded " + welded.merged + " vertices within 0.5 mm. UV seams and creases stayed split.");

  let parts;
  if (profile.id === "CAR") {
    const split = splitWheels(mesh);
    log.push(split.detail);
    if (!split.ok) {
      checks.push({ id: "wheels", pass: false, detail: split.detail, action: "Hand the shell to VEHICLE and split the four wheels by hand. This finish will not invent a cut." });
      return finishResult({ sourceSha, before, log, checks, banner: "NOT READY", summary: split.detail });
    }
    parts = split.parts;
    const axles = split.parts.filter((part) => part.wheel).map((part) => part.name + " " + part.center.map((value) => value.toFixed(3)).join(" ")).join("; ");
    checks.push({ id: "wheels", pass: true, detail: "Four wheel islands were named. No cylinder was guessed.", action: "" });
    checks.push({ id: "axle", pass: true, detail: "Wheel origins are the island centers. " + axles, action: "" });
  } else {
    parts = [{ name: "body", mesh, wheel: false }];
    log.push("No wheel split for " + profile.id + ".");
  }

  if (MeshoptSimplifier.ready) await MeshoptSimplifier.ready;
  const totalBefore = parts.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0);
  let triangles = 0;
  for (const part of parts) {
    const beforeTris = part.mesh.indices.length / 3;
    const share = totalBefore <= profile.triangleTarget
      ? beforeTris
      : Math.max(4, Math.round(beforeTris / totalBefore * profile.triangleTarget));
    const simplified = await simplifyPart(part.mesh, share, totalBefore <= profile.triangleTarget);
    part.mesh = simplified.mesh;
    dropBadFaces(part.mesh);
    part.mesh = compact(part.mesh);
    triangles += part.mesh.indices.length / 3;
    log.push(part.name + ". " + simplified.detail + " (" + beforeTris + " to " + (part.mesh.indices.length / 3) + ").");
    recomputeNormals(part.mesh);
  }
  const budget = triangles > profile.triangleCeiling;
  checks.push({
    id: "budget",
    pass: !budget,
    detail: "Exported triangles " + triangles + ". Target " + profile.triangleTarget + ". Ceiling " + profile.triangleCeiling + ".",
    action: budget ? "The count is over the ceiling. Borders were not unlocked." : ""
  });
  checks.push(wheelBleed(parts));
  checks.push({
    id: "drawcalls",
    pass: drawCallCheck(parts.length, profile).pass,
    detail: drawCallCheck(parts.length, profile).detail,
    action: drawCallCheck(parts.length, profile).pass ? "" : "Fewer draw calls are required. Do not split paint from glass to get there."
  });

  const images = resizeImages(loaded, profile.maxTexture, log, checks);
  let maskPack = null;
  if (profile.id === "CAR") {
    const png = (images.outputs || []).find((image) => image.mime === "image/png" && image.bytes && image.bytes.length);
    if (!png) {
      checks.push({ id: "mask", pass: false, detail: "No PNG base image was measured, so no mask was built.", action: "Use one PNG base color. A new atlas was not baked." });
    } else {
      try {
        const decoded = decodePng(png.bytes);
        const built = buildCarMask(parts, decoded.rgba, decoded.width, decoded.height);
        if (!built.ok) checks.push({ id: "mask", pass: false, detail: built.detail, action: built.action || "" });
        else {
          maskPack = built;
          png.bytes = encodePng(decoded.width, decoded.height, built.baseRgba);
          checks.push(...built.checks);
          log.push("A 1024 mask was stored on emissiveTexture with factor 0, 0, 0 and extras.kitMask. Street Empire does not read that mask.");
        }
      } catch (error) {
        checks.push({ id: "mask", pass: false, detail: "The base PNG could not be masked.", action: "Replace the base image with an 8-bit RGBA PNG." });
      }
    }
  }
  const materialName = safeMaterialName(names[0] || "atlas");
  const bytes = packParts(parts, materialName, images.outputs, !!options.frontConfirmed, maskPack);
  const afterSha = await sha256Hex(bytes);
  const after = {
    triangles,
    bytes: bytes.length,
    size: measureMesh(parts[0].mesh).size,
    sha256: afterSha
  };
  const whole = measureParts(parts);
  after.size = whole.size;
  after.minY = whole.min[1];
  after.center = [(whole.min[0] + whole.max[0]) / 2, (whole.min[2] + whole.max[2]) / 2];
  checks.push(sizeCheck(profile, whole, target));
  checks.push({
    id: "ground",
    pass: Math.abs(whole.min[1]) <= 0.001,
    detail: "Lowest Y is " + whole.min[1].toFixed(4) + " m.",
    action: Math.abs(whole.min[1]) <= 0.001 ? "" : "The mesh was not left on Y = 0."
  });
  const centered = Math.abs(after.center[0]) <= 0.001 && Math.abs(after.center[1]) <= 0.001;
  checks.push({
    id: "center",
    pass: centered,
    detail: "Center X " + after.center[0].toFixed(4) + " m, Z " + after.center[1].toFixed(4) + " m.",
    action: centered ? "" : "Center XZ was not finished."
  });
  checks.push({
    id: "material",
    pass: !GAME_TINT.test(materialName) && names.length <= 1,
    detail: "One material, " + materialName + ". No new atlas was baked.",
    action: ""
  });
  checks.push({
    id: "bytes",
    pass: bytes.length <= profile.byteCap,
    detail: "File is " + bytes.length + " bytes. Cap is " + profile.byteCap + " bytes.",
    action: bytes.length <= profile.byteCap ? "" : "The file is over the cap. Do not unlock a border to shrink it."
  });
  const bad = outputDefects(parts);
  checks.push({
    id: "triangles",
    pass: bad.zero === 0 && bad.duplicate === 0,
    detail: bad.zero + " zero-area triangles and " + bad.duplicate + " repeated triangles remain.",
    action: bad.zero || bad.duplicate ? "Remove the remaining bad triangles." : ""
  });
  if (profile.id === "CAR") {
    const missing = ["body", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"].filter((name) => !parts.some((part) => part.name === name));
    checks.push({
      id: "names",
      pass: !missing.length,
      detail: missing.length ? "Missing " + missing.join(", ") + "." : "Nodes are body and the four wheels.",
      action: missing.length ? "The four wheel islands were not named." : ""
    });
  }
  const failed = checks.some((check) => !check.pass);
  const banner = failed ? "NOT READY" : "READY";
  const summary = failed
    ? "One or more declared checks failed."
    : "Every declared check passed. This is not a gameplay or phone test. Street Empire does not read the mask.";
  log.push("Source SHA " + sourceSha.slice(0, 12) + " was not modified. Output SHA " + afterSha.slice(0, 12) + ".");
  log.push(summary);
  const validation = [banner, summary, ""].concat(checks.map((check) => (check.pass ? "PASS  " : "FAIL  ") + check.detail + (check.action ? "  " + check.action : ""))).concat([""]).concat(log).join("\n");
  const files = [
    { name: "model.glb", data: bytes },
    { name: "validation.txt", data: new TextEncoder().encode(validation) }
  ];
  if (maskPack) files.push({ name: "review-mask.png", data: maskPack.reviewPng });
  return finishResult({
    sourceSha,
    before,
    after,
    log,
    checks,
    bytes,
    zip: zipStore(files),
    banner,
    summary
  });
}

function finishResult(result) {
  return {
    ready: result.banner === "READY",
    issuedReady: result.banner === "READY",
    banner: result.banner,
    summary: result.summary,
    log: result.log,
    checks: result.checks,
    before: result.before,
    after: result.after || null,
    bytes: result.bytes || null,
    zip: result.zip || null,
    sourceSha: result.sourceSha
  };
}

function wheelBleed(parts) {
  const body = parts.find((part) => !part.wheel);
  if (!body || !parts.some((part) => part.wheel)) {
    return { id: "bleed", pass: true, detail: "No wheel boundary to measure.", action: "" };
  }
  const keys = new Set();
  for (let i = 0; i < body.mesh.positions.length; i += 3) {
    keys.add(Math.round(body.mesh.positions[i] * WELD) + "," + Math.round(body.mesh.positions[i + 1] * WELD) + "," + Math.round(body.mesh.positions[i + 2] * WELD));
  }
  let shared = 0;
  for (const part of parts) {
    if (!part.wheel) continue;
    for (let i = 0; i < part.mesh.positions.length; i += 3) {
      const key = Math.round(part.mesh.positions[i] * WELD) + "," + Math.round(part.mesh.positions[i + 1] * WELD) + "," + Math.round(part.mesh.positions[i + 2] * WELD);
      if (keys.has(key)) shared += 1;
    }
  }
  return {
    id: "bleed",
    pass: shared === 0,
    detail: shared + " wheel vertices sit on the body within 0.5 mm.",
    action: shared ? "The wheel boundary meets the body. Do not call that split clean." : ""
  };
}

function outputDefects(parts) {
  let zero = 0;
  let duplicate = 0;
  for (const part of parts) {
    const copy = { ...part.mesh, indices: part.mesh.indices.slice() };
    const dropped = dropBadFaces(copy);
    zero += dropped.zero;
    duplicate += dropped.duplicate;
  }
  return { zero, duplicate };
}

function measureFile(loaded) {
  const mesh = soupFrom(loaded.surfaces);
  const box = measureMesh(mesh);
  return {
    triangles: loaded.surfaces.reduce((sum, surface) => sum + surface.faceCount, 0),
    bytes: loaded.bytes.length,
    size: box.size,
    minY: box.min[1]
  };
}

function soupFrom(surfaces) {
  let corners = 0;
  for (const surface of surfaces) corners += surface.faceCount * 3;
  const positions = new Float32Array(corners * 3);
  const uvs = new Float32Array(corners * 2);
  const normals = new Float32Array(corners * 3);
  let corner = 0;
  for (const surface of surfaces) {
    for (let face = 0; face < surface.faceCount; face++) {
      for (let c = 0; c < 3; c++) {
        const at = corner * 3;
        positions[at] = surface.world[face * 9 + c * 3];
        positions[at + 1] = surface.world[face * 9 + c * 3 + 1];
        positions[at + 2] = surface.world[face * 9 + c * 3 + 2];
        if (surface.uvs) {
          uvs[corner * 2] = surface.uvs[face * 6 + c * 2];
          uvs[corner * 2 + 1] = surface.uvs[face * 6 + c * 2 + 1];
        }
        normals[at] = surface.normals[face * 3];
        normals[at + 1] = surface.normals[face * 3 + 1];
        normals[at + 2] = surface.normals[face * 3 + 2];
        corner += 1;
      }
    }
  }
  const indices = new Uint32Array(corners);
  for (let i = 0; i < corners; i++) indices[i] = i;
  return { positions, uvs, normals, indices };
}

function hasMorph(json) {
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) if (prim.targets && prim.targets.length) return true;
  }
  return false;
}

function orientMesh(mesh, profile, options) {
  const box = measureMesh(mesh);
  const [sx, sy, sz] = box.size;
  if (profile.id === "CAR" && sy > sx * 1.15 && sy > sz * 1.15) {
    return {
      ok: false,
      detail: "Up is ambiguous. The mesh is taller than it is long, and no rotation was applied.",
      action: "Confirm which axis is up, then run again."
    };
  }
  if (profile.id === "CHARACTER") {
    return {
      ok: true,
      detail: "Character up stays the glTF Y axis. The arm span was not turned onto Z."
    };
  }
  const horizontalGap = Math.abs(sx - sz) / Math.max(sx, sz, 1e-8);
  if ((profile.id === "CAR" || profile.id === "BUILDING") && horizontalGap < 0.15) {
    return {
      ok: false,
      detail: "Forward is ambiguous. The two horizontal lengths are similar, and no rotation was applied.",
      action: "Confirm which way is +Z, then run again."
    };
  }
  if ((profile.id === "CAR" || profile.id === "BUILDING") && sx > sz * 1.15) {
    rotateY(mesh, Math.PI / 2);
    return {
      ok: true,
      detail: "The longest horizontal axis was X. It was turned about Y onto Z. glTF up stayed Y. +Z is not a confirmed front unless you said so."
    };
  }
  return {
    ok: true,
    detail: options.frontConfirmed
      ? "Up is the glTF Y axis and the long axis is Z. +Z was confirmed as the front."
      : "Up is the glTF Y axis and the long axis is already Z. Which end is the front was not confirmed."
  };
}

function poseCheck(mesh) {
  const box = measureMesh(mesh);
  const height = box.size[1];
  const span = box.size[0];
  const depth = box.size[2];
  const pass = height > 0.4 && span > height * 0.65 && span > depth * 1.5;
  return {
    id: "pose",
    pass,
    detail: pass
      ? "Arm span " + span.toFixed(2) + " m reads as a T against height " + height.toFixed(2) + " m. No skeleton was added."
      : "Arm span " + span.toFixed(2) + " m does not read as a T against height " + height.toFixed(2) + " m. No skeleton was added.",
    action: pass ? "" : "Use a T pose. This finish does not rig a character."
  };
}

function baseCheck(mesh) {
  const box = measureMesh(mesh);
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i + 1];
    if (y > 0.02) continue;
    count += 1;
    if (y > maxY) maxY = y;
    if (mesh.positions[i] < minX) minX = mesh.positions[i];
    if (mesh.positions[i] > maxX) maxX = mesh.positions[i];
    if (mesh.positions[i + 2] < minZ) minZ = mesh.positions[i + 2];
    if (mesh.positions[i + 2] > maxZ) maxZ = mesh.positions[i + 2];
  }
  const coverX = count && (maxX - minX) >= box.size[0] * 0.6;
  const coverZ = count && (maxZ - minZ) >= box.size[2] * 0.6;
  const pass = count >= 4 && maxY <= 0.01 && coverX && coverZ;
  return {
    id: "base",
    pass,
    detail: pass
      ? "The footprint sits on a flat Y = 0 base (" + count + " low vertices)."
      : "The low points do not cover a flat base on Y = 0.",
    action: pass ? "" : "Level the base so the footprint sits on Y = 0."
  };
}

function targetLength(profile, mesh) {
  if (profile.id === "CAR") return { axis: 2, length: profile.lengthZ };
  if (profile.id === "BUILDING" || profile.id === "CHARACTER") return { axis: 1, length: profile.heightY };
  const size = measureMesh(mesh).size;
  let axis = 0;
  if (size[1] > size[axis]) axis = 1;
  if (size[2] > size[axis]) axis = 2;
  return { axis, length: profile.longest || 1 };
}

function scaleMesh(mesh, factor) {
  for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] *= factor;
}

function groundMesh(mesh) {
  const box = measureMesh(mesh);
  const dx = -((box.min[0] + box.max[0]) / 2);
  const dy = -box.min[1];
  const dz = -((box.min[2] + box.max[2]) / 2);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] += dx;
    mesh.positions[i + 1] += dy;
    mesh.positions[i + 2] += dz;
  }
  return [dx, dy, dz];
}

function dropBadFaces(mesh) {
  const keep = [];
  const seen = new Set();
  let zero = 0;
  let duplicate = 0;
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const ids = [mesh.indices[face], mesh.indices[face + 1], mesh.indices[face + 2]];
    const a = vertex(mesh, ids[0]);
    const b = vertex(mesh, ids[1]);
    const c = vertex(mesh, ids[2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    );
    if (cross < 1e-8) {
      zero += 1;
      continue;
    }
    const key = [ids[0], ids[1], ids[2]].map((id) => quantKey(mesh, id)).sort().join("|");
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);
    keep.push(ids[0], ids[1], ids[2]);
  }
  mesh.indices = new Uint32Array(keep);
  return { zero, duplicate };
}

function weldMesh(mesh) {
  const map = new Map();
  const positions = [];
  const uvs = [];
  const normals = [];
  const remap = new Uint32Array(mesh.positions.length / 3);
  let merged = 0;
  for (let i = 0; i < remap.length; i++) {
    const key = weldKey(mesh, i);
    if (map.has(key)) {
      remap[i] = map.get(key);
      merged += 1;
      continue;
    }
    const index = positions.length / 3;
    map.set(key, index);
    remap[i] = index;
    positions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
    uvs.push(mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]);
    normals.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
  }
  const indices = [];
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const a = remap[mesh.indices[face]];
    const b = remap[mesh.indices[face + 1]];
    const c = remap[mesh.indices[face + 2]];
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  return {
    merged,
    mesh: {
      positions: new Float32Array(positions),
      uvs: new Float32Array(uvs),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices)
    }
  };
}

function splitWheels(mesh) {
  const count = mesh.positions.length / 3;
  const parent = new Uint32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (id) => {
    while (parent[id] !== id) id = parent[id];
    return id;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let face = 0; face < mesh.indices.length; face += 3) {
    unite(mesh.indices[face], mesh.indices[face + 1]);
    unite(mesh.indices[face + 1], mesh.indices[face + 2]);
  }
  const groups = new Map();
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const root = find(mesh.indices[face]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(face / 3);
  }
  const pieces = [...groups.values()].map((faces) => ({ faces, box: faceBounds(mesh, faces) }));
  pieces.sort((a, b) => (b.box.size[0] * b.box.size[1] * b.box.size[2]) - (a.box.size[0] * a.box.size[1] * a.box.size[2]));
  if (!pieces.length) return { ok: false, detail: "The mesh has no triangles left to split." };
  const body = pieces[0];
  const slots = { wheel_fl: null, wheel_fr: null, wheel_rl: null, wheel_rr: null };
  for (const piece of pieces.slice(1)) {
    const name = wheelSlot(piece.box, measureMesh(mesh));
    if (!name || slots[name]) return { ok: false, detail: "Wheel islands are not one piece at each low corner. No wheel was invented, and simplify did not run." };
    slots[name] = piece;
  }
  if (Object.values(slots).some((piece) => !piece)) {
    return { ok: false, detail: "The shell does not have four disconnected wheel islands. No wheel was invented, and simplify did not run." };
  }
  const parts = [{ name: "body", mesh: facesToMesh(mesh, body.faces), wheel: false }];
  for (const name of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
    parts.push({ name, mesh: facesToMesh(mesh, slots[name].faces), wheel: true, center: centerOf(slots[name].box) });
  }
  return { ok: true, parts, detail: "Split four disconnected wheel islands before simplify. Names use +Z as the geometric front." };
}

function wheelSlot(box, whole) {
  const center = centerOf(box);
  if (center[1] > whole.max[1] * 0.55) return null;
  if (Math.abs(center[0]) < 0.2 || Math.abs(center[2]) < 0.2) return null;
  return "wheel_" + (center[2] >= 0 ? "f" : "r") + (center[0] < 0 ? "l" : "r");
}

async function simplifyPart(mesh, target, hold) {
  const count = mesh.indices.length / 3;
  if (hold || count <= target) return { mesh, detail: "Simplify skipped. The part is at or under its share of the target." };
  const targetIndex = Math.max(3, target * 3);
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices,
    mesh.positions,
    3,
    mesh.uvs,
    2,
    [1, 1],
    null,
    Math.min(mesh.indices.length, targetIndex),
    0.002,
    ["ErrorAbsolute"]
  );
  const next = { ...mesh, indices: indices instanceof Uint32Array ? indices : new Uint32Array(indices) };
  return { mesh: compact(next), detail: "Simplified with UV attributes. Error limit 2 mm. Borders were not present to unlock." };
}

function compact(mesh) {
  const used = new Uint8Array(mesh.positions.length / 3);
  for (const index of mesh.indices) used[index] = 1;
  const remap = new Int32Array(used.length);
  remap.fill(-1);
  const positions = [];
  const uvs = [];
  const normals = [];
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    remap[i] = positions.length / 3;
    positions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
    uvs.push(mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]);
    normals.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]];
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), normals: new Float32Array(normals), indices };
}

function recomputeNormals(mesh) {
  const acc = new Float32Array(mesh.positions.length);
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const a = vertex(mesh, mesh.indices[face]);
    const b = vertex(mesh, mesh.indices[face + 1]);
    const c = vertex(mesh, mesh.indices[face + 2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    for (let cIndex = 0; cIndex < 3; cIndex++) {
      const id = mesh.indices[face + cIndex] * 3;
      acc[id] += n[0];
      acc[id + 1] += n[1];
      acc[id + 2] += n[2];
    }
  }
  for (let i = 0; i < acc.length; i += 3) {
    const length = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    mesh.normals[i] = acc[i] / length;
    mesh.normals[i + 1] = acc[i + 1] / length;
    mesh.normals[i + 2] = acc[i + 2] / length;
  }
}

function resizeImages(loaded, max, log, checks) {
  const outputs = [];
  let failed = false;
  for (const image of loaded.images || []) {
    if (image.mime !== "image/png") {
      outputs.push(image);
      failed = true;
      log.push(image.name + " was kept. Its pixel size was not measured, so it was not resized.");
      continue;
    }
    try {
      const decoded = decodePng(image.bytes);
      if (decoded.width <= max && decoded.height <= max) {
        outputs.push(image);
        log.push(image.name + " is " + decoded.width + " px. It was not resized.");
        continue;
      }
      const scale = max / Math.max(decoded.width, decoded.height);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const rgba = boxFilter(decoded.rgba, decoded.width, decoded.height, width, height);
      outputs.push({ ...image, bytes: encodePng(width, height, rgba) });
      log.push(image.name + " was resized from " + decoded.width + "x" + decoded.height + " to " + width + "x" + height + ". The pixels were only downsampled.");
    } catch (error) {
      outputs.push(image);
      failed = true;
      log.push(image.name + " was kept. The PNG could not be read, so it was not resized.");
    }
  }
  checks.push({
    id: "texture",
    pass: !failed,
    detail: failed ? "A texture could not be measured against the cap." : "Textures are within " + max + " px or were only downsampled.",
    action: failed ? "Provide a PNG, or resize the texture outside this step." : ""
  });
  return { outputs };
}

function packParts(parts, materialName, images, frontConfirmed, maskPack) {
  const base = images[0] || null;
  const meshes = [];
  const nodes = [];
  parts.forEach((part, index) => {
    const origin = part.center || [0, 0, 0];
    const positions = new Float32Array(part.mesh.positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = part.mesh.positions[i] - origin[0];
      positions[i + 1] = part.mesh.positions[i + 1] - origin[1];
      positions[i + 2] = part.mesh.positions[i + 2] - origin[2];
    }
    meshes.push({
      name: part.name,
      primitives: [{
        material: 0,
        position: positions,
        normal: part.mesh.normals,
        uv: part.mesh.uvs,
        indices: part.mesh.indices
      }]
    });
    const node = { name: part.name, mesh: index };
    if (origin.some((value) => Math.abs(value) > 1e-8)) node.translation = origin;
    if (part.wheel) node.extras = { kitWheel: true };
    nodes.push(node);
  });
  return packGlb({
    sceneName: frontConfirmed ? "car" : "car-unconfirmed-front",
    roots: nodes.map((_, index) => index),
    materials: [{
      name: materialName,
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      baseColorImage: base ? { name: base.name || "base", mime: base.mime, bytes: base.bytes } : undefined,
      emissiveImage: maskPack ? { name: "mask", mime: "image/png", bytes: maskPack.maskPng } : undefined,
      emissiveFactor: maskPack ? [0, 0, 0] : undefined,
      extras: maskPack ? { kitMask: true } : undefined
    }],
    meshes,
    nodes
  });
}

function sizeCheck(profile, box, target) {
  const actual = box.size[target.axis];
  const band = Math.abs(actual - target.length) / target.length;
  const pass = band <= (profile.tolerance || 0.05);
  return {
    id: "size",
    pass,
    detail: "XYZ"[target.axis] + " is " + actual.toFixed(3) + " m. Target " + target.length + " m.",
    action: pass ? "" : "The scale did not land in the size band."
  };
}

function safeMaterialName(name) {
  if (!name || GAME_TINT.test(name)) return "atlas";
  return name;
}

function measureMesh(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max, size: min.map((value, axis) => max[axis] - value) };
}

function measureParts(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let i = 0; i < part.mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = part.mesh.positions[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  return { min, max, size: min.map((value, axis) => max[axis] - value) };
}

function faceBounds(mesh, faces) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) {
    for (let c = 0; c < 3; c++) {
      const id = mesh.indices[face * 3 + c];
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.positions[id * 3 + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  return { min, max, size: min.map((value, axis) => max[axis] - value) };
}

function facesToMesh(mesh, faces) {
  const map = new Map();
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  const take = (id) => {
    if (map.has(id)) return map.get(id);
    const next = positions.length / 3;
    map.set(id, next);
    positions.push(mesh.positions[id * 3], mesh.positions[id * 3 + 1], mesh.positions[id * 3 + 2]);
    uvs.push(mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]);
    normals.push(mesh.normals[id * 3], mesh.normals[id * 3 + 1], mesh.normals[id * 3 + 2]);
    return next;
  };
  for (const face of faces) {
    indices.push(take(mesh.indices[face * 3]), take(mesh.indices[face * 3 + 1]), take(mesh.indices[face * 3 + 2]));
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices)
  };
}

function centerOf(box) {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function vertex(mesh, id) {
  return [mesh.positions[id * 3], mesh.positions[id * 3 + 1], mesh.positions[id * 3 + 2]];
}

function quantKey(mesh, id) {
  return Math.round(mesh.positions[id * 3] * WELD) + "," + Math.round(mesh.positions[id * 3 + 1] * WELD) + "," + Math.round(mesh.positions[id * 3 + 2] * WELD);
}

function weldKey(mesh, id) {
  return quantKey(mesh, id) + "/" + Math.round(mesh.uvs[id * 2] * 4096) + "," + Math.round(mesh.uvs[id * 2 + 1] * 4096);
}

function rotateY(mesh, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const z = mesh.positions[i + 2];
    mesh.positions[i] = c * x + s * z;
    mesh.positions[i + 2] = -s * x + c * z;
  }
}

function boxFilter(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sh / dh);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sw / dw);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) {
        for (let xx = x0; xx < x1 && xx < sw; xx++) {
          const index = (yy * sw + xx) * 4;
          r += src[index];
          g += src[index + 1];
          b += src[index + 2];
          a += src[index + 3];
          n += 1;
        }
      }
      const dest = (y * dw + x) * 4;
      out[dest] = Math.round(r / n);
      out[dest + 1] = Math.round(g / n);
      out[dest + 2] = Math.round(b / n);
      out[dest + 3] = Math.round(a / n);
    }
  }
  return out;
}
