// Sovereign Asset: load any 3D model, see what is wrong with it, finish it, download it.
// Everything runs on this device. No file is uploaded anywhere.
import "./app.css";
import { PRESETS, presetById } from "./presets.js";
import { DEFAULTS } from "./engine.js";
import { ACCEPT, toGlb } from "./convert.js";
import { createViewer } from "./viewer.js";
import { createTouchUp } from "./touchup.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");
const mb = (bytes) => (bytes < 104858 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1048576).toFixed(1) + " MB");
const many = (n, word, plural) => num(n) + " " + (n === 1 ? word : (plural || word + "s"));
const meters = (v) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const STAND = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const TURN = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o.map((v) => Math.round(v));
};

const state = { name: "", bytes: null, stats: null, preset: "clean", turn: null, result: null, showing: "before", busy: false };

const host = $("#asset");
host.innerHTML = `
<header class="top">
  <h1>Sovereign Asset</h1>
  <span class="shield" title="Your files are processed on this device and are never uploaded"><i></i>SOVEREIGN</span>
</header>
<main id="main">
  <section class="card drop" id="drop">
    <h2>Finish any 3D model</h2>
    <button class="btn gold" id="pick">Load a 3D model</button>
    <input type="file" id="file" multiple hidden accept="${ACCEPT}">
    <p class="lead">GLB, glTF, FBX, OBJ, DAE, STL or PLY. If the model has separate texture or .bin files, pick them together with it.</p>
    <p class="lead">The file is processed on this device. Nothing is uploaded.</p>
    <p class="status" id="loadstatus"></p>
  </section>

  <section class="card view" id="view" hidden>
    <p class="name" id="name"></p>
    <canvas id="canvas"></canvas>
    <div class="bar row">
      <button class="btn on" id="vbefore">Before</button>
      <button class="btn" id="vafter" disabled>After</button>
      <button class="btn" id="vwire">Wireframe</button>
      <button class="btn" id="vstand" title="Tip the model up when it lies on its back">Stand up</button>
      <button class="btn" id="vturn" title="Turn the model a quarter turn, so the gold arrow points out its front">Turn</button>
      <button class="btn" id="vnew">Load another</button>
    </div>
    <div class="touch" id="touch" hidden></div>
  </section>

  <section class="card" id="found" hidden>
    <h2>What is in the file</h2>
    <div class="tiles" id="tiles"></div>
    <ul class="found" id="issues"></ul>
  </section>

  <section class="card" id="choose" hidden>
    <h2>Finish it as</h2>
    <div class="presets" id="presets"></div>
    <div class="extra" id="extra"></div>
    <details id="more">
      <summary>Settings</summary>
      <div class="settings" id="settings"></div>
    </details>
  </section>

  <section id="go" hidden>
    <button class="btn gold big" id="finish">Finish</button>
    <div class="progress" id="bar" hidden><i></i></div>
    <p class="status" id="status"></p>
  </section>

  <section class="card verdict" id="verdict" hidden></section>
</main>`;

let viewer = null, touch = null;

// ---- running the heavy work: a worker when the browser can, the page itself when it cannot ----
let worker = null, workerOk = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined", seq = 0;
const pending = new Map();
function startWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    if (event.data.progress) { job.onProgress(event.data.progress.label, event.data.progress.fraction); return; }
    pending.delete(event.data.id);
    if (event.data.ok) job.resolve(event.data.result); else job.reject(new Error(event.data.error));
  };
  worker.onerror = () => {
    workerOk = false;
    for (const job of pending.values()) job.retry();
    pending.clear();
    worker.terminate(); worker = null;
  };
}
async function direct(kind, payload, onProgress) {
  const [{ finishModel, inspectModel }, { browserCodec }, { validate }] = await Promise.all([import("./engine.js"), import("./codec.js"), import("./validate.js")]);
  const env = { codec: browserCodec, validate, onProgress };
  if (kind === "inspect") return inspectModel(payload.bytes);
  if (kind === "car") return (await import("./car.js")).finishCar(payload.bytes, payload.name, payload.options, env);
  if (kind === "motorcycle") return (await import("./car.js")).finishMotorcycle(payload.bytes, payload.name, payload.options, env);
  return finishModel(payload.bytes, payload.options, env);
}
function run(kind, payload, onProgress = () => {}) {
  if (!workerOk) return direct(kind, payload, onProgress);
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress, retry: () => direct(kind, payload, onProgress).then(resolve, reject) });
    worker.postMessage({ id, kind, ...payload });
  });
}

