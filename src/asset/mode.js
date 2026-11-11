import { mount } from "./view.js";
import { parseLine } from "./grammar.js";
import { parseLevel } from "./level.js";
import { askArtist, SAMPLE_LEVEL } from "./artist.js";
import { toast } from "../ui/toast.js";
import { mountVehicle } from "./vehicle.js";
import { boundsOf } from "./finish/inspect.js";
import { loadVehicle, replaceNamedImage } from "./finish/glb.js";
import { disposeVehicle } from "./finish/edit.js";
import {
  PENDING_RULES,
  carSourceCheck,
  guessType,
  profileSummary,
  resolveProfile,
  setActiveFinish,
  clearActiveFinish
} from "./finish/profiles.js";
import { runFinish } from "./finish/pipeline.js";
import { editMask, reviewSheet } from "./finish/mask.js";
import { encodePng } from "./finish/png.js";
import { zipStore } from "./finish/zip.js";

const RECIPES = {
  sedan: { name: "sedan", paint: "#1c3d66", budget: 12000 },
  storefront: { name: "storefront", paint: "#efe6d4", budget: 8000 },
  dumpster: { name: "dumpster", paint: "#2c4638", budget: 4000 },
  blank: { name: "blockout", paint: "#c4b8a2", budget: 8000 }
};

let host = null;
let api = null;
let vehicle = null;
let busy = false;
let finishKind = "CAR";
let finishFile = null;
let finishExport = null;
let finishZip = null;
let finishFiles = null;
let finishMask = null;
let doc = {
  kind: "asset",
  recipe: "sedan",
  name: "sedan",
  paint: "#1c3d66",
  budget: 12000,
  lines: [],
  showPivots: true,
  turntable: false
};

function status(text) {
  const el = host && host.querySelector("#assetstatus");
  if (el) el.textContent = text;
}

function sync() {
  if (!api) return;
  api.sync(doc);
  const name = host && host.querySelector("#assetname");
  if (name) name.textContent = doc.name || "asset";
}

function finishOpen() {
  const panel = host && host.querySelector("#finishpanel");
  return !!(panel && !panel.hidden);
}

function hideFinish() {
  const panel = host && host.querySelector("#finishpanel");
  if (panel) panel.hidden = true;
}

function openVehicle() {
  hideFinish();
  if (vehicle) vehicle.open();
}

function fieldValue(id) {
  const el = host && host.querySelector("#" + id);
  return el ? el.value : "";
}

function finishInput() {
  const nodes = fieldValue("finish-nodes").split(",").map((part) => part.trim()).filter(Boolean);
  return {
    lengthZ: fieldValue("finish-length"),
    heightY: fieldValue("finish-height"),
    storeys: fieldValue("finish-storeys"),
    storeyHeight: fieldValue("finish-storey"),
    longest: fieldValue("finish-longest"),
    triangleTarget: fieldValue("finish-target"),
    triangleCeiling: fieldValue("finish-ceiling"),
    maxTexture: fieldValue("finish-tex"),
    byteCapMb: fieldValue("finish-bytes"),
    tolerancePct: fieldValue("finish-tol"),
    requiredNodes: nodes
  };
}

function addNumber(row, label, id, value, step) {
  const lab = document.createElement("label");
  lab.append(document.createTextNode(label + " "));
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.min = "0.01";
  input.step = step || "0.1";
  input.value = String(value);
  lab.append(input);
  row.append(lab);
}

