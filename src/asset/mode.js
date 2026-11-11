import { mount } from "./view.js";
import { parseLine } from "./grammar.js";
import { parseLevel } from "./level.js";
import { askArtist, SAMPLE_LEVEL } from "./artist.js";
import { toast } from "../ui/toast.js";
import { mountVehicle } from "./vehicle.js";
import { boundsOf } from "./finish/inspect.js";
import { loadVehicle } from "./finish/glb.js";
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
  note.textContent = profileSummary(profile) + " A budget fail, when an export exists, is a triangle count above the ceiling. Crossing the target is not that fail. A locked border is not a budget fail. None of the finish checks run in this step.";
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
      <p id="finishlead">FINISH stores a profile for a GLB. It does not move, scale, cut, simplify, or export. Source bytes stay as loaded.</p>
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
        <button type="button" id="finishsave">Save profile</button>
      </div>
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
