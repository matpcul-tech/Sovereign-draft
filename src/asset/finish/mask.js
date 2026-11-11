import { encodePng } from "./png.js";

// CAR window mask metrics. Street Empire src/kit.js does not read this mask.
// Street Empire src/kit.js (read 2026-11-11) repaints a one-texture car
// from the base color hue in finishMaterial. It does not read
// extras.kitMask or the emissive image. The mask is stored so a later
// reader can use it. This repo does not change the game.

export const MASK = {
  size: 1024,
  glassAreaMin: 0.08,
  glassAreaMax: 0.3,
  fringePx: 4,
  aaMin: 1,
  aaMax: 2,
  padPx: 8,
  reviewScale: 4,
  glassTone: [34, 34, 34],
  minComponent: 3
};

export const REVIEW = {
  glass: [0, 212, 184, 255],
  paint: [212, 168, 67, 255],
  chrome: [255, 255, 255, 255],
  other: [120, 120, 120, 255]
};

const GLASS = [255, 0, 0, 255];
const PAINT = [0, 255, 0, 255];
const CHROME = [0, 0, 255, 255];

function hsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
  }
  return { h: ((h / 6) + 1) % 1, s: max > 0 ? d / max : 0, v: max };
}

export function maskClass(r, g, b) {
  if (r >= 250 && g <= 5 && b <= 5) return "glass";
  if (g >= 250 && r <= 5 && b <= 5) return "paint";
  if (b >= 250 && r <= 5 && g <= 5) return "chrome";
  if (r <= 5 && g <= 5 && b <= 5) return "other";
  return "edge";
}

export function isGlassTone(r, g, b) {
  const { s, v } = hsv(r, g, b);
  return s < 0.18 && v >= 0.05 && v <= 0.28;
}

export function isBodyHue(r, g, b, body) {
  const pixel = hsv(r, g, b);
  const key = hsv(body[0], body[1], body[2]);
  let dh = Math.abs(pixel.h - key.h);
  dh = Math.min(dh, 1 - dh);
  return dh < 0.06 && pixel.s > 0.18 && pixel.v > 0.15;
}

function inWheel(face, wheels) {
  for (const wheel of wheels || []) {
    const along = Math.abs(face.x - wheel.cx) <= wheel.halfWidth;
    const radial = Math.hypot(face.y - wheel.cy, face.z - wheel.cz);
    if (along && radial <= wheel.radius) return true;
  }
  return false;
}

// Geometry and color together. Color alone never marks glass.
// Tires, grille, and anything outside the cabin band or inside a wheel
// cylinder are not glass. A missing belt line is not a guess.
export function detectGlassFaces(faces, car) {
  if (!car || !Number.isFinite(car.beltY) || !Array.isArray(car.wheels) || car.wheels.length < 1) {
    return {
      ready: false,
      glass: [],
      excluded: 0,
      ambiguous: (faces || []).length,
      reason: "The cabin band is not known. Mark the glass by hand."
    };
  }
  const eligible = new Array(faces.length).fill(false);
  let excluded = 0;
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const banned = face.role === "tire" || face.role === "grille" || face.y < car.beltY || inWheel(face, car.wheels);
    if (banned || !face.colorEdgeGlass) {
      if (face.colorEdgeGlass) excluded += 1;
      continue;
    }
    eligible[i] = true;
  }
  const seen = new Array(faces.length).fill(false);
  const glass = [];
  let ambiguous = 0;
  const minComponent = car.minComponent || MASK.minComponent;
  for (let i = 0; i < faces.length; i++) {
    if (!eligible[i] || seen[i]) continue;
    const stack = [i];
    const component = [];
    seen[i] = true;
    while (stack.length) {
      const face = stack.pop();
      component.push(faces[face].id);
      for (const next of faces[face].neighbors || []) {
        if (seen[next] || !eligible[next]) continue;
        seen[next] = true;
        stack.push(next);
      }
    }
    if (component.length < minComponent) ambiguous += component.length;
    else glass.push(...component);
  }
  return {
    ready: true,
    glass,
    excluded,
    ambiguous,
    reason: ambiguous ? ambiguous + " faces are too small a region to call glass. Mark them by hand." : ""
  };
}

