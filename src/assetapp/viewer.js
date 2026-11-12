// The 3D view. Shows the source or the finished model on a ground grid, with a gold arrow for the front (+Z).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const stage = new THREE.Group(), holder = new THREE.Group(), extras = new THREE.Group();
  scene.add(stage, extras);
  stage.add(holder);
  let model = null, wire = false, dirty = true, token = 0, turn = null;
  controls.addEventListener("change", () => { dirty = true; });

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    }
  }

  function clear(group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) if (m[key]) m[key].dispose();
        m.dispose();
      }
    });
    group.clear();
  }

  // The preview stands the model on the ground and centers it, the way the finish will.
  function place(frame) {
    holder.matrixAutoUpdate = false;
    holder.matrix.identity();
    if (turn) holder.matrix.fromArray(turn);
    stage.position.set(0, 0, 0);
    stage.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    stage.position.set(-center.x, -box.min.y, -center.z);
    clear(extras);
    const span = Math.max(size.x, size.z, size.y * 0.6, 1e-6);
    const cell = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const half = Math.ceil(span * 1.4 / cell);
    const grid = new THREE.GridHelper(half * 2 * cell, half * 2, 0xd4a843, 0x1c3156);
    grid.material.transparent = true; grid.material.opacity = 0.55;
    extras.add(grid);
    const a = span * 0.09, z0 = size.z / 2 + a * 0.6;
    const shape = new THREE.Shape([new THREE.Vector2(-a * 0.35, 0), new THREE.Vector2(a * 0.35, 0), new THREE.Vector2(a * 0.35, a), new THREE.Vector2(a * 0.8, a), new THREE.Vector2(0, a * 2), new THREE.Vector2(-a * 0.8, a), new THREE.Vector2(-a * 0.35, a)]);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xd4a843, side: THREE.DoubleSide }));
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, span * 0.002, z0);
    extras.add(arrow);
    if (frame) {
      const r = Math.max(size.length() / 2, 1e-6);
      const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
      controls.target.set(0, size.y / 2, 0);
      camera.position.set(d * 0.62, size.y / 2 + d * 0.38, d * 0.68);
      camera.near = d / 200; camera.far = d * 40;
      camera.updateProjectionMatrix();
      controls.update();
    }
    dirty = true;
  }

  async function show(bytes, frame = true) {
    const mine = ++token;
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new Promise((resolve, reject) => loader.parse(copy, "", resolve, reject));
    if (mine !== token) return;
    clear(holder);
    model = gltf.scene;
    holder.add(model);
    setWire(wire);
    place(frame);
  }

  function setWire(on) {
    wire = on;
    if (model) model.traverse((o) => { for (const m of [].concat(o.material || [])) m.wireframe = on; });
    dirty = true;
  }

  function setTurn(matrix) {
    turn = matrix;
    place(true);
  }

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    resize();
    if (controls.update() || dirty) { dirty = false; renderer.render(scene, camera); }
  };
  loop();
  // canvas, camera, controls, the model on screen and a redraw request: what the touch up tool needs to paint on the model
  return { canvas, camera, controls, getModel: () => model, redraw() { dirty = true; }, show, setWire, setTurn, dispose() { cancelAnimationFrame(raf); clear(holder); clear(extras); renderer.dispose(); pmrem.dispose(); } };
}
