import { mount } from "./view.js";
import { parseLine } from "./grammar.js";
import { parseLevel } from "./level.js";
import { askArtist, SAMPLE_LEVEL } from "./artist.js";
import { toast } from "../ui/toast.js";

const RECIPES = {
  sedan: { name: "sedan", paint: "#1c3d66", budget: 12000 },
  storefront: { name: "storefront", paint: "#efe6d4", budget: 8000 },
  dumpster: { name: "dumpster", paint: "#2c4638", budget: 4000 },
  blank: { name: "blockout", paint: "#c4b8a2", budget: 8000 }
};

let host = null;
let api = null;
let busy = false;
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

function setRecipe(recipe) {
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
  if (parsed.meta === "export") { void exportGlb(); return; }
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
    <div class="assetchips">
      <button type="button" class="chip gold" data-asset="level">LEVEL</button>
      <button type="button" class="chip" data-asset="artist">ARTIST</button>
      <button type="button" class="chip" data-asset="sedan">SEDAN</button>
      <button type="button" class="chip" data-asset="storefront">SHOP</button>
      <button type="button" class="chip" data-asset="dumpster">BIN</button>
      <button type="button" class="chip" data-asset="glb">GLB</button>
    </div>
    <form class="assetbar">
      <span>Command:</span>
      <input id="assetcmd" autocomplete="off" spellcheck="false" placeholder="LEVEL    ARTIST a street lamp    GLB">
    </form>
    <div id="assetstatus">Meters. Ground is Y. Forward is +Z. People are not this space.</div>
  `;
  document.body.appendChild(host);
  const view = host.querySelector("#assetview");
  api = mount(view, (stats) => {
    status(
      (doc.name || "asset") +
      "   W " + stats.width.toFixed(2) +
      "  H " + stats.height.toFixed(2) +
      "  D " + stats.depth.toFixed(2) +
      "  TRI " + stats.triangles.toLocaleString()
    );
  });
  sync();
  host.querySelector("#assetclose").addEventListener("click", closeAsset);
  host.querySelectorAll("[data-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.getAttribute("data-asset");
      if (kind === "level") void artist("", "level");
      else if (kind === "artist") void artist("", "asset");
      else if (kind === "glb") void exportGlb();
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
}

export function isAssetOpen() {
  return !!host;
}

export function closeAsset() {
  if (api) api.dispose();
  api = null;
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
  else if (action === "assetglb") void exportGlb();
  else if (rest) submit(rest);
  else if (doc.kind !== "level" && !doc.lines.length) setRecipe(doc.recipe || "sedan");
}