export function editMask(mask, width, height, edit) {
  const out = new Uint8Array(mask);
  const color = edit.op === "remove" ? PAINT : edit.op === "chrome" ? CHROME : GLASS;
  const radius = edit.radius || 0;
  for (const pixel of edit.pixels || []) {
    for (let y = pixel.y - radius; y <= pixel.y + radius; y++) {
      for (let x = pixel.x - radius; x <= pixel.x + radius; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (radius && (x - pixel.x) * (x - pixel.x) + (y - pixel.y) * (y - pixel.y) > radius * radius) continue;
        const index = (y * width + x) * 4;
        out[index] = color[0];
        out[index + 1] = color[1];
        out[index + 2] = color[2];
        out[index + 3] = 255;
      }
    }
  }
  return out;
}

export function aaWidths(mask, width, height) {
  const widths = [];
  function at(x, y) {
    const index = (y * width + x) * 4;
    return maskClass(mask[index], mask[index + 1], mask[index + 2]);
  }
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const kind = at(x, y);
      if (kind !== "edge") {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && at(x, y) === "edge") x += 1;
      const before = start > 0 ? at(start - 1, y) : "";
      const after = x < width ? at(x, y) : "";
      if (before && after && before !== after && before !== "edge" && after !== "edge") widths.push(x - start);
    }
  }
  const max = widths.reduce((hi, value) => Math.max(hi, value), 0);
  const min = widths.length ? widths.reduce((lo, value) => Math.min(lo, value), widths[0]) : 0;
  const pass = widths.length > 0 && min >= MASK.aaMin && max <= MASK.aaMax;
  return {
    pass,
    count: widths.length,
    min,
    max,
    detail: pass
      ? "Mask edges are " + min + " to " + max + " px."
      : "Mask edge width is outside 1 to 2 px (" + (widths.length ? min + " to " + max : "no edge") + ")."
  };
}

export function sideViewGlassCheck(samples, beltY) {
  const car = (samples || []).filter((sample) => sample.onCar);
  const glass = car.filter((sample) => sample.kind === "glass");
  const below = glass.filter((sample) => sample.y < beltY);
  const ratio = car.length ? glass.length / car.length : 0;
  const areaPass = ratio >= MASK.glassAreaMin && ratio <= MASK.glassAreaMax;
  const pass = car.length > 0 && areaPass && below.length === 0;
  return {
    pass,
    carPixels: car.length,
    glassPixels: glass.length,
    ratio,
    belowBelt: below.length,
    detail: "Side view glass is " + glass.length + " of " + car.length + " car pixels (" + (ratio * 100).toFixed(1) + " percent). " + below.length + " glass pixels sit below the belt line."
  };
}

function nearGlass(mask, width, height, x, y, radius) {
  for (let yy = y - radius; yy <= y + radius; yy++) {
    for (let xx = x - radius; xx <= x + radius; xx++) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) > radius) continue;
      const index = (yy * width + xx) * 4;
      if (maskClass(mask[index], mask[index + 1], mask[index + 2]) === "glass") return true;
    }
  }
  return false;
}

export function cleanedBaseCheck(base, mask, width, height, body) {
  let bodyInGlass = 0;
  let fringe = 0;
  let glassPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const kind = maskClass(mask[index], mask[index + 1], mask[index + 2]);
      const r = base[index];
      const g = base[index + 1];
      const b = base[index + 2];
      if (kind === "glass") {
        glassPixels += 1;
        if (isBodyHue(r, g, b, body)) bodyInGlass += 1;
      } else if (kind === "paint" && nearGlass(mask, width, height, x, y, MASK.fringePx) && isGlassTone(r, g, b)) {
        fringe += 1;
      }
    }
  }
  const pass = bodyInGlass === 0 && fringe === 0;
  return {
    pass,
    glassPixels,
    bodyInGlass,
    fringe,
    detail: bodyInGlass + " body-hue pixels sit in glass. " + fringe + " glass-tone pixels sit in paint within " + MASK.fringePx + " px of the border."
  };
}

