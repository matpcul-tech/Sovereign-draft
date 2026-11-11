import { MATERIAL_ROLES, STRUCTURES } from "./finish/parts.js";
import { growFaces, seamBlocks, wheelSurfaceBlocks } from "./finish/select.js";
import { describeView, inspectVehicle } from "./finish/inspect.js";
import { loadVehicle } from "./finish/glb.js";
import { fusedShellGlb } from "./finish/fixture.js";
import {
  assignFaces,
  buildVehicle,
  changeEdit,
  countAssigned,
  createSession,
  disposeVehicle,
  exportVehicle,
  innerOf,
  measureRig,
  redoEdit,
  restoreEdit,
  selectionList,
  serializeEdit,
  trianglesUnder,
  undoEdit,
  worldToInner
} from "./finish/edit.js";
import { finishZip } from "./finish/review.js";
import { decodeRaster } from "./finish/raster.js";
import * as THREE from "three";

const STORE = "sd-vehicle-finish";

function averageImage(image) {
  if (typeof document === "undefined" || !image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      red += data[i];
      green += data[i + 1];
      blue += data[i + 2];
      count += 1;
    }
    return [red / count, green / count, blue / count];
  } catch {
    return null;
  }
}

function sampleTextures(root) {
  const notes = [];
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.helper) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid) || !material.map || !material.map.image) continue;
      seen.add(material.uuid);
      const average = averageImage(material.map.image);
      if (!average) continue;
      notes.push(material.name + " texture average RGB " + average.map((value) => Math.round(value)).join(", ") + ".");
    }
  });
  const pale = notes.find((line) => line.startsWith("body_paint") && /2[0-5]\d, 2[0-5]\d, 2[0-5]\d/.test(line));
  if (pale) notes.push("A pale body matches that paint texture. It does not mean the atlas, glass, or lamps failed to load.");
  return notes.slice(0, 8);
}

