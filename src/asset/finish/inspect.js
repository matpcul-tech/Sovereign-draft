import { faceTopology } from "./select.js";

const CONTRACT = ["door_fl", "door_fr", "door_rl", "door_rr", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];

export function boundsOf(surfaces) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const surface of surfaces) {
    const world = surface.world;
    for (let i = 0; i < world.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = world[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function formatMeters(value) {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs < 5e-7) return "0.000";
  if (abs < 0.001) return value.toFixed(6);
  return value.toFixed(3);
}

function fmt(value) {
  return formatMeters(value);
}

export function inspectVehicle(loaded) {
  const surfaces = loaded.surfaces;
  let triangles = 0;
  let degenerate = 0;
  let duplicate = 0;
  let nonManifold = 0;
  const materialCounts = new Map();
  for (const surface of surfaces) {
    triangles += surface.faceCount;
    if (!surface.topology) surface.topology = faceTopology(surface.world);
    degenerate += surface.topology.degenerate;
    duplicate += surface.topology.duplicate;
    nonManifold += surface.topology.nonManifold;
    const name = surface.material || "material";
    materialCounts.set(name, (materialCounts.get(name) || 0) + surface.faceCount);
  }
  const bounds = boundsOf(surfaces);
  const names = [];
  loaded.scene.traverse((obj) => {
    if (obj.name) names.push(obj.name);
  });
  const missing = CONTRACT.filter((name) => !names.includes(name));
  const issues = [];
  const size = bounds.size;
  const longest = Math.max(size[0], size[1], size[2]);
  const axes = ["X", "Y", "Z"];
  const longAxis = axes[size.indexOf(longest)] || "Z";
  issues.push(
    "Source size is " + fmt(size[0]) + " m wide (X), " + fmt(size[1]) + " m high (Y), " + fmt(size[2]) + " m long (Z). Import did not rescale or move the file."
  );
  if (longest < 2 || longest > 12) {
    const guess = longest > 1e-6 ? (4.5 / size[2]) : 0;
    issues.push(
      "Longest side is " + fmt(longest) + " m on " + longAxis + ". A street sedan is often near 4.5 m long. " +
      (size[2] > 1e-6 ? "Scale " + guess.toFixed(2) + " would make Z about 4.5 m. That guess is not applied." : "Length is too small to suggest a scale.")
    );
  }
  if (longAxis !== "Z") {
    issues.push("The longest side is " + longAxis + ", not Z. This space treats +Z as forward. No rotation was applied.");
  }
  if (bounds.min[1] < -0.01) {
    issues.push("Lowest point is Y " + fmt(bounds.min[1]) + " m. The ground plane is Y = 0. No move was applied.");
  }
  const required = loaded.json.extensionsRequired || [];
  if (required.includes("EXT_meshopt_compression")) {
    issues.push("Source geometry is meshopt compressed. The view decodes it. Export writes plain glTF.");
  }
  if (required.includes("EXT_texture_webp")) {
    issues.push("Source textures are WebP. Export keeps those bytes unless this browser rewrites them to PNG.");
  }
  if (materialCounts.size <= 1) {
    issues.push("This file has " + materialCounts.size + " material. A color on that material would tint every face. Assign faces to split paint from glass, trim, lights, and wheels.");
  }
  if (surfaces.length <= 1) {
    issues.push("This file has " + surfaces.length + " mesh. Faces stay one shell until you assign them.");
  }
  if (degenerate) issues.push(degenerate + " triangles have no area.");
  if (duplicate) issues.push(duplicate + " triangles repeat the same three corners within 0.5 mm.");
  if (nonManifold) issues.push(nonManifold + " edges are shared by more than two triangles.");
  if (missing.length) issues.push("Contract names not in this file: " + missing.join(", ") + ".");
  const materials = [...materialCounts.entries()].map(([name, count]) => ({ name, triangles: count }));
  const textures = (loaded.images || []).map((image) => ({
    name: image.name,
    mime: image.mime,
    bytes: image.bytes.length
  }));
  return {
    triangles,
    meshes: surfaces.length,
    materials,
    textures,
    bounds,
    issues,
    names,
    missing,
    degenerate,
    duplicate,
    nonManifold
  };
}

export function describeView(info, edit, live) {
  const issues = [];
  const source = info.bounds;
  issues.push(
    "Source size is " + fmt(source.size[0]) + " m wide (X), " + fmt(source.size[1]) + " m high (Y), " + fmt(source.size[2]) + " m long (Z). Import did not rescale or move the file."
  );
  if (edit) {
    const factor = Number(edit.scale || 1);
    issues.push(
      "View size is " + fmt(source.size[0] * factor) + " m wide (X), " + fmt(source.size[1] * factor) + " m high (Y), " + fmt(source.size[2] * factor) + " m long (Z) at scale " + factor.toFixed(3) + ". Preview angles are not included in this size."
    );
  }
  if (edit.ground && live && live.bounds) {
    const wheelBottoms = Object.values(live.wheels || {}).filter(Boolean).map((wheel) => wheel.minY).filter((value) => Number.isFinite(value));
    const wheelLine = wheelBottoms.length
      ? " Lowest wheel is Y " + fmt(Math.min(...wheelBottoms)) + " m."
      : "";
    const shellLine = Number.isFinite(live.shellMinY)
      ? " Lowest mesh that is not a wheel is Y " + fmt(live.shellMinY) + " m."
      : "";
    issues.push(
      "Sit on ground is on. Lowest point in the view is Y " + fmt(live.bounds.min[1]) + " m." + wheelLine + shellLine + " The move uses the lowest vertex. It does not bury the shell on purpose."
    );
  }
  for (const line of info.issues) {
    if (line.startsWith("Source size") || line.startsWith("Size is ")) continue;
    if (line.startsWith("Lowest point") && edit.ground) continue;
    if (line.startsWith("Longest side") && edit.scale && edit.scale !== 1) {
      issues.push(line.replace("That guess is not applied.", "A scale is now applied in the view. The source file is unchanged."));
      continue;
    }
    issues.push(line);
  }
  for (const note of info.textureNotes || []) issues.push(note);
  return issues;
}