function pixel(buf, width, x, y) {
  const index = (y * width + x) * 4;
  return [buf[index], buf[index + 1], buf[index + 2], buf[index + 3]];
}

function write(buf, width, x, y, rgba) {
  const index = (y * width + x) * 4;
  buf[index] = rgba[0];
  buf[index + 1] = rgba[1];
  buf[index + 2] = rgba[2];
  buf[index + 3] = rgba[3];
}

// Clean a copy of the exported base. The input array is not written.
// Padding only fills unused texels. Overlapping islands are counted and
// left alone. UVs are not moved.
export function cleanExportedBase(base, mask, width, height) {
  const out = new Uint8Array(base);
  const log = { glassFlattened: 0, fringeRemoved: 0, padded: 0, conflicts: 0, unchanged: 0 };
  const tone = MASK.glassTone;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const kind = maskClass(mask[index], mask[index + 1], mask[index + 2]);
      if (kind === "glass") {
        if (out[index] !== tone[0] || out[index + 1] !== tone[1] || out[index + 2] !== tone[2]) log.glassFlattened += 1;
        out[index] = tone[0];
        out[index + 1] = tone[1];
        out[index + 2] = tone[2];
        out[index + 3] = 255;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (maskClass(mask[index], mask[index + 1], mask[index + 2]) !== "paint") continue;
      if (!nearGlass(mask, width, height, x, y, MASK.fringePx)) continue;
      if (!isGlassTone(out[index], out[index + 1], out[index + 2])) continue;
      const donor = donorPaint(out, mask, width, height, x, y);
      if (!donor) continue;
      out[index] = donor[0];
      out[index + 1] = donor[1];
      out[index + 2] = donor[2];
      out[index + 3] = 255;
      log.fringeRemoved += 1;
    }
  }
  const pad = padIslands(out, mask, width, height);
  log.padded = pad.padded;
  log.conflicts = pad.conflicts;
  for (let i = 0; i < base.length; i++) if (out[i] === base[i]) log.unchanged += 1;
  return { base: out, log, ready: pad.conflicts === 0, conflicts: pad.conflicts };
}

function donorPaint(base, mask, width, height, x, y) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let yy = y - 8; yy <= y + 8; yy++) {
    for (let xx = x - 8; xx <= x + 8; xx++) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const dist = Math.max(Math.abs(xx - x), Math.abs(yy - y));
      if (dist < 5 || dist > 8) continue;
      const index = (yy * width + xx) * 4;
      if (maskClass(mask[index], mask[index + 1], mask[index + 2]) !== "paint") continue;
      if (isGlassTone(base[index], base[index + 1], base[index + 2])) continue;
      r += base[index];
      g += base[index + 1];
      b += base[index + 2];
      n += 1;
    }
  }
  if (!n) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255];
}

