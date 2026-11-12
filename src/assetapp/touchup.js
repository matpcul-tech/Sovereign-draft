// Touch up, the part you see: tools under the 3D view, a brush you drag on the car, and a preview that shows
// glass, paint and chrome the way a game reads them from the mask. The edits themselves live in touchcore.js.
import * as THREE from "three";
import { TOOLS } from "./touchcore.js";

const HELP = {
  move: "Drag to turn the car. Pick a tool to mark it.",
  glass: "Drag over a window. It becomes dark glass.",
  paint: "Drag over body panels the game should repaint.",
  chrome: "Drag over bumpers, grilles and trim that should shine.",
  trim: "Drag over lamps, plastic and signs: parts that are not glass, paint or chrome.",
  clean: "Tap a speck or stain. It takes the color of what surrounds it."
};
const SWATCHES = [["Original", null], ["Red", 0x8c1c1c], ["Blue", 0x1c3a8c], ["Green", 0x1f6b3a], ["Gold", 0xd4a843], ["Black", 0x15161a]];

export function createTouchUp({ viewer, host }) {
  host.innerHTML = `
    <div class="row tools">
      <button class="btn on" data-tool="move">Move</button>
      ${TOOLS.map((t) => `<button class="btn" data-tool="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
      <button class="btn" id="tundo" disabled>Undo</button>
    </div>
    <div class="row opts">
      <label class="size">Brush<input type="range" id="tsize" min="2" max="40" value="10"><span id="tsizev">10 cm</span></label>
      <label class="check"><input type="checkbox" id="tsim" checked>Similar colors only</label>
      <label class="check"><input type="checkbox" id="tshow">Show areas</label>
    </div>
    <div class="row swatches" id="tsw">${SWATCHES.map(([name, hex], i) => `<button class="sw${i ? "" : " on"}" data-i="${i}" title="${name}" style="${hex == null ? "" : "background:#" + hex.toString(16).padStart(6, "0")}">${hex == null ? "Original" : ""}</button>`).join("")}</div>
    <p class="status" id="thelp"></p>`;
  const $ = (sel) => host.querySelector(sel);
  const canvas = viewer.canvas, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let core = null, tool = "move", baseTex = null, maskTex = null, material = null, drawing = false, onChange = () => {};
  const fingers = new Set();
  const uniforms = { uMask: { value: null }, uPaint: { value: new THREE.Color(0x8c1c1c) }, uPaintOn: { value: 0 }, uShow: { value: 0 } };

  function say(text, bad) { const el = $("#thelp"); el.textContent = text; el.className = "status" + (bad ? " err" : ""); }

  function makeMaterial() {
    // paint that reads like the game's: a little gloss, no metal
    const m = new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.6 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = "uniform sampler2D uMask; uniform vec3 uPaint; uniform float uPaintOn; uniform float uShow;\n" + shader.fragmentShader
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec3 kM = texture2D( uMask, vMapUv ).rgb;
          float kTop = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ), kLow = min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
          float kSat = kTop > 0.0 ? ( kTop - kLow ) / kTop : 0.0;
          // the game repaints the pixels of the body area that carry the body color
          diffuseColor.rgb = mix( diffuseColor.rgb, uPaint * ( 0.3 + 1.1 * kTop ), uPaintOn * kM.g * smoothstep( 0.2, 0.4, kSat ) );
          diffuseColor.rgb *= mix( 1.0, 0.55, kM.r );
          if ( uShow > 0.5 ) {
            vec3 kTint = kM.r > 0.5 ? vec3( 0.0, 0.83, 0.72 ) : kM.b > 0.5 ? vec3( 0.83, 0.66, 0.26 ) : kM.g > 0.5 ? diffuseColor.rgb : vec3( 0.75, 0.2, 0.55 );
            diffuseColor.rgb = mix( diffuseColor.rgb, kTint, 0.65 );
          }`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix( mix( roughnessFactor, 0.06, kM.r ), 0.18, kM.b );")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = mix( metalnessFactor, 1.0, kM.b );");
    };
    return m;
  }

  // put the live textures on the model that is on screen (call again after the view reloads the model)
  function dress() {
    const model = viewer.getModel();
    if (!core || !model) return;
    model.traverse((o) => { if (o.isMesh && o.material && o.material.map && o.material !== material) { const old = o.material; o.material = material; if (old.map) old.map.dispose(); old.dispose(); } });
    viewer.redraw();
  }

  function refresh() { baseTex.needsUpdate = true; maskTex.needsUpdate = true; viewer.redraw(); }

  function setTool(next) {
    tool = next;
    for (const b of host.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === next);
    // with a tool in hand one finger (or the left button) paints; two fingers (or the right button) still turn the view
    viewer.controls.touches.ONE = next === "move" ? THREE.TOUCH.ROTATE : -1;
    viewer.controls.mouseButtons.LEFT = next === "move" ? THREE.MOUSE.ROTATE : -1;
    viewer.controls.touches.TWO = next === "move" ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.DOLLY_ROTATE;
    viewer.controls.mouseButtons.RIGHT = next === "move" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    canvas.style.cursor = next === "move" ? "" : "crosshair";
    say(HELP[next] + (next !== "move" ? " Two fingers turn the view." : ""));
  }

  function hit(event) {
    const model = viewer.getModel();
    if (!model) return null;
    const box = canvas.getBoundingClientRect();
    ndc.set((event.clientX - box.left) / box.width * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(ndc, viewer.camera);
    const found = ray.intersectObject(model, true)[0];
    return found ? model.worldToLocal(found.point.clone()).toArray() : null;
  }
  const options = () => ({ radius: Number($("#tsize").value) / 100, similar: $("#tsim").checked });

  function down(event) {
    fingers.add(event.pointerId);
    if (!core || tool === "move" || host.hidden) return;
    if (fingers.size > 1 || (event.pointerType === "mouse" && event.button !== 0)) { if (drawing) { core.cancel(); drawing = false; refresh(); } return; }
    const point = hit(event);
    if (!point) return;
    const reason = core.begin(point, tool, options());
    if (reason) { say(reason, true); return; }
    drawing = true;
    refresh();
  }
  function moved(event) {
    if (!drawing) return;
    const point = hit(event);
    if (point) { core.move(point); refresh(); }
  }
  function up(event) {
    fingers.delete(event.pointerId);
    if (!drawing) return;
    drawing = false;
    const count = core.end();
    refresh();
    $("#tundo").disabled = !core.strokes();
    say(count ? count.toLocaleString("en-US") + " texels changed. " + HELP[tool] : "Nothing under the brush matched. Turn off Similar colors only to mark everything in reach.");
    if (count) onChange();
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", moved);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);

  host.addEventListener("click", (event) => {
    const t = event.target.closest("[data-tool]"), sw = event.target.closest(".sw");
    if (t) setTool(t.dataset.tool);
    if (sw) {
      const hex = SWATCHES[Number(sw.dataset.i)][1];
      for (const b of host.querySelectorAll(".sw")) b.classList.toggle("on", b === sw);
      uniforms.uPaintOn.value = hex == null ? 0 : 1;
      if (hex != null) uniforms.uPaint.value.setHex(hex);
      viewer.redraw();
    }
  });
  $("#tundo").addEventListener("click", () => { if (core && core.undo()) { refresh(); $("#tundo").disabled = !core.strokes(); say("Undone."); onChange(); } });
  $("#tsize").addEventListener("input", (e) => { $("#tsizev").textContent = e.target.value + " cm"; });
  $("#tshow").addEventListener("change", (e) => { uniforms.uShow.value = e.target.checked ? 1 : 0; viewer.redraw(); });

  function drop() {
    if (baseTex) baseTex.dispose();
    if (maskTex) maskTex.dispose();
    if (material) material.dispose();
    core = baseTex = maskTex = material = null;
    drawing = false;
  }

  return {
    // Open a finished car for touch up. False when the file has no window mask to edit.
    async start(bytes, changed = () => {}) {
      drop();
      setTool("move");
      onChange = changed;
      const { openTouch } = await import("./touchcore.js");
      core = await openTouch(bytes);
      host.hidden = !core;
      if (!core) return false;
      const data = (rgba, srgb) => {
        const t = new THREE.DataTexture(rgba, core.width, core.height, THREE.RGBAFormat);
        t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      };
      baseTex = data(core.base, true); maskTex = data(core.mask, false);
      uniforms.uMask.value = maskTex;
      material = makeMaterial();
      $("#tundo").disabled = true;
      dress();
      return true;
    },
    dress,
    show(on) { host.hidden = !on || !core; if (!on && tool !== "move") setTool("move"); },
    close() { drop(); host.hidden = true; setTool("move"); },
    edited: () => !!core && core.strokes() > 0,
    strokes: () => (core ? core.strokes() : 0),
    bytes: () => core.bytes(),
    // for tests: a stroke without a pointer
    core: () => core
  };
}
