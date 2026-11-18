// Anything that is not already a GLB is turned into one here, on the page, before the finish runs.
// GLB and glTF go through unchanged. FBX, OBJ, DAE, 3DS, 3MF, USDZ, STL and PLY are read with three.js
// and written back as GLB. A ZIP is opened first and whatever model it holds is read with its textures.

const MAIN = ["glb", "gltf", "fbx", "obj", "dae", "3ds", "3mf", "usdz", "stl", "ply"];
const FORMATS = "GLB, glTF, FBX, OBJ, DAE, 3DS, 3MF, USDZ, STL or PLY";
// every slot of a material that can hold a picture
const SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "bumpMap", "specularMap", "lightMap", "displacementMap", "envMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "sheenColorMap", "transmissionMap", "thicknessMap"];
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tga: "image/x-tga", bmp: "image/bmp", gif: "image/gif" };

// Open every ZIP in the list and put what it holds beside the other files. Folders inside are
// flattened: files are matched by name, the way a model names its textures.
async function unzipAll(files) {
  if (!files.some((f) => ext(f.name) === "zip")) return { files, opened: 0 };
  const { unzipSync } = await import("three/addons/libs/fflate.module.js");
  const out = [];
  let opened = 0;
  for (const f of files) {
    if (ext(f.name) !== "zip") { out.push(f); continue; }
    let entries;
    try { entries = unzipSync(new Uint8Array(await f.arrayBuffer())); } catch (error) { throw new Error("The ZIP " + f.name + " could not be opened. It may be damaged or password protected."); }
    opened++;
    let total = 0;
    for (const [path, bytes] of Object.entries(entries)) {
      if (path.endsWith("/") || path.startsWith("__MACOSX/") || base(path).startsWith(".")) continue;
      total += bytes.length;
      if (total > 1024 * 1024 * 1024) throw new Error("The ZIP " + f.name + " unpacks to over 1 GB. Unpack it and pick the model file itself.");
      out.push(new File([bytes], base(path), { type: MIME[ext(path)] || "" }));
    }
  }
  return { files: out, opened };
}

// A model often names a texture file that did not come with it. An empty picture stops the GLB
// from being written, so each one is taken off its material and named in the note instead.
function dropEmptyTextures(object) {
  const missing = new Set();
  object.traverse((node) => {
    for (const material of [].concat(node.material || [])) {
      for (const slot of SLOTS) {
        const tex = material[slot];
        if (!tex) continue;
        const img = tex.image;
        const ok = img && ((img.width > 0 && img.height > 0) || (img.data && img.data.length > 0) || img.videoWidth > 0);
        if (ok) continue;
        material[slot] = null;
        material.needsUpdate = true;
        const from = (tex.userData && tex.userData.wanted) || tex.name || (img && img.src) || "";
        if (from && !/^blob:|^data:/.test(from)) missing.add(base(from));
      }
    }
  });
  return [...missing];
}
const ext = (name) => (name.split(".").pop() || "").toLowerCase();
const base = (path) => decodeURIComponent(String(path).split(/[\\/]/).pop().split("?")[0]);

export const ACCEPT = ".glb,.gltf,.bin,.fbx,.obj,.mtl,.dae,.3ds,.3mf,.usdz,.stl,.ply,.zip,.png,.jpg,.jpeg,.webp,.tga,.bmp";

