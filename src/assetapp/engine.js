// Sovereign Asset: clean up and finish any glTF model.
// Bytes in, bytes out. Runs the same in the browser, in a worker, and in Node.
// The source bytes are never changed. Every fix is logged, and the verdict is measured on the
// finished file after it is read back, not on what the fixes were meant to do.

import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { compactPrimitive, convertPrimitiveToTriangles, dedup, dequantize, meshopt, prune, reorder, simplify, transformMesh, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { analyze, boundsOf, capHoles, computeNormals, diagOf, findDebris, invertedIslands, resizeRgba, wrongNormals } from "./geometry.js";

export const DEFAULTS = {
  removeDebris: true,     // drop small pieces that touch nothing
  fixFacing: true,        // turn inside-out shells the right way round
  closeHoles: "small",    // "off", "small" (pinholes), "all"
  fixNormals: true,       // add missing normals, rebuild ones that point the wrong way
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
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: false, keepSolidTextures: true, keepExtras: true, keepIndices: true }));
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
