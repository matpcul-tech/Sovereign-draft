import { encodePng } from "./png.js";
import { zipStore } from "./zip.js";
import { appliedMapping, countAssigned } from "./edit.js";

const COLORS = {
  paint: [28, 61, 102, 255],
  glass: [154, 196, 206, 255],
  trim: [176, 178, 184, 255],
  light: [255, 214, 150, 255],
  door_fl: [196, 90, 60, 255],
  door_fr: [214, 130, 78, 255],
  door_rl: [150, 70, 48, 255],
  door_rr: [176, 96, 64, 255],
  wheel_fl: [24, 24, 24, 255],
  wheel_fr: [48, 48, 48, 255],
  wheel_rl: [36, 36, 36, 255],
  wheel_rr: [64, 64, 64, 255],
  other: [120, 132, 148, 255]
};

function roleMaps(edit) {
  const maps = new Map();
  const put = (kind, priority) => {
    for (const key of Object.keys(edit[kind] || {})) {
      if (!maps.has(key)) maps.set(key, new Map());
      const faces = maps.get(key);
      for (const id of Object.keys(edit[kind][key])) {
        for (const face of edit[kind][key][id]) {
          const prev = faces.get(face);
          if (!prev || priority > prev.priority) faces.set(face, { id, priority });
        }
      }
    }
  };
  put("material", 1);
  put("structure", 2);
  return maps;
}

function project(view, x, y, z) {
  if (view === "side") return { x: z, y, z: x };
  if (view === "top") return { x, y: -z, z: y };
  if (view === "oblique") return { x: x + z * 0.55, y: y + z * 0.12, z: z + x };
  return { x, y, z };
}