export async function toGlb(fileList) {
  const unpacked = await unzipAll(Array.from(fileList));
  const files = unpacked.files;
  const main = MAIN.map((e) => files.find((f) => ext(f.name) === e)).find(Boolean);
  if (!main) {
    const got = [...new Set(files.map((f) => "." + ext(f.name)))].slice(0, 6).join(", ");
    throw new Error((unpacked.opened ? "The ZIP holds no model this app reads (it has " + (got || "nothing") + "). " : got ? "This app does not read " + got + " as a model. " : "") + "Pick a " + FORMATS + " file, or a ZIP that holds one.");
  }
  const kind = ext(main.name);
  const stem = main.name.replace(/\.[^.]+$/, "");
  const zipped = unpacked.opened ? "Opened the ZIP and read " + main.name + ". " : "";
  if (kind === "glb") return { bytes: new Uint8Array(await main.arrayBuffer()), name: stem, note: zipped.trim() };
  const others = files.filter((f) => f !== main);

  if (kind === "gltf") {
    const { WebIO } = await import("@gltf-transform/core");
    const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
    const { MeshoptDecoder, MeshoptEncoder } = await import("meshoptimizer");
    await MeshoptDecoder.ready; await MeshoptEncoder.ready;
    const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
    const json = JSON.parse(await main.text());
    const resources = {};
    const missing = [];
    for (const item of [...(json.buffers || []), ...(json.images || [])]) {
      if (!item.uri || item.uri.startsWith("data:")) continue;
      const file = others.find((f) => f.name === base(item.uri));
      if (file) resources[item.uri] = new Uint8Array(await file.arrayBuffer()); else missing.push(base(item.uri));
    }
    if (missing.length) throw new Error("This glTF also needs " + missing.join(", ") + ". Pick those files together with it.");
    const doc = await io.readJSON({ json, resources });
    return { bytes: await io.writeBinary(doc), name: stem, note: zipped + "Packed the glTF and its files into one GLB." };
  }

  const THREE = await import("three");
  const urls = new Map();
  for (const f of others) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  // A texture that was picked with the model is read from the device. One that was not is never
  // fetched from the network: it gets an address that fails at once, and is reported as missing.
  const wanted = new Set();
  manager.setURLModifier((url) => {
    if (/^blob:|^data:/.test(url)) return url;
    const name = base(url).toLowerCase();
    if (urls.has(name)) return urls.get(name);
    wanted.add(base(url));
    return "data:,";
  });
  const { TGALoader } = await import("three/addons/loaders/TGALoader.js");
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  let busy = 0;
  const idle = () => new Promise((resolve) => {
    const tick = () => (busy <= 0 ? resolve() : setTimeout(tick, 60));
    setTimeout(tick, 60);
  });
  manager.itemStart = ((start) => function (url) { busy++; start.call(this, url); })(manager.itemStart);
  manager.itemEnd = ((end) => function (url) { busy--; end.call(this, url); })(manager.itemEnd);
  manager.itemError = ((err) => function (url) { busy--; err.call(this, url); })(manager.itemError);

  let object, animations = [];
  if (kind === "fbx") {
    const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
    object = new FBXLoader(manager).parse(await main.arrayBuffer(), "");
    animations = object.animations || [];
  } else if (kind === "obj") {
    const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
    const loader = new OBJLoader(manager);
    const mtl = others.find((f) => ext(f.name) === "mtl");
    if (mtl) {
      const { MTLLoader } = await import("three/addons/loaders/MTLLoader.js");
      const materials = new MTLLoader(manager).parse(await mtl.text(), "");
      materials.preload();
      loader.setMaterials(materials);
    }
    object = loader.parse(await main.text());
  } else if (kind === "dae") {
    const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
    const read = new ColladaLoader(manager).parse(await main.text(), "");
    object = read.scene;
    animations = (read.scene && read.scene.animations) || read.animations || [];
  } else if (kind === "3ds") {
    const { TDSLoader } = await import("three/addons/loaders/TDSLoader.js");
    object = new TDSLoader(manager).parse(await main.arrayBuffer(), "");
  } else if (kind === "3mf") {
    const { ThreeMFLoader } = await import("three/addons/loaders/3MFLoader.js");
    object = new ThreeMFLoader(manager).parse(await main.arrayBuffer());
    object.scale.multiplyScalar(0.001); // a 3MF is in millimeters, a GLB in meters
  } else if (kind === "usdz") {
    const { USDZLoader } = await import("three/addons/loaders/USDZLoader.js");
    object = new USDZLoader(manager).parse(await main.arrayBuffer());
  } else {
    let geometry;
    if (kind === "stl") {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      geometry = new STLLoader().parse(await main.arrayBuffer());
    } else {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      geometry = new PLYLoader().parse(await main.arrayBuffer());
    }
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.7, metalness: 0, vertexColors: !!geometry.getAttribute("color") });
    object = new THREE.Mesh(geometry, material);
    object.name = stem;
  }
  await idle();
  if (!object) throw new Error("Nothing could be read from " + main.name + ".");
  let meshes = 0;
  object.traverse((node) => { if (node.isMesh || node.isSkinnedMesh) meshes++; });
  if (!meshes) throw new Error(main.name + " was read but holds no mesh. It may be an animation-only file: pick the file with the model in it.");
  const dropped = dropEmptyTextures(object);
  const missing = [...new Set([...wanted, ...dropped])].filter((name) => name && name !== ",");
  const scene = new THREE.Scene();
  scene.add(object);
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  let out;
  try { out = await new GLTFExporter().parseAsync(scene, { binary: true, animations, onlyVisible: false }); }
  catch (error) { throw new Error("The " + kind.toUpperCase() + " was read but could not be written as GLB: " + (error && error.message ? error.message : error)); }
  finally { for (const url of urls.values()) URL.revokeObjectURL(url); }
  const lacks = missing.length ? " It names " + (missing.length === 1 ? "a texture" : missing.length + " textures") + " that did not come with it (" + missing.slice(0, 4).join(", ") + (missing.length > 4 ? ", and more" : "") + "), so " + (missing.length === 1 ? "that is" : "those are") + " left off. Pick " + (missing.length === 1 ? "it" : "them") + " together with the model, or pick the ZIP it came in, to get the color." : "";
  return { bytes: new Uint8Array(out), name: stem, note: zipped + "Converted from " + kind.toUpperCase() + " to GLB." + (kind === "stl" || kind === "ply" ? " If it lies on its back, use Stand up." : "") + lacks };
}
