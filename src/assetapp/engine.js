// Sovereign Asset: clean up and finish any glTF model.
// Bytes in, bytes out. Runs the same in the browser, in a worker, and in Node.
// The source bytes are never changed. Every fix is logged, and the verdict is measured on the
// finished file after it is read back, not on what the fixes were meant to do.

import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { compactPrimitive, convertPrimitiveToTriangles, dedup, dequantize, meshopt, prune, reorder, simplify, transformMesh, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { findAwnings, stripeColors, stripeCount } from "./awnings.js";
import { analyze, boundsOf, capHoles, computeNormals, diagOf, findDebris, findFlats, flattenPositions, invertedIslands, resizeRgba, weldIds, wrongNormals } from "./geometry.js";
import { LINEAR, STANDARD, applyGain, colorStats, coverageMask, fitBakedLight, gainFrom, gainMap, holdToStandard, insideStandard, normalFromColor, paintOf, roughnessFromColor, sampleColor, texelDensity, uvInside } from "./surface.js";
import { findWindows, litPattern } from "./windows.js";
import { colorOnly, copyPaint, findCourses, levelGrain, normalsFrom, packWalls, spreadEdges, surfaceAt } from "./walls.js";
import { meanColor } from "./materials.js";

export const DEFAULTS = {
  removeDebris: true,     // drop small pieces that touch nothing
  fixFacing: true,        // turn inside-out shells the right way round
  closeHoles: "small",    // "off", "small" (pinholes), "all"
  fixNormals: true,       // add missing normals, rebuild ones that point the wrong way
  flatten: "off",         // "off", "light", "strong": press crumpled walls flat and light each as one face
  delight: "off",         // "off", "light", "strong": take light that was painted into the color texture back out
  surfaceMaps: "off",     // "off", "light", "strong": make normal and roughness maps for materials that have none
  walls: "off",           // buildings: "off", "auto", "stucco", "block", "brick": give flat walls a clean texture of their own
  windowLights: false,    // buildings: find the window glass and give it its own lit and unlit materials
  colorStandard: false,   // hold every color texture to one range of brightness and vividness, so assets match
  minTexelDensity: null,  // fail when the color texture has fewer pixels per meter than this
  rotation: null,         // 4x4 column-major rotation applied before sizing
  size: null,             // { axis: "height" | "length" | "width" | "longest", meters }
  ground: true,           // lowest point on Y = 0
  center: true,           // centered on X and Z
  triangles: null,        // triangle target, null keeps every triangle
  maxTexture: 2048,       // longest texture side in pixels, null leaves textures alone
  textureFormat: "keep",  // "keep", "webp" or "png"
  textureQuality: 0.9,
  dropAnimations: false,
  compress: null,         // Meshopt geometry compression. null keeps whatever the source used
  requireSkeleton: false, // fail when the model has no skeleton
  requireClosed: false,   // fail on any open edge (3D printing)
  maxBytes: null          // fail when the finished file is larger
};

const TRIANGLES = 4;
// How far off its plane a point may sit and still count as part of a wall, as a share of the part's size.
const FLATTEN = { light: { tolerance: 0.003 }, strong: { tolerance: 0.008 } };
// How much of the painted light is taken out, and the most any pixel may be brightened or darkened.
const DELIGHT = { light: { strength: 0.6, limit: 1.6 }, strong: { strength: 1, limit: 2.5 } };
// Slope of the made normal map per unit of brightness.
const RELIEF = { light: 2, strong: 4 };
// Painted light under this ratio, lit side to dark side, is not worth touching the texture for.
const BAKED_FLOOR = 1.08;
// When this share of the surface faces straight along an axis, the model is a box of walls.
const BOXY = 0.75;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let ioReady = null;
async function makeIO() {
  if (!ioReady) {
    ioReady = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
    })();
  }
  return ioReady;
}

export async function readModel(bytes) {
  const io = await makeIO();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let doc;
  try {
    doc = await io.readBinary(data);
  } catch (error) {
    const text = String(error && error.message || error);
    if (/draco/i.test(text)) throw new Error("This file uses Draco compression, which this app cannot open yet. Export it without Draco.");
    throw new Error("This file could not be read as a GLB: " + text);
  }
  await doc.transform(dequantize()); // plain float positions, so every measurement below is in real units
  return doc;
}

export async function writeModel(doc) {
  return (await makeIO()).writeBinary(doc);
}

// Put the document in a state the fixes can work on. Lossless.
async function normalize(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      if (mode === 5 || mode === 6) convertPrimitiveToTriangles(prim);
    }
  }
  // no two primitives may share vertex data, so a fix to one never leaks into another
  const seen = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        const acc = prim.getAttribute(semantic);
        if (seen.has(acc)) prim.setAttribute(semantic, acc.clone()); else seen.add(acc);
      }
      const idx = prim.getIndices();
      if (idx) { if (seen.has(idx)) prim.setIndices(idx.clone()); else seen.add(idx); }
    }
  }
  await doc.transform(weld());
}

function sceneOf(doc) {
  const root = doc.getRoot();
  return root.getDefaultScene() || root.listScenes()[0] || null;
}

function meshNodes(doc) {
  const out = [];
  const scene = sceneOf(doc);
  if (scene) scene.traverse((node) => { if (node.getMesh()) out.push(node); });
  return out;
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

function isIdentity(m) {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
}

// Where each vertex really is: through the node, or through the skeleton when the mesh is skinned.
function worldPositions(node, prim) {
  const acc = prim.getAttribute("POSITION");
  const n = acc.getCount();
  const src = acc.getArray();
  const out = new Float32Array(n * 3);
  const skin = node.getSkin();
  const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
  const world = node.getWorldMatrix();
  let mats = null;
  if (skin && J && W) {
    const ibm = skin.getInverseBindMatrices();
    mats = skin.listJoints().map((joint, i) => {
      const inv = ibm ? ibm.getElement(i, new Array(16)) : IDENTITY;
      return mul(joint.getWorldMatrix(), inv);
    });
  }
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, total = 0;
    if (mats) {
      J.getElement(i, j); W.getElement(i, w);
      for (let k = 0; k < 4; k++) {
        const m = mats[j[k]];
        if (!m || !(w[k] > 0)) continue;
        ox += w[k] * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        oy += w[k] * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        oz += w[k] * (m[2] * x + m[6] * y + m[10] * z + m[14]);
        total += w[k];
      }
    }
    if (total > 0) { out[i * 3] = ox / total; out[i * 3 + 1] = oy / total; out[i * 3 + 2] = oz / total; }
    else {
      out[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
      out[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
      out[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
    }
  }
  return out;
}

function indicesOf(prim) {
  const idx = prim.getIndices();
  if (idx) return Uint32Array.from(idx.getArray());
  const n = prim.getAttribute("POSITION").getCount();
  const out = new Uint32Array(n - n % 3);
  for (let i = 0; i < out.length; i++) out[i] = i;
  return out;
}

// One entry per triangle primitive, placed by the first node that uses its mesh.
function surfacesOf(doc) {
  const out = [], done = new Set();
  for (const node of meshNodes(doc)) {
    const mesh = node.getMesh();
    if (done.has(mesh)) continue;
    done.add(mesh);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== TRIANGLES || !prim.getAttribute("POSITION")) continue;
      out.push({ node, mesh, prim, pos: worldPositions(node, prim), indices: indicesOf(prim) });
    }
  }
  return out;
}

function sceneBounds(doc, rotation) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const r = rotation || IDENTITY;
  for (const node of meshNodes(doc)) {
    for (const prim of node.getMesh().listPrimitives()) {
      if (!prim.getAttribute("POSITION")) continue;
      const pos = worldPositions(node, prim);
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        const p = [r[0] * x + r[4] * y + r[8] * z, r[1] * x + r[5] * y + r[9] * z, r[2] * x + r[6] * y + r[10] * z];
        for (let d = 0; d < 3; d++) { if (p[d] < min[d]) min[d] = p[d]; if (p[d] > max[d]) max[d] = p[d]; }
      }
    }
  }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], empty: true };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// Counts that cost almost nothing: what the file holds.