function raster(loaded, edit, view, width, height) {
  const maps = roleMaps(edit);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const triangles = [];
  for (const surface of loaded.surfaces) {
    const faceRoles = maps.get(surface.key);
    for (let face = 0; face < surface.faceCount; face++) {
      const base = face * 9;
      const points = [0, 1, 2].map((corner) => project(
        view,
        surface.world[base + corner * 3],
        surface.world[base + corner * 3 + 1],
        surface.world[base + corner * 3 + 2]
      ));
      const role = faceRoles && faceRoles.get(face);
      triangles.push({ points, color: COLORS[(role && role.id) || "other"] || COLORS.other });
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 7;
    rgba[i + 1] = 16;
    rgba[i + 2] = 31;
    rgba[i + 3] = 255;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = (Math.min(width, height) - 16) / span;
  const depth = new Float32Array(width * height);
  depth.fill(-1e9);
  const ox = (width - (maxX - minX) * scale) * 0.5;
  const oy = (height - (maxY - minY) * scale) * 0.5;
  for (const tri of triangles) {
    const px = tri.points.map((point) => ({
      x: ox + (point.x - minX) * scale,
      y: height - (oy + (point.y - minY) * scale),
      z: point.z
    }));
    const minPx = Math.max(0, Math.floor(Math.min(px[0].x, px[1].x, px[2].x)));
    const maxPx = Math.min(width - 1, Math.ceil(Math.max(px[0].x, px[1].x, px[2].x)));
    const minPy = Math.max(0, Math.floor(Math.min(px[0].y, px[1].y, px[2].y)));
    const maxPy = Math.min(height - 1, Math.ceil(Math.max(px[0].y, px[1].y, px[2].y)));
    for (let y = minPy; y <= maxPy; y++) {
      for (let x = minPx; x <= maxPx; x++) {
        const v0x = px[2].x - px[0].x;
        const v0y = px[2].y - px[0].y;
        const v1x = px[1].x - px[0].x;
        const v1y = px[1].y - px[0].y;
        const v2x = x - px[0].x;
        const v2y = y - px[0].y;
        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;
        const denom = dot00 * dot11 - dot01 * dot01;
        if (Math.abs(denom) < 1e-8) continue;
        const u = (dot11 * dot02 - dot01 * dot12) / denom;
        const v = (dot00 * dot12 - dot01 * dot02) / denom;
        if (u < -0.001 || v < -0.001 || u + v > 1.001) continue;
        const z = px[0].z * (1 - u - v) + px[1].z * v + px[2].z * u;
        const pixel = y * width + x;
        if (z < depth[pixel]) continue;
        depth[pixel] = z;
        const offset = pixel * 4;
        rgba[offset] = tri.color[0];
        rgba[offset + 1] = tri.color[1];
        rgba[offset + 2] = tri.color[2];
        rgba[offset + 3] = 255;
      }
    }
  }
  return encodePng(width, height, rgba);
}

export function reviewSheets(loaded, edit) {
  return [
    { name: "review-front.png", data: raster(loaded, edit, "front", 320, 180) },
    { name: "review-side.png", data: raster(loaded, edit, "side", 320, 180) },
    { name: "review-top.png", data: raster(loaded, edit, "top", 320, 180) },
    { name: "review-parts.png", data: raster(loaded, edit, "oblique", 320, 180) }
  ];
}

export function validationNotes(loaded, edit, checks) {
  const lines = [
    "Sovereign Draft vehicle finish",
    "Source file: " + loaded.fileName,
    "SHA-256: " + loaded.sha256,
    "The source bytes are not modified. This package is a new export.",
    "",
    "What you can do here",
    "Import a GLB, including meshopt and WebP files the viewer can decode.",
    "Select faces, grow a region, or take a connected island on that mesh.",
    "Assign those faces to a door, a wheel, or a material. Paint faces leave the shared atlas.",
    "Paint gets a new box UV layout and a plain white texture. The color is the factor se_paint.",
    "Set a door hinge or a wheel spin center. Preview swing, spin, and steer. Preview angles are not saved in the GLB.",
    "Scale and ground are explicit. They are not applied on import.",
    "",
    "What this does not do",
    "It does not rebuild topology, fill an interior, or separate parts you did not select.",
    "A ground or scale change keeps the source meshes and compression, and moves the scene roots. It is not a drop-in.",
    "Face, paint, tint, and pivot edits rewrite the file. Shared meshes are copied. meshopt, quantization, and WebP are dropped, so the file gets larger.",
    "A tint of an existing material recolors every face that already uses it. That is not face separation.",
    "Failed checks are unfinished work. This package does not award a status.",
    "",
    "Assignments",
    "Paint faces: " + countAssigned(edit, "material", "paint"),
    "Glass faces: " + countAssigned(edit, "material", "glass"),
    "Trim faces: " + countAssigned(edit, "material", "trim"),
    "Light faces: " + countAssigned(edit, "material", "light")
  ];
  for (const id of ["door_fl", "door_fr", "door_rl", "door_rr", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
    lines.push(id + " faces: " + countAssigned(edit, "structure", id));
  }
  lines.push("Scale: " + edit.scale);
  lines.push("Sit on ground: " + (edit.ground ? "yes" : "no"));
  lines.push("Material tint: " + (edit.tint ? edit.tint.name + " " + edit.tint.hex : "none"));
  lines.push("");
  lines.push("Checks");
  for (const check of checks) lines.push((check.pass ? "PASS" : "FAIL") + "  " + check.id + ": " + check.detail);
  return lines.join("\n");
}

export function finishZip(loaded, edit, result) {
  const base = (loaded.fileName || "vehicle").replace(/\.glb$/i, "");
  const mapping = new TextEncoder().encode(JSON.stringify(appliedMapping(loaded, edit, result), null, 2));
  const notes = new TextEncoder().encode(validationNotes(loaded, edit, result.checks));
  const files = [
    { name: base + "-finish.glb", data: result.bytes },
    { name: "mapping.json", data: mapping },
    { name: "validation.txt", data: notes },
    ...reviewSheets(loaded, edit)
  ];
  return zipStore(files);
}
