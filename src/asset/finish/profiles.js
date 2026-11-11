// Finish profiles for one imported GLB. Phase 1 stores the numbers.
// It does not split, clip, simplify, weld, or export.
//
// Street Empire public/models/kit/cars, read 2026-11-11:
// lowrider-v3 28913, muscle-coupe-v4 30189, pickup 30911,
// police-v7 30484, sedan-v9 31296, suv-v3 30381, taxi-v1 29727,
// van-v3 29609. Each file has one material. Names are atlas,
// police_atlas, sedan_atlas, taxi_atlas, or unnamed. None match
// src/kit.js PAINTABLE (/paint|body|carpaint|exterior|shell/i).
// A matching material name takes the tint path in cloneKitCar and
// multiplies material.color, which muddies a baked atlas. The atlas
// path uses paintKey and finishMaterial on the base color instead.
// Primitives on those cars are 5, 5, 6, 5, 7, 5, 5, and 5.
// Nodes are body plus wheel_fl, wheel_fr, wheel_rl, wheel_rr with
// extras.kitWheel. The loader pivots that node. It does not require
// a material named paint or body, and it does not require doors.
// CAR length here stays 4.5 m. The game default length is 4.4 m
// unless the file name sets @len. The field is editable.
// Triangle target 30000 is the working size of those cars.
// Triangle ceiling 40000 is the only hard triangle fail.
// A count of 30001 is over the target and is not a fail.
// Buildings in the game fit a 13 m lot. This BUILDING profile keeps
// 8000 triangles and 4 m per storey. Characters stay 1.8 m and 15000
// triangles. The game retargets a humanoid skeleton. This app does
// not add a rig. Exact bone strings stay in src/retarget.js.
// The kit has no generic PROP slot.
//
// No file-size cap or size band was requested. The byte caps and the
// 5 percent band below are explicit defaults. Change them per file.
// CAR 8 MiB, BUILDING 12 MiB, CHARACTER 16 MiB, PROP 4 MiB.
//
// CAR windows are a mask, not a glass material and not a triangle cut.
// One base color image and the original UVs stay. A separate mask
// image is allowed. src/kit.js does not read extras.kitMask today.

const MIB = 1024 * 1024;

export const GAME_TINT = /paint|body|carpaint|exterior|shell/i;

const OUTPUT_NODES = ["body", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];

export const PROFILES = {
  CAR: {
    id: "CAR",
    lengthZ: 4.5,
    heightY: 0,
    longest: 0,
    storeys: 0,
    storeyHeight: 0,
    triangleTarget: 30000,
    triangleCeiling: 40000,
    maxTexture: 1024,
    byteCap: 8 * MIB,
    tolerance: 0.05,
    pose: "",
    requiredNodes: [],
    outputNodes: OUTPUT_NODES,
    drawCallTargetMin: 5,
    drawCallTargetMax: 7,
    drawCallCeiling: 8,
    singleMaterial: true,
    kitWheel: true,
    wheelCircle: { minSegments: 24, maxSegments: 32, toleranceMm: 1, checked: false }
  },
  BUILDING: {
    id: "BUILDING",
    lengthZ: 0,
    heightY: 4,
    longest: 0,
    storeys: 1,
    storeyHeight: 4,
    triangleTarget: 8000,
    triangleCeiling: 8000,
    maxTexture: 1024,
    byteCap: 12 * MIB,
    tolerance: 0.05,
    pose: "",
    requiredNodes: [],
    nameRules: [],
    wheelCircle: null
  },
  CHARACTER: {
    id: "CHARACTER",
    lengthZ: 0,
    heightY: 1.8,
    longest: 0,
    storeys: 0,
    storeyHeight: 0,
    triangleTarget: 15000,
    triangleCeiling: 15000,
    maxTexture: 1024,
    byteCap: 16 * MIB,
    tolerance: 0.05,
    pose: "T",
    requiredNodes: [],
    nameRules: [],
    wheelCircle: null
  },
  PROP: {
    id: "PROP",
    lengthZ: 0,
    heightY: 0,
    longest: 1,
    storeys: 0,
    storeyHeight: 0,
    triangleTarget: 4000,
    triangleCeiling: 4000,
    maxTexture: 512,
    byteCap: 4 * MIB,
    tolerance: 0.05,
    pose: "",
    requiredNodes: [],
    nameRules: [],
    wheelCircle: null
  }
};

