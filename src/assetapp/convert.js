// Anything that is not already a GLB is turned into one here, on the page, before the finish runs.
// GLB and glTF go through unchanged. FBX, OBJ, STL, PLY and DAE are read with three.js and written back as GLB.

const MAIN = ["glb", "gltf", "fbx", "obj", "dae", "stl", "ply"];
const ext = (name) => (name.split(".").pop() || "").toLowerCase();
const base = (path) => decodeURIComponent(String(path).split(/[\\/]/).pop().split("?")[0]);

export const ACCEPT = ".glb,.gltf,.bin,.fbx,.obj,.mtl,.dae,.stl,.ply,.png,.jpg,.jpeg,.webp";

export async function toGlb(fileList) {
  const files = Array.from(fileList);
  const main = MAIN.map((e) => files.find((f) => ext(f.name) === e)).find(Boolean);
  if (!main) throw new Error("Pick a GLB, glTF, FBX, OBJ, DAE, STL or PLY file.");
  const kind = ext(main.name);
  const stem = main.name.replace(/\.[^.]+$/, "");
  if (kind === "glb") return { bytes: new Uint8Array(await main.arrayBuffer()), name: stem, note: "" };
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
    return { bytes: await io.writeBinary(doc), name: stem, note: "Packed the glTF and its files into one GLB." };
  }

  const THREE = await import("three");
  const urls = new Map();
  for (const f of others) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => urls.get(base(url).toLowerCase()) || url);
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
    object = new ColladaLoader(manager).parse(await main.text(), "").scene;
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
  const scene = new THREE.Scene();
  scene.add(object);
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const out = await new GLTFExporter().parseAsync(scene, { binary: true, animations, onlyVisible: false });
  for (const url of urls.values()) URL.revokeObjectURL(url);
  return { bytes: new Uint8Array(out), name: stem, note: "Converted from " + kind.toUpperCase() + " to GLB." + (kind === "stl" || kind === "ply" ? " If it lies on its back, use Stand up." : "") };
}