function measure(doc, byteLength) {
  const root = doc.getRoot();
  let triangles = 0, drawCalls = 0, other = 0, morphs = 0;
  for (const node of meshNodes(doc)) {
    for (const prim of node.getMesh().listPrimitives()) {
      drawCalls++;
      if (prim.listTargets().length) morphs++;
      if (prim.getMode() !== TRIANGLES) { other++; continue; }
      const idx = prim.getIndices(), pos = prim.getAttribute("POSITION");
      triangles += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  let vertices = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const pos = prim.getAttribute("POSITION"); if (pos) vertices += pos.getCount(); }
  const textures = root.listTextures().map((tex) => {
    const size = tex.getSize(), image = tex.getImage();
    return { name: tex.getName() || tex.getURI() || "", mime: tex.getMimeType() || "", width: size ? size[0] : 0, height: size ? size[1] : 0, bytes: image ? image.byteLength : 0 };
  });
  const bounds = sceneBounds(doc);
  return {
    bytes: byteLength || 0,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    drawCalls, triangles, vertices,
    materials: root.listMaterials().length,
    textures,
    maxTexture: textures.reduce((m, t) => Math.max(m, t.width, t.height), 0),
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((n, s) => n + s.listJoints().length, 0),
    animations: root.listAnimations().length,
    morphs, otherPrimitives: other,
    size: bounds.size, min: bounds.min, max: bounds.max,
    extensions: root.listExtensionsUsed().map((e) => e.extensionName)
  };
}

// What is wrong with the geometry. Runs the full analysis, so it is the slow part.
function findDefects(surfaces, diag, keepAnalysis) {
  const out = { degenerate: 0, duplicate: 0, debrisPieces: 0, debrisTriangles: 0, debrisHeld: 0, inverted: 0, missingNormals: 0, wrongNormals: 0, openEdges: 0, nonManifold: 0, missingUV: 0, pieces: 0 };
  for (const s of surfaces) {
    s.analysis = analyze(s.pos, s.indices, diag, keepAnalysis ? 10 : 1);
    s.inverted = invertedIslands(s.analysis);
    out.degenerate += s.analysis.nDegenerate;
    out.duplicate += s.analysis.nDuplicate;
    out.openEdges += s.analysis.openEdges;
    out.nonManifold += s.analysis.nonManifold;
    out.pieces += s.analysis.islands.length;
    out.inverted += s.inverted.length;
    const normal = s.prim.getAttribute("NORMAL");
    if (!normal) out.missingNormals++;
    else {
      const bad = wrongNormals(s.prim.getAttribute("POSITION").getArray(), normal.getArray(), s.indices);
      s.wrongNormals = bad;
      // a shell that is inside out has normals that agree with its faces, so it is counted above, not here
      if (bad > s.indices.length / 3 * 0.02) out.wrongNormals += bad;
    }
    const mat = s.prim.getMaterial();
    if (mat && textured(mat) && !s.prim.getAttribute("TEXCOORD_0")) out.missingUV++;
  }
  const debris = findDebris(surfaces, diag);
  surfaces.forEach((s, i) => { s.debris = debris.flagged[i]; });
  out.debrisPieces = debris.pieces;
  out.debrisTriangles = debris.triangles;
  out.debrisHeld = debris.held;
  if (!keepAnalysis) for (const s of surfaces) { s.analysis = null; }
  return out;
}

function textured(mat) {
  return !!(mat.getBaseColorTexture() || mat.getNormalTexture() || mat.getEmissiveTexture() || mat.getOcclusionTexture() || mat.getMetallicRoughnessTexture());
}

// Counts only: triangles, size, textures. Fast, and changes nothing.
export async function measureModel(bytes) {
  return measure(await readModel(bytes), bytes.byteLength);
}

// Read a file and report what it holds and what is wrong with it. Changes nothing.
export async function inspectModel(bytes) {
  const doc = await readModel(bytes);
  const stats = measure(doc, bytes.byteLength);
  await normalize(doc);
  const surfaces = surfacesOf(doc);
  const diag = Math.hypot(...stats.size);
  stats.defects = findDefects(surfaces, diag, false);
  return stats;
}

export async function finishModel(bytes, userOptions = {}, env = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const log = [];
  const progress = (label, fraction) => { if (env.onProgress) env.onProgress(label, fraction); };
  const io = await makeIO();
  progress("Reading the model", 0.02);
  const doc = await readModel(bytes);
  const root = doc.getRoot();
  const before = measure(doc, bytes.byteLength);
  if (!before.triangles) {
    return verdictOf({ before, after: null, bytes: null, log, checks: [{ id: "read", status: "fail", label: "Model", detail: "The file has no triangles.", fix: "Export the mesh again. Point clouds and lines are not finished here." }] });
  }
  await normalize(doc);
  const buffer = root.listBuffers()[0] || doc.createBuffer();

  // 1. geometry
  progress("Checking the mesh", 0.1);
  let surfaces = surfacesOf(doc);
  const diag = Math.hypot(...before.size);
  before.defects = findDefects(surfaces, diag, true);
  const d = before.defects;
  let removedDebris = 0, flipped = 0, capped = 0, holesLeft = 0, turnedNormals = 0, splitFaces = 0, addedNormals = 0, emptied = 0;
  const flat = { areas: 0, triangles: 0, held: 0, far: 0, skipped: 0, tangents: 0 };
  progress("Cleaning the mesh", 0.25);
  for (const s of surfaces) {
    const a = s.analysis;
    const dropDebris = options.removeDebris ? s.debris : new Set();
    const flip = new Set(options.fixFacing ? s.inverted : []);
    const kept = [];
    const turned = new Set();
    for (let t = 0; t < a.tris; t++) {
      const k = a.island[t];
      if (k < 0 || dropDebris.has(k)) continue;
      const i0 = s.indices[t * 3], i1 = s.indices[t * 3 + 1], i2 = s.indices[t * 3 + 2];
      if (flip.has(k)) { kept.push(i0, i2, i1); turned.add(i0); turned.add(i1); turned.add(i2); }
      else kept.push(i0, i1, i2);
    }
    removedDebris += dropDebris.size;
    flipped += flip.size;
    if (turned.size) {
      const normal = s.prim.getAttribute("NORMAL");
      if (normal) {
        const arr = normal.getArray();
        for (const i of turned) { arr[i * 3] = -arr[i * 3]; arr[i * 3 + 1] = -arr[i * 3 + 1]; arr[i * 3 + 2] = -arr[i * 3 + 2]; }
        normal.setArray(arr);
      }
    }
    let indices = Uint32Array.from(kept);
    if (options.closeHoles !== "off" && indices.length) {
      const again = analyze(s.pos, indices, diag, 10);
      if (again.openEdges) {
        const caps = capHoles(s.pos, indices, again, diag, { mode: options.closeHoles });
        capped += caps.filled; holesLeft += caps.left;
        if (caps.triangles.length) {
          const merged = new Uint32Array(indices.length + caps.triangles.length);
          merged.set(indices); merged.set(caps.triangles, indices.length);
          indices = merged;
        }
      }
    }
    if (!indices.length) { s.mesh.removePrimitive(s.prim); s.prim.dispose(); emptied++; continue; }
    s.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer));
    if (options.fixNormals) {
      const local = s.prim.getAttribute("POSITION").getArray();
      const normal = s.prim.getAttribute("NORMAL");
      if (!normal) {
        s.prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(computeNormals(local, indices)).setBuffer(buffer));
        addedNormals++;
      } else {
        // The model's own normals are kept. Only what is wrong is touched.
        const tris = indices.length / 3;
        let bad = wrongNormals(local, normal.getArray(), indices);
        if (bad > tris * 0.5) {
          const arr = normal.getArray();
          for (let i = 0; i < arr.length; i++) arr[i] = -arr[i];
          normal.setArray(arr);
          turnedNormals++;
          bad = wrongNormals(local, arr, indices);
        }
        if (bad > tris * 0.02) splitFaces += splitWrongFaces(s.prim, buffer, doc);
      }
    }
    if (FLATTEN[options.flatten]) {
      const done = flattenFlats(s.prim, buffer, doc, FLATTEN[options.flatten]);
      flat.areas += done.areas; flat.triangles += done.triangles; flat.held += done.held;
      flat.skipped += done.skipped; flat.tangents += done.tangents;
      if (done.far > flat.far) flat.far = done.far;
    }
    compactPrimitive(s.prim);
  }
  for (const mesh of root.listMeshes()) if (!mesh.listPrimitives().length) { for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setMesh(null); mesh.dispose(); }
  surfaces = null;
  log.push(d.degenerate || d.duplicate
    ? "Removed " + count(d.degenerate, "triangle") + " with no area and " + count(d.duplicate, "repeated triangle") + "."
    : "No empty or repeated triangles were found.");
  if (options.removeDebris) {
    if (removedDebris) log.push("Removed " + count(removedDebris, "small floating piece") + " (" + count(d.debrisTriangles, "triangle") + ") that touched nothing.");
    else if (d.debrisHeld) log.push(count(d.debrisHeld, "small loose piece") + " left in place. Together they are too much of the model to be junk.");
    else log.push("No floating debris was found.");
  }
  if (options.fixFacing) log.push(flipped ? "Turned " + count(flipped, "inside-out shell") + " the right way round." : "No inside-out shells were found.");
  if (options.closeHoles !== "off") log.push(capped || holesLeft
    ? "Closed " + count(capped, "hole") + "." + (holesLeft ? " " + count(holesLeft, "opening") + " left open: too large or not a simple loop." : "")
    : "No holes were found.");
  if (options.fixNormals && (addedNormals || turnedNormals || splitFaces)) {
    const bits = [];
    if (addedNormals) bits.push("added to " + count(addedNormals, "part") + " that had none");
    if (turnedNormals) bits.push("turned around on " + count(turnedNormals, "part"));
    if (splitFaces) bits.push(count(splitFaces, "face") + " lit from behind got corners of their own");
    log.push("Normals: " + bits.join(", ") + ". Every other normal is the model's own.");
  }
  if (FLATTEN[options.flatten]) {
    if (flat.areas) log.push("Flat areas: " + count(flat.areas, "wall or other flat area", "walls and other flat areas") + " (" + count(flat.triangles, "triangle") + ") pressed onto " + (flat.areas === 1 ? "its plane" : "their planes") + " and lit as one face each. No point moved more than " + (flat.far * 100).toFixed(2) + " percent of the part's size." + (flat.tangents ? " Tangents on those parts were dropped (the renderer rebuilds them)." : ""));
    else log.push("No crumpled flat areas were found.");
    if (flat.held) log.push(count(flat.held, "area that is", "areas that are") + " nearly flat but curved " + (flat.held === 1 ? "was" : "were") + " left alone.");
    if (flat.skipped) log.push(count(flat.skipped, "part") + " with a skeleton or morph targets " + (flat.skipped === 1 ? "was" : "were") + " not flattened.");
  }

  // 1a. windows, signs and doors: first, while every panel still has its full shape and its own
  // paint. Once each is its own part, the walls step leaves it alone and the triangle target holds
  // every edge between parts in place, so no seam can open.
  let windows = null;
  if (options.windowLights) {
    progress("Windows", 0.28);
    windows = await lightWindows(doc, buffer, env.codec, log);
  }

  // 1a. walls and roofs: before the surface steps, so the new texture is held to the same color standard
  let walls = null;
  if (WALL_KINDS.includes(options.walls)) {
    progress("Walls", 0.3);
    await stripeAwnings(doc, buffer, options, env.codec, log);
    walls = await retextureWalls(doc, buffer, options, env.codec, env.materials, log);
  }

  // 1b. surfaces: light painted into the color, and the maps a material is missing
  if (DELIGHT[options.delight] || RELIEF[options.surfaceMaps] || options.colorStandard) {
    progress("Surfaces", 0.33);
    await refineSurfaces(doc, options, env.codec, log);
  }

  // 2. animations
  if (options.dropAnimations && root.listAnimations().length) {
    const dropped = root.listAnimations().length;
    for (const anim of root.listAnimations()) anim.dispose();
    log.push("Dropped " + count(dropped, "animation") + ". The skeleton was kept.");
  }

  // 3. triangle target
  if (options.triangles && countTriangles(doc) > options.triangles * 1.01) {
    progress("Reducing triangles", 0.4);
    await MeshoptSimplifier.ready;
    const start = countTriangles(doc);
    const lock = root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0) > 1;
    let used = 0;
    for (const error of [0.001, 0.003, 0.01, 0.02]) {
      const now = countTriangles(doc);
      if (now <= options.triangles * 1.01) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: options.triangles / now, error, lockBorder: lock }));
      used = error;
    }
    // collapsing edges can leave slivers and repeats behind, so sweep once more
    scrubTriangles(doc, buffer);
    const end = countTriangles(doc);
    log.push("Reduced " + start + " triangles to " + end + ". The surface moved by at most " + (used * 100).toFixed(1) + " percent of the model size." + (lock ? " Edges between parts were held in place." : ""));
  }

  scrubTriangles(doc, buffer); // whatever the steps above left behind
  const vectors = repairVectors(doc);
  if (vectors.normals || vectors.tangents) log.push("Repaired " + count(vectors.normals, "normal") + " that had no length" + (vectors.tangents ? " and dropped " + count(vectors.tangents, "broken tangent set") + " (the renderer rebuilds them)" : "") + ".");

  // 4. turn, size, ground, center
  progress("Sizing and placing", 0.6);
  placeModel(doc, options, log);

  // 5. textures
  progress("Textures", 0.7);
  await fitTextures(doc, options, env.codec, log);

  // 6. write
  progress("Writing the file", 0.85);
  await doc.transform(dedup({ keepUniqueNames: true }), prune({ keepAttributes: true, keepLeaves: false, keepSolidTextures: true, keepExtras: true, keepIndices: true }));
  const compress = options.compress == null ? before.extensions.includes("EXT_meshopt_compression") : options.compress;
  if (compress) {
    await doc.transform(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    log.push("Geometry was compressed with Meshopt. The loader needs the Meshopt decoder.");
  }
  const out = await io.writeBinary(doc);

  // 7. measure the finished file, read back from its own bytes
  progress("Checking the finished file", 0.92);
  const check = await readModel(out);
  const after = measure(check, out.byteLength);
  await normalize(check);
  after.defects = findDefects(surfacesOf(check), Math.hypot(...after.size), false);
  after.detail = texelDensity(colorGroups(check).flatMap((g) => g.parts.map((part) => ({ ...part, width: g.size[0], height: g.size[1] }))));
  after.color = await colorOf(check, env.codec);
  if (WALL_KINDS.includes(options.walls)) after.walls = { ...(walls || { count: 0 }), ...wallsOf(check) };
  if (options.windowLights) after.windows = { ...(windows || { found: 0, lit: 0, signs: 0, doors: 0 }), ...glassOf(check) };
  let validation = null;
  if (env.validate) {
    try { validation = await env.validate(out); } catch (error) { validation = { failed: String(error && error.message || error) }; }
  }
  const checks = buildChecks(before, after, options, { holesLeft, validation });
  progress("Done", 1);
  return verdictOf({ before, after, bytes: out, log, checks, validation });
}

// Where two faces share their corners and face opposite ways (a thin fin, a two-sided leaf), no
// shared normal can be right for both. Those faces get corners of their own, lit from their own side.
function splitWrongFaces(prim, buffer, doc) {
  const indices = Uint32Array.from(prim.getIndices().getArray());
  const pos = prim.getAttribute("POSITION").getArray();
  const wrong = [];
  wrongNormals(pos, prim.getAttribute("NORMAL").getArray(), indices, wrong);
  if (!wrong.length) return 0;
  const count = prim.getAttribute("POSITION").getCount();
  const from = [];
  for (const t of wrong) for (let e = 0; e < 3; e++) { from.push(indices[t * 3 + e]); indices[t * 3 + e] = count + from.length - 1; }
  const grow = (acc) => {
    const size = acc.getElementSize(), src = acc.getArray();
    const dst = new src.constructor((count + from.length) * size);
    dst.set(src);
    for (let i = 0; i < from.length; i++) for (let k = 0; k < size; k++) dst[(count + i) * size + k] = src[from[i] * size + k];
    acc.setArray(dst);
  };
  for (const acc of prim.listAttributes()) grow(acc);
  for (const target of prim.listTargets()) for (const acc of target.listAttributes()) grow(acc);
  const p = prim.getAttribute("POSITION").getArray(), nor = prim.getAttribute("NORMAL").getArray();
  for (const t of wrong) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    for (const i of [a, b, c]) { nor[i] = x; nor[i + 1] = y; nor[i + 2] = z; }
  }
  prim.getAttribute("NORMAL").setArray(nor);
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer));
  return wrong.length;
}

// Walls and other big flat areas that came out crumpled are pressed onto their plane, and every
// corner on them gets the plane's normal, so the area is lit as one face. Where an area meets
// anything else the corners are copied, so the hard edge does not bend the light on either side.
// Parts that bend (a skeleton, morph targets) are left alone.
function flattenFlats(prim, buffer, doc, settings) {
  const stats = { areas: 0, triangles: 0, held: 0, far: 0, skipped: 0, tangents: 0 };
  if (prim.getAttribute("JOINTS_0") || prim.listTargets().length) { stats.skipped = 1; return stats; }
  const position = prim.getAttribute("POSITION");
  const indices = Uint32Array.from(prim.getIndices().getArray());
  const diag = diagOf(boundsOf(position.getArray()));
  const flats = findFlats(position.getArray(), indices, diag, settings);
  stats.held = flats.held;
  if (!flats.regions.length) return stats;
  if (!prim.getAttribute("NORMAL")) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(computeNormals(position.getArray(), indices)).setBuffer(buffer));

  const count = position.getCount();
  const none = flats.regions.length;
  const first = new Int32Array(count).fill(-1);
  const copies = new Map(), from = [];
  for (let t = 0; t < indices.length / 3; t++) {
    const k = flats.owner[t] < 0 ? none : flats.owner[t];
    for (let e = 0; e < 3; e++) {
      const v = indices[t * 3 + e];
      if (first[v] < 0) { first[v] = k; continue; }
      if (first[v] === k) continue;
      const key = v * (none + 1) + k;
      let copy = copies.get(key);
      if (copy === undefined) { copy = count + from.length; from.push(v); copies.set(key, copy); }
      indices[t * 3 + e] = copy;
    }
  }
  if (from.length) {
    for (const acc of prim.listAttributes()) {
      const size = acc.getElementSize(), src = acc.getArray();
      const dst = new src.constructor((count + from.length) * size);
      dst.set(src);
      for (let i = 0; i < from.length; i++) for (let c = 0; c < size; c++) dst[(count + i) * size + c] = src[from[i] * size + c];
      acc.setArray(dst);
    }
  }
  const nor = prim.getAttribute("NORMAL").getArray();
  for (const region of flats.regions) {
    for (const t of region.tris) for (let e = 0; e < 3; e++) {
      const i = indices[t * 3 + e] * 3;
      nor[i] = region.normal[0]; nor[i + 1] = region.normal[1]; nor[i + 2] = region.normal[2];
    }
    stats.triangles += region.tris.length;
  }
  prim.getAttribute("NORMAL").setArray(nor);
  const pos = position.getArray();
  const moved = flattenPositions(pos, indices, flats, diag);
  position.setArray(pos);
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer));
  if (prim.getAttribute("TANGENT")) { prim.setAttribute("TANGENT", null); stats.tangents = 1; }
  stats.areas = flats.regions.length;
  stats.far = diag > 0 ? moved.far / diag : 0;
  return stats;
}

