import { isSlot } from "./slots.js";
const RECIPES = {
  SEDAN: "sedan",
  STOREFRONT: "storefront",
  DUMPSTER: "dumpster",
  BLOCKOUT: "blank",
  BLANK: "blank"
};
function nums(parts, from, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const value = Number(parts[from + i]);
    if (!Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}
function asSlot(token, fallback) {
  if (!token) return fallback;
  const value = token.toLowerCase();
  return isSlot(value) ? value : null;
}
function flag(token) {
  if (!token) return "toggle";
  const value = token.toUpperCase();
  if (value === "ON" || value === "1") return true;
  if (value === "OFF" || value === "0") return false;
  return null;
}
function parseLine(input) {
  const line = input.trim().replace(/,/g, " ");
  if (!line) return { err: "Empty command." };
  const parts = line.split(/\s+/);
  const head = parts[0].toUpperCase();
  if (head in RECIPES) return { meta: "recipe", recipe: RECIPES[head] };
  if (head === "ASSET") {
    const id = (parts[1] || "").toUpperCase();
    if (id in RECIPES) return { meta: "recipe", recipe: RECIPES[id] };
    return { err: "ASSET sedan, storefront, dumpster, or blockout." };
  }
  if (head === "BOX") {
    const n = nums(parts, 1, 6);
    if (!n) return { err: "BOX x y z width height depth [slot]" };
    if (n[3] <= 0 || n[4] <= 0 || n[5] <= 0) return { err: "Size must be greater than zero." };
    const slot = asSlot(parts[7], "paint");
    if (!slot) return { err: "Unknown slot." };
    return { op: { kind: "box", name: "box", c: [n[0], n[1], n[2]], s: [n[3], n[4], n[5]], slot } };
  }
  if (head === "CYL" || head === "CONE") {
    const n = nums(parts, 1, 5);
    if (!n || n[3] <= 0 || n[4] <= 0) {
      return { err: head === "CONE" ? "CONE x y z radius height [axis] [slot]" : "CYL x y z radius height [axis] [slot]" };
    }
    let axis = "y";
    let slot = "paint";
    for (const token of [parts[6], parts[7]]) {
      if (!token) continue;
      const value = token.toLowerCase();
      if (value === "x" || value === "y" || value === "z") axis = value;
      else if (isSlot(value)) slot = value;
      else return { err: "Axis is x, y, or z. Slot is paint, glass, rubber, metal\u2026" };
    }
    return {
      op: {
        kind: head === "CONE" ? "cone" : "cyl",
        name: head === "CONE" ? "cone" : "cyl",
        c: [n[0], n[1], n[2]],
        r: n[3],
        h: n[4],
        axis,
        slot
      }
    };
  }
  if (head === "SUB") {
    const shape = parts[1]?.toUpperCase();
    if (shape === "BOX") {
      const n = nums(parts, 2, 6);
      if (!n || n[3] <= 0 || n[4] <= 0 || n[5] <= 0) return { err: "SUB BOX x y z width height depth" };
      return { op: { kind: "cut", shape: "box", c: [n[0], n[1], n[2]], s: [n[3], n[4], n[5]] } };
    }
    if (shape === "CYL") {
      const n = nums(parts, 2, 5);
      if (!n || n[3] <= 0 || n[4] <= 0) return { err: "SUB CYL x y z radius height [axis]" };
      const axisToken = parts[7]?.toLowerCase();
      const axis = axisToken === "x" || axisToken === "z" ? axisToken : "y";
      return { op: { kind: "cut", shape: "cyl", c: [n[0], n[1], n[2]], r: n[3], h: n[4], axis } };
    }
    return { err: "SUB BOX or SUB CYL cuts the previous solid." };
  }
  if (head === "PIVOT") {
    const name = parts[1];
    const n = nums(parts, 2, 3);
    if (!name || !/^[A-Za-z_][\w-]*$/.test(name) || !n) return { err: "PIVOT name x y z" };
    return { op: { kind: "pivot", name, c: [n[0], n[1], n[2]] } };
  }
  if (head === "BUDGET") {
    const n = Number(parts[1]);
    if (!Number.isFinite(n) || n < 200) return { err: "BUDGET needs a triangle count, at least 200." };
    return { meta: "budget", n: Math.round(Math.min(4e4, n)) };
  }
  if (head === "SLOT") {
    if (parts[1]?.toLowerCase() !== "paint" || !parts[2]) return { err: "SLOT paint #hex" };
    const hex = parts[2].startsWith("#") ? parts[2] : `#${parts[2]}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { err: "SLOT paint needs a color like #1c3d66." };
    return { meta: "paint", hex: hex.toLowerCase() };
  }
  if (head === "NAME") {
    const name = parts.slice(1).join(" ").slice(0, 48).trim();
    if (!name) return { err: "NAME needs a name." };
    return { meta: "name", name };
  }
  if (head === "ARTIST" || head === "AI") {
    return { meta: "artist", brief: parts.slice(1).join(" ").slice(0, 280) };
  }
  if (head === "LEVEL" || head === "BLOCK") {
    return { meta: "level", brief: parts.slice(1).join(" ").slice(0, 280) };
  }
  if (head === "GLB" || head === "EXPORT" || head === "GAMEEXPORT") return { meta: "export" };
  if (head === "VEHICLE" || head === "FINISH") return { meta: "vehicle" };
  if (head === "FIT" || head === "ZOOM") return { meta: "fit" };
  if (head === "PIVOTS") {
    const on = flag(parts[1]);
    if (on === null) return { err: "PIVOTS ON or PIVOTS OFF." };
    return { meta: "pivots", on };
  }
  if (head === "TURN" || head === "TURNTABLE") {
    const on = flag(parts[1]);
    if (on === null) return { err: "TURNTABLE ON or TURNTABLE OFF." };
    return { meta: "turn", on };
  }
  if (head === "HELP") {
    return {
      meta: "note",
      text: "LEVEL builds a block. ARTIST builds one piece. Also SEDAN, BOX, GLB."
    };
  }
  if (head === "UNITS") {
    const unit = (parts[1] || "M").toUpperCase();
    if (unit === "M" || unit === "METERS") {
      return { meta: "note", text: "Asset space is meters. Ground is Y. Forward is +Z." };
    }
    return { err: "Asset space is meters. Feet stay in the drafting model." };
  }
  if (head === "UV") return { meta: "note", text: "Box UVs are always on." };
  return { err: "Unknown command. Try LEVEL, ARTIST, SEDAN, BOX, or GLB." };
}
export {
  parseLine
};