// ---- loading ----
$("#pick").addEventListener("click", () => $("#file").click());
$("#vnew").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", (e) => { if (e.target.files.length) void load(e.target.files); e.target.value = ""; });
const drop = $("#drop");
for (const type of ["dragenter", "dragover"]) document.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const type of ["dragleave", "drop"]) document.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove("over"); });
document.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) void load(e.dataTransfer.files); });

async function load(files) {
  if (state.busy) return;
  const status = $("#loadstatus");
  status.className = "status";
  status.textContent = "Reading the file.";
  $("#drop").hidden = false;
  try {
    const got = await toGlb(files);
    state.name = got.name; state.bytes = got.bytes; state.result = null; state.turn = null; state.showing = "before"; state.stats = null;
    $("#main").classList.add("loaded");
    for (const id of ["view", "found", "choose", "go"]) $("#" + id).hidden = false;
    $("#verdict").hidden = true;
    $("#drop").hidden = true;
    $("#name").textContent = got.name + (got.note ? "  ·  " + got.note : "");
    $("#tiles").innerHTML = ""; $("#issues").innerHTML = '<li class="info">Checking the mesh.</li>';
    $("#status").textContent = "";
    $("#vafter").disabled = true;
    setShowing("before");
    if (!viewer) { viewer = createViewer($("#canvas")); touch = createTouchUp({ viewer, host: $("#touch") }); }
    touch.close();
    viewer.setTurn(null);
    await viewer.show(state.bytes);
    state.stats = await run("inspect", { bytes: state.bytes });
    renderFound();
    pickPreset(state.preset);
  } catch (error) {
    status.className = "status err";
    status.textContent = String(error && error.message || error);
    if (!state.stats && state.bytes) { $("#issues").innerHTML = '<li>' + esc(String(error && error.message || error)) + "</li>"; }
    if (!state.bytes) { $("#drop").hidden = false; }
  }
}

function renderFound() {
  const s = state.stats, d = s.defects;
  const tiles = [
    [num(s.triangles), "triangles"],
    [meters(s.size[0]) + " x " + meters(s.size[1]) + " x " + meters(s.size[2]) + " m", "wide, tall, long"],
    [s.textures.length ? s.maxTexture + " px" : "none", s.textures.length + (s.textures.length === 1 ? " texture" : " textures")],
    [mb(s.bytes), "file"],
    [num(s.drawCalls), (s.drawCalls === 1 ? "draw call, " : "draw calls, ") + many(s.materials, "material")]
  ];
  if (s.skins) tiles.push([num(s.joints) + " bones", s.animations + (s.animations === 1 ? " animation" : " animations")]);
  $("#tiles").innerHTML = tiles.map(([b, l]) => `<div class="tile"><b>${esc(b)}</b><span>${esc(l)}</span></div>`).join("");
  const issues = [];
  if (d.degenerate + d.duplicate) issues.push(many(d.degenerate + d.duplicate, "broken triangle") + " (no area, or the same triangle twice)");
  if (d.debrisPieces) issues.push(many(d.debrisPieces, "small piece") + " floating free of the model");
  if (d.inverted) issues.push(num(d.inverted) + (d.inverted === 1 ? " shell is" : " shells are") + " inside out");
  if (d.missingNormals) issues.push(many(d.missingNormals, "part has", "parts have") + " no normals, so the light cannot shade " + (d.missingNormals === 1 ? "it" : "them"));
  if (d.wrongNormals) issues.push(many(d.wrongNormals, "triangle is", "triangles are") + " lit from the wrong side");
  if (d.missingUV) issues.push(many(d.missingUV, "textured part has", "textured parts have") + " no UVs");
  const info = [];
  if (d.openEdges) info.push(num(d.openEdges) + " open edges. Small holes get closed. Fine for games, not for 3D printing.");
  if (d.debrisHeld) info.push(num(d.debrisHeld) + " small loose pieces that look intentional. They will be kept.");
  if (s.maxTexture > 2048) info.push("Textures are up to " + s.maxTexture + " px. That is heavy for a phone.");
  $("#issues").innerHTML = (issues.length ? issues.map((t) => `<li>${esc(t)}</li>`).join("") : '<li class="ok">No broken geometry found.</li>')
    + info.map((t) => `<li class="info">${esc(t)}</li>`).join("");
}

