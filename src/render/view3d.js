/* Orbit view of the extruded plan. Three.js stays in this module so the
 * kernel (solid.js) stays testable without WebGL.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { extrudeDrawing, heightStamp, resolveHeight } from '../core/solid.js';
import { fmtFtIn } from '../core/format.js';

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let root = null;
let hud = null;
let canvas = null;
let running = false;
let onClose = null;
let lastSolid = null;
const _color = new THREE.Color();

function disposeObject(obj){
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material){
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function clearScene(){
  if (!scene) return;
  const keep = new Set();
  scene.children.slice().forEach(ch => {
    if (ch.userData && ch.userData.keep) return;
    scene.remove(ch);
    disposeObject(ch);
  });
  void keep;
}

function hexToInt(c){
  const s = String(c || '#d4a843').replace('#', '');
  const n = parseInt(s.length === 3 ? s[0]+s[0]+s[1]+s[1]+s[2]+s[2] : s, 16);
  return isFinite(n) ? n : 0xd4a843;
}

/* Document solids, modelled with BOX, CSG and the rest, join the scene in
 * the same mesh format the plan extrusion produces. */
function appendSolidRecords(solid, records){
  (records || []).forEach(rec => {
    const m = rec.mesh;
    if (!m || !m.faces || !m.faces.length) return;
    const positions = new Float32Array(m.faces.length * 9);
    let p = 0;
    for (const f of m.faces){
      for (const vi of f){
        const v = m.verts[vi];
        positions[p++] = v[0]; positions[p++] = v[1]; positions[p++] = v[2];
      }
    }
    const indices = new Uint32Array(m.faces.length * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    solid.meshes = (solid.meshes || []).concat([{
      positions, indices, color: '#00d4b8', kind: 'solid', opacity: 1, solidName: rec.name
    }]);
    /* Framing reads solid.bbox and solid.height; a modelled tower must be
     * inside the frame, or the camera parks inside it. */
    const bb = solid.bbox || [Infinity, Infinity, 0, -Infinity, -Infinity, 0];
    let zTop = solid.height || 0;
    for (const v of m.verts){
      bb[0] = Math.min(bb[0], v[0]); bb[1] = Math.min(bb[1], v[1]);
      bb[3] = Math.max(bb[3], v[0]); bb[4] = Math.max(bb[4], v[1]);
      zTop = Math.max(zTop, v[2]);
    }
    solid.bbox = bb;
    solid.height = zTop;
  });
}

function addMeshes(solid){
  clearScene();
  lastSolid = solid;
  const group = new THREE.Group();
  group.name = 'drawing';
  (solid.meshes || []).forEach(m => {
    const geo = new THREE.BufferGeometry();
    const pos = m.positions;
    const threePos = new Float32Array(pos.length);
    /* CAD Z-up (x, y_plan, z_height) → Three Y-up (x, height, y_plan). */
    for (let i = 0; i < pos.length; i += 3){
      threePos[i] = pos[i];
      threePos[i + 1] = pos[i + 2];
      threePos[i + 2] = pos[i + 1];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(threePos, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: hexToInt(m.color),
      roughness: m.kind === 'floor' ? 0.92 : 0.55,
      metalness: 0.04,
      transparent: m.opacity != null && m.opacity < 1,
      opacity: m.opacity == null ? 1 : m.opacity,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = m.kind === 'wall' || m.kind === 'door';
    mesh.receiveShadow = true;
    if (m.solidName) mesh.userData.solidName = m.solidName;
    group.add(mesh);
  });
  scene.add(group);

  const bb = solid.bbox;
  const cx = (bb[0] + bb[3]) / 2;
  const cz = (bb[1] + bb[4]) / 2;
  const spanX = Math.max(4, bb[3] - bb[0]);
  const spanZ = Math.max(4, bb[4] - bb[1]);
  const span = Math.max(spanX, spanZ, solid.height || 8);
  const grid = new THREE.GridHelper(Math.ceil(span / 2) * 4, Math.ceil(span), 0x1b2c4a, 0x122038);
  grid.position.set(cx, 0, cz);
  scene.add(grid);

  if (camera){
    camera.position.set(cx + span * 0.85, (solid.height || 8) * 1.7, cz + span * 0.95);
    camera.lookAt(cx, (solid.height || 8) * 0.35, cz);
    camera.near = 0.1;
    camera.far = Math.max(200, span * 20);
    camera.updateProjectionMatrix();
  }
  if (controls){
    controls.target.set(cx, (solid.height || 8) * 0.35, cz);
    controls.minDistance = 4;
    controls.maxDistance = span * 12;
    controls.update();
  }
  if (hud){
    const stamp = hud.querySelector('.v3d-stamp');
    if (stamp) stamp.textContent = heightStamp(solid);
    const ht = hud.querySelector('#v3dHeightVal');
    if (ht) ht.textContent = fmtFtIn(solid.height);
  }
  void _color;
}

function render(){
  if (!running || !renderer || !scene || !camera) return;
  renderer.render(scene, camera);
}

/* The animation tick is the only caller of controls.update(). With damping
 * on, update() dispatches 'change' whenever it moves the camera, and the
 * 'change' listener renders; if that listener also updated, a large camera
 * jump would recurse update -> change -> update until the stack ran out,
 * which is exactly what re-targeting the view after a drag did. */
function tick(){
  if (controls) controls.update();
  render();
}

function onResize(){
  if (!renderer || !camera || !root) return;
  const w = root.clientWidth || 1;
  const h = root.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}

function ensureDom(){
  root = document.getElementById('view3d');
  if (!root){
    root = document.createElement('div');
    root.id = 'view3d';
    document.body.appendChild(root);
  }
  canvas = document.getElementById('cv3d');
  if (!canvas){
    canvas = document.createElement('canvas');
    canvas.id = 'cv3d';
    root.appendChild(canvas);
  }
  hud = document.getElementById('v3dHud');
  if (!hud){
    hud = document.createElement('div');
    hud.id = 'v3dHud';
    hud.innerHTML = `
      <div class="v3d-stamp">8'-0" story ASSUMED</div>
      <div class="v3d-actions">
        <button type="button" id="v3dPlan">Plan</button>
        <button type="button" id="v3dHminus" title="Lower story">−</button>
        <button type="button" id="v3dHeightVal">8'-0"</button>
        <button type="button" id="v3dHplus" title="Raise story">+</button>
        <button type="button" id="v3dGlb">GLB</button>
      </div>
      <div class="v3d-hint">Drag to orbit · scroll to zoom · click a solid to select</div>
      <div class="v3d-sel" style="display:none;color:#d4a843;font-weight:600;margin-top:4px"></div>`;
    root.appendChild(hud);
  }
  root.style.display = 'block';
  document.body.classList.add('view3d');
}

function wireHud(hooks){
  const plan = document.getElementById('v3dPlan');
  const plus = document.getElementById('v3dHplus');
  const minus = document.getElementById('v3dHminus');
  const glb = document.getElementById('v3dGlb');
  if (plan) plan.onclick = () => hideView3d();
  const step = 1;
  if (plus) plus.onclick = () => hooks.onHeight && hooks.onHeight((lastSolid && lastSolid.height || 8) + step);
  if (minus) minus.onclick = () => hooks.onHeight && hooks.onHeight(Math.max(6, (lastSolid && lastSolid.height || 8) - step));
  if (glb) glb.onclick = () => exportGlb(hooks.download);
}

function exportGlb(download){
  if (!scene) return;
  const exporter = new GLTFExporter();
  const drawing = scene.getObjectByName('drawing');
  exporter.parse(drawing || scene, (res) => {
    const buf = res instanceof ArrayBuffer ? res : new TextEncoder().encode(JSON.stringify(res)).buffer;
    if (download) download('model.glb', buf, 'model/gltf-binary');
  }, (err) => { console.warn(err); }, { binary: true });
}

/* ---------- touching the model ----------
 * Click a solid to select it; drag a selected solid to move it in plan,
 * hold shift to move it vertically. A click on empty space or an unselected
 * face orbits, so the camera never fights the hand. The live drag moves the
 * three.js meshes only; the document move commits once on release through
 * the onSolidMove hook, so the whole drag is one undo step.
 */
const pick = {
  raycaster: null,
  selected: null,        /* solid name */
  meshes: [],            /* three meshes of the selected solid */
  dragging: false,
  moved: [0, 0, 0],
  grab: null,            /* three-space point where the drag took hold */
  down: null,
  onSolidMove: null,
  onSolidInfo: null
};

function solidMeshesByName(name){
  const out = [];
  if (!scene) return out;
  scene.traverse(ch => { if (ch.userData && ch.userData.solidName === name) out.push(ch); });
  return out;
}

function setSelected(name){
  /* Clear the old highlight. */
  pick.meshes.forEach(m => { if (m.material && m.material.emissive) m.material.emissive.setHex(0x000000); });
  pick.selected = name || null;
  pick.meshes = name ? solidMeshesByName(name) : [];
  pick.meshes.forEach(m => { if (m.material && m.material.emissive) m.material.emissive.setHex(0x8a6a1a); });
  const el = hud && hud.querySelector('.v3d-sel');
  if (el){
    el.textContent = name ? name + ' — drag to move · shift-drag to lift · esc to deselect' : '';
    el.style.display = name ? 'block' : 'none';
  }
  if (pick.onSolidInfo) pick.onSolidInfo(name);
  render();
}

function ndcFromEvent(ev){
  const r = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * 2 - 1,
    y: -((ev.clientY - r.top) / r.height) * 2 + 1
  };
}

function raycastSolid(ev){
  if (!pick.raycaster) pick.raycaster = new THREE.Raycaster();
  const ndc = ndcFromEvent(ev);
  pick.raycaster.setFromCamera(ndc, camera);
  const hits = pick.raycaster.intersectObjects(scene.children, true)
    .filter(h => h.object.userData && h.object.userData.solidName);
  return hits.length ? hits[0] : null;
}

/* Where the drag ray meets the drag plane: the ground plane through the
 * grab point for a plan move, a camera-facing vertical plane for a lift. */
function dragPoint(ev, vertical){
  const ndc = ndcFromEvent(ev);
  pick.raycaster.setFromCamera(ndc, camera);
  const plane = vertical
    ? new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(camera.position.x - pick.grab.x, 0, camera.position.z - pick.grab.z).normalize(),
        pick.grab)
    : new THREE.Plane(new THREE.Vector3(0, 1, 0), -pick.grab.y);
  const out = new THREE.Vector3();
  return pick.raycaster.ray.intersectPlane(plane, out) ? out : null;
}

function wirePicking(){
  if (canvas._pickWired) return;
  canvas._pickWired = true;

  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    pick.down = { x: ev.clientX, y: ev.clientY };
    const hit = raycastSolid(ev);
    if (hit && hit.object.userData.solidName === pick.selected){
      /* Grabbing the selected solid starts a move; the camera stays put. */
      pick.dragging = true;
      pick.moved = [0, 0, 0];
      pick.grab = hit.point.clone();
      if (controls) controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', ev => {
    if (!pick.dragging || !pick.grab) return;
    const at = dragPoint(ev, ev.shiftKey);
    if (!at) return;
    const d3 = at.clone().sub(pick.grab);
    /* three (x, y, z) is CAD (x, height, y). */
    const delta = ev.shiftKey ? [0, 0, d3.y] : [d3.x, d3.z, 0];
    const shift = [delta[0] - pick.moved[0], delta[2] - pick.moved[2], delta[1] - pick.moved[1]];
    pick.meshes.forEach(m => { m.position.x += shift[0]; m.position.y += shift[1]; m.position.z += shift[2]; });
    pick.moved = delta;
    render();
  });

  canvas.addEventListener('pointerup', ev => {
    const wasDrag = pick.dragging;
    pick.dragging = false;
    if (controls) controls.enabled = true;
    if (wasDrag){
      const [dx, dy, dz] = pick.moved;
      /* Reset the preview offset; the document move re-meshes the scene. */
      pick.meshes.forEach(m => { m.position.set(0, 0, 0); });
      if ((dx || dy || dz) && pick.onSolidMove) pick.onSolidMove(pick.selected, dx, dy, dz);
      else render();
      return;
    }
    /* No drag: a small click selects what it hit, or clears. */
    if (pick.down && Math.hypot(ev.clientX - pick.down.x, ev.clientY - pick.down.y) < 5){
      const hit = raycastSolid(ev);
      setSelected(hit ? hit.object.userData.solidName : null);
    }
  });

  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && running && pick.selected) setSelected(null);
  });
}