// glTF requires every normal to have length 1 and every tangent to be a unit vector with a
// handedness of 1 or -1. Sources and edge collapses both leave a few that are not.
function repairVectors(doc) {
  let normals = 0, tangents = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const normal = prim.getAttribute("NORMAL");
      if (normal && prim.getMode() === TRIANGLES) {
        const arr = normal.getArray();
        let fresh = null, changed = false;
        for (let i = 0; i < arr.length; i += 3) {
          const len = Math.hypot(arr[i], arr[i + 1], arr[i + 2]);
          if (Math.abs(len - 1) < 0.005) continue;
          changed = true; normals++;
          if (len > 1e-4) { arr[i] /= len; arr[i + 1] /= len; arr[i + 2] /= len; continue; }
          if (!fresh) fresh = computeNormals(prim.getAttribute("POSITION").getArray(), indicesOf(prim));
          arr[i] = fresh[i]; arr[i + 1] = fresh[i + 1]; arr[i + 2] = fresh[i + 2];
        }
        if (changed) normal.setArray(arr);
      }
      const tangent = prim.getAttribute("TANGENT");
      if (tangent) {
        const arr = tangent.getArray();
        let bad = false;
        for (let i = 0; i < arr.length && !bad; i += 4) {
          bad = Math.abs(Math.hypot(arr[i], arr[i + 1], arr[i + 2]) - 1) > 0.005 || Math.abs(Math.abs(arr[i + 3]) - 1) > 1e-6;
        }
        if (bad) { prim.setAttribute("TANGENT", null); tangents++; }
      }
    }
  }
  return { normals, tangents };
}

// Drop triangles with no area and repeats. Used after a step that can create them.
function scrubTriangles(doc, buffer) {
  const box = sceneBounds(doc);
  const diag = Math.hypot(...box.size);
  let removed = 0;
  for (const s of surfacesOf(doc)) {
    const a = analyze(s.pos, s.indices, diag, 10);
    if (!a.nDegenerate && !a.nDuplicate) continue;
    const kept = [];
    for (let t = 0; t < a.tris; t++) if (a.island[t] >= 0) kept.push(s.indices[t * 3], s.indices[t * 3 + 1], s.indices[t * 3 + 2]);
    removed += a.nDegenerate + a.nDuplicate;
    if (!kept.length) { s.mesh.removePrimitive(s.prim); s.prim.dispose(); continue; }
    s.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(kept)).setBuffer(buffer));
    compactPrimitive(s.prim);
  }
  return removed;
}

function countTriangles(doc) {
  let n = 0;
  for (const node of meshNodes(doc)) for (const prim of node.getMesh().listPrimitives()) {
    if (prim.getMode() !== TRIANGLES) continue;
    const idx = prim.getIndices(), pos = prim.getAttribute("POSITION");
    n += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
  }
  return n;
}

function placeModel(doc, options, log) {
  const rotation = options.rotation && !isIdentity(options.rotation) ? options.rotation : null;
  const box = sceneBounds(doc, rotation);
  if (box.empty) return;
  let scale = 1;
  if (options.size && options.size.meters > 0) {
    const dims = { width: box.size[0], height: box.size[1], length: box.size[2], longest: Math.max(...box.size) };
    const dim = dims[options.size.axis] || dims.longest;
    if (dim > 1e-9) scale = options.size.meters / dim;
  }
  const tx = options.center ? -(box.min[0] + box.max[0]) / 2 * scale : 0;
  const ty = options.ground ? -box.min[1] * scale : 0;
  const tz = options.center ? -(box.min[2] + box.max[2]) / 2 * scale : 0;
  const r = rotation || IDENTITY;
  const fix = [r[0] * scale, r[1] * scale, r[2] * scale, 0, r[4] * scale, r[5] * scale, r[6] * scale, 0, r[8] * scale, r[9] * scale, r[10] * scale, 0, tx, ty, tz, 1];
  if (isIdentity(fix)) { log.push("Size and position were already right."); return; }

  const root = doc.getRoot();
  const scene = sceneOf(doc);
  const nodes = meshNodes(doc);
  const single = nodes.length === 1 && !root.listSkins().length && !root.listAnimations().length
    && root.listNodes().filter((n) => n.getMesh() === nodes[0].getMesh()).length === 1;
  if (single) {
    // one plain mesh: write the change into the vertices, so the object itself sits at the origin
    const node = nodes[0];
    transformMesh(node.getMesh(), mul(fix, node.getWorldMatrix()));
    scene.addChild(node);
    node.setMatrix(IDENTITY);
  } else {
    // several parts, a skeleton or animation: move the whole thing from one node on top,
    // so pivots, bones and animation keep working
    const tops = scene.listChildren();
    const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
    const animated = new Set(root.listAnimations().flatMap((a) => a.listChannels().map((c) => c.getTargetNode())));
    if (tops.length === 1 && !joints.has(tops[0]) && !animated.has(tops[0]) && !tops[0].getMesh()) {
      tops[0].setMatrix(mul(fix, tops[0].getMatrix()));
    } else {
      const top = doc.createNode("asset_root").setMatrix(fix);
      for (const node of tops) top.addChild(node);
      scene.addChild(top);
    }
  }
  const parts = [];
  if (rotation) parts.push("turned");
  if (Math.abs(scale - 1) > 1e-6) parts.push("scaled by " + scale.toFixed(4));
  if (options.ground) parts.push("set on the ground");
  if (options.center) parts.push("centered");
  log.push("The model was " + parts.join(", ") + "." + (single ? "" : " The change sits on one top node, so parts, bones and animation are untouched."));
}

const WALL_KINDS = ["auto", "stucco", "block", "brick"];
const WALLS = "walls";
// A wall worth its own texture is at least this share of the model's size, squared.
const WALL_AREA = 0.04;
// The height of one course, in meters: a concrete block with its joint, and a brick with its joint.
const WALL_BLOCK = 0.2, WALL_BRICK = 0.075;
// A smaller solid patch of wall (a pier, a band) still gets the clean texture.
const WALL_PATCH = 0.005;
// A triangle beside a wall joins it when a corner is this near the wall's plane and none is further than the second.
const WALL_ON = 0.003, WALL_CLOSE = 0.02;
// Paint that changes this much more going up a wall than along it has level courses. Measured: stucco 0.75 to 1.4, brick and block 1.6 to 4.2.
const WALL_GRAIN = 1.5;
// A roof slope: at least this much of it, and the raised tiles lie this close to its plane.
const ROOF_AREA = 0.02, ROOF_NEAR = 0.014;

