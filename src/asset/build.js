import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { parseLine } from "./grammar.js";
import { createPalette } from "./materials.js";
function boxUv(geometry) {
  const pos = geometry.getAttribute("position");
  const norm = geometry.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(norm.getX(i));
    const ay = Math.abs(norm.getY(i));
    const az = Math.abs(norm.getZ(i));
    let u = x;
    let v = y;
    if (ax >= ay && ax >= az) {
      u = z;
      v = y;
    } else if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
function applyGrime(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const pos = geometry.getAttribute("position");
  const norm = geometry.getAttribute("normal");
  if (!bounds || !pos || !norm) return;
  const color = new Float32Array(pos.count * 3);
  const span = Math.max(0.2, bounds.max.y - bounds.min.y);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bounds.min.y) / span;
    const down = Math.max(0, -norm.getY(i));
    const dirt = Math.min(0.7, (1 - t) * 0.36 + down * 0.26);
    const value = 1 - dirt;
    color[i * 3] = value;
    color[i * 3 + 1] = value;
    color[i * 3 + 2] = value;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
}
function dress(geometry, grime) {
  geometry.computeVertexNormals();
  boxUv(geometry);
  if (grime) applyGrime(geometry);
}
function carve(base, cuts) {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  let brush = new Brush(base);
  brush.updateMatrixWorld(true);
  const retired = [];
  for (const cutGeo of cuts) {
    const cut = new Brush(cutGeo);
    cut.updateMatrixWorld(true);
    try {
      const next = evaluator.evaluate(brush, cut, SUBTRACTION);
      const count = next.geometry.getAttribute("position")?.count ?? 0;
      if (count > 0) {
        retired.push(brush.geometry);
        brush = next;
        brush.updateMatrixWorld(true);
      }
    } catch {
    }
    cutGeo.dispose();
  }
  const geometry = brush.geometry.clone();
  for (const old of retired) {
    if (old !== brush.geometry) old.dispose();
  }
  return geometry;
}
function mesh(name, geometry, slot, palette, grime) {
  dress(geometry, grime);
  const object = new THREE.Mesh(geometry, palette.get(slot));
  object.name = name;
  object.castShadow = slot !== "glass";
  object.receiveShadow = true;
  return object;
}
function place(group, name, slot, size, at, palette, grime) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const object = mesh(name, geometry, slot, palette, grime);
  object.position.set(at[0], at[1], at[2]);
  group.add(object);
  return object;
}
function cutBox(w, h, d, x, y, z) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}
function wheel(name, x, z, radius, width, palette) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.userData.pivot = true;
  pivot.position.set(x, radius, z);
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = mesh("tire", tireGeo, "rubber", palette, true);
  const hubGeo = new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, width * 0.38, 16);
  hubGeo.rotateZ(Math.PI / 2);
  hubGeo.translate(Math.sign(x || 1) * width * 0.28, 0, 0);
  const hub = mesh("hub", hubGeo, "metal", palette, false);
  pivot.add(tire, hub);
  return pivot;
}
function sedan(palette) {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  const pts = [
    [2.2, 0.3],
    [2.16, 0.52],
    [1.9, 0.66],
    [1.1, 0.74],
    [0.58, 0.78],
    [0.22, 1.04],
    [-0.08, 1.22],
    [-0.9, 1.24],
    [-1.2, 1.06],
    [-1.58, 0.82],
    [-2.08, 0.74],
    [-2.22, 0.52],
    [-2.18, 0.3]
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const point of pts.slice(1)) shape.lineTo(point[0], point[1]);
  shape.closePath();
  const depth = 1.7;
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.055,
    bevelSegments: 2,
    curveSegments: 8,
    steps: 1
  });
  bodyGeo.translate(0, 0, -depth / 2);
  bodyGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  const wells = [
    [0.78, 0.34, 1.28],
    [-0.78, 0.34, 1.28],
    [0.78, 0.34, -1.32],
    [-0.78, 0.34, -1.32]
  ].map(([x, y, z]) => {
    const geometry = new THREE.CylinderGeometry(0.48, 0.48, 0.8, 22);
    geometry.rotateZ(Math.PI / 2);
    geometry.translate(x, y, z);
    return geometry;
  });
  const cabin = new THREE.BoxGeometry(1.34, 0.34, 1.48);
  cabin.translate(0, 0.98, -0.12);
  const carved = carve(bodyGeo, [...wells, cabin]);
  group.add(mesh("body", carved, "paint", palette, true));
  const glassGeo = new THREE.BoxGeometry(1.18, 0.26, 1.28);
  const glass = mesh("cabin", glassGeo, "glass", palette, false);
  glass.position.set(0, 0.98, -0.12);
  group.add(glass);
  place(group, "headlamp_l", "light", [0.34, 0.12, 0.08], [-0.62, 0.58, 2.08], palette, false);
  place(group, "headlamp_r", "light", [0.34, 0.12, 0.08], [0.62, 0.58, 2.08], palette, false);
  place(group, "taillamp_l", "light", [0.32, 0.1, 0.06], [-0.64, 0.62, -2.1], palette, false);
  place(group, "taillamp_r", "light", [0.32, 0.1, 0.06], [0.64, 0.62, -2.1], palette, false);
  for (const x of [-0.98, 0.98]) {
    place(
      group,
      x < 0 ? "mirror_l" : "mirror_r",
      "paint",
      [0.1, 0.1, 0.2],
      [x, 0.92, 0.32],
      palette,
      true
    );
  }
  const mounts = [
    ["wheel_fl", -0.78, 1.28],
    ["wheel_fr", 0.78, 1.28],
    ["wheel_rl", -0.78, -1.32],
    ["wheel_rr", 0.78, -1.32]
  ];
  for (const [name, x, z] of mounts) group.add(wheel(name, x, z, 0.33, 0.22, palette));
  return group;
}
function storefront(palette) {
  const group = new THREE.Group();
  const rear = new THREE.BoxGeometry(8, 6.6, 5.5);
  const mass = mesh("mass", rear, "concrete", palette, true);
  mass.position.set(0, 3.3, -3);
  group.add(mass);
  const facade = new THREE.BoxGeometry(8.2, 6.8, 0.46);
  facade.translate(0, 3.4, 0);
  const carved = carve(facade, [
    cutBox(6.5, 2.65, 0.7, 0, 1.62, 0),
    cutBox(1.7, 1.2, 0.7, -2.3, 5.05, 0),
    cutBox(1.7, 1.2, 0.7, 0, 5.05, 0),
    cutBox(1.7, 1.2, 0.7, 2.3, 5.05, 0)
  ]);
  group.add(mesh("facade", carved, "brick", palette, true));
  place(group, "shop-glass", "glass", [5.15, 2.35, 0.04], [0.55, 1.62, 0.02], palette, false);
  const doorPivot = new THREE.Group();
  doorPivot.name = "door";
  doorPivot.userData.pivot = true;
  doorPivot.position.set(-3.15, 0, 0.08);
  const doorGeo = new THREE.BoxGeometry(1, 2.2, 0.06);
  const door = mesh("door-leaf", doorGeo, "paint", palette, true);
  door.position.set(0.5, 1.18, 0);
  doorPivot.add(door);
  group.add(doorPivot);
  const windows = [
    ["window_l", -2.3],
    ["window_c", 0],
    ["window_r", 2.3]
  ];
  for (const [name, x] of windows) {
    place(group, name, "glass", [1.48, 1.02, 0.04], [x, 5.05, 0.02], palette, false);
  }
  place(group, "sign", "paint", [3.3, 0.4, 0.08], [0.5, 3.22, 0.28], palette, true);
  place(group, "awning", "paint", [2.3, 0.06, 0.9], [-2.15, 3.12, 0.58], palette, true);
  place(group, "cornice", "metal", [8.45, 0.14, 0.56], [0, 6.86, 0.06], palette, false);
  place(group, "sidewalk", "concrete", [8.8, 0.1, 2.3], [0, 0.05, 1.35], palette, true);
  return group;
}
function dumpster(palette) {
  const group = new THREE.Group();
  const bin = new THREE.BoxGeometry(1.9, 1.08, 1.16);
  bin.translate(0, 0.78, 0);
  const mouth = new THREE.BoxGeometry(1.68, 0.48, 0.94);
  mouth.translate(0, 1.16, 0);
  group.add(mesh("bin", carve(bin, [mouth]), "paint", palette, true));
  const lidPivot = new THREE.Group();
  lidPivot.name = "lid";
  lidPivot.userData.pivot = true;
  lidPivot.position.set(0, 1.3, -0.56);
  lidPivot.rotation.x = -0.5;
  const lidGeo = new THREE.BoxGeometry(1.94, 0.06, 1.18);
  const lid = mesh("lid-panel", lidGeo, "metal", palette, false);
  lid.position.set(0, 0.02, 0.58);
  lidPivot.add(lid);
  group.add(lidPivot);
  const mounts = [
    ["wheel_fl", -0.78, 0.4],
    ["wheel_fr", 0.78, 0.4],
    ["wheel_rl", -0.78, -0.4],
    ["wheel_rr", 0.78, -0.4]
  ];
  for (const [name, x, z] of mounts) group.add(wheel(name, x, z, 0.12, 0.08, palette));
  return group;
}
function addUserOps(group, lines, palette) {
  let last = null;
  function solid(geometry, slot, index, at) {
    const object = mesh(
      `${slot}_${index + 1}`,
      geometry,
      slot,
      palette,
      slot !== "glass" && slot !== "light"
    );
    object.position.set(at[0], at[1], at[2]);
    group.add(object);
    last = object;
  }
  function orient(geometry, axis) {
    if (axis === "x") geometry.rotateZ(Math.PI / 2);
    if (axis === "z") geometry.rotateX(Math.PI / 2);
  }
  function cutLast(cut) {
    if (!last) {
      cut.dispose();
      return;
    }
    cut.translate(-last.position.x, -last.position.y, -last.position.z);
    const grime = !!last.geometry.getAttribute("color");
    const work = last.geometry.clone();
    const next = carve(work, [cut]);
    dress(next, grime);
    last.geometry.dispose();
    last.geometry = next;
  }
  lines.forEach((line, index) => {
    const parsed = parseLine(line);
    if (!("op" in parsed)) return;
    const op = parsed.op;
    if (op.kind === "pivot") {
      const pivot = new THREE.Group();
      pivot.name = op.name;
      pivot.userData.pivot = true;
      pivot.position.set(op.c[0], op.c[1], op.c[2]);
      group.add(pivot);
      return;
    }
    if (op.kind === "cut") {
      if (op.shape === "box") {
        const geometry3 = new THREE.BoxGeometry(op.s[0], op.s[1], op.s[2]);
        geometry3.translate(op.c[0], op.c[1], op.c[2]);
        cutLast(geometry3);
        return;
      }
      const geometry2 = new THREE.CylinderGeometry(op.r, op.r, op.h, 16);
      orient(geometry2, op.axis);
      geometry2.translate(op.c[0], op.c[1], op.c[2]);
      cutLast(geometry2);
      return;
    }
    if (op.kind === "box") {
      solid(new THREE.BoxGeometry(op.s[0], op.s[1], op.s[2]), op.slot, index, op.c);
      return;
    }
    const geometry = op.kind === "cone" ? new THREE.CylinderGeometry(0, op.r, op.h, 20) : new THREE.CylinderGeometry(op.r, op.r, op.h, 24);
    orient(geometry, op.axis);
    solid(geometry, op.slot, index, op.c);
  });
}
function buildRecipe(recipe, paint) {
  const palette = createPalette(paint);
  const group = recipe === "sedan" ? sedan(palette) : recipe === "storefront" ? storefront(palette) : dumpster(palette);
  return { group, palette };
}
function buildLines(group, lines, palette) {
  addUserOps(group, lines, palette);
}
function buildAsset(doc) {
  const palette = createPalette(doc.paint);
  const root = new THREE.Group();
  root.name = doc.name.trim() || "asset";
  root.userData = { units: "m", up: "+Y", forward: "+Z", origin: "ground" };
  if (doc.recipe === "sedan") root.add(sedan(palette));
  if (doc.recipe === "storefront") root.add(storefront(palette));
  if (doc.recipe === "dumpster") root.add(dumpster(palette));
  addUserOps(root, doc.lines, palette);
  return { root, palettes: [palette] };
}
export {
  buildAsset,
  buildLines,
  buildRecipe
};