// Later phases read this. implemented false means none of it has run.
export const PENDING_RULES = {
  implemented: false,
  splitBeforeSimplify: "Split into parts on the full resolution source first. Simplify after that, each part on its own.",
  borderLock: "A locked border stays on its boundary curve. Vertices may collapse along the loop when the new vertex stays on that curve within 1 mm. Both parts that share the border receive that identical collapse, so the join does not gap or overlap. Do not freeze every border vertex in place. Do not move a border vertex off the curve or across the boundary. Shared loop simplification is synchronized. Interior simplification of each part may stay independent. The simplifier must not unlock the boundary.",
  wheelCircle: "A wheel circle targets about 24 to 32 segments when that count stays within 1 mm of the curve. Measure vertex position and edge and chord deviation. 1 mm is a hard tolerance. If the radius needs more segments to stay inside 1 mm, keep the extra segments. If the curve still cannot be held, the result is NOT READY. A plane or corner test is not a circular cut.",
  bleed: "Wheel borders are surfaces. Cut triangles that cross a wheel boundary, and interpolate position, normal, and UV on the new vertices. Re-run wheel bleed after the cut and again after simplify. A wheel triangle with vertices on both sides beyond 1 mm is bleed. Any wheel bleed is NOT READY. Report the count. CAR does not cut triangles for glass and does not run a paint or glass bleed check.",
  windows: "CAR windows are a 1024 px mask in the same UV layout as the base. R is glass, G is body paint, B is chrome and lamps, black is tires, trim, and underside. Detect glass from the cabin band above the belt line, excluding wheel cylinders, then a connected region, then the texture edge. Tires and grille outside that band are never glass. The exported base may be cleaned under the mask: flat dark glass tone inside glass, no glass fringe in paint within 4 px, and an 8 px pad on unused UV gutter. Mask edges are 1 to 2 px, never a wider blur. The mask is stored on the one material as emissiveTexture with emissiveFactor [0, 0, 0] and extras.kitMask true. A factor of zero must not drop the image. Street Empire src/kit.js does not read that mask yet. UV overlaps that make an 8 px pad mix two classes are NOT READY. Original UVs stay. The source file bytes stay.",
  budgetFail: "Budget fail is only the measured exported triangle count above the ceiling. For an unedited CAR the target is 30000 and the ceiling is 40000. A count above the target and at or under the ceiling is not a budget fail. A locked border is not a budget fail. If holding the boundary leaves the count over the ceiling, keep the boundary and fail the budget. Draw calls use the exported primitive count. The target is 5 to 7. More than 8 fails. Boundary, wheel bleed, mask, and unsupported source stay separate checks.",
  grow: "Manual Grow still stops on crease angle only. A later change stops at a part boundary, a sampled basecolor change across a shared edge, a UV island edge, or a crease.",
  unsupported: "Transparency, a basecolor color space this step cannot sample, or UV wrapping it cannot resolve is an explicit failure. Skin, morph targets, and animation stay. If a step cannot keep them, that step fails and says what it dropped."
};

let active = null;

export function setActiveFinish(record) {
  active = record;
  return active;
}

export function getActiveFinish() {
  return active;
}

export function clearActiveFinish() {
  active = null;
}

function taken(value, fallback, label) {
  if (value == null || value === "") return { value: fallback };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { error: label + " must be a positive number." };
  return { value: n };
}

function takenInt(value, fallback, label) {
  const got = taken(value, fallback, label);
  if (got.error) return got;
  if (Math.round(got.value) !== got.value) return { error: label + " must be a whole number." };
  return got;
}