// Move every large flat upright wall to a material of its own, with a new texture: one rectangle
// per wall at one even scale, the old paint smoothed down to its colors, and a sharp surface laid
// over it. Positions are not touched. See walls.js.
async function retextureWalls(doc, buffer, options, codec, materials, log) {
  if (!codec) { log.push("Walls: textures cannot be read on this device, so the walls were left as they are."); return null; }
  const box = sceneBounds(doc);
  const diag = Math.hypot(box.size[0], box.size[1], box.size[2]), tall = box.size[1], floor = box.min[1];
  const size = Math.min(options.maxTexture || 2048, 2048);
  // How many meters one unit of the model will be once it is sized, when a size was asked for.
  // With that, block, brick, tile and grain are laid at their real dimensions.
  let metersPerUnit = 0;
  if (options.size && options.size.meters > 0) {
    const dims = { width: box.size[0], height: box.size[1], length: box.size[2], longest: Math.max(box.size[0], box.size[1], box.size[2]) };
    const dim = dims[options.size.axis] || dims.longest;
    if (dim > 1e-9) metersPerUnit = options.size.meters / dim;
  }
  const found = [];
  let joined = 0;
  const pixels = new Map();
  for (const s of surfacesOf(doc)) {
    if (s.prim.getAttribute("JOINTS_0") || s.prim.listTargets().length) continue;
    const mat = s.prim.getMaterial();
    if (!mat || PART_NAMES.includes(mat.getName())) continue;
    const tex = mat.getBaseColorTexture(), info = mat.getBaseColorTextureInfo();
    const uvAcc = tex && s.prim.getAttribute("TEXCOORD_" + (info ? info.getTexCoord() : 0));
    if (!uvAcc || !s.prim.getAttribute("NORMAL")) continue;
    if (!pixels.has(tex)) {
      let decoded = null;
      try { decoded = await codec.decode(tex.getImage(), tex.getMimeType()); } catch (error) { decoded = null; }
      pixels.set(tex, decoded);
    }
    if (!pixels.get(tex)) continue;
    const base = { s, mat, src: pixels.get(tex), uvOld: uvAcc.getArray() };
    const taken = new Uint8Array(s.indices.length / 3);
    const extent = (tris, U, V) => {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const t of tris) for (let e = 0; e < 3; e++) {
        const i = s.indices[t * 3 + e] * 3, a = s.pos[i] * U[0] + s.pos[i + 1] * U[1] + s.pos[i + 2] * U[2], b = s.pos[i] * V[0] + s.pos[i + 1] * V[1] + s.pos[i + 2] * V[2];
        if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
      return { a0, a1, b0, b1, w: a1 - a0, h: b1 - b0 };
    };

    // walls: flat upright areas. A big one always counts. A small one counts when it is a solid
    // patch (a pier, a band of brick) and not a thin strip of trim or the ring of a frame.
    let eave = 0, eaveArea = 0;
    const first = found.length;
    const flats = findFlats(s.pos, s.indices, diag, { minShare: 0.0008 });
    const fronts = flats.regions.filter((region) => Math.abs(region.normal[1]) <= 0.2 && region.area >= WALL_AREA * diag * diag);
    flats.regions.forEach((region) => {
      const n = region.normal;
      if (Math.abs(n[1]) > 0.2) return;
      const len = Math.hypot(n[0], n[2]), U = [n[2] / len, 0, -n[0] / len], V = [0, 1, 0];
      const e = extent(region.tris, U, V);
      const big = region.area >= WALL_AREA * diag * diag;
      const patch = region.area >= WALL_PATCH * diag * diag && Math.min(e.w, e.h) >= 0.05 * diag && region.area / (e.w * e.h) >= 0.4;
      if (!big && !patch) return;
      // A door leaf is a solid upright patch too. It is tall, stands on the ground, and sits back
      // from the wall it is in. A pier is tall and on the ground but level with the wall.
      if (!big && e.h >= 1.3 * e.w && e.b0 - floor < 0.08 * tall && fronts.some((f) => f.normal[0] * n[0] + f.normal[2] * n[2] > 0.95 && f.d - region.d > 0.004 * diag)) return;
      for (const t of region.tris) taken[t] = 1;
      found.push({ ...base, ...e, kind: "wall", tris: region.tris, U, V, n, d: region.d });
      if (big) { eave += e.b1 * region.area; eaveArea += region.area; }
    });

    // A wall is taken whole. A generator leaves a wall in loose sheets: big triangles that share a
    // plane but not an edge, some lying over each other. The flat areas above follow edges, so they
    // take one sheet and leave the next, and the old paint then shows in long wedges across the new
    // wall. So every upright triangle left over that lies in a wall's plane, inside its outline,
    // joins that wall. Those that match no wall are gathered by plane, and a plane with enough
    // solid area is a wall too (the back wall of a porch).
    {
      const p = s.pos, on = WALL_ON * diag, pad = 0.03 * diag, loose = [];
      for (let t = 0; t < taken.length; t++) {
        if (taken[t]) continue;
        const i0 = s.indices[t * 3] * 3, i1 = s.indices[t * 3 + 1] * 3, i2 = s.indices[t * 3 + 2] * 3;
        const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
        if (!(len > 1e-7 * diag * diag) || Math.abs(ny) > 0.2 * len) continue;
        loose.push({ t, area: len / 2, n: [nx / len, ny / len, nz / len], at: [i0, i1, i2] });
      }
      loose.sort((q, r) => r.area - q.area);
      const lies = (tri, n, d) => {
        if (tri.n[0] * n[0] + tri.n[1] * n[1] + tri.n[2] * n[2] < 0.98) return false;
        for (const i of tri.at) if (Math.abs(p[i] * n[0] + p[i + 1] * n[1] + p[i + 2] * n[2] - d) > on) return false;
        return true;
      };
      const sheets = [];
      for (const tri of loose) {
        let home = null;
        for (let k = first; k < found.length && !home; k++) {
          const wall = found[k];
          if (!lies(tri, wall.n, wall.d)) continue;
          const e = extent([tri.t], wall.U, wall.V);
          if (e.a0 >= wall.a0 - pad && e.a1 <= wall.a1 + pad && e.b0 >= wall.b0 - pad && e.b1 <= wall.b1 + pad) home = wall;
        }
        if (home) { (home.more || (home.more = [])).push(tri.t); taken[tri.t] = 1; joined++; continue; }
        let sheet = sheets.find((q) => lies(tri, q.n, q.d));
        if (!sheet) sheets.push(sheet = { n: tri.n, d: p[tri.at[0]] * tri.n[0] + p[tri.at[0] + 1] * tri.n[1] + p[tri.at[0] + 2] * tri.n[2], tris: [], area: 0 });
        sheet.tris.push(tri.t); sheet.area += tri.area;
      }
      for (let k = first; k < found.length; k++) {
        const wall = found[k];
        if (!wall.more) continue;
        wall.tris = Int32Array.from([...wall.tris, ...wall.more]); wall.more = null;
        Object.assign(wall, extent(wall.tris, wall.U, wall.V));
      }
      for (const sheet of sheets) {
        if (sheet.area < WALL_PATCH * diag * diag || sheet.tris.length < 2) continue; // one triangle alone is not a wall
        const n = sheet.n, len = Math.hypot(n[0], n[2]), U = [n[2] / len, 0, -n[0] / len], V = [0, 1, 0];
        const e = extent(sheet.tris, U, V);
        if (Math.min(e.w, e.h) < 0.05 * diag || sheet.area / (e.w * e.h) < 0.4) continue;
        if (e.h >= 1.3 * e.w && e.b0 - floor < 0.08 * tall && fronts.some((f) => f.normal[0] * n[0] + f.normal[2] * n[2] > 0.95 && f.d - sheet.d > 0.004 * diag)) continue;
        for (const t of sheet.tris) taken[t] = 1;
        joined += sheet.tris.length;
        found.push({ ...base, ...e, kind: "wall", tris: Int32Array.from(sheet.tris), U, V, n, d: sheet.d });
      }
    }

    // A window that is only painted on, or set a hair into the wall, leaves triangles that reach
    // from the wall into it. They tilt, so they are in no plane. Each wall takes in the triangles
    // that touch it, face its way, start on its plane and stay close to it. Glass set back in a
    // frame has no corner on the wall's plane, and a frame's sides face across.
    if (found.length > first) {
      const { ids, unique } = weldIds(s.pos, diag * 1e-6);
      const across = new Map();
      for (let t = 0; t < taken.length; t++) for (let e = 0; e < 3; e++) {
        const a = ids[s.indices[t * 3 + e]], b = ids[s.indices[t * 3 + (e + 1) % 3]];
        if (a === b) continue;
        const key = a < b ? a * unique + b : b * unique + a, list = across.get(key);
        if (list) list.push(t); else across.set(key, [t]);
      }
      const on = WALL_ON * diag, close = WALL_CLOSE * diag, p = s.pos;
      for (let k = first; k < found.length; k++) {
        const wall = found[k], n = wall.n, tris = Array.from(wall.tris), had = tris.length;
        for (let head = 0; head < tris.length; head++) {
          const t = tris[head];
          for (let e = 0; e < 3; e++) {
            const a = ids[s.indices[t * 3 + e]], b = ids[s.indices[t * 3 + (e + 1) % 3]];
            if (a === b) continue;
            for (const u of across.get(a < b ? a * unique + b : b * unique + a)) {
              if (taken[u]) continue;
              const i0 = s.indices[u * 3] * 3, i1 = s.indices[u * 3 + 1] * 3, i2 = s.indices[u * 3 + 2] * 3;
              const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
              const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
              if (!(len > 0) || (nx * n[0] + ny * n[1] + nz * n[2]) / len < 0.9) continue;
              let touching = 0, far = false;
              for (const i of [i0, i1, i2]) {
                const off = Math.abs(p[i] * n[0] + p[i + 1] * n[1] + p[i + 2] * n[2] - wall.d);
                if (off > close) { far = true; break; }
                if (off <= on) touching++;
              }
              if (far || !touching) continue;
              taken[u] = 1;
              tris.push(u);
            }
          }
        }
        if (tris.length > had) { wall.tris = Int32Array.from(tris); Object.assign(wall, extent(tris, wall.U, wall.V)); joined += tris.length - had; }
      }
    }

    // roofs: sloping planes above the walls. A tiled roof is modeled with every tile raised, so no
    // part of it is flat. Each slope is found as the plane most of the upward surface lies near.
    const line = (eaveArea ? eave / eaveArea : floor + 0.45 * tall) - 0.04 * tall;
    const cand = [], area = new Float32Array(taken.length), cen = new Float32Array(taken.length * 3), up = new Float32Array(taken.length);
    for (let t = 0; t < taken.length; t++) {
      if (taken[t]) continue;
      const i0 = s.indices[t * 3] * 3, i1 = s.indices[t * 3 + 1] * 3, i2 = s.indices[t * 3 + 2] * 3, p = s.pos;
      const cy = (p[i0 + 1] + p[i1 + 1] + p[i2 + 1]) / 3;
      if (cy < line) continue;
      const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
      if (!(len > 0)) continue;
      area[t] = len / 2; up[t] = ny / len;
      cen[t * 3] = (p[i0] + p[i1] + p[i2]) / 3; cen[t * 3 + 1] = cy; cen[t * 3 + 2] = (p[i0 + 2] + p[i1 + 2] + p[i2 + 2]) / 3;
      cand.push(t);
    }
    // level surface is a flat roof or a slab, not a slope, and is left out of the search
    let pool = cand.filter((t) => up[t] > 0.2 && up[t] < 0.97);
    const near = ROOF_NEAR * diag;
    let seed = 12345;
    const pick = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
    for (let slope = 0; slope < 12 && pool.length > 50; slope++) {
      let best = null, bestArea = 0;
      for (let tries = 0; tries < 160; tries++) {
        const a = pool[pick(pool.length)] * 3, b = pool[pick(pool.length)] * 3, c = pool[pick(pool.length)] * 3;
        const ux = cen[b] - cen[a], uy = cen[b + 1] - cen[a + 1], uz = cen[b + 2] - cen[a + 2], vx = cen[c] - cen[a], vy = cen[c + 1] - cen[a + 1], vz = cen[c + 2] - cen[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (!(len > 1e-9)) continue;
        nx /= len; ny /= len; nz /= len;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        if (ny < 0.25 || ny > 0.95) continue;
        const d = nx * cen[a] + ny * cen[a + 1] + nz * cen[a + 2];
        let sum = 0;
        for (const t of pool) { const off = nx * cen[t * 3] + ny * cen[t * 3 + 1] + nz * cen[t * 3 + 2] - d; if (off < near && off > -near) sum += area[t]; }
        if (sum > bestArea) { bestArea = sum; best = [nx, ny, nz, d]; }
      }
      if (!best || bestArea < ROOF_AREA * diag * diag) break;
      const [nx, ny, nz, d] = best;
      const tris = [];
      for (const t of cand) {
        if (taken[t]) continue;
        const off = nx * cen[t * 3] + ny * cen[t * 3 + 1] + nz * cen[t * 3 + 2] - d;
        if (off < near && off > -near) { tris.push(t); taken[t] = 1; }
      }
      pool = pool.filter((t) => !taken[t]);
      const hl = Math.hypot(nx, nz), U = [nz / hl, 0, -nx / hl];
      const V = [-(ny * nx) / hl, hl, -(ny * nz) / hl]; // up the slope
      found.push({ ...base, ...extent(tris, U, V), kind: "roof", tris: Int32Array.from(tris), U, V, normal: [nx, ny, nz] });
    }
  }
  const wallCount = found.filter((f) => f.kind === "wall").length, roofCount = found.length - wallCount;
  if (!found.length) { log.push("Walls: no large flat upright wall or sloping roof was found, so nothing was changed. Turn on Flatten walls first if the walls are crumpled."); return null; }
  const pack = packWalls(found, size);
  if (!pack) { log.push("Walls: the walls could not be laid out in one texture. Nothing was changed."); return null; }
  const ppu = pack.ppu;

  // new vertices: a wall corner shared with a frame needs its own texture position here
  const bySurface = new Map();
  found.forEach((wall, k) => {
    wall.spot = pack.spots[k];
    let part = bySurface.get(wall.s);
    if (!part) bySurface.set(wall.s, part = { s: wall.s, mat: wall.mat, src: wall.src, uvOld: wall.uvOld, from: [], uvNew: [], face: [], out: [], indices: [], taken: new Uint8Array(wall.s.indices.length / 3) });
    const seen = new Map();
    for (const t of wall.tris) {
      part.taken[t] = 1;
      // On a roof the underside of a raised tile faces down. It keeps its own copy of each
      // corner, so it can be lit from its own side while the top is lit as the slope.
      let under = 0;
      if (wall.normal) {
        const p = wall.s.pos, i0 = wall.s.indices[t * 3] * 3, i1 = wall.s.indices[t * 3 + 1] * 3, i2 = wall.s.indices[t * 3 + 2] * 3;
        const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const facing = (nx * wall.normal[0] + ny * wall.normal[1] + nz * wall.normal[2]) / (Math.hypot(nx, ny, nz) || 1);
        under = facing < -0.3 ? 1 : facing < 0.3 ? 2 : 0; // 2: the edge of a tile, standing across the slope. It keeps the normals it had.
      }
      for (let e = 0; e < 3; e++) {
        const v = wall.s.indices[t * 3 + e];
        let at = seen.get(v * 3 + under);
        if (at === undefined) {
          at = part.from.length; seen.set(v * 3 + under, at); part.from.push(v);
          const p = wall.s.pos, a = p[v * 3] * wall.U[0] + p[v * 3 + 1] * wall.U[1] + p[v * 3 + 2] * wall.U[2], b = p[v * 3] * wall.V[0] + p[v * 3 + 1] * wall.V[1] + p[v * 3 + 2] * wall.V[2];
          part.uvNew.push((wall.spot.x + (a - wall.a0) * ppu) / size, (wall.spot.y + (wall.b1 - b) * ppu) / size);
          part.face.push(!wall.normal || under === 2 ? null : under ? [-wall.normal[0], -wall.normal[1], -wall.normal[2]] : wall.normal);
          part.out.push(wall.n ? p[v * 3] * wall.n[0] + p[v * 3 + 1] * wall.n[1] + p[v * 3 + 2] * wall.n[2] - wall.d : 0);
        }
        part.indices.push(at);
      }
    }
  });

  // 1. the old paint, copied across
  const paint = new Uint8Array(size * size * 4), mask = new Uint8Array(size * size);
  for (const part of bySurface.values()) {
    const old = new Float32Array(part.from.length * 2);
    part.from.forEach((v, i) => { old[i * 2] = part.uvOld[v * 2]; old[i * 2 + 1] = part.uvOld[v * 2 + 1]; });
    const wrote = copyPaint(paint, size, Float32Array.from(part.uvNew), old, Uint32Array.from(part.indices), part.src);
    for (let p = 0; p < wrote.length; p++) if (wrote[p]) mask[p] = 1;
    part.old = old;
  }
  // Again, now that each wall's usual color can be read: where two sheets of a wall lie on each
  // other, the pixel keeps the paint that is further from that color. See copyPaint.
  if (joined) {
    const usual = { owner: new Int16Array(size * size).fill(-1), color: new Float32Array(found.length * 3), depth: new Float32Array(size * size), near: 0.001 * diag, front: null };
    found.forEach((wall, k) => {
      if (wall.kind !== "wall") return;
      const { x, y, w, h } = wall.spot, tones = [[], [], []];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const p = (y + j) * size + x + i;
        usual.owner[p] = k;
        if (mask[p] && (j * w + i) % 5 === 0) { tones[0].push(paint[p * 4]); tones[1].push(paint[p * 4 + 1]); tones[2].push(paint[p * 4 + 2]); }
      }
      for (let c = 0; c < 3; c++) { tones[c].sort((p, q) => p - q); usual.color[k * 3 + c] = tones[c].length ? tones[c][tones[c].length >> 1] : 0; }
    });
    paint.fill(0);
    for (const part of bySurface.values()) { usual.front = Float32Array.from(part.out); copyPaint(paint, size, Float32Array.from(part.uvNew), part.old, Uint32Array.from(part.indices), part.src, usual); }
  }

  // 2. what are the walls made of? level courses in the old paint mean block or brick
  let kind = options.walls, course = 0;
  let coursed = 0, total = 0;
  const periods = [];
  for (const wall of found) {
    if (wall.kind !== "wall") continue;
    wall.courses = findCourses(paint, mask, size, wall.spot, 0.006 * tall * ppu, 0.2 * tall * ppu);
    total += wall.w * wall.h;
    // fine brick is too small to measure a course on, but its mortar lines still make the paint
    // change more going up the wall than along it. Plain paint is near 1 on that scale.
    if (!wall.courses && levelGrain(paint, mask, size, wall.spot) >= WALL_GRAIN) coursed += wall.w * wall.h;
    if (wall.courses) { coursed += wall.w * wall.h; periods.push(wall.courses.period); }
  }
  periods.sort((p, q) => p - q);
  const read = periods.length ? periods[periods.length >> 1] : 0;
  if (kind === "auto") {
    // courses on a quarter of the wall area is enough: a generator draws them crooked, and crooked
    // courses fade when a row is averaged. Red walls with courses are brick, any other color is block.
    let r = 0, b = 0;
    for (const wall of found) {
      if (wall.kind !== "wall") continue;
      const { x, y, w, h } = wall.spot;
      for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) { const p = (y + j) * size + x + i; if (mask[p]) { r += paint[p * 4]; b += paint[p * 4 + 2]; } }
    }
    kind = coursed >= total * 0.25 ? (r > 1.3 * b ? "brick" : "block") : "stucco";
  }
  // one course: 0.2 m for block and 0.075 m for brick when the real size is known, else what the
  // old paint showed, else a guess from the model's height
  const pxPerMeter = metersPerUnit ? ppu / metersPerUnit : 0;
  if (kind !== "stucco") course = pxPerMeter ? (kind === "brick" ? WALL_BRICK : WALL_BLOCK) * pxPerMeter : read || (kind === "brick" ? 0.035 : 0.11) * tall * ppu;
  const brickCourse = pxPerMeter ? WALL_BRICK * pxPerMeter : course / 3;

  // Scanned surfaces, laid at true size. They need the real size of the building, and a device
  // that can fetch them. Without either, the surface is made here instead.
  const scans = {};
  if (materials && pxPerMeter) {
    for (const name of new Set([wallCount ? kind : null, wallCount && kind === "block" ? "brick" : null, roofCount ? "roof" : null])) {
      // block is drawn, not scanned: its courses read clean and crisp at street distance, where the
      // scan's are faint. Stucco, brick and roof tile use the scans.
      if (!name || name === "block") continue;
      let scan = null;
      try { scan = await materials(name); } catch (error) { scan = null; }
      if (!scan || !scan.color || !scan.normal || !scan.roughness) continue;
      const px = Math.max(16, Math.min(2048, Math.round(scan.meters * pxPerMeter)));
      const fit = (img) => (img.width === px && img.height === px ? img.rgba : resizeRgba(img.rgba, img.width, img.height, px, px));
      scans[name] = { px, color: fit(scan.color), normal: fit(scan.normal), rough: fit(scan.roughness), mean: meanColor(scan.color) };
    }
  }

  // 3. the new surface, tinted by the old paint's colors
  const color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4), high = new Float32Array(size * size).fill(0.5), rough = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) { rough[p * 4] = 255; rough[p * 4 + 1] = 224; rough[p * 4 + 3] = 255; color[p * 4 + 3] = 255; }
  const drawn = new Uint8Array(size * size), scanned = new Uint8Array(size * size);
  // the soft mottle of a wall is about a quarter of a meter across
  const cell = Math.max(2, Math.round(0.008 * diag * ppu)), grainPx = Math.max(8, pxPerMeter ? 0.25 * pxPerMeter : 0.02 * tall * ppu);
  const at = [0, 0, 0];
  let kept = 0;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  found.forEach((wall, k) => {
    const { x, y, w, h } = wall.spot;
    const flat = colorOnly(paint, mask, size, wall.spot, cell);
    const phase = wall.courses ? wall.courses.phase : 0;
    const roof = wall.kind === "roof";
    // Something painted on a wall with no step in the mesh (a window, a vent, a door) cannot be
    // split off. Smoothing would smear it into a blot, so wherever the wall is far darker than its
    // own usual color the old paint is kept as it was, with a margin for the frame.
    let keep = null, soft = null;
    if (!roof) {
      const lum = new Float32Array(w * h), sample = [];
      for (let q = 0; q < w * h; q++) { lum[q] = 0.3 * flat[q * 3] + 0.59 * flat[q * 3 + 1] + 0.11 * flat[q * 3 + 2]; if (q % 7 === 0) sample.push(lum[q]); }
      sample.sort((p, q) => p - q);
      const usual = sample[sample.length >> 1] || 0;
      const dark = new Uint8Array(w * h);
      let any = 0;
      for (let q = 0; q < w * h; q++) if (lum[q] < 0.55 * usual) { dark[q] = 1; any++; }
      if (any) {
        const reach = Math.max(3, Math.round(pxPerMeter ? 0.12 * pxPerMeter : cell * 3));
        const wide = new Uint8Array(w * h);
        for (let j = 0; j < h; j++) { let run = -1e9; for (let i = 0; i < w; i++) { if (dark[j * w + i]) run = i; if (i - run <= reach) wide[j * w + i] = 1; } run = 1e9; for (let i = w - 1; i >= 0; i--) { if (dark[j * w + i]) run = i; if (run - i <= reach) wide[j * w + i] = 1; } }
        keep = new Uint8Array(w * h);
        for (let i = 0; i < w; i++) { let run = -1e9; for (let j = 0; j < h; j++) { if (wide[j * w + i]) run = j; if (j - run <= reach) keep[j * w + i] = 1; } run = 1e9; for (let j = h - 1; j >= 0; j--) { if (wide[j * w + i]) run = j; if (run - j <= reach) keep[j * w + i] = 1; } }
      }
      // A painted window can be pale and a painted door is brown, so darkness alone misses them and
      // they come out half kept and half smeared. Look again in coarse squares for solid blocks of
      // paint that is not the wall's color, half a meter or so each way. Such a block is
      // kept whole, as a rectangle, or not at all. A stain is a streak or a blot, not a block.
      const step = Math.max(2, Math.round(pxPerMeter ? 0.04 * pxPerMeter : cell)), gw = Math.ceil(w / step), gh = Math.ceil(h / step);
      if (gw >= 6 && gh >= 6) {
        const mean = new Float32Array(gw * gh * 3), have = new Uint8Array(gw * gh), ls = [], ts = [];
        for (let gj = 0; gj < gh; gj++) for (let gi = 0; gi < gw; gi++) {
          let r = 0, g = 0, b = 0, m = 0;
          for (let j = gj * step; j < Math.min(h, gj * step + step); j++) for (let i = gi * step; i < Math.min(w, gi * step + step); i++) {
            const p = (y + j) * size + x + i;
            if (mask[p]) { r += paint[p * 4]; g += paint[p * 4 + 1]; b += paint[p * 4 + 2]; m++; }
          }
          if (m * 2 < step * step) continue;
          const q = gj * gw + gi;
          have[q] = 1; mean[q * 3] = r / m; mean[q * 3 + 1] = g / m; mean[q * 3 + 2] = b / m;
          const l = 0.3 * mean[q * 3] + 0.59 * mean[q * 3 + 1] + 0.11 * mean[q * 3 + 2];
          ls.push(l); ts.push((mean[q * 3] - mean[q * 3 + 2]) / (l + 1));
        }
        if (ls.length > 30) {
          ls.sort((p, q) => p - q); ts.sort((p, q) => p - q);
          const midL = ls[ls.length >> 1], midT = ts[ts.length >> 1];
          // A wall painted in two bands has two usual colors, so each level row is judged against
          // its own: the lower band is not a block, and neither is the grime along the ground.
          const rowL = new Float32Array(gh).fill(midL), rowT = new Float32Array(gh).fill(midT);
          for (let j = 0; j < gh; j++) {
            const l = [], t = [];
            for (let i = 0; i < gw; i++) { const q = j * gw + i; if (!have[q]) continue; const v = 0.3 * mean[q * 3] + 0.59 * mean[q * 3 + 1] + 0.11 * mean[q * 3 + 2]; l.push(v); t.push((mean[q * 3] - mean[q * 3 + 2]) / (v + 1)); }
            if (l.length < 8) continue;
            l.sort((p, q) => p - q); t.sort((p, q) => p - q);
            rowL[j] = l[l.length >> 1]; rowT[j] = t[t.length >> 1];
          }
          const least = Math.max(3, Math.round((pxPerMeter ? 0.45 * pxPerMeter : 0.1 * tall * ppu) / step)), margin = Math.max(4, Math.round(pxPerMeter ? 0.15 * pxPerMeter : 3 * cell));
          // twice: once for anything off the wall's color, and once for what is far off it only,
          // because on a stained wall the stains run a window, a door and the ground into one mass
          for (const [dim, warm, cool] of [[0.82, 0.25, 0.09], [0.66, 0.32, 0.16]]) {
          const odd = new Uint8Array(gw * gh);
          for (let q = 0; q < gw * gh; q++) {
            if (!have[q]) continue;
            const l = 0.3 * mean[q * 3] + 0.59 * mean[q * 3 + 1] + 0.11 * mean[q * 3 + 2];
            const row = (q / gw) | 0, tone = (mean[q * 3] - mean[q * 3 + 2]) / (l + 1) - rowT[row]; // warmer or cooler than the wall
            // cooler and no brighter is glass. Cooler and brighter is a pale patch of the wall itself.
            if (l < dim * rowL[row] || tone > warm || (tone < -cool && l < 0.95 * rowL[row])) odd[q] = 1;
          }
          // close the gaps a pale curtain or a door panel leaves inside a block: grow by two squares, shrink by two
          for (let pass = 0; pass < 4; pass++) {
            const grow = pass < 2, from = Uint8Array.from(odd);
            for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
              const q = j * gw + i;
              if (grow) { if (!from[q] && ((i > 0 && from[q - 1]) || (i < gw - 1 && from[q + 1]) || (j > 0 && from[q - gw]) || (j < gh - 1 && from[q + gw]))) odd[q] = 1; }
              else if (from[q] && ((i > 0 && !from[q - 1]) || (i < gw - 1 && !from[q + 1]) || (j > 0 && !from[q - gw]) || (j < gh - 1 && !from[q + gw]))) odd[q] = 0;
            }
          }
          const stack = [];
          for (let q0 = 0; q0 < gw * gh; q0++) {
            if (odd[q0] !== 1) continue;
            let i0 = gw, i1 = -1, j0 = gh, j1 = -1, n = 0;
            stack.push(q0); odd[q0] = 2;
            while (stack.length) {
              const q = stack.pop(), i = q % gw, j = (q - i) / gw;
              n++; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
              if (i > 0 && odd[q - 1] === 1) { odd[q - 1] = 2; stack.push(q - 1); }
              if (i < gw - 1 && odd[q + 1] === 1) { odd[q + 1] = 2; stack.push(q + 1); }
              if (j > 0 && odd[q - gw] === 1) { odd[q - gw] = 2; stack.push(q - gw); }
              if (j < gh - 1 && odd[q + gw] === 1) { odd[q + gw] = 2; stack.push(q + gw); }
            }
            const bw = i1 - i0 + 1, bh = j1 - j0 + 1;
            if (bw < least || bh < least || n < 0.4 * bw * bh || bw * bh > 0.5 * gw * gh) continue;
            // kept in full to just past its edge, then faded into the new wall, so no hard outline shows
            if (!soft) soft = new Float32Array(w * h);
            const x0 = i0 * step - margin, x1 = (i1 + 1) * step + margin - 1, y0 = j0 * step - margin, y1 = (j1 + 1) * step + margin - 1, fade = 0.8 * margin;
            for (let j = Math.max(0, y0); j <= Math.min(h - 1, y1); j++) for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) {
              const edge = Math.min(i - x0, x1 - i, j - y0, y1 - j) + 1, share = edge >= fade ? 1 : edge / fade;
              if (share > soft[j * w + i]) soft[j * w + i] = share;
            }
          }
          }
        }
      }
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const share = keep && keep[j * w + i] ? 1 : soft ? soft[j * w + i] : 0;
      if (share >= 1) {
        const p = (y + j) * size + x + i;
        if (mask[p]) { color[p * 4] = paint[p * 4]; color[p * 4 + 1] = paint[p * 4 + 1]; color[p * 4 + 2] = paint[p * 4 + 2]; drawn[p] = 1; kept++; }
        continue;
      }
      const r = flat[(j * w + i) * 3], g = flat[(j * w + i) * 3 + 1], b = flat[(j * w + i) * 3 + 2];
      // on a block wall, the parts painted brick red get brick: three courses to each block course
      const bricky = !roof && kind === "block" && r > 1.3 * b && r > 1.12 * g;
      const name = roof ? "roof" : bricky ? "brick" : kind;
      const p = (y + j) * size + x + i;
      const scan = scans[name];
      if (scan) {
        // each wall starts the scan at a different place, so neighbors do not repeat each other
        const q = (((j + k * 131) % scan.px) * scan.px + ((i + k * 517) % scan.px)) * 4;
        // The scan gives the light and dark of the surface. Its own colors come through only a
        // third: a red brick scan under yellow paint would otherwise turn green and orange brick by brick.
        // The brick scan is of old, burnt brick, black next to cream. Its swing is eased so a wall reads as one wall.
        const raw = (0.3 * scan.color[q] + 0.59 * scan.color[q + 1] + 0.11 * scan.color[q + 2]) / (0.3 * scan.mean[0] + 0.59 * scan.mean[1] + 0.11 * scan.mean[2]);
        const sl = name === "brick" ? Math.pow(raw, 0.55) : raw;
        const shade = (c, paintC) => clamp(paintC * Math.min(3, sl * (1 + 0.35 * (scan.color[q + c] / scan.mean[c] / (sl || 1) - 1))));
        color[p * 4] = shade(0, r); color[p * 4 + 1] = shade(1, g); color[p * 4 + 2] = shade(2, b);
        normal[p * 4] = scan.normal[q]; normal[p * 4 + 1] = scan.normal[q + 1]; normal[p * 4 + 2] = scan.normal[q + 2]; normal[p * 4 + 3] = 255;
        rough[p * 4 + 1] = scan.rough[q];
        scanned[p] = 1;
      } else {
        surfaceAt(roof ? "brick" : name, i + (bricky ? 0 : k * 977), j, grainPx, roof ? brickCourse * 2 : bricky ? brickCourse : course, phase, 11 + k, at);
        // the same mottle shows more on pale paint than on dark, so pale stucco gets less of it
        const tint = name === "stucco" ? 1 + (at[0] - 1) * Math.max(0.4, Math.min(1, 1.25 - (0.3 * r + 0.59 * g + 0.11 * b) / 255)) : at[0];
        color[p * 4] = clamp(r * tint); color[p * 4 + 1] = clamp(g * tint); color[p * 4 + 2] = clamp(b * tint);
        high[p] = at[1];
        rough[p * 4 + 1] = clamp(Math.round(at[2] * 255));
      }
      if (share > 0 && mask[p]) for (let c = 0; c < 3; c++) color[p * 4 + c] = Math.round(color[p * 4 + c] * (1 - share) + paint[p * 4 + c] * share);
      drawn[p] = 1;
    }
  });
  spreadEdges(color, drawn, size, 6);
  const made = normalsFrom(high, size, kind === "stucco" ? 0.8 : 2.4);
  for (let p = 0; p < size * size; p++) if (!scanned[p]) { normal[p * 4] = made[p * 4]; normal[p * 4 + 1] = made[p * 4 + 1]; normal[p * 4 + 2] = made[p * 4 + 2]; normal[p * 4 + 3] = 255; }

  const save = async (rgba, name) => {
    const saved = await encodePixels(rgba, size, size, "image/jpeg", { ...options, textureFormat: options.textureFormat === "webp" ? "webp" : "keep" }, codec);
    if (!saved) return null;
    const tex = doc.createTexture(name).setImage(saved.bytes).setMimeType(saved.mime);
    if (saved.mime === "image/webp") doc.createExtension(EXTTextureWebP).setRequired(true);
    return tex;
  };
  const texColor = await save(color, "walls_color"), texNormal = await save(normal, "walls_normal"), texRough = await save(rough, "walls_roughness");
  if (!texColor || !texNormal || !texRough) { log.push("Walls: the new texture could not be written on this device. Nothing was changed."); return null; }

  // 4. the walls and roofs become a part of their own
  const mats = new Map();
  for (const part of bySurface.values()) {
    const { s } = part;
    if (!mats.has(part.mat)) mats.set(part.mat, part.mat.clone().setName(WALLS).setBaseColorTexture(texColor).setNormalTexture(texNormal).setMetallicRoughnessTexture(texRough).setRoughnessFactor(1).setMetallicFactor(0).setEmissiveTexture(null).setOcclusionTexture(null));
    const prim = doc.createPrimitive().setMaterial(mats.get(part.mat));
    for (const semantic of ["POSITION", "NORMAL"]) {
      const src = s.prim.getAttribute(semantic), arr = src.getArray(), width = src.getElementSize();
      const out = new Float32Array(part.from.length * width);
      part.from.forEach((v, i) => { for (let c = 0; c < width; c++) out[i * width + c] = arr[v * width + c]; });
      // a roof slope is lit as one plane: its tiles come from the normal map now, not from every
      // raised tile catching the light its own way. Positions stay, so the eaves keep their shape.
      if (semantic === "NORMAL") {
        // the slope's normal is in world space. The part's own space is the node's matrix away.
        const m = s.node.getWorldMatrix();
        part.face.forEach((n, i) => {
          if (!n) return;
          const x = m[0] * n[0] + m[1] * n[1] + m[2] * n[2], y = m[4] * n[0] + m[5] * n[1] + m[6] * n[2], z = m[8] * n[0] + m[9] * n[1] + m[10] * n[2];
          const l = Math.hypot(x, y, z) || 1;
          out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
        });
      }
      prim.setAttribute(semantic, doc.createAccessor().setType(src.getType()).setArray(out).setBuffer(buffer));
    }
    prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(Float32Array.from(part.uvNew)).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(part.indices)).setBuffer(buffer));
    s.mesh.addPrimitive(prim);
    const rest = [];
    for (let t = 0; t < part.taken.length; t++) if (!part.taken[t]) rest.push(s.indices[t * 3], s.indices[t * 3 + 1], s.indices[t * 3 + 2]);
    // a part that was nothing but walls has no triangles left: an empty part is not valid glTF
    if (rest.length) {
      s.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(rest)).setBuffer(buffer));
      // A handful of faces lit from the wrong side pass unseen in a whole building. With the walls
      // and roof gone they are a larger share of what is left, so they are put right here.
      const normal = s.prim.getAttribute("NORMAL");
      if (options.fixNormals && normal && wrongNormals(s.prim.getAttribute("POSITION").getArray(), normal.getArray(), Uint32Array.from(rest)) > rest.length / 3 * 0.02) splitWrongFaces(s.prim, buffer, doc);
    } else s.mesh.removePrimitive(s.prim);
  }
  const named = kind === "stucco" ? "stucco" : kind === "brick" ? "brick" : "block";
  const usedScans = Object.keys(scans);
  log.push("Walls: " + count(wallCount, "wall") + (roofCount ? " and " + count(roofCount, "roof slope") : "") + " moved to a " + size + " px texture of their own, one rectangle each at one even scale. The old paint was smoothed to its colors (stains, bands and corners stay, thin lines and creases go) and a new " + named + " surface was laid over it" + (kind === "stucco" ? "" : pxPerMeter ? ", with courses at their real height (" + (kind === "brick" ? "75 mm" : "200 mm") + ") for the size asked for" : read ? ", with courses where the old paint had them" : "") + ". Material " + WALLS + ". Nothing was moved.");
  if (usedScans.length) log.push("Surfaces are scanned photographs (" + usedScans.join(", ") + ") laid at true size and tinted to the old paint.");
  else if (materials && !pxPerMeter) log.push("Set a Size to get scanned stucco, block, brick and roof tile at true scale. Without one the surface is drawn here instead.");
  if (kept) log.push("Where a wall is far darker than its own usual color (a window, vent or door that is only painted on, with no step in the mesh) the old paint was kept as it was, so it is not smeared. A solid block of other paint half a meter or more across (a pale window, a brown door) is kept whole the same way and faded into the new wall at its edge.");
  if (joined) log.push("Walls taken whole: " + count(joined, "loose triangle") + " that lay in a wall's plane or reached from it into a painted window joined that wall, so no wedge of old paint is left across it. Where two sheets of a wall lay on each other, the one in front shows.");
  if (roofCount) log.push("Roof: each slope is lit as one plane and its tiles come from the texture. The raised tiles of the mesh stay in place, so the eaves keep their shape.");
  return { count: found.length, walls: wallCount, roofs: roofCount, kind: named, size, scans: usedScans };
}

