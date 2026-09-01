/* Orbit view of the extruded plan. Three.js stays in this module so the
 * kernel (solid.js) stays testable without WebGL.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { extrudeDrawing, heightStamp, resolveHeight } from '../core/solid.js';
import { fmtFtIn } from '../core/format.js';
import {
  meshBBox, meshVolume, isWatertight, mergeMeshes,
  makeBox, makeCylinder, makeSphere, makeCone
} from '../core/mesh.js';
import { pushPullPrism } from '../core/model3d.js';
import { sunVector } from '../core/sun.js';
import { samplePath, easeInOut } from '../core/campath.js';

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let root = null;
let hud = null;
let canvas = null;
let running = false;
let framedOnce = false;
let onClose = null;
let lastSolid = null;
let lastSun = null;
let lastMaterials = {};
let sunLight = null;
let hemiLight = null;
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

function materialFor(m){
  const mats = lastMaterials || {};
  const keys = [];
  if (m.solidName){
    keys.push(String(m.solidName).toUpperCase());
    keys.push(String(m.solidName).toUpperCase().replace(/-L?\d+$/, ''));
  }
  if (m.layer) keys.push(String(m.layer).toUpperCase());
  if (m.kind) keys.push(String(m.kind).toUpperCase());
  for (const k of keys){ if (mats[k]) return mats[k]; }
  return null;
}

/* The study sun: real azimuth and elevation drive the light, the shadow
 * camera hugs the model, and a shadow-only ground plane catches what the
 * building throws. Below the horizon the scene says night rather than
 * lighting from underground. */
function applySun(solid){
  if (!sunLight) return;
  const bb = solid.bbox;
  const cx = (bb[0] + bb[3]) / 2, cz = (bb[1] + bb[4]) / 2;
  const span = Math.max(bb[3] - bb[0], bb[4] - bb[1], solid.height || 8, 4);
  if (lastSun){
    const v = sunVector(lastSun);
    const up = Math.max(0.02, v.z);
    /* CAD (x, y, z) is three (x, z, y). */
    sunLight.position.set(cx + v.x * span * 2, up * span * 2, cz + v.y * span * 2);
    sunLight.target.position.set(cx, 0, cz);
    sunLight.intensity = v.z > 0 ? 1.5 : 0.05;
    sunLight.color.setHex(v.elevation < 15 ? 0xffc890 : 0xfff4e0);
    if (hemiLight) hemiLight.intensity = v.z > 0 ? 0.35 : 0.15;
    const cam = sunLight.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 0.5; cam.far = span * 6;
    cam.updateProjectionMatrix();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 6, span * 6),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, cz);
    ground.receiveShadow = true;
    scene.add(ground);
  } else {
    sunLight.position.set(cx + span, span * 1.6, cz + span * 0.6);
    sunLight.target.position.set(cx, 0, cz);
    sunLight.intensity = 1.05;
    sunLight.color.setHex(0xfff1d6);
    if (hemiLight) hemiLight.intensity = 0.7;
  }
}

/* A drag leaves damping velocity that keeps the camera coasting for a
 * second after the mouse is up. Anything that captures the camera as
 * data freezes that coast first, so what is saved is what is seen. */
function freezeCoast(){
  if (!controls) return;
  const d = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = d;
}

/* The camera as data, for saved views. */
export function getCamera3d(){
  if (!camera || !controls) return null;
  freezeCoast();
  return {
    pos: [camera.position.x, camera.position.z, camera.position.y],
    target: [controls.target.x, controls.target.z, controls.target.y],
    fov: camera.fov
  };
}

export function setCamera3d(v){
  if (!camera || !controls || !v) return false;
  /* Damping keeps applying leftover drag velocity on later ticks, which
   * would drift the restored camera. Flush it with damping off first. */
  controls.enableDamping = false;
  controls.update();
  camera.position.set(v.pos[0], v.pos[2], v.pos[1]);
  controls.target.set(v.target[0], v.target[2], v.target[1]);
  camera.fov = v.fov || 50;
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = true;
  render();
  return true;
}

/* A still frame at print resolution: the same scene through an offscreen
 * renderer, returned as a PNG data URL. With level=true the camera is made
 * horizontal and the framing recovered with a film offset, the two point
 * perspective of an architectural rendering: verticals stay vertical. */