// ---- view controls ----
function setShowing(which) {
  state.showing = which;
  $("#vbefore").classList.toggle("on", which === "before");
  $("#vafter").classList.toggle("on", which === "after");
}
$("#vbefore").addEventListener("click", async () => { if (!state.bytes) return; setShowing("before"); touch.show(false); viewer.setTurn(state.turn); await viewer.show(state.bytes, false); });
$("#vafter").addEventListener("click", async () => { if (!state.result || !state.result.bytes) return; setShowing("after"); viewer.setTurn(null); await viewer.show(state.result.bytes, false); touch.dress(); touch.show(true); });
$("#vwire").addEventListener("click", (e) => { const on = !e.currentTarget.classList.contains("on"); e.currentTarget.classList.toggle("on", on); viewer.setWire(on); });
async function applyTurn(step) {
  if (state.busy || !state.bytes) return;
  const next = mul(step, state.turn || IDENTITY);
  state.turn = next.every((v, i) => v === IDENTITY[i]) ? null : next;
  if (state.showing !== "before") { setShowing("before"); touch.show(false); await viewer.show(state.bytes, false); }
  viewer.setTurn(state.turn);
  stale();
}
$("#vstand").addEventListener("click", () => applyTurn(STAND));
$("#vturn").addEventListener("click", () => applyTurn(TURN));

// ---- presets and settings ----
$("#presets").innerHTML = PRESETS.map((p) => `<button class="preset" data-id="${p.id}"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></button>`).join("");
$("#presets").addEventListener("click", (e) => { const b = e.target.closest(".preset"); if (b && !state.busy) pickPreset(b.dataset.id); });