// What the finished file holds as walls: triangles, and how many texture pixels cover a meter of them.
function wallsOf(doc) {
  const parts = [];
  let tris = 0;
  for (const s of surfacesOf(doc)) {
    const mat = s.prim.getMaterial();
    if (!mat || mat.getName() !== WALLS || !mat.getBaseColorTexture()) continue;
    const uv = s.prim.getAttribute("TEXCOORD_0"), sz = mat.getBaseColorTexture().getSize();
    if (!uv || !sz) continue;
    tris += s.indices.length / 3;
    parts.push({ pos: s.pos, uv: Float32Array.from(uv.getArray()), indices: s.indices, width: sz[0], height: sz[1] });
  }
  const d = parts.length ? texelDensity(parts) : null;
  return { tris, density: d ? d.median : 0, stretched: d ? d.stretched : 0 };
}

// The warm light of a lit room, as an emissive color.
const WINDOW_GLOW = [1, 0.74, 0.45];
const WINDOW_LIT = "windows_lit", WINDOW_DARK = "windows_dark", SIGN_LIT = "sign_lit", DOOR = "door";
const AWNING = "awning";
const PART_NAMES = [WINDOW_LIT, WINDOW_DARK, SIGN_LIT, DOOR, "walls", AWNING];

// Find the window glass on every unskinned part and move it to two materials of its own: one for
// rooms with a light on, one for rooms without. Vertices are shared with the wall, so nothing
// moves and no seam opens. The game can then switch the lit material on at night.
// A striped shop awning is drawn again with straight, even stripes in its own colors. See awnings.js.
async function stripeAwnings(doc, buffer, options, codec, log) {
  if (!codec) return 0;
  const box = sceneBounds(doc);
  const diag = Math.hypot(box.size[0], box.size[1], box.size[2]), tall = box.size[1], floor = box.min[1];
  let metersPerUnit = 0;
  if (options.size && options.size.meters > 0) {
    const dims = { width: box.size[0], height: box.size[1], length: box.size[2], longest: Math.max(box.size[0], box.size[1], box.size[2]) };
    const dim = dims[options.size.axis] || dims.longest;
    if (dim > 1e-9) metersPerUnit = options.size.meters / dim;
  }
  const pixels = new Map();
  let done = 0, colorsUsed = 0;
  for (const s of surfacesOf(doc)) {
    if (s.prim.getAttribute("JOINTS_0") || s.prim.listTargets().length) continue;
    const mat = s.prim.getMaterial();
    if (!mat || PART_NAMES.includes(mat.getName())) continue;
    const tex = mat.getBaseColorTexture(), info = mat.getBaseColorTextureInfo();
    const acc = tex && s.prim.getAttribute("TEXCOORD_" + (info ? info.getTexCoord() : 0));
    if (!acc || !s.prim.getAttribute("NORMAL")) continue;
    if (!pixels.has(tex)) {
      let decoded = null;
      try { decoded = await codec.decode(tex.getImage(), tex.getMimeType()); } catch (error) { decoded = null; }
      pixels.set(tex, decoded);
    }
    const img = pixels.get(tex);
    if (!img) continue;
    const uv = acc.getArray(), idx = s.indices, p = s.pos;
    const at = (u, v) => (Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height))) * img.width + Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)))) * 4;
    const taken = new Uint8Array(idx.length / 3);
    let any = false;
    for (const awning of findAwnings(p, idx, diag, floor, tall)) {
      // its paint, read all over the top face
      const samples = [];
      for (const t of awning.top) {
        const a = idx[t * 3] * 2, b = idx[t * 3 + 1] * 2, c = idx[t * 3 + 2] * 2;
        // spread evenly over the triangle, and more of them when the top is only a few big triangles
        for (let k = 0, per = Math.max(7, Math.ceil(300 / awning.top.length)); k < per; k++) {
          let x = ((k + 0.5) * 0.6180339887) % 1, y = (k + 0.5) / per;
          if (x + y > 1) { x = 1 - x; y = 1 - y; }
          const z = 1 - x - y, o = at(x * uv[a] + y * uv[b] + z * uv[c], x * uv[a + 1] + y * uv[b + 1] + z * uv[c + 1]);
          samples.push([img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]]);
        }
      }
      const colors = stripeColors(samples);
      if (!colors) continue;
      // the whole width in one strip of texture, 16 pixels or more a stripe, so nothing depends on
      // how a game engine tiles a texture
      const width = awning.a1 - awning.a0, n = stripeCount(width, metersPerUnit ? 0.2 / metersPerUnit : width / 15, colors.length), repeat = width;
      let tw = 64;
      while (tw < n * 16 && tw < Math.min(options.maxTexture || 2048, 2048)) tw *= 2;
      const th = 4, rgba = new Uint8Array(tw * th * 4);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) rgba.set([...colors[Math.min(n - 1, Math.floor((x + 0.5) / tw * n)) % colors.length], 255], (y * tw + x) * 4);
      const encoded = await encodePixels(rgba, tw, th, "image/png", { ...options, textureFormat: "png" }, codec);
      if (!encoded) continue;
      const cloth = mat.clone().setName(AWNING).setBaseColorTexture(doc.createTexture(AWNING + "_color").setImage(encoded.bytes).setMimeType(encoded.mime))
        .setBaseColorFactor([1, 1, 1, 1]).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0])
        .setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true);
      // every corner gets its place across the width. A side panel, which faces along the width, is striped along its depth.
      const from = [], uvNew = [], indices = [];
      let d0 = Infinity;
      for (const t of awning.tris) for (let e = 0; e < 3; e++) { const v = idx[t * 3 + e] * 3; d0 = Math.min(d0, p[v] * awning.out[0] + p[v + 2] * awning.out[1]); }
      for (const t of awning.tris) {
        const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
        const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz) || 1;
        const side = Math.abs(nx * awning.along[0] + nz * awning.along[1]) / len > 0.7;
        for (const i of [i0, i1, i2]) {
          const u = Math.min(0.999, Math.max(0.001, side ? (p[i] * awning.out[0] + p[i + 2] * awning.out[1] - d0) / repeat : (p[i] * awning.along[0] + p[i + 2] * awning.along[1] - awning.a0) / repeat));
          indices.push(from.length); from.push(i / 3); uvNew.push(u, 0.5);
        }
        taken[t] = 1;
      }
      const prim = doc.createPrimitive().setMaterial(cloth);
      for (const semantic of ["POSITION", "NORMAL"]) {
        const src = s.prim.getAttribute(semantic), arr = src.getArray(), out = new Float32Array(from.length * 3);
        from.forEach((v, i) => { out[i * 3] = arr[v * 3]; out[i * 3 + 1] = arr[v * 3 + 1]; out[i * 3 + 2] = arr[v * 3 + 2]; });
        prim.setAttribute(semantic, doc.createAccessor().setType("VEC3").setArray(out).setBuffer(buffer));
      }
      prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(Float32Array.from(uvNew)).setBuffer(buffer));
      prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(indices)).setBuffer(buffer));
      s.mesh.addPrimitive(prim);
      any = true; done++; colorsUsed = new Set(colors).size;
    }
    if (!any) continue;
    const rest = [];
    for (let t = 0; t < taken.length; t++) if (!taken[t]) rest.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    if (rest.length) s.prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(rest)).setBuffer(buffer));
    else s.mesh.removePrimitive(s.prim);
  }
  if (done) log.push("Awnings: " + count(done, "striped awning") + " drawn again with straight, even stripes in " + (done === 1 ? "its own " + colorsUsed + " colors" : "their own colors") + ", running down the slope (material " + AWNING + "). A generator's stripes wander and tear, and stripes are where that shows.");
  return done;
}