function padIslands(base, mask, width, height) {
  const owner = new Int16Array(width * height);
  owner.fill(-1);
  const classes = [];
  let next = 0;
  const seen = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = y * width + x;
      if (seen[id]) continue;
      const index = id * 4;
      const kind = maskClass(mask[index], mask[index + 1], mask[index + 2]);
      if (kind === "edge") continue;
      const stack = [id];
      seen[id] = 1;
      const pixels = [];
      while (stack.length) {
        const cur = stack.pop();
        pixels.push(cur);
        owner[cur] = next;
        const cx = cur % width;
        const cy = (cur - cx) / width;
        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const point of neighbors) {
          if (point[0] < 0 || point[1] < 0 || point[0] >= width || point[1] >= height) continue;
          const nid = point[1] * width + point[0];
          if (seen[nid]) continue;
          const nindex = nid * 4;
          if (maskClass(mask[nindex], mask[nindex + 1], mask[nindex + 2]) !== kind) continue;
          seen[nid] = 1;
          stack.push(nid);
        }
      }
      classes.push({ kind, pixels });
      next += 1;
    }
  }
  const claim = new Int16Array(width * height);
  claim.fill(-1);
  let conflicts = 0;
  let padded = 0;
  for (let island = 0; island < classes.length; island++) {
    for (const id of classes[island].pixels) {
      const x = id % width;
      const y = (id - x) / width;
      for (let yy = y - MASK.padPx; yy <= y + MASK.padPx; yy++) {
        for (let xx = x - MASK.padPx; xx <= x + MASK.padPx; xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const dist = Math.max(Math.abs(xx - x), Math.abs(yy - y));
          if (!dist || dist > MASK.padPx) continue;
          const tid = yy * width + xx;
          if (owner[tid] === island) continue;
          if (owner[tid] !== -1 && classes[owner[tid]].kind !== classes[island].kind) {
            conflicts += 1;
            continue;
          }
          if (claim[tid] !== -1 && claim[tid] !== island && classes[claim[tid]] && classes[claim[tid]].kind !== classes[island].kind) {
            conflicts += 1;
            continue;
          }
          if (owner[tid] === -1 && maskClass(mask[tid * 4], mask[tid * 4 + 1], mask[tid * 4 + 2]) === "edge") {
            claim[tid] = island;
          }
        }
      }
    }
  }
  if (conflicts > 0) return { padded: 0, conflicts };
  for (let tid = 0; tid < claim.length; tid++) {
    const island = claim[tid];
    if (island < 0) continue;
    const x = tid % width;
    const y = (tid - x) / width;
    let best = null;
    let bestDist = 99;
    for (const id of classes[island].pixels) {
      const sx = id % width;
      const sy = (id - sx) / width;
      const dist = Math.max(Math.abs(sx - x), Math.abs(sy - y));
      if (dist < bestDist) {
        bestDist = dist;
        best = pixel(base, width, sx, sy);
      }
    }
    if (!best || bestDist > MASK.padPx) continue;
    const before = pixel(base, width, x, y);
    if (before[0] === best[0] && before[1] === best[1] && before[2] === best[2]) continue;
    write(base, width, x, y, best);
    padded += 1;
  }
  return { padded, conflicts };
}

export function paddingConflicts(islands, padPx = MASK.padPx) {
  let conflicts = 0;
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      if (islands[i].kind === islands[j].kind) continue;
      const a = islands[i];
      const b = islands[j];
      const overlapW = Math.min(a.maxX + padPx, b.maxX + padPx) - Math.max(a.minX - padPx, b.minX - padPx);
      const overlapH = Math.min(a.maxY + padPx, b.maxY + padPx) - Math.max(a.minY - padPx, b.minY - padPx);
      if (overlapW > 0 && overlapH > 0) conflicts += overlapW * overlapH;
    }
  }
  return {
    conflicts,
    ready: conflicts === 0,
    detail: conflicts
      ? conflicts + " texels would mix two mask classes if padded " + padPx + " px. UVs were not moved."
      : "An " + padPx + " px pad fits in the unused gutter."
  };
}

export function reviewSheet(mask, size) {
  const preview = reviewFit(mask, size, 160, 160);
  return reviewImage(preview, 160, 160, 4);
}

function reviewFit(mask, size, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 10;
    out[i + 1] = 20;
    out[i + 2] = 30;
  }
  const rank = (r, g, b) => {
    const kind = maskClass(r, g, b);
    if (kind === "glass") return 3;
    if (kind === "chrome") return 2;
    if (kind === "paint") return 1;
    return 0;
  };
  for (let y = 0; y < size; y++) {
    const dy = Math.min(height - 1, Math.floor(y * height / size));
    for (let x = 0; x < size; x++) {
      const dx = Math.min(width - 1, Math.floor(x * width / size));
      const from = (y * size + x) * 4;
      const score = rank(mask[from], mask[from + 1], mask[from + 2]);
      if (!score) continue;
      const to = (dy * width + dx) * 4;
      if (score >= rank(out[to], out[to + 1], out[to + 2])) out.set(mask.subarray(from, from + 4), to);
    }
  }
  return out;
}

