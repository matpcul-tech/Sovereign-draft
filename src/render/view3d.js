/* Orbit view of the extruded plan. Three.js stays in this module so the
 * kernel (solid.js) stays testable without WebGL.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { extrudeDrawing, heightStamp, resolveHeight } from '../core/solid.js';
import { fmtFtIn } from '../core/format.js';
import { meshBBox } from '../core/mesh.js';

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
 *
 * Precision is what separates the drag from a demo:
 * - the delta snaps to a half-foot grid, and to the faces and centres of
 *   every other solid when it comes within tolerance, so a box lands flush
 *   against its neighbour exactly (hold alt to move free);
 * - the live delta reads out in the HUD while dragging;
 * - typing a number mid-drag and pressing Enter sets the distance exactly,
 *   along whichever axis the drag was going (a leading minus reverses it);
 * - ctrl-drag commits a copy instead of a move;
 * - R toggles rotate mode: dragging turns the solid about its own plan
 *   centre in 15 degree steps (shift for 1 degree), typed degrees exact.
 */
const GRID_STEP = 0.5;
const FACE_TOL = 0.45;

const pick = {
  raycaster: null,
  selected: null,        /* solid name */
  meshes: [],            /* three meshes of the selected solid */
  mode: 'move',          /* or 'rotate' */
  dragging: false,
  copying: false,
  copyMeshes: [],
  moved: [0, 0, 0],
  rotDeg: 0,
  typed: '',
  snapFace: false,
  grab: null,            /* three-space point where the drag took hold */
  down: null,
  bboxSelf: null,        /* CAD bbox of the grabbed solid, at grab time */
  edges: null,           /* face and centre positions of every other solid */
  pivot: null,           /* three-space plan centre for rotation */
  onSolidMove: null,
  onSolidInfo: null,
  onSolidCopy: null,
  onSolidRotate: null
};

let lastSolidsList = [];

/* Face snap first, grid snap second. The moving box offers its low edge,
 * centre and high edge; the smallest correction inside tolerance wins. */
function snapAxis(d, lo, hi, edges){
  const mid = (lo + hi) / 2;
  let best = null;
  for (const m of [lo, mid, hi]){
    for (const e of edges){
      const corr = e - (m + d);
      if (Math.abs(corr) < FACE_TOL && (best == null || Math.abs(corr) < Math.abs(best))) best = corr;
    }
  }
  if (best != null) return { d: d + best, face: true };
  return { d: Math.round(d / GRID_STEP) * GRID_STEP, face: false };
}

function collectSnapData(name){
  const self = lastSolidsList.find(s => s && s.name === name);
  pick.bboxSelf = self ? meshBBox(self.mesh) : null;
  pick.edges = { x: [], y: [], z: [] };
  for (const s of lastSolidsList){
    if (!s || s.name === name) continue;
    const bb = meshBBox(s.mesh);
    pick.edges.x.push(bb[0], bb[3], (bb[0] + bb[3]) / 2);
    pick.edges.y.push(bb[1], bb[4], (bb[1] + bb[4]) / 2);
    pick.edges.z.push(bb[2], bb[5]);
  }
  pick.pivot = pick.bboxSelf
    ? { x: (pick.bboxSelf[0] + pick.bboxSelf[3]) / 2, z: (pick.bboxSelf[1] + pick.bboxSelf[4]) / 2 }
    : null;
}

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
  if (!name) pick.mode = 'move';
  const el = hud && hud.querySelector('.v3d-sel');
  if (el){
    el.textContent = !name ? ''
      : pick.mode === 'rotate'
        ? name + ' · rotate: drag turns in 15° steps (shift 1°) · type degrees, Enter · R back to move · esc'
        : name + ' · drag moves · shift lifts · ctrl copies · R rotates · type a distance, Enter · esc';
    el.style.display = name ? 'block' : 'none';
  }
  if (pick.onSolidInfo) pick.onSolidInfo(name);
  render();
}