export function renderStill(width, level){
  if (!scene || !camera) return null;
  const w = Math.max(320, Math.min(4096, Math.round(Number(width) || 1920)));
  const h = Math.round(w * 9 / 16);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(lastSun ? 0x18304a : 0x07101f, 1);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const cam = camera.clone();
  cam.aspect = w / h;
  if (level && controls){
    /* Look horizontally from the same eye, then shift the film to bring
     * the original target back into frame. */
    const eye = camera.position.clone();
    const tgt = controls.target.clone();
    const flat = tgt.clone(); flat.y = eye.y;
    cam.position.copy(eye);
    cam.up.set(0, 1, 0);
    cam.lookAt(flat);
    const dist = eye.distanceTo(flat) || 1;
    const rise = tgt.y - eye.y;
    const halfFilm = Math.tan((cam.fov / 2) * Math.PI / 180) * dist;
    const shift = (rise / (2 * halfFilm)) * h;
    cam.setViewOffset(w, h, 0, Math.max(-h, Math.min(h, -shift)), w, h);
  }
  cam.updateProjectionMatrix();
  r.render(scene, cam);
  const url = cv.toDataURL('image/png');
  r.dispose();
  return { url, w, h };
}

/* A turntable: the camera orbits the target once while the live canvas is
 * captured to WebM. Falls back to null where MediaRecorder cannot record
 * a canvas stream. */
export function renderTurntable(seconds){
  if (!canvas || !camera || !controls || typeof MediaRecorder === 'undefined') return Promise.resolve(null);
  const secs = Math.max(2, Math.min(20, Number(seconds) || 6));
  let stream;
  try { stream = canvas.captureStream(30); } catch (e){ return Promise.resolve(null); }
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
  catch (e){
    try { rec = new MediaRecorder(stream); } catch (e2){ return Promise.resolve(null); }
  }
  const chunks = [];
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  freezeCoast();
  const eye0 = camera.position.clone();
  const tgt = controls.target.clone();
  const r0 = Math.hypot(eye0.x - tgt.x, eye0.z - tgt.z);
  const y0 = eye0.y;
  const a0 = Math.atan2(eye0.z - tgt.z, eye0.x - tgt.x);
  const t0 = performance.now();
  return new Promise(resolve => {
    const spin = () => {
      const t = (performance.now() - t0) / (secs * 1000);
      if (t >= 1){
        camera.position.copy(eye0);
        controls.update();
        render();
        rec.stop();
        return;
      }
      const a = a0 + t * Math.PI * 2;
      camera.position.set(tgt.x + r0 * Math.cos(a), y0, tgt.z + r0 * Math.sin(a));
      camera.lookAt(tgt);
      render();
      requestAnimationFrame(spin);
    };
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null);
    rec.start(200);
    requestAnimationFrame(spin);
  });
}

/* A walkthrough: the camera rides a Catmull-Rom spline through saved
 * views (CAD-order pos/target triples) and the canvas is recorded to a
 * webm, same machinery as the turntable. Eased so it starts and stops
 * gently. Resolves the Blob, or null where recording is impossible. */
export function renderWalkthrough(views, seconds){
  if (!canvas || !camera || !controls || typeof MediaRecorder === 'undefined') return Promise.resolve(null);
  if (!views || views.length < 2) return Promise.resolve(null);
  const secs = Math.max(2, Math.min(60, Number(seconds) || 8));
  let stream;
  try { stream = canvas.captureStream(30); } catch (e){ return Promise.resolve(null); }
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
  catch (e){
    try { rec = new MediaRecorder(stream); } catch (e2){ return Promise.resolve(null); }
  }
  const chunks = [];
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  freezeCoast();
  const eye0 = camera.position.clone();
  const tgt0 = controls.target.clone();
  const fov0 = camera.fov;
  const t0 = performance.now();
  return new Promise(resolve => {
    const step = () => {
      const t = (performance.now() - t0) / (secs * 1000);
      if (t >= 1){
        camera.position.copy(eye0);
        controls.target.copy(tgt0);
        camera.fov = fov0;
        camera.updateProjectionMatrix();
        controls.update();
        render();
        rec.stop();
        return;
      }
      const s = samplePath(views, easeInOut(t));
      /* CAD Z-up (x, y_plan, z_height) -> Three Y-up (x, height, y_plan). */
      camera.position.set(s.pos[0], s.pos[2], s.pos[1]);
      controls.target.set(s.target[0], s.target[2], s.target[1]);
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      render();
      requestAnimationFrame(step);
    };
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null);
    rec.start(200);
    requestAnimationFrame(step);
  });
}