export function resolveProfile(id, input = {}) {
  const key = String(id || "").toUpperCase();
  const base = PROFILES[key];
  if (!base) return { error: "Choose CAR, BUILDING, CHARACTER, or PROP." };
  const target = takenInt(
    input.triangleTarget != null && input.triangleTarget !== "" ? input.triangleTarget : input.triangleBudget,
    base.triangleTarget,
    "Triangle target"
  );
  if (target.error) return target;
  const ceiling = takenInt(
    input.triangleCeiling != null && input.triangleCeiling !== "" ? input.triangleCeiling : input.triangleBudget,
    base.triangleCeiling,
    "Triangle ceiling"
  );
  if (ceiling.error) return ceiling;
  if (target.value > ceiling.value) return { error: "Triangle target cannot be above the ceiling." };
  const tex = takenInt(input.maxTexture, base.maxTexture, "Max texture");
  if (tex.error) return tex;
  let byteCap = base.byteCap;
  if (input.byteCapMb != null && input.byteCapMb !== "") {
    const mb = Number(input.byteCapMb);
    if (!Number.isFinite(mb) || mb <= 0) return { error: "File cap must be a positive number of MB." };
    byteCap = Math.round(mb * MIB);
  } else if (input.byteCap != null && input.byteCap !== "") {
    const bytes = taken(input.byteCap, base.byteCap, "File cap");
    if (bytes.error) return bytes;
    byteCap = Math.round(bytes.value);
  }
  let tolerance = base.tolerance;
  if (input.tolerancePct != null && input.tolerancePct !== "") {
    const pct = Number(input.tolerancePct);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return { error: "Size band must be a percent above 0 and below 100." };
    tolerance = pct / 100;
  } else if (input.tolerance != null && input.tolerance !== "") {
    const band = Number(input.tolerance);
    if (!Number.isFinite(band) || band <= 0 || band >= 1) return { error: "Size band must be a fraction above 0 and below 1." };
    tolerance = band;
  }
  const profile = {
    id: key,
    lengthZ: base.lengthZ,
    heightY: base.heightY,
    longest: base.longest,
    storeys: base.storeys,
    storeyHeight: base.storeyHeight,
    triangleTarget: target.value,
    triangleCeiling: ceiling.value,
    maxTexture: tex.value,
    byteCap,
    tolerance,
    pose: base.pose,
    requiredNodes: Array.isArray(input.requiredNodes) ? input.requiredNodes.filter(Boolean) : base.requiredNodes.slice(),
    outputNodes: (base.outputNodes || []).slice(),
    drawCallTargetMin: base.drawCallTargetMin || 0,
    drawCallTargetMax: base.drawCallTargetMax || 0,
    drawCallCeiling: base.drawCallCeiling || 0,
    singleMaterial: !!base.singleMaterial,
    kitWheel: !!base.kitWheel,
    wheelCircle: base.wheelCircle ? { ...base.wheelCircle } : null
  };
  if (key === "CAR") {
    const length = taken(input.lengthZ, base.lengthZ, "Length");
    if (length.error) return length;
    profile.lengthZ = length.value;
  } else if (key === "BUILDING") {
    const storeys = takenInt(input.storeys, base.storeys, "Storeys");
    if (storeys.error) return storeys;
    const storeyHeight = taken(input.storeyHeight, base.storeyHeight, "Storey height");
    if (storeyHeight.error) return storeyHeight;
    profile.storeys = storeys.value;
    profile.storeyHeight = storeyHeight.value;
    if (input.heightY != null && input.heightY !== "") {
      const height = taken(input.heightY, storeys.value * storeyHeight.value, "Height");
      if (height.error) return height;
      profile.heightY = height.value;
    } else {
      profile.heightY = storeys.value * storeyHeight.value;
    }
  } else if (key === "CHARACTER") {
    const height = taken(input.heightY, base.heightY, "Height");
    if (height.error) return height;
    profile.heightY = height.value;
    profile.pose = "T";
  } else if (key === "PROP") {
    const longest = taken(input.longest, base.longest, "Longest side");
    if (longest.error) return longest;
    profile.longest = longest.value;
  }
  return profile;
}