async function lightWindows(doc, buffer, codec, log) {
  if (!codec) { log.push("Windows: textures cannot be read on this device, so glass could not be told from painted doors. Nothing was changed."); return null; }
  const box = sceneBounds(doc);
  const diag = Math.hypot(box.size[0], box.size[1], box.size[2]);
  const pixels = new Map(), glass = new Map();
  let found = 0, lit = 0, unread = 0, signs = 0, doors = 0;
  for (const s of surfacesOf(doc)) {
    if (s.prim.getAttribute("JOINTS_0") || s.prim.listTargets().length) continue;
    const mat = s.prim.getMaterial();
    if (!mat || PART_NAMES.includes(mat.getName())) continue;
    const tex = mat.getBaseColorTexture();
    const info = mat.getBaseColorTextureInfo();
    const acc = tex && s.prim.getAttribute("TEXCOORD_" + (info ? info.getTexCoord() : 0));
    if (!acc) continue;
    if (!pixels.has(tex)) {
      let decoded = null;
      try { decoded = await codec.decode(tex.getImage(), tex.getMimeType()); } catch (error) { decoded = null; }
      pixels.set(tex, decoded);
    }
    const img = pixels.get(tex);
    if (!img) { unread++; continue; }
    const uv = acc.getArray(), idx = s.indices, w = img.width, h = img.height, rgba = img.rgba;
    const at = (u, v) => (Math.min(h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * h))) * w + Math.min(w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * w)))) * 4;
    const out = [0, 0, 0];
    // the color of a triangle: its middle and a point toward each corner
    const colorOf = (t) => {
      const a = idx[t * 3] * 2, b = idx[t * 3 + 1] * 2, c = idx[t * 3 + 2] * 2;
      let r = 0, g = 0, bl = 0;
      for (let k = 0; k < 4; k++) {
        const x = k === 1 ? 0.6 : k ? 0.2 : 1 / 3, y = k === 2 ? 0.6 : k ? 0.2 : 1 / 3, z = 1 - x - y;
        const o = at(x * uv[a] + y * uv[b] + z * uv[c], x * uv[a + 1] + y * uv[b + 1] + z * uv[c + 1]);
        r += LINEAR[rgba[o]]; g += LINEAR[rgba[o + 1]]; bl += LINEAR[rgba[o + 2]];
      }
      out[0] = r / 4; out[1] = g / 4; out[2] = bl / 4;
      return out;
    };
    const res = findWindows(s.pos, idx, diag, colorOf);
    if (!res.windows.length && !res.signs.length && !res.doors.length) continue;
    const on = litPattern(res.windows);
    const mark = new Uint8Array(idx.length / 3);
    for (const door of res.doors) for (const t of door.tris) mark[t] = 4;
    for (const sign of res.signs) for (const t of sign.tris) mark[t] = 3;
    res.windows.forEach((win, i) => { for (const t of win.tris) mark[t] = on[i] ? 1 : 2; });
    signs += res.signs.length; doors += res.doors.length;
    const lists = [[], [], [], [], []];
    for (let t = 0; t < mark.length; t++) lists[mark[t]].push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    if (!glass.has(mat)) {
      const pane = (name, glow) => {
        const m = mat.clone().setName(name).setEmissiveTexture(null).setEmissiveFactor(glow).setNormalTexture(null).setRoughnessFactor(Math.min(mat.getRoughnessFactor(), 0.25));
        return m;
      };
      // a sign glows with its own paint. A door is only named, so a game can find it.
      const sign = mat.clone().setName(SIGN_LIT).setEmissiveTexture(mat.getBaseColorTexture()).setEmissiveFactor([1, 1, 1]);
      if (sign.getEmissiveTextureInfo() && info) sign.getEmissiveTextureInfo().setTexCoord(info.getTexCoord());
      glass.set(mat, [null, pane(WINDOW_LIT, WINDOW_GLOW), pane(WINDOW_DARK, [0, 0, 0]), sign, mat.clone().setName(DOOR)]);
    }
    const accessor = (list) => doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(list)).setBuffer(buffer);
    for (const k of [1, 2, 3, 4]) {
      if (!lists[k].length) continue;
      s.mesh.addPrimitive(s.prim.clone().setIndices(accessor(lists[k])).setMaterial(glass.get(mat)[k]));
    }
    if (lists[0].length) s.prim.setIndices(accessor(lists[0]));
    else s.mesh.removePrimitive(s.prim);
    found += res.windows.length;
    lit += on.filter(Boolean).length;
  }
  if (found) log.push("Windows: found " + count(found, "window") + " by shape (flat, upright, set back inside a frame, glass colored). " + lit + (lit === 1 ? " has" : " have") + " a light on (material " + WINDOW_LIT + ")" + (found - lit ? " and " + (found - lit) + (found - lit === 1 ? " is" : " are") + " dark (material " + WINDOW_DARK + ")" : "") + ". The walls are untouched and nothing was moved.");
  else log.push("Windows: none found. A window has to be set back from its frame in the mesh. Glass that is only painted on a flat wall cannot be told from the wall.");
  if (signs || doors) log.push("Signs and doors: " + (signs ? count(signs, "sign") + " (a wide painted panel, proud of the wall or framed) set to glow with " + (signs === 1 ? "its" : "their") + " own paint, material " + SIGN_LIT + ". " : "") + (doors ? count(doors, "door") + " (set back like a window, but painted or reaching the ground) named as material " + DOOR + ", unchanged in look." : ""));
  if (unread) log.push(count(unread, "part") + " skipped for windows because the texture could not be read.");
  return { found, lit, signs, doors };
}