function addMeshes(solid){
  clearScene();
  /* The scene rebuild took the measure marks with it. */
  meas.marks = [];
  meas.a = null;
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
    /* Document materials override the layer colour: by solid name, then
     * the name with its level or copy suffix stripped, then layer, then
     * kind, so MAT ROOF paints ROOF, ROOF-2 and every level of it. */
    const ov = materialFor(m);
    const mat = new THREE.MeshStandardMaterial({
      color: hexToInt(ov ? ov.color : m.color),
      roughness: ov ? ov.rough : (m.kind === 'floor' ? 0.92 : 0.55),
      metalness: ov ? ov.metal : 0.04,
      transparent: m.opacity != null && m.opacity < 1,
      opacity: m.opacity == null ? 1 : m.opacity,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
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

  /* Frame the model once per opening of the view. Later rebuilds (a wall
   * moved, a material set, a view saved: anything that syncs the scene)
   * keep the camera where the user put it; only the clip planes and the
   * orbit limits follow the new extents. */
  if (camera){
    if (!framedOnce){
      camera.position.set(cx + span * 0.85, (solid.height || 8) * 1.7, cz + span * 0.95);
      camera.lookAt(cx, (solid.height || 8) * 0.35, cz);
      framedOnce = true;
      if (controls) controls.target.set(cx, (solid.height || 8) * 0.35, cz);
    }
    camera.near = 0.1;
    camera.far = Math.max(200, span * 20);
    camera.updateProjectionMatrix();
  }
  if (controls){
    controls.minDistance = 4;
    controls.maxDistance = span * 12;
    controls.update();
  }
  if (hud){
    const stamp = hud.querySelector('.v3d-stamp');
    if (stamp){
      if (lastSolidsList && lastSolidsList.length){
        const m = mergeMeshes(lastSolidsList.map(s => s.mesh).filter(Boolean));
        const n = lastSolidsList.length;
        stamp.textContent = n + ' solid' + (n === 1 ? '' : 's')
          + ' · ' + Math.abs(meshVolume(m)).toFixed(2) + ' CF'
          + (isWatertight(m) ? ' · closed' : ' · NOT closed');
      } else {
        stamp.textContent = heightStamp(solid);
      }
    }
    const ht = hud.querySelector('#v3dHeightVal');
    if (ht) ht.textContent = fmtFtIn(placeH);
  }
  applySun(solid);
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
      <div class="v3d-stamp">Mesh solids · not B-rep</div>
      <div class="v3d-actions">
        <button type="button" id="v3dPlan">Plan</button>
        <button type="button" id="v3dIso">ISO</button>
        <button type="button" id="v3dTop">TOP</button>
        <button type="button" id="v3dFront">FRONT</button>
        <button type="button" id="v3dRight">RIGHT</button>
        <button type="button" id="v3dHminus" title="Lower">−</button>
        <button type="button" id="v3dHeightVal">1'-0"</button>
        <button type="button" id="v3dHplus" title="Raise">+</button>
        <button type="button" id="v3dStl">STL</button>
        <button type="button" id="v3dObj">OBJ</button>
        <button type="button" id="v3dGlb">GLB</button>
      </div>
      <div class="v3d-hint">BOX on the rail · drag a footprint · click a solid to move it · M measures</div>
      <div class="v3d-sel" style="display:none;color:#d4a843;font-weight:600;margin-top:4px"></div>`;
    root.appendChild(hud);
  }
  if (!document.getElementById('v3dRail')){
    const rail = document.createElement('div');
    rail.id = 'v3dRail';
    rail.innerHTML = `
      <button type="button" data-tool3d="orbit">ORBIT</button>
      <button type="button" data-tool3d="box">BOX</button>
      <button type="button" data-tool3d="cyl">CYL</button>
      <button type="button" data-tool3d="sphere">SPH</button>
      <button type="button" data-tool3d="cone">CONE</button>
      <button type="button" data-act="union">UNI</button>
      <button type="button" data-act="subtract">SUB</button>
      <button type="button" data-act="sample">PART</button>
      <button type="button" data-act="stl">STL</button>`;
    root.appendChild(rail);
  }
  root.style.display = 'block';
  document.body.classList.add('view3d');
}

function wireHud(hooks){
  const plan = document.getElementById('v3dPlan');
  const plus = document.getElementById('v3dHplus');
  const minus = document.getElementById('v3dHminus');
  const glb = document.getElementById('v3dGlb');
  const stl = document.getElementById('v3dStl');
  const obj = document.getElementById('v3dObj');
  if (plan) plan.onclick = () => hideView3d();
  const step = 0.5;
  if (plus) plus.onclick = () => {
    placeH = Math.min(40, placeH + step);
    const el = document.getElementById('v3dHeightVal');
    if (el) el.textContent = fmtFtIn(placeH);
    if (hooks.onSolidHeight) hooks.onSolidHeight(placeH);
  };
  if (minus) minus.onclick = () => {
    placeH = Math.max(0.25, placeH - step);
    const el = document.getElementById('v3dHeightVal');
    if (el) el.textContent = fmtFtIn(placeH);
    if (hooks.onSolidHeight) hooks.onSolidHeight(placeH);
  };
  if (glb) glb.onclick = () => exportGlb(hooks.download);
  if (stl) stl.onclick = () => hooks.onStl && hooks.onStl();
  if (obj) obj.onclick = () => hooks.onObj && hooks.onObj();
  ['v3dIso', 'v3dTop', 'v3dFront', 'v3dRight'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.onclick = () => frameStandard(id.replace('v3d', '').toLowerCase());
  });
  const rail = document.getElementById('v3dRail');
  if (rail && !rail._wired){
    rail._wired = 1;
    rail.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.tool3d){ setTool3dView(b.dataset.tool3d); return; }
      const act = b.dataset.act;
      if (act === 'union' && hooks.onBool) hooks.onBool('union');
      else if (act === 'subtract' && hooks.onBool) hooks.onBool('subtract');
      else if (act === 'sample' && hooks.onSample) hooks.onSample();
      else if (act === 'stl' && hooks.onStl) hooks.onStl();
    });
  }
  const hv = document.getElementById('v3dHeightVal');
  if (hv) hv.textContent = fmtFtIn(placeH);
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
  ppFace: -1,
  ppN3: null,
  ppDist: 0,
  ppGhost: null,
  onSolidMove: null,
  onSolidInfo: null,
  onSolidCopy: null,
  onSolidRotate: null,
  onSolidFace: null
};

let lastSolidsList = [];
let viewHooks = {};
let placeH = 1;

const PLACING = { box: 1, cyl: 1, sphere: 1, cone: 1 };
const place = {
  tool: 'orbit',
  a: null,
  preview: null
};

function hitWorkplane(ev){
  if (!pick.raycaster) pick.raycaster = new THREE.Raycaster();
  const ndc = ndcFromEvent(ev);
  pick.raycaster.setFromCamera(ndc, camera);
  const out = new THREE.Vector3();
  if (!pick.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out)) return null;
  return [out.x, out.z, out.y];
}

function snapCad(p){
  const g = 0.5;
  return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g, p[2]];
}

function clearPlacePreview(){
  if (place.preview && scene){
    scene.remove(place.preview);
    if (place.preview.geometry) place.preview.geometry.dispose();
    if (place.preview.material) place.preview.material.dispose();
  }
  place.preview = null;
}

function cadMeshToThree(mesh, color){
  if (!mesh || !mesh.faces.length) return null;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.faces.length * 9);
  let p = 0;
  for (const f of mesh.faces){
    for (const vi of f){
      const v = mesh.verts[vi];
      pos[p++] = v[0]; pos[p++] = v[2]; pos[p++] = v[1];
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: color || 0xd4a843, transparent: true, opacity: 0.55, roughness: 0.5, side: THREE.DoubleSide
  });
  return new THREE.Mesh(geo, mat);
}

function primitiveAt(kind, a, b){
  const h = placeH > 0 ? placeH : 1;
  if (kind === 'box'){
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
    const w = Math.abs(b[0] - a[0]) || 0.5, d = Math.abs(b[1] - a[1]) || 0.5;
    return makeBox(x, y, 0, w, d, h);
  }
  if (kind === 'cyl'){
    const r = Math.max(0.25, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return makeCylinder(a[0], a[1], 0, r, h, 32);
  }
  if (kind === 'sphere'){
    const r = Math.max(0.25, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return makeSphere(a[0], a[1], r, r, 24);
  }
  if (kind === 'cone'){
    const r = Math.max(0.25, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return makeCone(a[0], a[1], 0, r, h, 32);
  }
  return null;
}

function commitPlace(a, b){
  const mesh = primitiveAt(place.tool, a, b);
  place.a = null;
  clearPlacePreview();
  if (!mesh || !mesh.faces.length) return;
  if (viewHooks.onPlaceMesh) viewHooks.onPlaceMesh(mesh, place.tool);
}

export function setTool3dView(name){
  place.tool = name || 'orbit';
  place.a = null;
  clearPlacePreview();
  if (controls) controls.enabled = !PLACING[place.tool];
  document.querySelectorAll('#v3dRail button[data-tool3d]').forEach(b => {
    b.classList.toggle('on', b.dataset.tool3d === place.tool);
  });
  const hint = hud && hud.querySelector('.v3d-hint');
  if (hint){
    hint.textContent = place.tool === 'box' ? 'Drag a footprint on the workplane'
      : place.tool === 'cyl' ? 'Click center, drag radius'
      : place.tool === 'sphere' ? 'Click center, drag radius'
      : place.tool === 'cone' ? 'Click center, drag radius'
      : 'Drag to orbit · click a solid to select · M measures';
  }
}

function frameStandard(kind){
  const bb = lastSolid && lastSolid.bbox ? lastSolid.bbox : [-4, -4, 0, 4, 4, 8];
  const cx = (bb[0] + bb[3]) / 2, cz = (bb[1] + bb[4]) / 2;
  const h = lastSolid && lastSolid.height || 8;
  const span = Math.max(bb[3] - bb[0], bb[4] - bb[1], h, 4);
  if (!camera || !controls) return;
  if (kind === 'top') camera.position.set(cx, span * 2.2, cz + 0.01);
  else if (kind === 'front') camera.position.set(cx, h * 0.45, cz + span * 2);
  else if (kind === 'right') camera.position.set(cx + span * 2, h * 0.45, cz);
  else camera.position.set(cx + span * 0.85, h * 1.7, cz + span * 0.95);
  controls.target.set(cx, h * 0.35, cz);
  controls.update();
  render();
}

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
        : pick.mode === 'pushpull'
          ? name + ' · push-pull: drag a face along its normal · type a distance, Enter · P back to move · esc'
          : name + ' · drag moves · shift lifts · ctrl copies · R rotates · P push-pulls · type a distance, Enter · esc';
    el.style.display = name ? 'block' : 'none';
  }
  if (pick.onSolidInfo) pick.onSolidInfo(name);
  render();
}

/* The live readout while a drag is in flight. */
function dragHud(){
  const el = hud && hud.querySelector('.v3d-sel');
  if (!el || !pick.dragging) return;
  if (pick.mode === 'pushpull'){
    el.textContent = pick.selected + (pick.ppDist >= 0 ? ' · pull ' : ' · push ') + fmtFtIn(Math.abs(pick.ppDist)) +
      (pick.typed ? ' · type: ' + pick.typed + ' Enter' : '');
  } else if (pick.mode === 'rotate'){
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

/* ---------- measuring ----------
 * M toggles measure mode: two clicks give the true 3D distance between the
 * points hit, with the delta per axis. Points land on whatever surface the
 * click hits, or on the ground plane when it hits nothing.
 */
const meas = { on: false, a: null, marks: [] };

function clearMeasureMarks(){
  meas.marks.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  meas.marks = [];
}

function measureHud(text){
  const el = hud && hud.querySelector('.v3d-sel');
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function setMeasureMode(on){
  meas.on = on;
  meas.a = null;
  clearMeasureMarks();
  if (on) measureHud('MEASURE · click two points · M or esc to leave');
  else setSelected(pick.selected);
  render();
}

function markerRadius(){
  const solid = lastSolid;
  const bb = solid && solid.bbox;
  const span = bb ? Math.max(bb[3] - bb[0], bb[4] - bb[1], solid.height || 8) : 20;
  return Math.max(0.05, span * 0.008);
}

function addMark(pt){
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(markerRadius(), 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xd4a843 })
  );
  m.position.copy(pt);
  scene.add(m);
  meas.marks.push(m);
}

function measurePointFromEvent(ev){
  if (!pick.raycaster) pick.raycaster = new THREE.Raycaster();
  const ndc = ndcFromEvent(ev);
  pick.raycaster.setFromCamera(ndc, camera);
  const hits = pick.raycaster.intersectObjects(scene.children, true)
    .filter(h => h.object.isMesh && !meas.marks.includes(h.object));
  if (hits.length) return hits[0].point.clone();
  const out = new THREE.Vector3();
  return pick.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out) ? out : null;
}

function measureClick(ev){
  const pt = measurePointFromEvent(ev);
  if (!pt) return;
  if (!meas.a){
    clearMeasureMarks();
    meas.a = pt;
    addMark(pt);
    measureHud('MEASURE · first point set · click the second');
  } else {
    addMark(pt);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([meas.a, pt]),
      new THREE.LineBasicMaterial({ color: 0x00d4b8 })
    );
    scene.add(line);
    meas.marks.push(line);
    /* three (x, y, z) is CAD (x, height, y). */
    const dx = pt.x - meas.a.x, dy = pt.z - meas.a.z, dz = pt.y - meas.a.y;
    const d = Math.hypot(dx, dy, dz);
    measureHud('MEASURE · ' + fmtFtIn(d) + ' · dx ' + fmtFtIn(Math.abs(dx)) +
      ' · dy ' + fmtFtIn(Math.abs(dy)) + ' · dz ' + fmtFtIn(Math.abs(dz)));
    meas.a = null;
  }
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

function removePpGhost(){
  if (pick.ppGhost){
    scene.remove(pick.ppGhost);
    if (pick.ppGhost.geometry) pick.ppGhost.geometry.dispose();
    if (pick.ppGhost.material) pick.ppGhost.material.dispose();
    pick.ppGhost = null;
  }
}

function resetPreview(){
  pick.meshes.forEach(m => { m.position.set(0, 0, 0); m.rotation.y = 0; });
  removeCopyPreview();
  removePpGhost();
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

function commitPushPull(dist){
  endDrag();
  resetPreview();
  if (dist && pick.ppFace >= 0 && pick.onSolidFace) pick.onSolidFace(pick.selected, pick.ppFace, dist);
  else setSelected(pick.selected);
  pick.ppFace = -1;
}

/* Distance along the face normal: the parameter of the closest approach
 * between the normal line through the grab point and the pointer ray. */
function normalDrag(ev){
  const ndc = ndcFromEvent(ev);
  pick.raycaster.setFromCamera(ndc, camera);
  const ro = pick.raycaster.ray.origin, rd = pick.raycaster.ray.direction;
  const n = pick.ppN3;
  const w0 = pick.grab.clone().sub(ro);
  const b = n.dot(rd), d = n.dot(w0), e = rd.dot(w0);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return pick.ppDist;
  return (b * e - d) / denom;
}

function wirePicking(){
  if (canvas._pickWired) return;
  canvas._pickWired = true;

  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    pick.down = { x: ev.clientX, y: ev.clientY };
    if (PLACING[place.tool]){
      const p = hitWorkplane(ev);
      if (!p) return;
      place.a = snapCad(p);
      if (controls) controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if (meas.on) return;
    const hit = raycastSolid(ev);
    if (hit && hit.object.userData.solidName === pick.selected && pick.mode === 'pushpull'){
      /* Grabbing a face: remember which triangle and its normal. The
       * geometry is in world coordinates, so the face normal is too. */
      pick.dragging = true;
      pick.typed = '';
      pick.ppFace = hit.faceIndex != null ? hit.faceIndex : -1;
      pick.ppN3 = hit.face ? hit.face.normal.clone().normalize() : null;
      pick.ppDist = 0;
      pick.grab = hit.point.clone();
      if (pick.ppFace < 0 || !pick.ppN3){ pick.dragging = false; return; }
      if (controls) controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
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
    if (PLACING[place.tool] && place.a){
      const p = hitWorkplane(ev);
      if (!p) return;
      const b = snapCad(p);
      const mesh = primitiveAt(place.tool, place.a, b);
      clearPlacePreview();
      const obj = cadMeshToThree(mesh);
      if (obj){ place.preview = obj; scene.add(obj); render(); }
      return;
    }
    if (!pick.dragging || !pick.grab) return;
    if (pick.mode === 'pushpull'){
      let d = normalDrag(ev);
      if (!ev.altKey) d = Math.round(d / GRID_STEP) * GRID_STEP;
      if (d !== pick.ppDist){
        pick.ppDist = d;
        removePpGhost();
        const rec = lastSolidsList.find(x => x && x.name === pick.selected);
        const prism = rec && Math.abs(d) > 1e-9 ? pushPullPrism(rec.mesh, pick.ppFace, d) : null;
        if (prism){
          pick.ppGhost = cadMeshToThree(prism, d > 0 ? 0x2fa87a : 0xa85a2f);
          if (pick.ppGhost) scene.add(pick.ppGhost);
        }
      }
      dragHud();
      render();
      return;
    }
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
    if (PLACING[place.tool] && place.a){
      const p = hitWorkplane(ev) || place.a;
      commitPlace(place.a, snapCad(p));
      if (controls) controls.enabled = false;
      return;
    }
    if (pick.dragging){
      if (pick.mode === 'pushpull') commitPushPull(pick.ppDist);
      else if (pick.mode === 'rotate') commitRotate(pick.rotDeg);
      else commitMove(pick.moved);
      return;
    }
    /* A live placing tool keeps the camera parked, or the next drag
     * would orbit instead of placing. */
    if (controls) controls.enabled = !PLACING[place.tool];
    /* No drag: a small click measures in measure mode, otherwise it
     * selects what it hit, or clears. */
    if (pick.down && Math.hypot(ev.clientX - pick.down.x, ev.clientY - pick.down.y) < 5){
      if (meas.on){ measureClick(ev); return; }
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
      if (PLACING[place.tool]){ setTool3dView('orbit'); ev.preventDefault(); ev.stopPropagation(); }
      else if (meas.on){ setMeasureMode(false); ev.preventDefault(); ev.stopPropagation(); }
      else if (pick.dragging){ cancelDrag(); ev.preventDefault(); ev.stopPropagation(); }
      else if (pick.selected && pick.mode !== 'move'){
        pick.mode = 'move'; setSelected(pick.selected);
        ev.preventDefault(); ev.stopPropagation();
      } else if (pick.selected){
        setSelected(null);
        ev.preventDefault(); ev.stopPropagation();
      }
      return;
    }
    if (PLACING[place.tool] && place.a){
      /* A placement drag owns the keyboard the same way a move does, or
       * a stray digit focuses the 2D command line mid-drag. */
      ev.stopPropagation();
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
          if (pick.mode === 'pushpull') commitPushPull((pick.ppDist < 0 ? -1 : 1) * n);
          else if (pick.mode === 'rotate') commitRotate(n);
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
    if ((ev.key === 'r' || ev.key === 'R') && pick.selected && !meas.on && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
      pick.mode = pick.mode === 'rotate' ? 'move' : 'rotate';
      setSelected(pick.selected);
      ev.preventDefault();
      ev.stopPropagation();
    }
    if ((ev.key === 'p' || ev.key === 'P') && pick.selected && !meas.on && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
      pick.mode = pick.mode === 'pushpull' ? 'move' : 'pushpull';
      setSelected(pick.selected);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if ((ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
      /* Measuring and placing are both click-owners; leave the tool
       * before taking the clicks for measurement. */
      if (PLACING[place.tool]) setTool3dView('orbit');
      setMeasureMode(!meas.on);
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
  viewHooks = o;
  if (o.solidHeight > 0) placeH = o.solidHeight;
  ensureDom();
  if (!renderer){
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x07101f, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07101f, 80, 220);
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    hemiLight = new THREE.HemisphereLight(0xc8d8f0, 0x1a140c, 0.7);
    hemiLight.userData.keep = 1;
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff1d6, 1.05);
    sunLight.position.set(40, 70, 25);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.userData.keep = 1;
    scene.add(sunLight);
    scene.add(sunLight.target);
    sunLight.target.userData.keep = 1;
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
  pick.onSolidFace = o.onSolidFace || null;
  wirePicking();
  lastSolidsList = o.solids || [];
  lastSun = o.sun || null;
  lastMaterials = o.materials || {};
  const solid = extrudeDrawing(o.entities || [], {
    height: o.height,
    assumed: o.assumed,
    layers: o.layers || []
  });
  appendSolidRecords(solid, o.solids);
  addMeshes(solid);
  reapplySelection();
  setTool3dView(place.tool || 'orbit');
  running = true;
  onResize();
  renderer.setAnimationLoop(tick);
  window.addEventListener('resize', onResize);
  return solid;
}

export function syncView3d(opts){
  if (!running) return null;
  const o = opts || {};
  viewHooks = Object.assign(viewHooks, o);
  if (o.solidHeight > 0) placeH = o.solidHeight;
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
  framedOnce = false;
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