export function guessType(size) {
  const x = Number(size && size[0]) || 0;
  const y = Number(size && size[1]) || 0;
  const z = Number(size && size[2]) || 0;
  const horizontal = Math.max(x, z);
  if (!(x > 0 || y > 0 || z > 0)) {
    return { id: "PROP", reason: "No measured size, so the guess is PROP. Change the type if that is wrong." };
  }
  if (y >= 1.4 && y <= 2.4 && horizontal < 1.2 && y > horizontal * 1.15) {
    return { id: "CHARACTER", reason: "Height is in a person range and larger than the footprint. This is a guess, not a pose check." };
  }
  if (y >= 3 && y >= horizontal * 0.75) {
    return { id: "BUILDING", reason: "The piece is tall. This is a guess." };
  }
  if (horizontal >= 1.5 && horizontal > y * 1.4) {
    return { id: "CAR", reason: "The piece is longer than it is tall. This is a guess. The longest axis is not treated as forward." };
  }
  return { id: "PROP", reason: "The proportions do not match a car, a building, or a person. This is a guess." };
}

// Budget fail looks only at a measured exported triangle count against
// the ceiling. The target is reported and does not fail by itself.
export function budgetCheck(exportedTriangles, profile) {
  const count = Number(exportedTriangles);
  const ceiling = profile && typeof profile === "object" ? Number(profile.triangleCeiling) : Number(profile);
  const target = profile && typeof profile === "object" ? Number(profile.triangleTarget) : null;
  if (!Number.isFinite(count) || count < 0) {
    return {
      id: "budget",
      pass: false,
      overTarget: false,
      count: null,
      target: Number.isFinite(target) ? target : null,
      ceiling: Number.isFinite(ceiling) ? ceiling : null,
      detail: "Exported triangle count was not measured.",
      action: "Count triangles in the exported GLB."
    };
  }
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return {
      id: "budget",
      pass: false,
      overTarget: false,
      count,
      target: Number.isFinite(target) ? target : null,
      ceiling: null,
      detail: "Triangle ceiling is not a positive number.",
      action: "Set a positive triangle ceiling on the profile."
    };
  }
  const overCeiling = count > ceiling;
  const overTarget = Number.isFinite(target) && count > target;
  let detail;
  if (overCeiling) detail = "Exported triangles " + count + " are over the ceiling of " + ceiling + ".";
  else if (overTarget) detail = "Exported triangles " + count + " are over the target of " + target + " and within the ceiling of " + ceiling + ". Not a budget fail.";
  else if (Number.isFinite(target)) detail = "Exported triangles " + count + " are within the target of " + target + " and the ceiling of " + ceiling + ".";
  else detail = "Exported triangles " + count + " are within the ceiling of " + ceiling + ".";
  return {
    id: "budget",
    pass: !overCeiling,
    overTarget: overTarget && !overCeiling,
    count,
    target: Number.isFinite(target) ? target : null,
    ceiling,
    detail,
    action: overCeiling ? "The exported mesh is over the ceiling. Do not unlock a border to pass this check." : ""
  };
}

export function drawCallCheck(primitives, profile) {
  const count = Number(primitives);
  const min = profile && profile.drawCallTargetMin ? profile.drawCallTargetMin : 5;
  const max = profile && profile.drawCallTargetMax ? profile.drawCallTargetMax : 7;
  const ceiling = profile && profile.drawCallCeiling ? profile.drawCallCeiling : 8;
  if (!Number.isFinite(count) || count < 0) {
    return { id: "drawcalls", pass: false, onTarget: false, count: null, detail: "Exported primitive count was not measured." };
  }
  const onTarget = count >= min && count <= max;
  const pass = count <= ceiling;
  let detail;
  if (!pass) detail = count + " primitives are over the ceiling of " + ceiling + ".";
  else if (onTarget) detail = count + " primitives are inside the target of " + min + " to " + max + ".";
  else detail = count + " primitives are outside the target of " + min + " to " + max + " and within the ceiling of " + ceiling + ". Not a draw call fail.";
  return { id: "drawcalls", pass, onTarget, count, ceiling, detail };
}