export function reviewImage(mask, width, height, scale = MASK.reviewScale) {
  const outW = width * scale;
  const outH = height * scale;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const sy = Math.min(height - 1, Math.floor(y / scale));
      const index = (sy * width + sx) * 4;
      const kind = maskClass(mask[index], mask[index + 1], mask[index + 2]);
      const color = REVIEW[kind] || REVIEW.other;
      const dest = (y * outW + x) * 4;
      out[dest] = color[0];
      out[dest + 1] = color[1];
      out[dest + 2] = color[2];
      out[dest + 3] = color[3];
    }
  }
  return { width: outW, height: outH, rgba: out };
}

export function buildCarMask(parts, rgba, width, height) {
  const body = parts.find((part) => !part.wheel);
  if (!body) {
    return { ok: false, detail: "There is no body to mask.", action: "Keep a body mesh, then run finish again." };
  }
  const box = partBounds(body.mesh);
  const belt = box.min[1] + (box.max[1] - box.min[1]) * 0.78;
  const wheels = parts.filter((part) => part.wheel).map(wheelCylinder);
  const glassFaces = [];
  const faceCount = body.mesh.indices.length / 3;
  let above = 0;
  let tone = 0;
  for (let face = 0; face < faceCount; face++) {
    const tri = faceVerts(body.mesh, face);
    const center = average(tri.map((vert) => vert.p));
    const uv = average(tri.map((vert) => vert.uv));
    if (center[1] < belt || inAnyWheel(center, wheels)) continue;
    above += 1;
    const color = texel(rgba, width, height, uv);
    if (!isGlassTone(color[0], color[1], color[2])) continue;
    tone += 1;
    glassFaces.push(face);
  }
  const regions = components(body.mesh, glassFaces);
  const kept = regions.filter((region) => region.length >= MASK.minComponent);
  if (!kept.length) {
    return {
      ok: false,
      detail: "Cabin glass was not found from the upper body and the texture together. Above belt " + above + ", glass tone " + tone + ", faces " + faceCount + ". Color alone was not treated as glass.",
      action: "Mark the window by hand. This finish will not guess a cabin."
    };
  }
  const glass = new Set(kept.flat());
  const mask = new Uint8Array(MASK.size * MASK.size * 4);
  for (let i = 0; i < mask.length; i += 4) {
    mask[i] = 10;
    mask[i + 1] = 20;
    mask[i + 2] = 30;
    mask[i + 3] = 0;
  }
  const ordered = parts.filter((part) => part.wheel).concat(parts.filter((part) => !part.wheel));
  for (const part of ordered) {
    const count = part.mesh.indices.length / 3;
    for (let face = 0; face < count; face++) {
      const tri = faceVerts(part.mesh, face);
      const color = part.wheel ? [0, 0, 0, 255] : glass.has(face) && part === body ? GLASS : PAINT;
      const us = tri.map((vert) => vert.uv[0]);
      const vs = tri.map((vert) => vert.uv[1]);
      if (Math.max(...us) - Math.min(...us) > 0.25 || Math.max(...vs) - Math.min(...vs) > 0.25) continue;
      splat(mask, MASK.size, tri, color);
    }
  }
  antialiasMask(mask, MASK.size);
  const fitted = fitMask(mask, MASK.size, width, height);
  const cleaned = cleanExportedBase(rgba, fitted, width, height);
  const edge = aaWidths(mask, MASK.size, MASK.size);
  const side = sideSamples(body.mesh, glass);
  const area = sideViewGlassCheck(side, belt);
  const hues = cleanedBaseCheck(cleaned.base, fitted, width, height, [40, 90, 180]);
  const checks = [
    { id: "mask-area", pass: area.pass, detail: area.detail, action: area.pass ? "" : "The side-view glass area is outside 8 to 30 percent, or glass sits below the belt." },
    { id: "mask-edge", pass: edge.count === 0 || edge.pass, detail: edge.count === 0 ? "Glass and paint do not share a texel edge, so there is no blur wider than 2 px." : edge.detail, action: edge.count === 0 || edge.pass ? "" : "Keep the mask edge at 1 to 2 px." },
    { id: "mask-clean", pass: hues.pass && cleaned.ready, detail: hues.detail + " " + (cleaned.conflicts ? cleaned.conflicts + " pad conflicts." : "No pad conflict."), action: hues.pass && cleaned.ready ? "" : "Clean the glass and the paint fringe by hand. UVs were not moved." }
  ];
  const review = reviewSheet(mask, MASK.size);
  return {
    ok: true,
    checks,
    maskPng: encodePng(MASK.size, MASK.size, mask),
    maskRgba: mask,
    maskSize: MASK.size,
    baseRgba: cleaned.base,
    baseWidth: width,
    baseHeight: height,
    reviewPng: encodePng(review.width, review.height, review.rgba)
  };
}

function partBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      if (mesh.positions[i + axis] < min[axis]) min[axis] = mesh.positions[i + axis];
      if (mesh.positions[i + axis] > max[axis]) max[axis] = mesh.positions[i + axis];
    }
  }
  return { min, max };
}

function faceVerts(mesh, face) {
  const out = [];
  for (let corner = 0; corner < 3; corner++) {
    const id = mesh.indices[face * 3 + corner];
    out.push({
      p: [mesh.positions[id * 3], mesh.positions[id * 3 + 1], mesh.positions[id * 3 + 2]],
      uv: [mesh.uvs[id * 2] || 0, mesh.uvs[id * 2 + 1] || 0]
    });
  }
  return out;
}

function average(values) {
  const out = values[0].map(() => 0);
  for (const value of values) for (let i = 0; i < out.length; i++) out[i] += value[i];
  return out.map((value) => value / values.length);
}

function wheelCylinder(part) {
  const box = partBounds(part.mesh);
  return {
    cx: part.center ? part.center[0] : (box.min[0] + box.max[0]) / 2,
    cy: part.center ? part.center[1] : (box.min[1] + box.max[1]) / 2,
    cz: part.center ? part.center[2] : (box.min[2] + box.max[2]) / 2,
    half: (box.max[0] - box.min[0]) / 2 + 0.02,
    radius: Math.max(box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2 + 0.02
  };
}

function inAnyWheel(point, wheels) {
  return wheels.some((wheel) => Math.abs(point[0] - wheel.cx) <= wheel.half && Math.hypot(point[1] - wheel.cy, point[2] - wheel.cz) <= wheel.radius);
}

function texel(rgba, width, height, uv) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(uv[0] * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - uv[1]) * height)));
  const index = (y * width + x) * 4;
  return [rgba[index], rgba[index + 1], rgba[index + 2]];
}