function renderFinish() {
  const types = host.querySelector("#finishtypes");
  const fields = host.querySelector("#finishfields");
  const note = host.querySelector("#finishnote");
  const measure = host.querySelector("#finishmeasure");
  types.replaceChildren();
  for (const id of ["CAR", "BUILDING", "CHARACTER", "PROP"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.dataset.finish = id;
    if (id === finishKind) button.className = "on";
    button.addEventListener("click", () => {
      finishKind = id;
      renderFinish();
    });
    types.append(button);
  }
  const seed = { requiredNodes: fieldValue("finish-nodes") ? finishInput().requiredNodes : [] };
  if (finishKind === "PROP" && finishFile && finishFile.size) {
    seed.longest = Math.max(finishFile.size[0], finishFile.size[1], finishFile.size[2]) || 1;
  }
  const profile = resolveProfile(finishKind, seed);
  fields.replaceChildren();
  if (profile.id === "CAR") addNumber(fields, "Length Z m", "finish-length", profile.lengthZ, "0.1");
  if (profile.id === "BUILDING") {
    addNumber(fields, "Height m", "finish-height", profile.heightY, "0.1");
    addNumber(fields, "Storeys", "finish-storeys", profile.storeys, "1");
    addNumber(fields, "Per storey m", "finish-storey", profile.storeyHeight, "0.1");
  }
  if (profile.id === "CHARACTER") addNumber(fields, "Height m", "finish-height", profile.heightY, "0.01");
  if (profile.id === "PROP") addNumber(fields, "Longest m", "finish-longest", profile.longest, "0.1");
  addNumber(fields, "Target tris", "finish-target", profile.triangleTarget, "1");
  addNumber(fields, "Ceiling tris", "finish-ceiling", profile.triangleCeiling, "1");
  addNumber(fields, "Max tex px", "finish-tex", profile.maxTexture, "1");
  addNumber(fields, "File cap MB", "finish-bytes", profile.byteCap / (1024 * 1024), "1");
  addNumber(fields, "Size band %", "finish-tol", Math.round(profile.tolerance * 100), "1");
  const nodes = document.createElement("label");
  nodes.append(document.createTextNode("Extra nodes "));
  const nodeInput = document.createElement("input");
  nodeInput.type = "text";
  nodeInput.id = "finish-nodes";
  nodeInput.placeholder = "optional, comma separated";
  nodeInput.value = (profile.requiredNodes || []).join(", ");
  nodes.append(nodeInput);
  fields.append(nodes);
  if (finishFile && finishFile.error) {
    measure.textContent = finishFile.fileName + " (" + finishFile.byteLength.toLocaleString() + " bytes) did not measure: " + finishFile.error;
  } else if (finishFile) {
    const size = finishFile.size;
    measure.textContent = finishFile.fileName + "  " + finishFile.byteLength.toLocaleString() + " bytes  source tris " + finishFile.triangles.toLocaleString() + "  W " + size[0].toFixed(3) + "  H " + size[1].toFixed(3) + "  D " + size[2].toFixed(3) + ". " + (finishFile.guess || "");
  } else {
    measure.textContent = "No file yet. The type and numbers are a guess you can change.";
  }
  const sourceEl = host.querySelector("#finishsource");
  if (finishKind === "CAR" && finishFile && finishFile.materialNames) {
    const source = carSourceCheck({
      materialNames: finishFile.materialNames,
      materialCount: finishFile.materialNames.length,
      imageCount: finishFile.imageCount
    });
    sourceEl.textContent = source.detail + (source.action ? " " + source.action : "");
    sourceEl.classList.toggle("bad", !!source.unsupported);
  } else if (finishKind === "CAR") {
    sourceEl.textContent = "CAR keeps one base texture and original UVs. A later mask image is separate. Paint, glass, trim, and doors are not split. Only the four wheels are. This step does not run that split.";
    sourceEl.classList.remove("bad");
  } else {
    sourceEl.textContent = "";
    sourceEl.classList.remove("bad");
  }
  note.textContent = profileSummary(profile) + " A budget fail is an exported triangle count above the ceiling. Crossing the target is not that fail. Run finish logs the fixes. READY means every declared check passed. It is not a gameplay or phone test. Street Empire does not read the mask.";
}

function openFinish() {
  if (vehicle && vehicle.isOpen()) vehicle.suspend();
  const panel = host.querySelector("#finishpanel");
  panel.hidden = false;
  renderFinish();
  host.querySelector("#finishfile").click();
}

async function onFinishFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const loaded = await loadVehicle(bytes, file.name || "model.glb");
    const bounds = boundsOf(loaded.surfaces);
    let triangles = 0;
    for (const surface of loaded.surfaces) triangles += surface.faceCount;
    const guess = guessType(bounds.size);
    finishKind = guess.id;
    finishFile = {
      fileName: loaded.fileName,
      byteLength: bytes.byteLength,
      sha256: loaded.sha256,
      size: bounds.size,
      triangles,
      bytes,
      guess: guess.reason,
      materialNames: (loaded.json.materials || []).map((material) => material.name || ""),
      imageCount: (loaded.images || []).length
    };
    disposeVehicle(loaded.scene);
    status(guess.reason + " Source bytes were not modified.");
  } catch (error) {
    finishFile = {
      fileName: file.name || "model.glb",
      byteLength: bytes.byteLength,
      sha256: "",
      size: [0, 0, 0],
      triangles: 0,
      bytes,
      guess: "",
      error: error instanceof Error ? error.message : "The GLB could not be read."
    };
    toast(finishFile.error);
  }
  renderFinish();
}