function pickPreset(id) {
  state.preset = id;
  const preset = presetById(id);
  for (const b of document.querySelectorAll(".preset")) b.classList.toggle("on", b.dataset.id === id);
  const o = { ...DEFAULTS, ...preset.options };
  let extra = "";
  if (preset.slots) {
    extra += `<label class="field">Game slot<select id="slot">${preset.slots.map((s) => `<option>${s}</option>`).join("")}</select></label>`;
  }
  if (preset.car || preset.motorcycle) {
    const noun = preset.motorcycle ? "bike" : "car";
    extra += `<label class="confirm"><input type="checkbox" id="front"><span>The gold arrow points out the front of the ${noun}. If it does not, tap Turn until it does.</span></label>
      <p class="lead">This runs the wheel split and window mask. It keeps one material and the original texture, and it takes longer than the other finishes.</p>`;
  }
  $("#extra").innerHTML = extra;
  $("#more").hidden = !!(preset.car || preset.motorcycle);
  $("#settings").innerHTML = `
    <label class="field">Triangle target<input type="number" id="o-tris" min="4" step="1000" placeholder="Keep every triangle" value="${o.triangles || ""}"></label>
    <label class="field">Largest texture<select id="o-tex">${[["", "Leave textures alone"], [512, "512 px"], [1024, "1024 px"], [2048, "2048 px"], [4096, "4096 px"]].map(([v, l]) => `<option value="${v}"${String(o.maxTexture || "") === String(v) ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Texture format<select id="o-fmt">${[["keep", "Keep PNG and JPEG"], ["webp", "WebP (smallest, for web and games)"]].map(([v, l]) => `<option value="${v}"${o.textureFormat === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Size<span class="pair"><select id="o-axis">${[["", "Keep the size"], ["height", "Height"], ["length", "Length"], ["width", "Width"], ["longest", "Longest side"]].map(([v, l]) => `<option value="${v}"${(o.size ? o.size.axis : "") === v ? " selected" : ""}>${l}</option>`).join("")}</select><input type="number" id="o-m" min="0" step="0.1" placeholder="meters" value="${o.size ? o.size.meters : ""}"></span></label>
    <label class="field">Close holes<select id="o-holes">${[["off", "Off"], ["small", "Small holes only"], ["all", "Every hole it can"]].map(([v, l]) => `<option value="${v}"${o.closeHoles === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Compress geometry<select id="o-zip">${[["", "Same as the source"], ["on", "On (smaller, needs the Meshopt decoder)"], ["off", "Off (opens everywhere)"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
    <div>
      ${[["o-debris", "Remove floating debris", o.removeDebris], ["o-facing", "Fix inside-out faces", o.fixFacing], ["o-normals", "Fix normals", o.fixNormals], ["o-ground", "Set on the ground", o.ground], ["o-center", "Center it", o.center], ["o-anim", "Drop animations", o.dropAnimations]]
    .map(([id, label, on]) => `<label class="check"><input type="checkbox" id="${id}"${on ? " checked" : ""}>${label}</label>`).join("")}
    </div>`;
  if (preset.slots && (preset.car || preset.motorcycle)) $("#slot").addEventListener("change", stale);
  stale();
}
$("#choose").addEventListener("change", stale);

function readOptions() {
  const preset = presetById(state.preset);
  const tris = parseInt($("#o-tris").value, 10), tex = parseInt($("#o-tex").value, 10), m = parseFloat($("#o-m").value), axis = $("#o-axis").value;
  const zip = $("#o-zip").value;
  return {
    ...preset.options,
    triangles: tris > 0 ? tris : null,
    maxTexture: tex > 0 ? tex : null,
    textureFormat: $("#o-fmt").value,
    size: axis && m > 0 ? { axis, meters: m } : null,
    closeHoles: $("#o-holes").value,
    compress: zip === "on" ? true : zip === "off" ? false : null,
    removeDebris: $("#o-debris").checked, fixFacing: $("#o-facing").checked, fixNormals: $("#o-normals").checked,
    ground: $("#o-ground").checked, center: $("#o-center").checked, dropAnimations: $("#o-anim").checked,
    rotation: state.turn
  };
}

// a change after a finish means the verdict on screen no longer describes what would be made
function stale() {
  if (!state.result || state.busy) return;
  $("#status").textContent = "Settings changed. Tap Finish to run it again.";
}

// ---- finish ----
$("#finish").addEventListener("click", () => { void finish(); });
async function finish() {
  if (state.busy || !state.bytes) return;
  const preset = presetById(state.preset);
  const status = $("#status"), bar = $("#bar");
  state.busy = true;
  $("#finish").disabled = true;
  status.className = "status";
  bar.hidden = false;
  const onProgress = (label, fraction) => { status.textContent = label + "."; $("i", bar).style.width = Math.round(fraction * 100) + "%"; };
  onProgress("Starting", 0.01);
  try {
    let result;
    if (preset.car || preset.motorcycle) {
      const slot = $("#slot").value;
      const kind = preset.motorcycle ? "motorcycle" : "car";
      result = await run(kind, { bytes: state.bytes, name: state.name + ".glb", options: { rotation: state.turn, frontConfirmed: $("#front").checked, length: preset.lengths[slot] } }, onProgress);
    } else {
      result = await run("finish", { bytes: state.bytes, options: readOptions() }, onProgress);
    }
    const slotEl = $("#slot");
    result.fileName = preset.fileName && slotEl ? preset.fileName(slotEl.value) : state.name.replace(/[^\w.-]+/g, "_") + "-finished.glb";
    result.presetName = preset.name;
    state.result = result;
    renderVerdict();
    status.textContent = "";
    if (result.bytes) {
      $("#vafter").disabled = false;
      setShowing("after");
      viewer.setTurn(null);
      await viewer.show(result.bytes, true);
      // a finished car with a window mask can be touched up by hand: the download then carries the edits
      if (await touch.start(result.bytes, markTouched)) markTouched();
    } else touch.close();
    $("#verdict").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.className = "status err";
    status.textContent = "The finish stopped: " + String(error && error.message || error);
  } finally {
    state.busy = false;
    $("#finish").disabled = false;
    bar.hidden = true;
  }
}

function renderVerdict() {
  const r = state.result, el = $("#verdict");
  el.hidden = false;
  el.className = "card verdict " + (r.ready ? "ready" : "not");
  const b = r.before, a = r.after;
  const row = (label, before, after) => `<div class="tile"><span>${esc(label)}</span><b>${esc(after)}</b><small>was ${esc(before)}</small></div>`;
  const tiles = a ? [
    row("Triangles", num(b.triangles), num(a.triangles)),
    row("File", mb(b.bytes), mb(a.bytes)),
    row("Largest texture", b.textures.length ? b.maxTexture + " px" : "none", a.textures.length ? a.maxTexture + " px" : "none"),
    row("Draw calls", num(b.drawCalls), num(a.drawCalls)),
    row("Size (m)", b.size.map(meters).join(" x "), a.size.map(meters).join(" x "))
  ].join("") : "";
  const word = { pass: "PASS", fail: "FAIL", note: "NOTE" };
  const order = { fail: 0, pass: 1, note: 2 };
  const checks = r.checks.slice().sort((x, y) => order[x.status] - order[y.status]);
  el.innerHTML = `
    <div class="banner">${r.banner}</div>
    <p class="sum">${esc(r.summary)}</p>
    <div class="tiles">${tiles}</div>
    <div class="row downloads">
      ${r.bytes ? `<button class="btn ${r.ready ? "gold" : ""}" id="dl">${r.ready ? "Download " : "Download anyway: "}${esc(r.fileName)}</button>` : ""}
      <button class="btn" id="dlreport">Download the report</button>
      ${r.pack ? '<button class="btn" id="dlpack">Download the review pack</button>' : ""}
    </div>
    <p class="lead" id="touchnote"></p>
    <h3>Checks on the finished file</h3>
    <ul class="checks">${checks.map((c) => `<li><span class="chip ${c.status}">${word[c.status]}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p>${c.fix ? `<p class="fix">${esc(c.fix)}</p>` : ""}</div></li>`).join("")}</ul>
    <h3>What was done</h3>
    <ul class="log">${r.log.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
  const save = (data, name, type) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  if (r.bytes) $("#dl").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!touch.edited()) return save(r.bytes, r.fileName, "model/gltf-binary");
    button.disabled = true;
    try { save(await touch.bytes(), r.fileName, "model/gltf-binary"); } finally { button.disabled = false; }
  });
  $("#dlreport").addEventListener("click", () => save("Sovereign Asset report\nSource: " + state.name + "\nFinish: " + r.presetName + "\nOutput: " + (r.bytes ? r.fileName : "none") + "\n\n" + r.report + "\n", r.fileName.replace(/\.glb$/, "") + "-report.txt", "text/plain"));
  if (r.pack) $("#dlpack").addEventListener("click", () => save(r.pack, r.fileName.replace(/\.glb$/, "") + "-review.zip", "application/zip"));
}

// the download button says when it carries hand edits
function markTouched() {
  const note = $("#touchnote");
  if (note) note.textContent = touch.edited() ? "The download includes your touch up (" + many(touch.strokes(), "stroke") + ")." : "Touch up is ready under the 3D view: mark glass, paint and chrome by hand, or clean a speck.";
}

// test hooks: lets a script drive the page without a file dialog
window.sovereignAsset = { state, load, get touch() { return touch; } };