function download(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function pngImages(images) {
  if (typeof document === "undefined") return images;
  const out = [];
  for (const image of images) {
    if (!image.bytes || image.bytes.length < 16 || image.mime === "image/png") {
      out.push(image);
      continue;
    }
    const converted = await transcodeImage(image);
    out.push(converted || image);
  }
  return out;
}

function transcodeImage(image) {
  const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mime || "image/webp" }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        URL.revokeObjectURL(url);
        if (!blob) {
          resolve(null);
          return;
        }
        resolve({
          name: image.name,
          mime: "image/png",
          bytes: new Uint8Array(await blob.arrayBuffer())
        });
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function mountVehicle({ host, getApi, status, toast: notify }) {
  const panel = document.createElement("section");
  panel.id = "vehiclepanel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="vehrow">
      <button type="button" id="vehimport">Import GLB</button>
      <button type="button" id="vehsample">Fused sample</button>
      <input id="vehfile" type="file" accept=".glb,model/gltf-binary" hidden>
    </div>
    <p id="vehlead">Import a Meshy GLB or open the fused sample. The source file stays unchanged until you export. Export is not a drop-in. Ground and scale keep the source meshes and compression. Face, paint, tint, and pivot edits rewrite the file, copy shared meshes, and drop meshopt and WebP, so the file gets larger.</p>
    <p id="vehsummary"></p>
    <ul id="vehissues"></ul>
    <div class="vehrow">
      <button type="button" data-sel="replace">Select</button>
      <button type="button" data-sel="add">Add</button>
      <button type="button" data-sel="sub">Remove</button>
      <button type="button" id="vehgrow">Grow</button>
      <button type="button" id="vehisland">Island</button>
      <button type="button" id="vehclear">Clear selection</button>
      <label>Crease <input id="vehcrease" type="number" min="1" max="180" value="35"></label>
    </div>
    <p id="vehselcount">0 faces selected. Tap the mesh. Grow and Island stay on that mesh.</p>
    <div class="vehlabel">Move faces onto a part</div>
    <div class="vehrow" id="vehstruct"></div>
    <div class="vehlabel">Give faces their own material</div>
    <div class="vehrow" id="vehmat"></div>
    <div class="vehrow">
      <label>Color <input id="vehcolor" type="color" value="#1c3d66"></label>
      <label>Material <select id="vehmatpick"></select></label>
      <button type="button" id="vehtint">Tint material</button>
      <button type="button" id="vehcleartint">Clear tint</button>
    </div>
    <p id="vehtintnote">Tint material recolors every face that already uses that material. It does not split paint from glass, trim, lights, or wheels.</p>
    <div class="vehrow">
      <button type="button" id="vehinge">Set hinge</button>
      <button type="button" id="vehcenter">Center wheels</button>
      <label>Length m <input id="vehtarget" type="number" min="0.2" step="0.1" value="4.5"></label>
      <button type="button" id="vehscale">Apply scale</button>
      <button type="button" id="vehground">Sit on ground</button>
    </div>
    <p id="vehdoornote">The door slider opens the left and right doors outward around each door node's own origin. A large angle swings the trailing edge away from the opening. That hinge is the one already in the file until you set another.</p>
    <div class="vehrow">
      <label>Door <input id="vehdoor" type="range" min="-80" max="80" value="0"></label>
      <label>Spin <input id="vehspin" type="range" min="0" max="360" value="0"></label>
      <label>Steer <input id="vehsteer" type="range" min="-40" max="40" value="0"></label>
    </div>
    <div class="vehrow">
      <button type="button" id="vehundo">Undo</button>
      <button type="button" id="vehredo">Redo</button>
      <button type="button" id="vehsave">Save edits</button>
      <button type="button" id="vehreload">Reload edits</button>
      <button type="button" id="vehexport">Export GLB</button>
      <button type="button" id="vehzip">Export ZIP</button>
    </div>
    <pre id="vehchecks"></pre>
  `;
  const chips = host.querySelector(".assetchips");
  host.insertBefore(panel, chips);

  const struct = panel.querySelector("#vehstruct");
  for (const part of STRUCTURES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.structure = part.id;
    button.textContent = part.label;
    struct.appendChild(button);
  }
  const clearStruct = document.createElement("button");
  clearStruct.type = "button";
  clearStruct.dataset.structure = "";
  clearStruct.textContent = "Unparent";
  struct.appendChild(clearStruct);

  const matRow = panel.querySelector("#vehmat");
  for (const role of MATERIAL_ROLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.material = role.id;
    button.textContent = role.label;
    matRow.appendChild(button);
  }
  const keep = document.createElement("button");
  keep.type = "button";
  keep.dataset.material = "";
  keep.textContent = "Keep material";
  matRow.appendChild(keep);

  let session = null;
  let info = null;
  let imported = {};
  let open = false;
  let display = null;
  let selectMode = "replace";
  let selection = new Map();
  let pending = "";
  let preview = { door: 0, spin: 0, steer: 0 };

  function selectedCount() {
    let count = 0;
    selection.forEach((faces) => { count += faces.size; });
    return count;
  }

  function paintHex() {
    return panel.querySelector("#vehcolor").value || "#1c3d66";
  }

  function partLabel(label, id) {
    const existing = imported[id] || 0;
    const fresh = session ? countAssigned(session.edit, "structure", id) : 0;
    if (existing && fresh) return label + " file " + existing.toLocaleString() + ", new " + fresh;
    if (existing) return label + " file " + existing.toLocaleString();
    return label + " new " + fresh;
  }

  function refreshLabels() {
    if (!session) return;
    panel.querySelectorAll("[data-structure]").forEach((button) => {
      const id = button.dataset.structure;
      if (!id) return;
      const part = STRUCTURES.find((item) => item.id === id);
      button.textContent = partLabel(part.label, id);
    });
    panel.querySelectorAll("[data-material]").forEach((button) => {
      const id = button.dataset.material;
      if (!id) return;
      const role = MATERIAL_ROLES.find((item) => item.id === id);
      button.textContent = role.label + " " + countAssigned(session.edit, "material", id);
    });
  }

  function show() {
    const api = getApi();
    if (!api || !session) return;
    if (display) disposeVehicle(display);
    display = buildVehicle(session.loaded, session.edit, { preview, selection });
    const maps = [];
    display.traverse((obj) => {
      if (!obj.isMesh || !obj.material || obj.userData.helper) return;
      const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const image = material.map && material.map.image;
      maps.push(material.name + ":" + (image ? (image.width || image.videoWidth || 0) : 0));
    });
    globalThis.__vehicleMaps = maps;
    api.showVehicle(display);
    const doors = {};
    for (const id of ["door_fl", "door_fr", "door_rl", "door_rr"]) {
      const node = display.getObjectByName(id);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      doors[id] = { minX: box.min.x, maxX: box.max.x };
    }
    globalThis.__vehicleState = {
      scale: session.edit.scale,
      ground: !!session.edit.ground,
      pivots: Object.keys(session.edit.pivots),
      doors
    };
    if (!session.textureNotes) session.textureNotes = sampleTextures(display);
    info.textureNotes = session.textureNotes;
    fillReport(measureRig(display));
    refreshLabels();
    const count = selectedCount();
    panel.querySelector("#vehselcount").textContent =
      count + " faces selected. Tap the mesh. Grow and Island stay on that mesh." +
      (pending === "hinge" ? " Next tap sets the hinge." : "");
  }

  function fillReport(live) {
    if (!info || !session) return;
    const census = session.loaded.census;
    const lines = [
      info.triangles.toLocaleString() + " tris, " +
      (census ? census.meshes + " glTF meshes, " + census.primitives + " primitives, " + census.sharedMeshes + " shared, " : "") +
      info.meshes + " drawable pieces, " + info.materials.length + " materials, " + info.textures.length + " textures."
    ];
    lines.push(info.materials.map((material) => material.name + " " + material.triangles.toLocaleString()).join(" | "));
    lines.push(info.textures.map((texture) => texture.name + " " + texture.mime + " " + texture.bytes.toLocaleString() + " bytes").join(" | "));
    panel.querySelector("#vehsummary").textContent = lines.join(" ");
    const list = panel.querySelector("#vehissues");
    list.replaceChildren();
    for (const issue of describeView(info, session.edit, live || null)) {
      const item = document.createElement("li");
      item.textContent = issue;
      list.appendChild(item);
    }
    const select = panel.querySelector("#vehmatpick");
    const previous = select.value;
    select.replaceChildren();
    for (const material of info.materials) {
      const option = document.createElement("option");
      option.value = material.name;
      option.textContent = material.name + " (" + material.triangles.toLocaleString() + ")";
      select.appendChild(option);
    }
    if (previous) select.value = previous;
  }

  async function adopt(bytes, fileName) {
    status("Reading GLB…");
    const loaded = await loadVehicle(bytes, fileName);
    if (display) disposeVehicle(display);
    display = null;
    session = createSession(loaded);
    info = inspectVehicle(loaded);
    imported = {};
    for (const part of STRUCTURES) imported[part.id] = trianglesUnder(loaded.scene, part.id);
    selection = new Map();
    pending = "";
    preview = { door: 0, spin: 0, steer: 0 };
    panel.querySelector("#vehdoor").value = "0";
    panel.querySelector("#vehspin").value = "0";
    panel.querySelector("#vehsteer").value = "0";
    panel.querySelector("#vehchecks").textContent = "";
    fillReport();
    panel.scrollTop = 0;
    open = true;
    panel.hidden = false;
    show();
    status(loaded.fileName + "  " + info.triangles.toLocaleString() + " tris. Source file is unchanged.");
    window.__vehicleFinish = { fileName: loaded.fileName, sha256: loaded.sha256, triangles: info.triangles };
  }

  function requireSession() {
    if (session) return true;
    notify("Import a GLB or open the fused sample first.");
    return false;
  }

  function mutate(fn) {
    changeEdit(session, (edit) => {
      edit.paint.hex = paintHex();
      fn(edit);
    });
    show();
  }

  panel.querySelector("#vehimport").addEventListener("click", () => panel.querySelector("#vehfile").click());
  panel.querySelector("#vehfile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      await adopt(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not read that GLB.");
    }
  });
  panel.querySelector("#vehsample").addEventListener("click", async () => {
    try {
      await adopt(fusedShellGlb(), "fused-shell.glb");
      notify("Fused sample: one mesh, one material, shared texture. Not a finished car.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Sample failed.");
    }
  });
  panel.querySelectorAll("[data-sel]").forEach((button) => {
    button.addEventListener("click", () => {
      selectMode = button.dataset.sel;
      panel.querySelectorAll("[data-sel]").forEach((item) => item.classList.toggle("on", item === button));
    });
  });
  panel.querySelector("[data-sel='replace']").classList.add("on");
  panel.querySelector("#vehclear").addEventListener("click", () => {
    selection = new Map();
    pending = "";
    if (session) show();
  });
  panel.querySelector("#vehgrow").addEventListener("click", () => grow(false));
  panel.querySelector("#vehisland").addEventListener("click", () => grow(true));
  panel.querySelectorAll("[data-structure]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!requireSession() || !selectedCount()) {
        notify("Select faces first.");
        return;
      }
      const partId = button.dataset.structure || null;
      mutate((edit) => assignFaces(edit, selectionList(selection), "structure", partId));
      notify(partId ? "Moved " + selectedCount() + " faces to " + partId + "." : "Cleared the part on the selection.");
    });
  });
  panel.querySelectorAll("[data-material]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!requireSession() || !selectedCount()) {
        notify("Select faces first.");
        return;
      }
      const role = button.dataset.material || null;
      mutate((edit) => assignFaces(edit, selectionList(selection), "material", role));
      notify(role === "paint"
        ? "Paint faces now use se_paint. Glass, trim, lights, and wheels are unchanged unless you selected them."
        : role
          ? "Those faces now use se_" + role + "."
          : "Selection keeps its original material.");
    });
  });
  panel.querySelector("#vehtint").addEventListener("click", () => {
    if (!requireSession()) return;
    const name = panel.querySelector("#vehmatpick").value;
    if (!name) return;
    const material = info.materials.find((item) => item.name === name);
    if (info.materials.length < 2) {
      notify("This file has one material. Tint would recolor every face. Select faces and use Paint instead.");
      return;
    }
    mutate((edit) => { edit.tint = { name, hex: paintHex() }; });
    notify("Tinted " + name + " (" + (material ? material.triangles.toLocaleString() : "?") + " triangles). Other materials are not tinted.");
  });
  panel.querySelector("#vehcleartint").addEventListener("click", () => {
    if (!requireSession() || !session.edit.tint) return;
    mutate((edit) => { edit.tint = null; });
  });
  panel.querySelector("#vehinge").addEventListener("click", () => {
    if (!requireSession()) return;
    pending = "hinge";
    const door = doorTarget();
    notify(door ? "Tap the hinge point for " + door + "." : "Assign a door or tap near door_fl, then tap Set hinge.");
    panel.querySelector("#vehselcount").textContent = "Next tap sets the hinge" + (door ? " for " + door : "") + ".";
  });
  panel.querySelector("#vehcenter").addEventListener("click", () => {
    if (!requireSession()) return;
    const ids = wheelTargets();
    if (!ids.length) {
      notify("No wheel spin nodes yet. Assign wheel faces first, or import a file that already has them.");
      return;
    }
    mutate((edit) => {
      const inner = innerOf(display);
      for (const id of ids) {
        const spin = display.getObjectByName(id + "_spin");
        if (!spin) continue;
        const center = new THREE.Box3().setFromObject(spin).getCenter(new THREE.Vector3());
        const point = worldToInner(inner, center);
        edit.pivots[id + "_spin"] = point;
        if (display.getObjectByName(id + "_steer")) edit.pivots[id + "_steer"] = point.slice();
      }
    });
    notify("Spin origins sit on the wheel bounds centers. The mesh stays where it was.");
  });
  panel.querySelector("#vehscale").addEventListener("click", () => {
    if (!requireSession()) return;
    const target = Number(panel.querySelector("#vehtarget").value);
    const length = info.bounds.size[2];
    if (!Number.isFinite(target) || target <= 0 || length <= 1e-6) {
      notify("Need a length and a model with Z extent.");
      return;
    }
    mutate((edit) => { edit.scale = target / length; });
    notify("Scale " + (target / length).toFixed(3) + " targets " + target.toFixed(2) + " m on Z.");
  });
  panel.querySelector("#vehground").addEventListener("click", () => {
    if (!requireSession()) return;
    mutate((edit) => { edit.ground = !edit.ground; });
    notify(session.edit.ground ? "The export sits on Y = 0." : "Ground move cleared.");
  });
  for (const [id, key] of [["#vehdoor", "door"], ["#vehspin", "spin"], ["#vehsteer", "steer"]]) {
    panel.querySelector(id).addEventListener("input", (event) => {
      preview = { ...preview, [key]: Number(event.target.value) };
      if (session) show();
    });
  }
  panel.querySelector("#vehundo").addEventListener("click", () => {
    if (!session || !undoEdit(session)) return;
    show();
  });
  panel.querySelector("#vehredo").addEventListener("click", () => {
    if (!session || !redoEdit(session)) return;
    show();
  });
  panel.querySelector("#vehsave").addEventListener("click", () => {
    if (!requireSession()) return;
    const saved = serializeEdit(session.loaded, session.edit);
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* quota */ }
    download(new TextEncoder().encode(JSON.stringify(saved, null, 2)), "vehicle-edits.json", "application/json");
    notify("Edits saved for this GLB. The source file was not written.");
  });
  panel.querySelector("#vehreload").addEventListener("click", () => {
    if (!requireSession()) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
    if (!saved) {
      notify("No saved edits in this browser.");
      return;
    }
    try {
      session.edit = restoreEdit(session.loaded, saved);
      session.undo = [];
      session.redo = [];
      show();
      notify("Reloaded edits for this GLB.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not reload edits.");
    }
  });
  panel.querySelector("#vehexport").addEventListener("click", () => { void runExport(false); });
  panel.querySelector("#vehzip").addEventListener("click", () => { void runExport(true); });

  async function grow(island) {
    if (!requireSession() || !selectedCount()) {
      notify("Tap a face first.");
      return;
    }
    const crease = Number(panel.querySelector("#vehcrease").value) || 35;
    let added = 0;
    let colorNote = "";
    const next = new Map();
    for (const [key, faces] of selection) {
      const surface = session.loaded.surfaces.find((item) => item.key === key);
      if (!surface) continue;
      let blocks = null;
      if (!island) {
        let rgba = null;
        let width = 0;
        let height = 0;
        const image = session.loaded.images && session.loaded.images.find((item) => item.bytes && item.bytes.length);
        if (image) {
          try {
            const decoded = await decodeRaster(image.bytes, image.mime);
            rgba = decoded.rgba;
            width = decoded.width;
            height = decoded.height;
          } catch (error) {
            colorNote = " Color was not sampled: " + (error instanceof Error ? error.message : "the image could not be read") + ".";
          }
        } else colorNote = " This mesh has no texture to sample.";
        const partIds = new Array(surface.faceCount).fill("shell");
        const table = session.edit && session.edit.structure && session.edit.structure[surface.key];
        if (table) {
          for (const name of Object.keys(table)) {
            for (const face of table[name]) partIds[face] = name;
          }
        }
        blocks = seamBlocks(surface.world, surface.uvs, rgba, width, height, partIds);
        for (const pair of wheelSurfaceBlocks(surface.world)) blocks.add(pair);
      }
      const grown = growFaces(surface.topology, surface.normals, faces, island ? Infinity : crease * Math.PI / 180, blocks);
      added += grown.size - faces.size;
      next.set(key, grown);
    }
    selection = next;
    show();
    notify(island
      ? (added ? "Island added " + added + " connected faces." : "The selection is already the whole island.")
      : (added ? "Grow added " + added + " faces. It stops at a wheel surface, an assigned part, a sampled texture edge, a UV island, or a crease." + colorNote : "No added faces. The next face is a wheel surface, an assigned part, a texture edge, a UV island, or a crease."));
  }

  function doorTarget() {
    for (const part of ["door_fl", "door_fr", "door_rl", "door_rr"]) {
      if (countAssigned(session.edit, "structure", part)) return part;
      if (display && display.getObjectByName(part)) return part;
    }
    return "door_fl";
  }

  function wheelTargets() {
    const ids = [];
    for (const part of STRUCTURES) {
      if (part.steer == null) continue;
      if (display && display.getObjectByName(part.id + "_spin")) ids.push(part.id);
    }
    return ids;
  }

  async function runExport(zip) {
    if (!requireSession()) return;
    status(zip ? "Packing notes…" : "Exporting GLB…");
    try {
      const images = await pngImages(session.loaded.images);
      const result = exportVehicle(session.loaded, session.edit, images);
      const base = (session.loaded.fileName || "vehicle").replace(/\.glb$/i, "");
      if (zip) {
        const packed = finishZip(session.loaded, session.edit, result);
        download(packed, base + "-finish.zip", "application/zip");
      } else {
        download(result.bytes, base + "-finish.glb", "model/gltf-binary");
      }
      const failed = result.checks.filter((check) => !check.pass);
      panel.querySelector("#vehchecks").textContent = result.checks.map((check) => (check.pass ? "PASS  " : "FAIL  ") + check.detail).join("\n");
      notify((zip ? "Saved ZIP. " : "Saved GLB. ") + failed.length + " checks still fail. That is unfinished work, not a score.");
      status("Exported " + result.stats.triangles.toLocaleString() + " tris. Source SHA " + session.loaded.sha256.slice(0, 12) + " unchanged.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Export failed.");
    }
  }

  return {
    open() {
      open = true;
      panel.hidden = false;
      if (session) show();
      else status("Vehicle finish. Import a GLB or open the fused sample.");
    },
    suspend() {
      if (!open && panel.hidden) return;
      open = false;
      panel.hidden = true;
      const api = getApi();
      if (api) api.clearVehicle();
    },
    isOpen() { return open && !panel.hidden; },
    label() { return session ? (session.loaded.fileName || "vehicle").replace(/\.glb$/i, "") : ""; },
    onPick(hit) {
      if (!session || !hit || !hit.object) return;
      if (pending === "hinge" && hit.point) {
        const door = doorTarget();
        const node = display.getObjectByName(door);
        if (!node) {
          notify("Assign faces to " + door + " before setting its hinge.");
          pending = "";
          return;
        }
        const point = worldToInner(innerOf(display), hit.point);
        mutate((edit) => { edit.pivots[door] = point; });
        pending = "";
        notify(door + " hinge set. The door mesh stays put. Drag Door to preview the swing.");
        return;
      }
      const key = hit.object.userData.surfaceKey;
      if (!key || hit.faceIndex == null) return;
      const face = hit.object.userData.faceMap ? hit.object.userData.faceMap[hit.faceIndex] : hit.faceIndex;
      if (face == null) return;
      const next = new Map(selection);
      if (selectMode === "replace") next.clear();
      const set = new Set(next.get(key) || []);
      if (selectMode === "sub") set.delete(face);
      else set.add(face);
      if (set.size) next.set(key, set);
      else next.delete(key);
      selection = next;
      show();
    }
  };
}