// What the finished file holds as window glass.
function glassOf(doc) {
  let litTris = 0, darkTris = 0, signTris = 0, doorTris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial() ? prim.getMaterial().getName() : "";
    const n = (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute("POSITION").getCount()) / 3;
    if (name === WINDOW_LIT) litTris += n; else if (name === WINDOW_DARK) darkTris += n; else if (name === SIGN_LIT) signTris += n; else if (name === DOOR) doorTris += n;
  }
  const mat = doc.getRoot().listMaterials().find((m) => m.getName() === WINDOW_LIT);
  return { litTris, darkTris, signTris, doorTris, glow: mat ? mat.getEmissiveFactor() : null };
}

// Every color texture with the triangles that show it. Parts are in world space, so areas are in meters.
function colorGroups(doc) {
  const groups = new Map();
  for (const s of surfacesOf(doc)) {
    const mat = s.prim.getMaterial();
    const tex = mat && mat.getBaseColorTexture();
    if (!tex) continue;
    const info = mat.getBaseColorTextureInfo();
    const acc = s.prim.getAttribute("TEXCOORD_" + (info ? info.getTexCoord() : 0));
    const size = tex.getSize();
    if (!acc || !size) continue;
    let group = groups.get(tex);
    if (!group) groups.set(tex, group = { tex, size, parts: [], materials: new Set(), moved: false });
    if (info && info.getExtension("KHR_texture_transform")) group.moved = true;
    group.materials.add(mat);
    group.parts.push({ pos: s.pos, uv: Float32Array.from(acc.getArray()), indices: s.indices });
  }
  return [...groups.values()];
}

// The color range of the finished file: the widest reading over its color textures.
async function colorOf(doc, codec) {
  if (!codec) return null;
  let out = null;
  for (const group of colorGroups(doc)) {
    let decoded = null;
    try { decoded = await codec.decode(group.tex.getImage(), group.tex.getMimeType()); } catch (error) { decoded = null; }
    if (!decoded) return null;
    const mesh = joinParts(group.parts);
    const mask = !group.moved && uvInside(mesh.uv) ? coverageMask(decoded.width, decoded.height, mesh.uv, mesh.indices) : null;
    const stats = colorStats(decoded.rgba, mask);
    if (!stats) continue;
    out = out ? { low: Math.min(out.low, stats.low), mid: (out.mid + stats.mid) / 2, high: Math.max(out.high, stats.high), vivid: Math.max(out.vivid, stats.vivid) } : stats;
  }
  return out;
}

// All parts of one texture as one vertex list.
function joinParts(parts) {
  let verts = 0, tris = 0;
  for (const p of parts) { verts += p.pos.length / 3; tris += p.indices.length; }
  const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2), indices = new Uint32Array(tris);
  let v = 0, t = 0;
  for (const p of parts) {
    pos.set(p.pos, v * 3); uv.set(p.uv, v * 2);
    for (let i = 0; i < p.indices.length; i++) indices[t + i] = p.indices[i] + v;
    v += p.pos.length / 3; t += p.indices.length;
  }
  return { pos, uv, indices };
}

async function readPixels(tex, options, codec) {
  const image = tex.getImage(), mime = tex.getMimeType();
  if (!image || !codec) return null;
  let decoded = null;
  try { decoded = await codec.decode(image, mime); } catch (error) { decoded = null; }
  if (!decoded) return null;
  let { width, height, rgba } = decoded;
  const max = options.maxTexture;
  if (max && Math.max(width, height) > max) {
    const k = max / Math.max(width, height);
    const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
    rgba = resizeRgba(rgba, width, height, w, h);
    width = w; height = h;
  }
  return { width, height, rgba };
}

// The format a rewritten or new texture is saved in: the one asked for, else the source's own, else PNG.
async function encodePixels(rgba, width, height, prefer, options, codec) {
  const want = options.textureFormat === "webp" ? "image/webp" : options.textureFormat === "png" ? "image/png" : prefer || "image/png";
  for (const mime of want === "image/png" ? ["image/png"] : [want, "image/png"]) {
    let bytes = null;
    try { bytes = await codec.encode(rgba, width, height, mime, options.textureQuality); } catch (error) { bytes = null; }
    if (bytes) return { bytes, mime };
  }
  return null;
}

function nameTexture(doc, tex, mime) {
  const uri = tex.getURI();
  if (uri) tex.setURI(uri.replace(/\.[a-z0-9]+$/i, "") + "." + mime.split("/")[1].replace("jpeg", "jpg"));
  if (mime === "image/webp") doc.createExtension(EXTTextureWebP).setRequired(true);
}

// How brightness follows the way a face points and how high it sits, measured at every vertex.
function bakedLightOf(mesh, rgba, width, height, mask) {
  const count = mesh.pos.length / 3;
  const normal = computeNormals(mesh.pos, mesh.indices);
  const weight = new Float32Array(count);
  const p = mesh.pos;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    weight[a / 3] += area; weight[b / 3] += area; weight[c / 3] += area;
  }
  // A building is flat walls facing a handful of ways. With so few directions, a wall that is
  // simply dirtier, or a base painted a darker color, looks exactly like light. Do not guess.
  let square = 0, all = 0;
  for (let i = 0; i < count; i++) {
    all += weight[i];
    if (Math.max(Math.abs(normal[i * 3]), Math.abs(normal[i * 3 + 1]), Math.abs(normal[i * 3 + 2])) > 0.978) square += weight[i]; // within 12 degrees of an axis
  }
  if (all > 0 && square / all > BOXY) return { found: false, range: 1, boxy: true };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < count; i++) { const y = p[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  const span = hi - lo > 0 ? hi - lo : 1;
  const h = new Float32Array(count), l = new Float32Array(count), paint = new Uint8Array(count);
  const rgb = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    h[i] = (p[i * 3 + 1] - lo) / span;
    if (!sampleColor(rgba, width, height, mesh.uv[i * 2], mesh.uv[i * 2 + 1], 2, mask, rgb)) { weight[i] = 0; continue; }
    l[i] = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    paint[i] = paintOf(rgb[0], rgb[1], rgb[2]);
  }
  return fitBakedLight({ count, normal, height: h, luma: l, paint, weight });
}

async function refineSurfaces(doc, options, codec, log) {
  const light = DELIGHT[options.delight], relief = RELIEF[options.surfaceMaps];
  const groups = colorGroups(doc);
  if (!groups.length) { log.push("Surfaces: the model has no color texture, so there was nothing to work from."); return; }
  if (!codec) { log.push("Surfaces: textures cannot be read on this device, so baked light and surface maps were skipped."); return; }
  let unread = 0, tiled = 0, evened = 0, clean = 0, normals = 0, roughs = 0, had = 0, flatMaps = 0, matched = 0, inRange = 0, boxed = 0;
  let worst = 1, left = 1, shown = null;
  for (const group of groups) {
    const pixels = await readPixels(group.tex, options, codec);
    if (!pixels) { unread++; continue; }
    let { width, height, rgba } = pixels;
    const mesh = joinParts(group.parts);
    const single = !group.moved && uvInside(mesh.uv);
    const mask = single ? coverageMask(width, height, mesh.uv, mesh.indices) : null;

    let dirty = false, lit = null;
    if (light) {
      if (!single) tiled++;
      else if (mesh.pos.length / 3 >= 200) {
        const fit = bakedLightOf(mesh, rgba, width, height, mask);
        if (fit.boxy) boxed++;
        else if (fit.found && fit.range >= BAKED_FLOOR) {
          rgba = applyGain(rgba, gainMap(width, height, mesh.uv, mesh.indices, gainFrom(fit, light.strength, light.limit)));
          const again = bakedLightOf(mesh, rgba, width, height, mask);
          lit = { was: fit.range, now: again.found ? again.range : 1 };
          dirty = true;
        } else clean++;
      } else clean++;
    }

    let held = null;
    if (options.colorStandard) {
      const was = colorStats(rgba, mask);
      if (was && !insideStandard(was)) {
        const fixed = holdToStandard(rgba);
        rgba = fixed.rgba;
        held = { was, now: colorStats(rgba, mask) };
        dirty = true;
      } else if (was) inRange++;
    }

    if (dirty) {
      const saved = await encodePixels(rgba, width, height, group.tex.getMimeType(), options, codec);
      if (saved) {
        group.tex.setImage(saved.bytes).setMimeType(saved.mime);
        nameTexture(doc, group.tex, saved.mime);
        if (lit) { evened++; if (lit.was > worst) { worst = lit.was; left = lit.now; } }
        if (held) { matched++; if (!shown) shown = held; }
      } else { unread++; continue; }
    }

    if (relief) {
      let normalTex = null, bumps = 0;
      const roughTex = new Map();
      for (const mat of group.materials) {
        if (mat.getExtension("KHR_materials_unlit")) continue;
        const info = mat.getBaseColorTextureInfo();
        const set = info ? info.getTexCoord() : 0;
        if (mat.getNormalTexture()) had++;
        else {
          if (!normalTex) {
            const made = normalFromColor(rgba, width, height, mask, relief);
            bumps = made.bumps;
            if (bumps >= 0.01) {
              const saved = await encodePixels(made.rgba, width, height, "image/png", options, codec);
              if (saved) { normalTex = doc.createTexture((mat.getName() || "surface") + "_normal").setImage(saved.bytes).setMimeType(saved.mime); nameTexture(doc, normalTex, saved.mime); }
            } else flatMaps++;
          }
          if (normalTex) { mat.setNormalTexture(normalTex); mat.getNormalTextureInfo().setTexCoord(set); normals++; }
        }
        if (!mat.getMetallicRoughnessTexture()) {
          const factor = mat.getRoughnessFactor();
          const base = factor >= 0.99 ? 0.8 : Math.max(0.2, factor);
          const key = base.toFixed(2);
          let tex = roughTex.get(key);
          if (!tex) {
            const saved = await encodePixels(roughnessFromColor(rgba, width, height, base, mask), width, height, "image/png", options, codec);
            if (saved) { tex = doc.createTexture((mat.getName() || "surface") + "_roughness").setImage(saved.bytes).setMimeType(saved.mime); nameTexture(doc, tex, saved.mime); roughTex.set(key, tex); }
          }
          if (tex) { mat.setMetallicRoughnessTexture(tex).setRoughnessFactor(1); mat.getMetallicRoughnessTextureInfo().setTexCoord(set); roughs++; }
        }
      }
    }
  }
  if (light) {
    if (evened) log.push("Baked light: " + count(evened, "color texture") + " had light painted in. On the worst, the lit side was " + worst.toFixed(2) + " times as bright as the dark side. It is now " + left.toFixed(2) + " times. Local painted shadows are not touched.");
    else if (clean) log.push("Baked light: none found. Brightness does not follow the direction faces point or how high they sit.");
    if (boxed) log.push("Baked light: " + count(boxed, "color texture") + " left as painted. The model is mostly flat walls facing a few ways, and there a dirtier wall or a darker painted base looks exactly like light. That is not guessed at.");
    if (tiled) log.push(count(tiled, "tiling texture") + " left as painted. A texture that repeats has no single pixel per point to correct.");
  }
  if (options.colorStandard) {
    const pct = (v) => Math.round(v * 100);
    if (matched) log.push("Color standard: " + count(matched, "color texture") + " brought inside the shared range. Brightness ran from " + pct(shown.was.low) + " to " + pct(shown.was.high) + " percent and peak vividness was " + pct(shown.was.vivid) + ". Now " + pct(shown.now.low) + " to " + pct(shown.now.high) + " and " + pct(shown.now.vivid) + ". The middle of the range and every hue are untouched.");
    else if (inRange) log.push("Color standard: every color texture was already inside the shared range. Nothing was changed.");
  }
  if (relief) {
    if (normals || roughs) log.push("Surface maps: made " + count(normals, "normal map link") + " and " + count(roughs, "roughness map link") + " from the color texture, for materials that had none." + (had ? " " + count(had, "material") + " kept the normal map it came with." : ""));
    else log.push(had ? "Surface maps: every material already has its own." : "Surface maps: nothing was made.");
    if (flatMaps) log.push(count(flatMaps, "color texture is", "color textures are") + " too even to read any relief from. No normal map was made for " + (flatMaps === 1 ? "it" : "them") + ".");
  }
  if (unread) log.push(count(unread, "texture") + " could not be read or written here and " + (unread === 1 ? "was" : "were") + " left alone.");
}

