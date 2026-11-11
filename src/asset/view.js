import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";
import { buildAsset } from "./build.js";
import { buildLevel } from "./level.js";
function hasTextureMap(root) {
  let found = false;
  root.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material.map) found = true;
  });
  return found;
}
function countTriangles(root) {
  let triangles = 0;
  root.traverse((obj) => {
    const mesh = obj;
    if (!mesh.isMesh) return;
    const index = mesh.geometry.getIndex();
    const positions = mesh.geometry.getAttribute("position");
    triangles += index ? index.count / 3 : positions ? positions.count / 3 : 0;
  });
  return Math.round(triangles);
}
function measure(root) {
  const pivots = [];
  root.traverse((obj) => {
    if (obj.userData.pivot && obj.name) pivots.push(obj.name);
  });
  if (root.children.length === 0) {
    return { triangles: 0, width: 0, height: 0, depth: 0, pivots };
  }
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return {
    triangles: countTriangles(root),
    width: size.x,
    height: size.y,
    depth: size.z,
    pivots
  };
}
function fileName(name) {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-|-$/g, "");
  return `${clean || "asset"}.glb`;
}
function cloneAsset(asset) {
  const clone = asset.clone(true);
  clone.traverse((obj) => {
    const mesh = obj;
    if (mesh.isMesh) mesh.geometry = mesh.geometry.clone();
  });
  return clone;
}
function disposeBuilt(built) {
  if (!built) return;
  built.root.traverse((obj) => {
    const mesh = obj;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  for (const palette of built.palettes) palette.dispose();
}
function mount(el, onStats) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(462879, 1);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
  camera.position.set(6, 2.6, 7);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const roomEnvironment = scene.environment;
  const hemi = new THREE.HemisphereLight(12965098, 727088, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(16774372, 3.1);
  sun.position.set(7, 11, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -4e-4;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(12964095, 0.8);
  rim.position.set(-6, 4, -4);
  scene.add(rim);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({ color: 727088, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(24, 24, 3494522, 1780810);
  grid.position.y = 2e-3;
  scene.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.8, 0);
  controls.maxPolarAngle = Math.PI / 2.02;
  controls.minDistance = 0.6;
  controls.maxDistance = 80;
  controls.update();
  const holder = new THREE.Group();
  scene.add(holder);
  const gizmos = new THREE.Group();
  scene.add(gizmos);
  let built = null;
  let doc = null;
  let key = "";
  let framed = "";
  let running = true;
  let external = null;
  let pointerHooks = {};
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const gizmoGeo = new THREE.SphereGeometry(0.06, 10, 8);
  const gizmoMat = new THREE.MeshBasicMaterial({ color: 13936707, depthTest: false });
  function resize() {
    const width = Math.max(1, el.clientWidth);
    const height = Math.max(1, el.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  function fitRig(target) {
    const box = new THREE.Box3().setFromObject(target);
    const size = box.isEmpty() ? new THREE.Vector3(8, 2, 8) : box.getSize(new THREE.Vector3());
    const span = Math.max(14, size.x, size.z);
    const scale = span / 14;
    ground.scale.setScalar(scale);
    grid.scale.setScalar(scale);
    controls.maxDistance = span * 2.6;
    controls.minDistance = span > 24 ? 3 : 0.6;
    const reach = span * 0.75;
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.far = span * 3;
    sun.shadow.camera.updateProjectionMatrix();
  }
  function frameObject(target) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      controls.target.set(0, 0.6, 0);
      camera.position.set(4, 2.4, 6);
      controls.update();
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.62;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
    camera.position.copy(center).add(new THREE.Vector3(0.72, 0.42, 0.9).normalize().multiplyScalar(distance));
    controls.target.copy(center);
    controls.update();
  }
  function refreshGizmos() {
    while (gizmos.children.length) {
      const child = gizmos.children.pop();
      if (child) child.removeFromParent();
    }
    if (external || !built || !doc?.showPivots) return;
    built.root.updateWorldMatrix(true, true);
    built.root.traverse((obj) => {
      if (!obj.userData.pivot) return;
      const marker = new THREE.Mesh(gizmoGeo, gizmoMat);
      marker.position.setFromMatrixPosition(obj.matrixWorld);
      marker.userData.pivotMarker = true;
      marker.userData.pivotName = obj.name;
      marker.renderOrder = 2;
      gizmos.add(marker);
    });
  }
  function rebuild(next, forceFrame) {
    disposeBuilt(built);
    holder.clear();
    built = next.kind === "level" ? buildLevel(next) : buildAsset(next);
    holder.add(built.root);
    onStats(measure(built.root));
    refreshGizmos();
    fitRig(built.root);
    if (forceFrame) frameObject(built.root);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();
  function tick() {
    if (!running) return;
    if (doc?.turntable) {
      const target = controls.target;
      const offset = camera.position.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), 4e-3);
      camera.position.copy(target).add(offset);
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    down = null;
    if (dx * dx + dy * dy > 36) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([holder, gizmos], true)[0] || null;
    if (pointerHooks.onPick) pointerHooks.onPick(hit);
  });
  return {
    sync(next) {
      doc = next;
      if (external) return;
      const nextKey = JSON.stringify({
        kind: next.kind,
        recipe: next.recipe,
        paint: next.paint,
        lines: next.lines
      });
      const identity = `${next.kind}:${next.recipe}`;
      const identityChanged = framed !== identity;
      if (nextKey !== key) {
        key = nextKey;
        framed = identity;
        rebuild(next, next.kind === "level" || identityChanged || !built);
      } else {
        refreshGizmos();
        if (built) built.root.name = next.name.trim() || "asset";
      }
    },
    async exportGlb() {
      if (!built || !doc || countTriangles(built.root) === 0) {
        return "Nothing to export yet. Add a solid first.";
      }
      const clone = cloneAsset(built.root);
      clone.name = doc.name.trim() || "asset";
      let simplified = false;
      const before = countTriangles(clone);
      if (before > doc.budget) {
        const keep = doc.budget / before;
        const modifier = new SimplifyModifier();
        const meshes = [];
        clone.traverse((obj) => {
          const mesh = obj;
          if (mesh.isMesh) meshes.push(mesh);
        });
        for (const mesh of meshes) {
          const positions = mesh.geometry.getAttribute("position");
          if (!positions || positions.count < 48) continue;
          const remove = Math.floor(positions.count * (1 - keep));
          if (remove < 12) continue;
          try {
            const nextGeo = await modifier.modify(mesh.geometry, remove);
            mesh.geometry.dispose();
            mesh.geometry = nextGeo;
            simplified = true;
          } catch {
          }
        }
      }
      const exporter = new GLTFExporter();
      const data = await exporter.parseAsync(clone, { binary: true });
      clone.traverse((obj) => {
        const mesh = obj;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      const bytes = data instanceof ArrayBuffer ? data : new TextEncoder().encode(String(data));
      const blob = new Blob([bytes], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(clone.name);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4e3);
      const after = simplified ? ` Simplified toward ${doc.budget.toLocaleString()} triangles.` : "";
      return `Saved ${link.download}${after}`;
    },
    frame() {
      frameObject(external || built?.root || holder);
    },
    showVehicle(root) {
      external = root;
      holder.clear();
      holder.add(root);
      while (gizmos.children.length) gizmos.children[0].removeFromParent();
      onStats(measure(root));
      fitRig(root);
      const review = hasTextureMap(root);
      sun.intensity = review ? 0.9 : 3.1;
      hemi.intensity = review ? 0.18 : 0.55;
      rim.intensity = review ? 0.08 : 0.8;
      scene.environment = review ? null : roomEnvironment;
      renderer.toneMapping = review ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = review ? 1 : 1.05;
      if (review) {
        root.traverse((obj) => {
          if (!obj.isMesh || !obj.material || !obj.material.map) return;
          obj.material.map.colorSpace = THREE.SRGBColorSpace;
          obj.material.map.needsUpdate = true;
          obj.material.needsUpdate = true;
        });
      }
      frameObject(root);
      controls.update();
    },
    look(preset) {
      const target = external || holder;
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.55;
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      const alongLength = size.z >= size.x;
      const dir = preset === "side"
        ? (alongLength ? new THREE.Vector3(1, 0.12, 0) : new THREE.Vector3(0, 0.12, 1))
        : preset === "front"
          ? (alongLength ? new THREE.Vector3(0.35, 0.42, 1) : new THREE.Vector3(1, 0.42, 0.35))
          : new THREE.Vector3(0.72, 0.38, 0.9);
      camera.position.copy(center).add(dir.normalize().multiplyScalar(dist));
      controls.target.copy(center);
      controls.update();
    },
    clearVehicle() {
      external = null;
      sun.intensity = 3.1;
      hemi.intensity = 0.55;
      rim.intensity = 0.8;
      scene.environment = roomEnvironment;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      holder.clear();
      if (doc) {
        key = "";
        this.sync(doc);
      }
    },
    setPointerHooks(hooks) {
      pointerHooks = hooks || {};
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects([holder, gizmos], true);
      return hits[0] || null;
    },
    dispose() {
      running = false;
      observer.disconnect();
      disposeBuilt(built);
      gizmoGeo.dispose();
      gizmoMat.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
export {
  mount
};
