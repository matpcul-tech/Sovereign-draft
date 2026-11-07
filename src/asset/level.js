import * as THREE from "three";
import { parseLine } from "./grammar.js";
import { buildLines, buildRecipe } from "./build.js";
import { createPalette } from "./materials.js";
function num(token) {
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}
function hex(token, fallback) {
  if (!token) return fallback;
  const value = token.startsWith("#") ? token : `#${token}`;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}
function keepPropLine(raw) {
  const parsed = parseLine(raw);
  if (!("op" in parsed)) return false;
  const op = parsed.op;
  if (op.kind === "pivot" || op.kind === "cut") return true;
  if (Math.abs(op.c[0]) > 2.5 || Math.abs(op.c[2]) > 2.5 || op.c[1] > 3.5 || op.c[1] < -0.2) return false;
  if (op.kind === "box" && (op.s[0] > 3 || op.s[1] > 3 || op.s[2] > 3)) return false;
  if ((op.kind === "cyl" || op.kind === "cone") && (op.r > 1.2 || op.h > 3.2)) return false;
  return true;
}
function parseLevel(lines) {
  let name = "block";
  let road = 32;
  const places = [];
  let prop = null;
  let shops = 0;
  let cars = 0;
  let bins = 0;
  let lamps = 0;
  let props = 0;
  function closeProp() {
    if (prop && prop.lines.length) places.push(prop);
    prop = null;
  }
  for (const raw of lines) {
    const parts = raw.trim().split(/\s+/);
    const head = parts[0]?.toUpperCase();
    if (!head) continue;
    if (head === "END") {
      closeProp();
      continue;
    }
    if (head === "LEVEL") continue;
    if (head === "NAME") {
      const next = parts.slice(1).join(" ").slice(0, 48).trim();
      if (next) name = next;
      continue;
    }
    if (head === "ROAD") {
      closeProp();
      const length = num(parts[1]);
      if (length) road = Math.min(44, Math.max(22, length));
      continue;
    }
    if (head === "SHOP" || head === "STORE" || head === "STOREFRONT") {
      closeProp();
      if (shops >= 4) continue;
      const x = num(parts[1]);
      const z = num(parts[2]);
      if (x === null || z === null) continue;
      const colorIndex = parts[3] && num(parts[3]) !== null ? 4 : 3;
      shops += 1;
      places.push({
        kind: "shop",
        x,
        z,
        paint: hex(parts[colorIndex], shops % 2 ? "#efe6d4" : "#b5523a")
      });
      continue;
    }
    if (head === "CAR" || head === "SEDAN") {
      closeProp();
      if (cars >= 2) continue;
      const x = num(parts[1]);
      const z = num(parts[2]);
      if (x === null || z === null) continue;
      let yaw = 0;
      let colorToken = parts[3];
      if (parts[3] && num(parts[3]) !== null) {
        yaw = num(parts[3]) ?? 0;
        colorToken = parts[4];
      }
      cars += 1;
      places.push({
        kind: "car",
        x,
        z,
        yaw,
        paint: hex(colorToken, cars === 1 ? "#1c3d66" : "#6e2a2a")
      });
      continue;
    }
    if (head === "BIN" || head === "DUMPSTER") {
      closeProp();
      if (bins >= 3) continue;
      const x = num(parts[1]);
      const z = num(parts[2]);
      if (x === null || z === null) continue;
      bins += 1;
      places.push({ kind: "bin", x, z });
      continue;
    }
    if (head === "LAMP" || head === "LIGHT") {
      closeProp();
      if (lamps >= 6) continue;
      const x = num(parts[1]);
      const z = num(parts[2]);
      if (x === null || z === null) continue;
      lamps += 1;
      places.push({ kind: "lamp", x, z });
      continue;
    }
    if (head === "PROP") {
      closeProp();
      if (props >= 2) {
        prop = null;
        continue;
      }
      let label = "prop";
      let xi = 1;
      if (parts[1] && num(parts[1]) === null) {
        label = parts[1].slice(0, 24);
        xi = 2;
      }
      const x = num(parts[xi]);
      const z = num(parts[xi + 1]);
      if (x === null || z === null) continue;
      props += 1;
      prop = { kind: "prop", name: label, x, z, lines: [] };
      continue;
    }
    if (prop && prop.lines.length < 8 && keepPropLine(raw)) prop.lines.push(raw.trim());
  }
  closeProp();
  const shopPlaces = places.filter((place) => place.kind === "shop");
  if (shopPlaces.length >= 2 && shopPlaces.every((place) => place.x <= 0)) {
    shopPlaces.forEach((place, index) => {
      if (index % 2 === 1) place.x = 8;
    });
  }
  if (shopPlaces.length >= 2 && shopPlaces.every((place) => place.x > 0)) {
    shopPlaces.forEach((place, index) => {
      if (index % 2 === 1) place.x = -8;
    });
  }
  if (!shopPlaces.length) return null;
  return { name, road, places };
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function buildLevel(doc) {
  const plan = parseLevel(doc.lines);
  const root = new THREE.Group();
  root.name = (plan?.name || doc.name || "block").trim();
  root.userData = { units: "m", up: "+Y", forward: "+Z", origin: "ground" };
  const palettes = [];
  if (!plan) return { root, palettes };
  const half = plan.road / 2;
  const roadPalette = createPalette("#e4dcc8");
  palettes.push(roadPalette);
  const street = new THREE.Group();
  const marks = [
    `BOX 0 0.02 0 7.2 0.04 ${plan.road.toFixed(2)} asphalt`,
    `BOX -4.85 0.08 0 2.35 0.14 ${(plan.road + 1).toFixed(2)} concrete`,
    `BOX 4.85 0.08 0 2.35 0.14 ${(plan.road + 1).toFixed(2)} concrete`,
    `BOX -3.52 0.1 0 0.18 0.18 ${plan.road.toFixed(2)} concrete`,
    `BOX 3.52 0.1 0 0.18 0.18 ${plan.road.toFixed(2)} concrete`
  ];
  for (let z = -half + 4; z <= half - 4; z += 4.2) {
    marks.push(`BOX 0 0.05 ${z.toFixed(2)} 0.14 0.015 1.5 paint`);
  }
  const cross = half - 2.4;
  for (let i = -3; i <= 3; i++) {
    marks.push(`BOX ${(i * 0.9).toFixed(2)} 0.055 ${cross.toFixed(2)} 0.42 0.015 0.4 paint`);
  }
  buildLines(street, marks, roadPalette);
  root.add(street);
  const taken = [];
  function shopZ(side, z) {
    let next = clamp(z, -half + 5.2, half - 5.2);
    for (let guard = 0; guard < 5; guard++) {
      if (!taken.some((item) => item.side === side && Math.abs(item.z - next) < 8.8)) break;
      next = clamp(next + 9, -half + 5.2, half - 5.2);
    }
    taken.push({ side, z: next });
    return next;
  }
  const cars = [];
  function carZ(z) {
    let next = clamp(z, -half + 4, half - 4);
    for (let guard = 0; guard < 4; guard++) {
      if (!cars.some((item) => Math.abs(item - next) < 6.2)) break;
      next = clamp(next + 6.5, -half + 4, half - 4);
    }
    cars.push(next);
    return next;
  }
  const lampLines = [
    "CYL 0 2.05 0 0.07 4.1 y metal",
    "BOX 0 4.12 0.32 0.08 0.08 0.7 metal",
    "BOX 0 3.98 0.62 0.28 0.1 0.42 light"
  ];
  const authored = plan.places.filter((place) => place.kind === "lamp");
  const lamps = authored.length ? authored : [
    { kind: "lamp", x: -5, z: -half + 6 },
    { kind: "lamp", x: 5, z: -2 },
    { kind: "lamp", x: -5, z: half - 8 },
    { kind: "lamp", x: 5, z: half - 6 }
  ];
  const lampPalette = createPalette("#c9c2b2");
  palettes.push(lampPalette);
  function addLamps(list) {
    for (const lamp of list) {
      const side = lamp.x >= 0 ? 1 : -1;
      const group = new THREE.Group();
      buildLines(group, lampLines, lampPalette);
      group.position.set(side * 5.45, 0, clamp(lamp.z, -half + 1, half - 1));
      if (side > 0) group.rotation.y = Math.PI;
      root.add(group);
    }
  }
  for (const place of plan.places) {
    if (place.kind === "shop") {
      const side = place.x >= 0 ? 1 : -1;
      const piece = buildRecipe("storefront", place.paint);
      palettes.push(piece.palette);
      piece.group.position.set(side * 7.35, 0, shopZ(side, place.z));
      piece.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(piece.group);
      continue;
    }
    if (place.kind === "car") {
      const piece = buildRecipe("sedan", place.paint);
      palettes.push(piece.palette);
      const lane = place.x >= 0 ? 1.45 : -1.45;
      const facing = Math.abs(place.yaw) > 90 && Math.abs(place.yaw) < 270 ? Math.PI : 0;
      piece.group.position.set(lane, 0, carZ(place.z));
      piece.group.rotation.y = facing;
      root.add(piece.group);
      continue;
    }
    if (place.kind === "bin") {
      const piece = buildRecipe("dumpster", "#2c4638");
      palettes.push(piece.palette);
      const side = place.x >= 0 ? 1 : -1;
      piece.group.position.set(side * 5.15, 0, clamp(place.z, -half + 2, half - 2));
      piece.group.rotation.y = side > 0 ? 0.4 : -0.4;
      root.add(piece.group);
      continue;
    }
    if (place.kind === "prop") {
      const palette = createPalette(doc.paint || "#c4b8a2");
      palettes.push(palette);
      const group = new THREE.Group();
      group.name = place.name;
      buildLines(group, place.lines, palette);
      const side = place.x >= 0 ? 1 : -1;
      group.position.set(side * 5.2, 0, clamp(place.z, -half + 2, half - 2));
      root.add(group);
    }
  }
  addLamps(lamps);
  return { root, palettes };
}
export {
  buildLevel,
  parseLevel
};