function components(mesh, faces) {
  const set = new Set(faces);
  const seen = new Set();
  const out = [];
  const neighbors = new Map();
  const edge = new Map();
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner++) {
      const a = mesh.indices[face * 3 + corner];
      const b = mesh.indices[face * 3 + ((corner + 1) % 3)];
      const key = a < b ? a + ":" + b : b + ":" + a;
      const list = edge.get(key) || [];
      list.push(face);
      edge.set(key, list);
    }
  }
  for (const list of edge.values()) {
    if (list.length !== 2) continue;
    for (const face of list) {
      if (!neighbors.has(face)) neighbors.set(face, []);
      for (const other of list) if (other !== face) neighbors.get(face).push(other);
    }
  }
  for (const face of faces) {
    if (seen.has(face)) continue;
    const stack = [face];
    const region = [];
    seen.add(face);
    while (stack.length) {
      const current = stack.pop();
      region.push(current);
      for (const next of neighbors.get(current) || []) {
        if (!set.has(next) || seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    out.push(region);
  }
  return out;
}

function splat(mask, size, tri, color) {
  const points = tri.map((vert) => [vert.uv[0] * (size - 1), (1 - vert.uv[1]) * (size - 1)]);
  const minX = Math.max(0, Math.floor(Math.min(points[0][0], points[1][0], points[2][0])));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(points[0][0], points[1][0], points[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(points[0][1], points[1][1], points[2][1])));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(points[0][1], points[1][1], points[2][1])));
  let wrote = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!bary([x + 0.5, y + 0.5], points)) continue;
      const index = (y * size + x) * 4;
      mask[index] = color[0];
      mask[index + 1] = color[1];
      mask[index + 2] = color[2];
      mask[index + 3] = 255;
      wrote += 1;
    }
  }
  if (wrote) return;
  const u = (tri[0].uv[0] + tri[1].uv[0] + tri[2].uv[0]) / 3;
  const v = (tri[0].uv[1] + tri[1].uv[1] + tri[2].uv[1]) / 3;
  const x = Math.max(0, Math.min(size - 1, Math.round(u * (size - 1))));
  const y = Math.max(0, Math.min(size - 1, Math.round((1 - v) * (size - 1))));
  const index = (y * size + x) * 4;
  mask[index] = color[0];
  mask[index + 1] = color[1];
  mask[index + 2] = color[2];
  mask[index + 3] = 255;
}

function bary(p, tri) {
  const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const whole = area(tri[0], tri[1], tri[2]);
  if (Math.abs(whole) < 1e-8) return false;
  const w0 = area(p, tri[1], tri[2]) / whole;
  const w1 = area(tri[0], p, tri[2]) / whole;
  const w2 = 1 - w0 - w1;
  return w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02;
}

function antialiasMask(mask, size) {
  const src = mask.slice();
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const index = (y * size + x) * 4;
      if (maskClass(src[index], src[index + 1], src[index + 2]) !== "paint") continue;
      const left = ((y * size + x - 1) * 4);
      const up = (((y - 1) * size + x) * 4);
      const glassNear = maskClass(src[left], src[left + 1], src[left + 2]) === "glass" || maskClass(src[up], src[up + 1], src[up + 2]) === "glass";
      if (!glassNear) continue;
      mask[index] = 128;
      mask[index + 1] = 128;
      mask[index + 2] = 0;
      mask[index + 3] = 255;
    }
  }
}

function fitMask(mask, size, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(size - 1, Math.floor((y + 0.5) * size / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(size - 1, Math.floor((x + 0.5) * size / width));
      const from = (sy * size + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = mask[from];
      out[to + 1] = mask[from + 1];
      out[to + 2] = mask[from + 2];
      out[to + 3] = mask[from + 3];
    }
  }
  return out;
}

function sideSamples(mesh, glass) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const tris = [];
  const faceCount = mesh.indices.length / 3;
  for (let face = 0; face < faceCount; face++) {
    const tri = faceVerts(mesh, face);
    tris.push({ tri, glass: glass.has(face) });
    for (const vert of tri) {
      if (vert.p[1] < minY) minY = vert.p[1];
      if (vert.p[1] > maxY) maxY = vert.p[1];
      if (vert.p[2] < minZ) minZ = vert.p[2];
      if (vert.p[2] > maxZ) maxZ = vert.p[2];
    }
  }
  const samples = [];
  const grid = 48;
  for (let y = 0; y < grid; y++) {
    for (let z = 0; z < grid; z++) {
      const py = minY + ((y + 0.5) / grid) * (maxY - minY || 1);
      const pz = minZ + ((z + 0.5) / grid) * (maxZ - minZ || 1);
      let hit = null;
      for (const item of tris) {
        if (!covers(item.tri, py, pz)) continue;
        hit = item;
        break;
      }
      if (!hit) continue;
      samples.push({ onCar: true, kind: hit.glass ? "glass" : "paint", y: py });
    }
  }
  return samples;
}

function covers(tri, y, z) {
  const points = tri.map((vert) => [vert.p[2], vert.p[1]]);
  return bary([z, y], points);
}