function concatBytes(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function phoneReview(mask, size) {
  return reviewSheet(mask, size);
}

function downloadBytes(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function runFinishNow() {
  if (!finishFile || !finishFile.bytes) {
    toast("Choose a GLB first.");
    return;
  }
  const profile = resolveProfile(finishKind, finishInput());
  if (profile.error) {
    toast(profile.error);
    return;
  }
  status("Running finish. Source bytes stay as loaded.");
  try {
    const loaded = await loadVehicle(finishFile.bytes, finishFile.fileName || "model.glb");
    const result = await runFinish(loaded, profile, {
      frontConfirmed: !!host.querySelector("#finishfront").checked
    });
    disposeVehicle(loaded.scene);
    finishExport = result.bytes;
    finishZip = result.zip;
    finishFiles = result.files || null;
    const banner = host.querySelector("#finishbanner");
    banner.hidden = false;
    banner.classList.toggle("bad", result.banner === "NOT READY");
    banner.classList.toggle("ready", result.banner === "READY");
    banner.textContent = result.banner + ". " + result.summary;
    const lines = [];
    if (result.before) {
      lines.push("Before  tris " + result.before.triangles + "  bytes " + result.before.bytes + "  size " + result.before.size.map((value) => value.toFixed(3)).join(" x "));
    }
    if (result.after) {
      lines.push("After   tris " + result.after.triangles + "  bytes " + result.after.bytes + "  size " + result.after.size.map((value) => value.toFixed(3)).join(" x ") + "  minY " + result.after.minY.toFixed(4));
    }
    for (const check of result.checks) lines.push((check.pass ? "PASS  " : "FAIL  ") + check.detail + (check.action ? "  " + check.action : ""));
    lines.push("");
    lines.push(...result.log);
    host.querySelector("#finishlog").textContent = lines.join("\n");
    host.querySelector("#finishdownload").hidden = !result.bytes;
    host.querySelector("#finishzip").hidden = !result.zip;
    const review = host.querySelector("#finishreview");
    if (result.review) {
      finishMask = result.mask || null;
      review.hidden = false;
      review.src = URL.createObjectURL(new Blob([result.review], { type: "image/png" }));
    } else {
      finishMask = null;
      review.hidden = true;
    }
    status(result.banner + ". " + (result.after ? result.after.triangles + " tris." : "No file written."));
  } catch (error) {
    toast(error instanceof Error ? error.message : "Finish failed.");
  }
}

function saveFinish() {
  const profile = resolveProfile(finishKind, finishInput());
  if (profile.error) {
    toast(profile.error);
    return;
  }
  setActiveFinish({
    fileName: finishFile && finishFile.fileName || "",
    byteLength: finishFile && finishFile.byteLength || 0,
    sha256: finishFile && finishFile.sha256 || "",
    sourceTriangles: finishFile && finishFile.triangles || 0,
    measuredSize: finishFile && finishFile.size || [0, 0, 0],
    bytes: finishFile && finishFile.bytes || null,
    profile
  });
  const lead = profile.id + " profile saved.";
  const fileBit = finishFile ? " Source " + finishFile.byteLength.toLocaleString() + " bytes unchanged." : " No GLB loaded yet.";
  status(lead + fileBit + " No cut, simplify, or verdict was run.");
  toast(lead + " Nothing was written.");
}

function setRecipe(recipe) {
  if (vehicle) vehicle.suspend();
  hideFinish();
  const spec = RECIPES[recipe] || RECIPES.blank;
  doc = {
    kind: "asset",
    recipe: RECIPES[recipe] ? recipe : "blank",
    name: spec.name,
    paint: spec.paint,
    budget: spec.budget,
    lines: [],
    showPivots: true,
    turntable: doc.turntable
  };
  sync();
  api && api.frame();
}

function loadScript(script) {
  let recipe = "blank";
  let name = "asset";
  let paint = doc.paint;
  let budget = 8000;
  const lines = [];
  script.forEach((raw) => {
    const parsed = parseLine(raw);
    if (parsed.err) return;
    if (parsed.meta === "recipe") recipe = parsed.recipe;
    else if (parsed.meta === "name" && parsed.name) name = parsed.name;
    else if (parsed.meta === "paint") paint = parsed.hex;
    else if (parsed.meta === "budget") budget = parsed.n;
    else if (parsed.op) lines.push(String(raw).trim());
  });
  if (recipe === "blank" && !lines.length) return false;
  doc = {
    kind: "asset",
    recipe,
    name,
    paint,
    budget,
    lines: lines.slice(0, 40),
    showPivots: doc.showPivots,
    turntable: doc.turntable
  };
  sync();
  api && api.frame();
  return true;
}

function loadLevel(script) {
  const plan = parseLevel(script);
  if (!plan) return false;
  doc = {
    kind: "level",
    recipe: "blank",
    name: plan.name,
    paint: doc.paint,
    budget: 60000,
    lines: script.map((line) => String(line).trim()).filter(Boolean).slice(0, 64),
    showPivots: false,
    turntable: doc.turntable
  };
  sync();
  api && api.frame();
  return true;
}

function submit(raw) {
  const parsed = parseLine(raw);
  if (parsed.err) {
    toast(parsed.err);
    return;
  }
  if (parsed.meta === "recipe") { setRecipe(parsed.recipe); return; }
  if (parsed.meta === "export") {
    if (finishOpen()) {
      toast("FINISH does not export. The GLB command downloads the built-in piece, not the file you picked.");
      return;
    }
    void exportGlb();
    return;
  }
  if (parsed.meta === "vehicle") { openVehicle(); return; }
  if (parsed.meta === "finish") { openFinish(); return; }
  if (parsed.meta === "fit") { api && api.frame(); return; }
  if (parsed.meta === "artist") { void artist(parsed.brief || "", "asset"); return; }
  if (parsed.meta === "level") { void artist(parsed.brief || "", "level"); return; }
  if (parsed.meta === "name") { doc = { ...doc, name: parsed.name }; sync(); return; }
  if (parsed.meta === "paint") { doc = { ...doc, paint: parsed.hex }; sync(); return; }
  if (parsed.meta === "budget") { doc = { ...doc, budget: parsed.n }; sync(); return; }
  if (parsed.meta === "pivots") {
    doc = { ...doc, showPivots: parsed.on === "toggle" ? !doc.showPivots : parsed.on };
    sync();
    return;
  }
  if (parsed.meta === "turn") {
    doc = { ...doc, turntable: parsed.on === "toggle" ? !doc.turntable : parsed.on };
    sync();
    return;
  }
  if (parsed.meta === "note") { status(parsed.text); return; }
  if (parsed.op) {
    if (doc.kind === "level") {
      toast("This is a block. SEDAN, SHOP, or ARTIST starts a piece.");
      return;
    }
    doc = { ...doc, lines: doc.lines.concat(raw.trim()).slice(0, 40) };
    sync();
    status(doc.name);
  }
}

async function exportGlb() {
  if (!api) return;
  status("Exporting…");
  const message = await api.exportGlb();
  status(message);
  toast(message);
}

async function artist(brief, scope) {
  if (busy) return;
  if (/\b(person|people|human|face|character|nude|naked|child|kid|man|woman)\b/i.test(brief || "")) {
    toast("People are not this space. Ask for a block, a car, a shop, or a street prop.");
    return;
  }
  busy = true;
  status(scope === "level" ? "Laying out a block…" : "Artist is building…");
  try {
    const result = await askArtist({ brief, scope });
    if (!result.ok) {
      if (scope === "level" && result.sample && loadLevel(SAMPLE_LEVEL)) {
        toast("Built-in block. Add an xAI key in AI settings and the artist will lay out the next one.");
        return;
      }
      toast(result.error || "The artist failed.");
      status(result.error || "Artist failed");
      return;
    }
    const ok = scope === "level" ? loadLevel(result.lines) : loadScript(result.lines);
    if (!ok) {
      toast(scope === "level" ? "The artist did not lay out a block." : "The artist returned no solids.");
      return;
    }
    toast(scope === "level" ? "Artist laid out " + doc.name + "." : "Artist built " + doc.name + ".");
  } catch (error) {
    toast(error instanceof Error ? error.message : "The artist failed.");
  } finally {
    busy = false;
  }
}

function ensure() {
  if (host) return;
  host = document.createElement("div");
  host.id = "assetmode";
  host.innerHTML = `
    <div class="assethead">
      <div>
        <div class="sovlabel">ASSET</div>
        <div id="assetname">sedan</div>
      </div>
      <button type="button" id="assetclose">Back to drawing</button>
    </div>
    <div id="assetview" class="assetview"></div>
    <section id="finishpanel" hidden>
      <p id="finishlead">FINISH logs fixes on a copy. Source bytes stay as loaded. A logged file is not a READY verdict, and Street Empire does not read a window mask from it.</p>
      <div class="vehrow">
        <button type="button" id="finishpick">Choose GLB</button>
        <input id="finishfile" type="file" accept=".glb,model/gltf-binary" hidden>
      </div>
      <p id="finishmeasure"></p>
      <p id="finishsource"></p>
      <div class="vehlabel">Type</div>
      <div class="vehrow" id="finishtypes"></div>
      <div class="vehlabel">Profile</div>
      <div class="vehrow" id="finishfields"></div>
      <p id="finishnote"></p>
      <div class="vehrow">
        <label><input id="finishfront" type="checkbox"> +Z end is the front</label>
        <button type="button" id="finishsave">Save profile</button>
        <button type="button" id="finishrun">Run finish</button>
        <button type="button" id="finishdownload" hidden>Download GLB</button>
        <button type="button" id="finishzip" hidden>Download ZIP</button>
      </div>
      <p id="finishbanner" hidden></p>
      <img id="finishreview" alt="Glass is teal, paint is gold, chrome is white, other is gray" hidden>
      <div class="vehrow">
        <button type="button" id="finishadd">Add glass</button>
        <button type="button" id="finishremove">Remove glass</button>
        <button type="button" id="finishbrush">Edge brush</button>
      </div>
      <pre id="finishlog"></pre>
      <p id="finishrules"></p>
    </section>
    <div class="assetchips">
      <button type="button" class="chip gold" data-asset="level">LEVEL</button>
      <button type="button" class="chip" data-asset="artist">ARTIST</button>
      <button type="button" class="chip" data-asset="sedan">SEDAN</button>
      <button type="button" class="chip" data-asset="storefront">SHOP</button>
      <button type="button" class="chip" data-asset="dumpster">BIN</button>
      <button type="button" class="chip" data-asset="glb">GLB</button>
      <button type="button" class="chip" data-asset="vehicle">VEHICLE</button>
      <button type="button" class="chip" data-asset="finish">FINISH</button>
    </div>
    <p class="assetnote">Gold dots are pivot markers. Tap one to read its name. They do not edit the mesh.</p>
    <form class="assetbar">
      <span>Command:</span>
      <input id="assetcmd" autocomplete="off" spellcheck="false" placeholder="FINISH    VEHICLE    SEDAN    GLB">
    </form>
    <div id="assetstatus">Meters. Ground is Y. Forward is +Z. People are not this space.</div>
  `;
  document.body.appendChild(host);
  const view = host.querySelector("#assetview");
  api = mount(view, (stats) => {
    const label = vehicle && vehicle.isOpen() && vehicle.label() || doc.name || "asset";
    const name = host && host.querySelector("#assetname");
    if (name && vehicle && vehicle.isOpen() && vehicle.label()) name.textContent = vehicle.label();
    status(
      label +
      "   W " + stats.width.toFixed(2) +
      "  H " + stats.height.toFixed(2) +
      "  D " + stats.depth.toFixed(2) +
      "  TRI " + stats.triangles.toLocaleString()
    );
  });
  vehicle = mountVehicle({
    host,
    getApi: () => api,
    status,
    toast
  });
  api.setPointerHooks({
    onPick(hit) {
      if (vehicle && vehicle.isOpen()) vehicle.onPick(hit);
      else if (hit && hit.object.userData.pivotMarker) {
        status("Pivot " + hit.object.userData.pivotName + ". This marker only names the pivot.");
      }
    }
  });
  sync();
  host.querySelector("#assetclose").addEventListener("click", closeAsset);
  host.querySelectorAll("[data-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.getAttribute("data-asset");
      if (kind === "level") void artist("", "level");
      else if (kind === "artist") void artist("", "asset");
      else if (kind === "glb") {
        if (vehicle && vehicle.isOpen()) {
          toast("Use Export GLB in the vehicle panel. The GLB chip does not download while a vehicle is open.");
          return;
        }
        if (finishOpen()) {
          toast("FINISH does not export. The GLB chip downloads the built-in piece, not the file you picked.");
          return;
        }
        void exportGlb();
      }
      else if (kind === "vehicle") openVehicle();
      else if (kind === "finish") openFinish();
      else setRecipe(kind);
    });
  });
  host.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = host.querySelector("#assetcmd");
    const value = input.value.trim();
    input.value = "";
    if (value) submit(value);
  });
  host.querySelector("#finishpick").addEventListener("click", () => {
    host.querySelector("#finishfile").click();
  });
  host.querySelector("#finishfile").addEventListener("change", (event) => {
    void onFinishFile(event);
  });
  host.querySelector("#finishsave").addEventListener("click", saveFinish);
  host.querySelector("#finishrun").addEventListener("click", () => { void runFinishNow(); });
  host.querySelector("#finishdownload").addEventListener("click", () => {
    if (!finishExport) return;
    downloadBytes(finishExport, "finish.glb", "model/gltf-binary");
  });
  host.querySelector("#finishzip").addEventListener("click", () => {
    if (!finishZip) return;
    downloadBytes(finishZip, "finish.zip", "application/zip");
  });
  const paintMask = (op, radius) => {
    if (!finishMask) {
      toast("Run finish on a car that has a base image first.");
      return;
    }
    const size = finishMask.size;
    const pixels = [];
    const y = Math.floor(size * 0.5);
    for (let x = Math.floor(size * 0.46); x <= Math.floor(size * 0.54); x++) pixels.push({ x, y });
    finishMask.rgba = editMask(finishMask.rgba, size, size, { op: op === "brush" ? "add" : op, pixels, radius: radius || 0 });
    const sheet = phoneReview(finishMask.rgba, size);
    const reviewPng = encodePng(sheet.width, sheet.height, sheet.rgba);
    const review = host.querySelector("#finishreview");
    review.hidden = false;
    review.src = URL.createObjectURL(new Blob([reviewPng], { type: "image/png" }));
    const maskPng = encodePng(size, size, finishMask.rgba);
    if (finishExport) finishExport = replaceNamedImage(finishExport, "mask", maskPng, "image/png");
    if (finishFiles) {
      const note = new TextEncoder().encode("\nMask edit after the verdict. The previous READY or NOT READY line is stale until finish is run again. The download uses this mask.\n");
      finishFiles = finishFiles.map((file) => {
        if (file.name === "model.glb") return { name: file.name, data: finishExport };
        if (file.name === "review-mask-4x.png") return { name: file.name, data: reviewPng };
        if (file.name === "validation.txt") return { name: file.name, data: concatBytes(file.data, note) };
        return file;
      });
      finishZip = zipStore(finishFiles);
    }
    const banner = host.querySelector("#finishbanner");
    banner.classList.add("bad");
    banner.classList.remove("ready");
    banner.textContent = "NOT READY. The mask was edited after the check. Run finish again before treating the verdict as current. The download already contains this mask.";
    toast(op === "remove" ? "Removed a glass region. The teal overlay and the download use it." : op === "brush" ? "Edge brush painted a 2 px glass stroke on the teal overlay." : "Added a glass region. The teal overlay and the download use it.");
  };
  host.querySelector("#finishadd").addEventListener("click", () => paintMask("add", 0));
  host.querySelector("#finishremove").addEventListener("click", () => paintMask("remove", 0));
  host.querySelector("#finishbrush").addEventListener("click", () => paintMask("brush", 2));
  host.querySelector("#finishrules").textContent = PENDING_RULES.implemented
    ? ""
    : "Later steps still unrun. " + PENDING_RULES.windows;
  renderFinish();
}

export function isAssetOpen() {
  return !!host;
}

export function closeAsset() {
  if (api) api.dispose();
  api = null;
  vehicle = null;
  finishFile = null;
  clearActiveFinish();
  if (host) host.remove();
  host = null;
}

export function openFromCommand(res) {
  ensure();
  const action = res && res.action || "asset";
  const rest = (res && res.rest || "").trim();
  if (action === "assetlevel") void artist(rest, "level");
  else if (action === "assetartist") void artist(rest, "asset");
  else if (action === "assetsedan") setRecipe("sedan");
  else if (action === "assetshop") setRecipe("storefront");
  else if (action === "assetbin") setRecipe("dumpster");
  else if (action === "assetglb") {
    if (finishOpen()) toast("FINISH does not export. The GLB command downloads the built-in piece, not the file you picked.");
    else void exportGlb();
  }
  else if (action === "assetvehicle") openVehicle();
  else if (action === "assetfinish") openFinish();
  else if (rest) submit(rest);
  else if (doc.kind !== "level" && !doc.lines.length) setRecipe(doc.recipe || "sedan");
}