async function fitTextures(doc, options, codec, log) {
  const max = options.maxTexture;
  const target = options.textureFormat === "webp" ? "image/webp" : options.textureFormat === "png" ? "image/png" : null;
  if (!max && !target) return;
  let resized = 0, converted = 0, skipped = 0, saved = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const image = tex.getImage(), mime = tex.getMimeType(), size = tex.getSize();
    if (!image || !size) { skipped++; continue; }
    const over = max && Math.max(size[0], size[1]) > max;
    const want = target || mime;
    if (!over && want === mime) continue;
    if (!codec) { skipped++; continue; }
    let decoded = null;
    try { decoded = await codec.decode(image, mime); } catch (error) { decoded = null; }
    if (!decoded) { skipped++; continue; }
    let { width, height, rgba } = decoded;
    if (over) {
      const k = max / Math.max(width, height);
      const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
      rgba = resizeRgba(rgba, width, height, w, h);
      width = w; height = h;
    }
    let alpha = false;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { alpha = true; break; }
    let outMime = want === "image/jpeg" && alpha ? "image/png" : want;
    let bytes = null;
    try { bytes = await codec.encode(rgba, width, height, outMime, options.textureQuality); } catch (error) { bytes = null; }
    if (!bytes && outMime !== "image/png") {
      outMime = "image/png";
      try { bytes = await codec.encode(rgba, width, height, outMime, options.textureQuality); } catch (error) { bytes = null; }
    }
    if (!bytes) { skipped++; continue; }
    if (!over && target !== "image/png" && bytes.byteLength >= image.byteLength) continue; // a format change that makes the file bigger is not kept
    saved += Math.max(0, image.byteLength - bytes.byteLength);
    tex.setImage(bytes).setMimeType(outMime);
    const uri = tex.getURI();
    if (uri) tex.setURI(uri.replace(/\.[a-z0-9]+$/i, "") + "." + outMime.split("/")[1].replace("jpeg", "jpg"));
    if (outMime === "image/webp") doc.createExtension(EXTTextureWebP).setRequired(true);
    if (over) resized++; else converted++;
  }
  if (resized || converted) log.push("Textures: " + resized + " resized to " + max + " px or under" + (converted ? ", " + converted + " converted" : "") + ". Saved " + mb(saved) + ".");
  if (skipped) log.push(count(skipped, "texture") + " could not be read here and " + (skipped === 1 ? "was" : "were") + " left alone.");
}

function mb(bytes) {
  return bytes < 104858 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1048576).toFixed(1) + " MB";
}

// "1 hole", "2 holes"
function count(amount, word, plural) {
  return amount + " " + (amount === 1 ? word : (plural || word + "s"));
}

function f4(v) {
  const s = v.toFixed(4);
  return s === "-0.0000" ? "0.0000" : s;
}

function meters(v) {
  return v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
}

// Every line here is measured on the finished file.
function buildChecks(before, after, options, extra) {
  const checks = [];
  const add = (id, status, label, detail, fix) => checks.push({ id, status, label, detail, fix: status === "pass" ? "" : (fix || "") });
  const d = after.defects;

  if (extra.validation) {
    const v = extra.validation;
    if (v.failed) add("valid", "note", "glTF validator", "The validator could not run: " + v.failed);
    else add("valid", v.errors ? "fail" : "pass", "Valid glTF 2.0", v.errors
      ? v.errors + " errors from the Khronos validator. First: " + (v.first || "")
      : "The Khronos validator found no errors" + (v.warnings ? " (" + v.warnings + " warnings)." : "."),
    "The file breaks the glTF rules in a way this app did not repair. Re-export the source.");
  }
  add("triangles-clean", d.degenerate || d.duplicate ? "fail" : "pass", "Clean triangles",
    d.degenerate || d.duplicate ? d.degenerate + " empty and " + d.duplicate + " repeated triangles remain." : "No empty or repeated triangles.",
    "Run it again. If the count stays, the source has geometry this app cannot repair.");
  if (options.removeDebris || d.debrisPieces) add("debris", d.debrisPieces ? "fail" : d.debrisHeld ? "note" : "pass", "No floating debris",
    d.debrisPieces ? count(d.debrisPieces, "small floating piece") + " remain." : d.debrisHeld ? count(d.debrisHeld, "small loose piece") + " kept on purpose. Check them in the view." : "No small pieces float free of the model.",
    "Turn on Remove floating debris.");
  add("facing", d.inverted ? "fail" : "pass", "Faces point outward",
    d.inverted ? count(d.inverted, "shell is", "shells are") + " inside out." : "No shell is inside out.", "Turn on Fix inside-out faces.");
  add("normals", d.missingNormals || d.wrongNormals ? "fail" : "pass", "Normals",
    d.missingNormals || d.wrongNormals ? d.missingNormals + " parts have no normals and " + d.wrongNormals + " triangles are lit from the wrong side." : "Every part has normals that agree with its faces.",
    "Turn on Fix normals.");
  if (d.missingUV) add("uv", "fail", "Texture coordinates", d.missingUV + " textured parts have no UVs, so their texture cannot show.", "The source needs UVs. This app does not unwrap.");

  if (options.requireClosed) add("closed", d.openEdges || d.nonManifold ? "fail" : "pass", "Watertight",
    d.openEdges || d.nonManifold ? d.openEdges + " open edges and " + d.nonManifold + " edges shared by more than two faces." : "Every edge joins exactly two faces.",
    "Set Close holes to All. Openings that are not simple loops need a modeling tool.");
  else add("closed", "note", "Open edges", d.openEdges
    ? d.openEdges + " open edges" + (d.nonManifold ? " and " + d.nonManifold + " edges shared by more than two faces" : "") + ". Fine for games and rendering. A 3D print needs none."
    : "The mesh is closed" + (d.nonManifold ? ", with " + d.nonManifold + " edges shared by more than two faces." : "."));

  if (options.triangles) {
    const over = after.triangles > options.triangles * 1.02;
    add("budget", over ? "fail" : "pass", "Triangle target",
      after.triangles + " triangles. Target " + options.triangles + "." + (over ? " Going lower would visibly change the shape." : ""),
      "Raise the target, or simplify the source model.");
  } else add("budget", "note", "Triangles", after.triangles + " triangles. No target was set.");
  add("drawcalls", "note", "Draw calls", count(after.drawCalls, "draw call") + ", " + count(after.materials, "material") + ".");

  if (options.maxTexture) {
    const unknown = after.textures.filter((t) => !t.width).length;
    const over = after.textures.filter((t) => Math.max(t.width, t.height) > options.maxTexture).length;
    add("textures", over ? "fail" : unknown ? "note" : "pass", "Texture size",
      after.textures.length
        ? (over ? count(over, "texture is", "textures are") + " over " + options.maxTexture + " px." : "All " + (after.textures.length - unknown) + " readable textures are " + options.maxTexture + " px or under.") + (unknown ? " " + unknown + " are in a format this app cannot measure." : "")
        : "The model has no textures.",
      "Those textures could not be decoded on this device. Convert them to PNG or JPEG first.");
  }
  if (after.walls) {
    const w = after.walls;
    if (w.count) add("walls", w.tris > 0 && w.density > 0 ? "pass" : "fail", "Walls", count(w.walls, "wall") + (w.roofs ? " and " + count(w.roofs, "roof slope") : "") + " on a " + w.kind + " texture of their own" + (w.scans && w.scans.length ? " (scanned)" : "") + ": " + w.tris + " triangles at " + Math.round(w.density) + " texture pixels per meter, evenly (" + Math.round(w.stretched * 100) + " percent stretched).", "The wall material did not survive to the finished file.");
    else add("walls", "note", "Walls", "No large flat upright wall was found.");
  }
  if (after.windows) {
    const w = after.windows;
    if (w.found) {
      const kept = (w.lit ? w.litTris > 0 && !!w.glow && w.glow[0] > 0 : true) && (w.found - w.lit ? w.darkTris > 0 : true);
      add("windows", kept ? "pass" : "fail", "Windows", count(w.found, "window") + ": " + w.lit + " lit (" + w.litTris + " triangles, material " + WINDOW_LIT + ") and " + (w.found - w.lit) + " dark (" + w.darkTris + " triangles, material " + WINDOW_DARK + ").", "The window materials did not survive to the finished file. Turn off any step that merges materials.");
    } else add("windows", "note", "Windows", "None found. Only glass that is set back from its frame in the mesh can be found.");
    if (w.signs || w.doors) add("panels", (w.signs ? w.signTris > 0 : true) && (w.doors ? w.doorTris > 0 : true) ? "pass" : "fail", "Signs and doors", count(w.signs || 0, "sign") + " (" + w.signTris + " triangles, material " + SIGN_LIT + ") and " + count(w.doors || 0, "door") + " (" + w.doorTris + " triangles, material " + DOOR + ").", "The sign or door material did not survive to the finished file.");
  }
  if (after.color) {
    const c = after.color, pct = (v) => Math.round(v * 100);
    const text = "Brightness runs from " + pct(c.low) + " to " + pct(c.high) + " percent, middle " + pct(c.mid) + ". Peak vividness " + pct(c.vivid) + ". The shared range is " + pct(STANDARD.floor) + " to " + pct(STANDARD.ceiling) + ", vividness up to " + pct(STANDARD.vividMax) + ".";
    if (options.colorStandard) add("color", insideStandard(c) ? "pass" : "fail", "Color standard", text, "The texture could not be rewritten on this device. Convert it to PNG or JPEG first.");
    else add("color", "note", "Color range", text + (insideStandard(c) ? "" : " This asset is outside it. Turn on Hold color to the shared standard so it matches the others."));
  }
  if (after.detail) {
    const px = Math.round(after.detail.median), thin = Math.round(after.detail.stretched * 100);
    const text = px + " texture pixels per meter across most of the surface." + (thin >= 5 ? " " + thin + " percent of the surface is stretched to under half that." : "");
    if (options.minTexelDensity) add("detail", px >= options.minTexelDensity ? "pass" : "fail", "Texture detail", text + " Minimum " + options.minTexelDensity + ".", "Use a larger texture, or a smaller model. Stretched UVs need a new unwrap in a modeling tool.");
    else add("detail", "note", "Texture detail", text + " Assets that share a street should be close to each other on this number.");
  }
  if (options.size && options.size.meters > 0) {
    const dims = { width: after.size[0], height: after.size[1], length: after.size[2], longest: Math.max(...after.size) };
    const got = dims[options.size.axis] || dims.longest;
    const ok = Math.abs(got - options.size.meters) <= options.size.meters * 0.01;
    add("size", ok ? "pass" : "fail", "Size", "The " + (options.size.axis || "longest") + " is " + meters(got) + " m. Target " + meters(options.size.meters) + " m.", "The size could not be set. Check the model has geometry on that axis.");
  } else add("size", "note", "Size", meters(after.size[0]) + " wide, " + meters(after.size[1]) + " tall, " + meters(after.size[2]) + " long (meters). No size was set.");
  const tol = Math.max(0.001, Math.max(...after.size) * 0.001);
  if (options.ground) add("ground", Math.abs(after.min[1]) <= tol ? "pass" : "fail", "On the ground", "Lowest point is at " + f4(after.min[1]) + " m.", "The model could not be placed.");
  if (options.center) {
    const cx = (after.min[0] + after.max[0]) / 2, cz = (after.min[2] + after.max[2]) / 2;
    add("center", Math.abs(cx) <= tol && Math.abs(cz) <= tol ? "pass" : "fail", "Centered", "Center is at X " + f4(cx) + ", Z " + f4(cz) + ".", "The model could not be placed.");
  }

  const lost = [];
  if (after.materials < before.materials) lost.push((before.materials - after.materials) + " unused or identical materials merged");
  if (after.skins < before.skins) lost.push((before.skins - after.skins) + " skeletons");
  if (!options.dropAnimations && after.animations < before.animations) lost.push((before.animations - after.animations) + " animations");
  const realLoss = after.skins < before.skins || (!options.dropAnimations && after.animations < before.animations);
  add("kept", realLoss ? "fail" : "pass", "Nothing lost",
    (before.skins ? after.skins + " skeleton with " + after.joints + " bones kept. " : "") + (before.animations && !options.dropAnimations ? after.animations + " animations kept. " : "") + count(after.materials, "material") + ", " + count(after.textures.length, "texture") + "." + (lost.length && !realLoss ? " (" + lost.join(", ") + ".)" : ""),
    "Part of the rig was dropped while writing. Keep the source file.");
  if (options.requireSkeleton) add("skeleton", after.skins ? "pass" : "fail", "Skeleton", after.skins ? "The model has a skeleton with " + after.joints + " bones." : "The model has no skeleton.", "Rig it first. This app does not add bones.");
  if (options.maxBytes) add("bytes", after.bytes <= options.maxBytes ? "pass" : "fail", "File size", mb(after.bytes) + ". Limit " + mb(options.maxBytes) + ".", "Lower the texture size or the triangle target.");
  else add("bytes", "note", "File size", mb(after.bytes) + ", was " + mb(before.bytes) + ".");
  if (after.otherPrimitives) add("other", "note", "Lines and points", after.otherPrimitives + " parts are lines or points. They were left as they are.");
  return checks;
}

function verdictOf(result) {
  const failed = result.checks.filter((c) => c.status === "fail");
  const ready = !!result.bytes && !failed.length;
  const banner = ready ? "READY" : "NOT READY";
  const summary = ready ? "Every check passed on the finished file." : failed.length + (failed.length === 1 ? " check" : " checks") + " failed: " + failed.map((c) => c.label).join(", ") + ".";
  const mark = { pass: "PASS  ", fail: "FAIL  ", note: "NOTE  " };
  const report = [banner, summary, ""]
    .concat(result.checks.map((c) => mark[c.status] + c.label + ": " + c.detail + (c.fix ? "  Fix: " + c.fix : "")))
    .concat(["", "What was done"]).concat(result.log.map((line) => "- " + line)).join("\n");
  return { ...result, ready, banner, summary, report };
}