/* The live readout while a drag is in flight. */
function dragHud(){
  const el = hud && hud.querySelector('.v3d-sel');
  if (!el || !pick.dragging) return;
  if (pick.mode === 'rotate'){
    el.textContent = pick.selected + ' · ' + pick.rotDeg + '°' +
      (pick.typed ? ' · type: ' + pick.typed + '° Enter' : '');
  } else {
    const [dx, dy, dz] = pick.moved;
    el.textContent = pick.selected + (pick.copying ? ' copy' : '') +
      ' · dx ' + fmtFtIn(dx) + ' · dy ' + fmtFtIn(dy) +
      (dz ? ' · dz ' + fmtFtIn(dz) : '') +
      (pick.snapFace ? ' · face' : '') +
      (pick.typed ? ' · type: ' + pick.typed + ' Enter' : '');
  }
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

/* A copy drags a translucent ghost; the originals stay put. The ghost
 * shares geometry with the source and owns only its cloned material. */
function makeCopyPreview(){
  pick.copyMeshes = pick.meshes.map(m => {
    const c = new THREE.Mesh(m.geometry, m.material.clone());
    c.material.transparent = true;
    c.material.opacity = 0.7;
    scene.add(c);
    return c;
  });
}

function removeCopyPreview(){
  pick.copyMeshes.forEach(c => { scene.remove(c); c.material.dispose(); });
  pick.copyMeshes = [];
}

function movingMeshes(){
  return pick.copying ? pick.copyMeshes : pick.meshes;
}

function resetPreview(){
  pick.meshes.forEach(m => { m.position.set(0, 0, 0); m.rotation.y = 0; });
  removeCopyPreview();
}

function endDrag(){
  pick.dragging = false;
  pick.typed = '';
  pick.snapFace = false;
  if (controls) controls.enabled = true;
}

function cancelDrag(){
  endDrag();
  pick.copying = false;
  resetPreview();
  setSelected(pick.selected);
}

function commitMove(delta){
  const wasCopy = pick.copying;
  endDrag();
  pick.copying = false;
  resetPreview();
  const [dx, dy, dz] = delta;
  if (!(dx || dy || dz)){ setSelected(pick.selected); return; }
  if (wasCopy && pick.onSolidCopy){
    Promise.resolve(pick.onSolidCopy(pick.selected, dx, dy, dz))
      .then(n => { if (n) setSelected(n); });
  } else if (!wasCopy && pick.onSolidMove){
    pick.onSolidMove(pick.selected, dx, dy, dz);
  } else render();
}

function commitRotate(deg){
  endDrag();
  pick.copying = false;
  resetPreview();
  if (deg && pick.onSolidRotate) pick.onSolidRotate(pick.selected, deg);
  else setSelected(pick.selected);
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
      pick.typed = '';
      pick.moved = [0, 0, 0];
      pick.rotDeg = 0;
      pick.grab = hit.point.clone();
      collectSnapData(pick.selected);
      pick.copying = pick.mode === 'move' && (ev.ctrlKey || ev.metaKey);
      if (pick.copying) makeCopyPreview();
      if (controls) controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', ev => {
    if (!pick.dragging || !pick.grab) return;
    if (pick.mode === 'rotate'){
      const snap = ev.shiftKey ? 1 : 15;
      pick.rotDeg = Math.round(((ev.clientX - pick.down.x) * 0.4) / snap) * snap;
      /* CAD rotates counterclockwise about +z; in three's Y-up frame that
       * is a negative Y rotation. World transform T(pos) R means the
       * pivot stays put when pos = P - R P. */
      const rad = -pick.rotDeg * Math.PI / 180;
      const p = pick.pivot || { x: 0, z: 0 };
      const c = Math.cos(rad), s = Math.sin(rad);
      const rx = p.x * c + p.z * s;
      const rz = -p.x * s + p.z * c;
      pick.meshes.forEach(m => { m.rotation.y = rad; m.position.set(p.x - rx, 0, p.z - rz); });
      dragHud();
      render();
      return;
    }
    const at = dragPoint(ev, ev.shiftKey);
    if (!at) return;
    const d3 = at.clone().sub(pick.grab);
    /* three (x, y, z) is CAD (x, height, y). */
    const delta = ev.shiftKey ? [0, 0, d3.y] : [d3.x, d3.z, 0];
    pick.snapFace = false;
    if (!ev.altKey && pick.bboxSelf){
      const bb = pick.bboxSelf;
      if (ev.shiftKey){
        const sz = snapAxis(delta[2], bb[2], bb[5], pick.edges.z);
        delta[2] = sz.d;
        pick.snapFace = sz.face;
      } else {
        const sx = snapAxis(delta[0], bb[0], bb[3], pick.edges.x);
        const sy = snapAxis(delta[1], bb[1], bb[4], pick.edges.y);
        delta[0] = sx.d;
        delta[1] = sy.d;
        pick.snapFace = sx.face || sy.face;
      }
    }
    pick.moved = delta;
    movingMeshes().forEach(m => { m.position.set(delta[0], delta[2], delta[1]); });
    dragHud();
    render();
  });

  canvas.addEventListener('pointerup', ev => {
    if (pick.dragging){
      if (pick.mode === 'rotate') commitRotate(pick.rotDeg);
      else commitMove(pick.moved);
      return;
    }
    if (controls) controls.enabled = true;
    /* No drag: a small click selects what it hit, or clears. */
    if (pick.down && Math.hypot(ev.clientX - pick.down.x, ev.clientY - pick.down.y) < 5){
      const hit = raycastSolid(ev);
      setSelected(hit ? hit.object.userData.solidName : null);
    }
  });

  /* Capture phase, because the app's own document-level key handler runs
   * first otherwise and does the wrong thing mid-interaction: Escape would
   * close the whole 3D view under a drag, and a plain letter would focus
   * the command line, which then swallows ctrl-z for good. Keys the 3D
   * interaction owns stop here; everything else falls through, so Escape
   * with nothing selected still returns to the plan. */
  window.addEventListener('keydown', ev => {
    if (!running) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (ev.key === 'Escape'){
      if (pick.dragging){ cancelDrag(); ev.preventDefault(); ev.stopPropagation(); }
      else if (pick.selected && pick.mode === 'rotate'){
        pick.mode = 'move'; setSelected(pick.selected);
        ev.preventDefault(); ev.stopPropagation();
      } else if (pick.selected){
        setSelected(null);
        ev.preventDefault(); ev.stopPropagation();
      }
      return;
    }
    if (pick.dragging){
      /* While a drag is in flight the 2D command line gets nothing. */
      ev.stopPropagation();
      if (/^[0-9.\-]$/.test(ev.key)){
        pick.typed += ev.key;
        dragHud(); render(); ev.preventDefault();
      } else if (ev.key === 'Backspace'){
        pick.typed = pick.typed.slice(0, -1);
        dragHud(); render(); ev.preventDefault();
      } else if (ev.key === 'Enter' && pick.typed){
        const n = parseFloat(pick.typed);
        if (isFinite(n)){
          if (pick.mode === 'rotate') commitRotate(n);
          else {
            /* The typed number sets the distance along whichever axis the
             * drag was going; a leading minus reverses the direction. */
            const [dx, dy, dz] = pick.moved;
            const ax = Math.abs(dz) >= Math.abs(dx) && Math.abs(dz) >= Math.abs(dy) ? 2
              : (Math.abs(dy) > Math.abs(dx) ? 1 : 0);
            const d = [0, 0, 0];
            d[ax] = ([dx, dy, dz][ax] < 0 ? -1 : 1) * n;
            commitMove(d);
          }
        }
        ev.preventDefault();
      }
      return;
    }
    if ((ev.key === 'r' || ev.key === 'R') && pick.selected && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
      pick.mode = pick.mode === 'rotate' ? 'move' : 'rotate';
      setSelected(pick.selected);
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
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
  pick.onSolidCopy = o.onSolidCopy || null;
  pick.onSolidRotate = o.onSolidRotate || null;
  wirePicking();
  lastSolidsList = o.solids || [];
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
  lastSolidsList = o.solids || [];
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
  if (pick.dragging) cancelDrag();
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