export function carSourceCheck(source) {
  const names = (source && source.materialNames) || [];
  const count = source && Number.isFinite(source.materialCount) ? source.materialCount : names.length;
  const images = source && source.imageCount;
  if (!count) {
    return { id: "source", ready: false, unsupported: false, detail: "No material was read. This is not READY." };
  }
  const tintNamed = names.filter((name) => GAME_TINT.test(name || ""));
  if (count > 1) {
    return {
      id: "source",
      ready: false,
      unsupported: true,
      detail: "NOT READY. This source has " + count + " materials (" + names.filter(Boolean).join(", ") + "). CAR export keeps one original material and one base color image. A new atlas is not baked.",
      action: "Use a single-material GLB, or open VEHICLE for manual paint, glass, trim, and lights."
    };
  }
  if (tintNamed.length) {
    return {
      id: "source",
      ready: false,
      unsupported: true,
      detail: "NOT READY. Material " + tintNamed[0] + " matches the game tint list. The game would multiply that color onto the baked texture.",
      action: "This step does not rename materials. A CAR material must not be named paint, body, carpaint, exterior, or shell."
    };
  }
  const imageBit = images == null ? "an unread image count" : images + " image file(s)";
  return {
    id: "source",
    ready: false,
    unsupported: false,
    detail: "Source has one material" + (names[0] ? " (" + names[0] + ")" : "") + " and " + imageBit + ". Extra original maps on that material can stay. Finish has not run, so this is not READY."
  };
}

export function profileSummary(profile) {
  if (!profile || profile.error) return profile && profile.error || "No profile.";
  const lines = [];
  if (profile.id === "CAR") {
    lines.push("Target length " + profile.lengthZ + " m on Z.");
    lines.push("Output nodes " + (profile.outputNodes || []).join(", ") + ". One material on all of them. Wheel nodes get extras.kitWheel. No door split and no material named paint or body.");
    lines.push("Draw call target " + profile.drawCallTargetMin + " to " + profile.drawCallTargetMax + ". More than " + profile.drawCallCeiling + " exported primitives fails.");
  }
  if (profile.id === "BUILDING") {
    lines.push("Target height " + profile.heightY + " m (" + profile.storeys + " storeys at " + profile.storeyHeight + " m).");
  }
  if (profile.id === "CHARACTER") lines.push("Target height " + profile.heightY + " m. Pose target is T. This app does not add a rig.");
  if (profile.id === "PROP") lines.push("Target longest side " + profile.longest + " m.");
  lines.push("Triangle target " + profile.triangleTarget + ". Triangle ceiling " + profile.triangleCeiling + ". Max texture " + profile.maxTexture + " px. File cap " + (profile.byteCap / MIB).toFixed(0) + " MB. Size band " + Math.round(profile.tolerance * 100) + " percent.");
  if (profile.wheelCircle) {
    lines.push("Wheel circle target " + profile.wheelCircle.minSegments + " to " + profile.wheelCircle.maxSegments + " segments, within " + profile.wheelCircle.toleranceMm + " mm of the curve. Not scored in this step.");
  }
  if (profile.id === "CHARACTER") {
    lines.push("Street Empire retargets a humanoid skeleton. Exact bone names are not copied into this profile. An empty node list is not a pass.");
  } else if (profile.id === "BUILDING") {
    lines.push("The build kit names no required building nodes. An empty node list is not a pass.");
  } else if (profile.id === "PROP") {
    lines.push("The build kit has no generic prop slot. An empty node list is not a pass.");
  }
  if (profile.requiredNodes && profile.requiredNodes.length) {
    lines.push("Extra node names: " + profile.requiredNodes.join(", ") + ".");
  }
  return lines.join(" ");
}