/* The selection survives a re-mesh, because a move rebuilds the scene. */
function reapplySelection(){
  if (pick.selected) setSelected(pick.selected);
}

export function isView3dOpen(){
  return running;
}

export function showView3d(opts){
  const o = opts || {};
  onClose = o.onClose || null;
  ensureDom();
  if (!renderer){
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x07101f, 1);
    renderer.shadowMap.enabled = true;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07101f, 80, 220);
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const hemi = new THREE.HemisphereLight(0xc8d8f0, 0x1a140c, 0.7);
    hemi.userData.keep = 1;
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.05);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.userData.keep = 1;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88a0c0, 0.25);
    fill.position.set(-30, 20, -40);
    fill.userData.keep = 1;
    scene.add(fill);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', render);
  }
  wireHud(o);
  pick.onSolidMove = o.onSolidMove || null;
  pick.onSolidInfo = o.onSolidInfo || null;
  wirePicking();
  const solid = extrudeDrawing(o.entities || [], {
    height: o.height,
    assumed: o.assumed,
    layers: o.layers || []
  });
  appendSolidRecords(solid, o.solids);
  addMeshes(solid);
  reapplySelection();
  running = true;
  onResize();
  renderer.setAnimationLoop(tick);
  window.addEventListener('resize', onResize);
  return solid;
}

export function syncView3d(opts){
  if (!running) return null;
  const o = opts || {};
  const solid = extrudeDrawing(o.entities || [], {
    height: o.height,
    assumed: o.assumed,
    layers: o.layers || []
  });
  appendSolidRecords(solid, o.solids);
  addMeshes(solid);
  reapplySelection();
  render();
  return solid;
}

export function hideView3d(){
  running = false;
  if (renderer) renderer.setAnimationLoop(null);
  window.removeEventListener('resize', onResize);
  if (root) root.style.display = 'none';
  document.body.classList.remove('view3d');
  if (typeof onClose === 'function') onClose();
}

export function disposeView3d(){
  hideView3d();
  if (controls){ controls.dispose(); controls = null; }
  if (scene){ disposeObject(scene); scene = null; }
  if (renderer){ renderer.dispose(); renderer = null; }
  camera = null;
  lastSolid = null;
}

export { resolveHeight };
