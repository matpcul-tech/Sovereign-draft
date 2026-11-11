function quant(value) {
  return Math.round(value * 2000);
}

function vertexKey(x, y, z) {
  return quant(x) + "," + quant(y) + "," + quant(z);
}

function edgeKey(ax, ay, az, bx, by, bz) {
  const a = vertexKey(ax, ay, az);
  const b = vertexKey(bx, by, bz);
  return a < b ? a + "|" + b : b + "|" + a;
}

export function faceTopology(corners) {
  const faceCount = corners.length / 9;
  const neighbors = Array.from({ length: faceCount }, () => []);
  const edges = new Map();
  const seen = new Map();
  let degenerate = 0;
  let duplicate = 0;
  for (let face = 0; face < faceCount; face++) {
    const base = face * 9;
    const ax = corners[base];
    const ay = corners[base + 1];
    const az = corners[base + 2];
    const bx = corners[base + 3];
    const by = corners[base + 4];
    const bz = corners[base + 5];
    const cx = corners[base + 6];
    const cy = corners[base + 7];
    const cz = corners[base + 8];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const cross = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
    if (cross < 1e-8) degenerate += 1;
    const keys = [vertexKey(ax, ay, az), vertexKey(bx, by, bz), vertexKey(cx, cy, cz)].sort();
    const hash = keys.join("|");
    if (seen.has(hash)) duplicate += 1;
    else seen.set(hash, face);
    const corners3 = [
      [ax, ay, az, bx, by, bz],
      [bx, by, bz, cx, cy, cz],
      [cx, cy, cz, ax, ay, az]
    ];
    for (const edge of corners3) {
      const key = edgeKey(edge[0], edge[1], edge[2], edge[3], edge[4], edge[5]);
      const list = edges.get(key);
      if (list) list.push(face);
      else edges.set(key, [face]);
    }
  }
  let nonManifold = 0;
  for (const list of edges.values()) {
    if (list.length > 2) nonManifold += 1;
    if (list.length !== 2) continue;
    const [a, b] = list;
    if (a === b) continue;
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  return { faceCount, neighbors, degenerate, duplicate, nonManifold };
}

function angleBetween(normals, a, b) {
  const ax = normals[a * 3];
  const ay = normals[a * 3 + 1];
  const az = normals[a * 3 + 2];
  const bx = normals[b * 3];
  const by = normals[b * 3 + 1];
  const bz = normals[b * 3 + 2];
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot);
}

function pairKey(a, b) {
  return a < b ? a + ":" + b : b + ":" + a;
}

export function seamBlocks(world, uvs, rgba, width, height) {
  const blocks = new Set();
  const faceCount = world.length / 9;
  const edges = new Map();
  for (let face = 0; face < faceCount; face++) {
    const base = face * 9;
    const uvBase = face * 6;
    const corners = [0, 1, 2];
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[edge];
      const b = corners[(edge + 1) % 3];
      const key = edgeKey(
        world[base + a * 3], world[base + a * 3 + 1], world[base + a * 3 + 2],
        world[base + b * 3], world[base + b * 3 + 1], world[base + b * 3 + 2]
      );
      const record = {
        face,
        u0: uvs ? [uvs[uvBase + a * 2], uvs[uvBase + a * 2 + 1]] : null,
        u1: uvs ? [uvs[uvBase + b * 2], uvs[uvBase + b * 2 + 1]] : null
      };
      const list = edges.get(key);
      if (list) list.push(record);
      else edges.set(key, [record]);
    }
  }
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list;
    if (uvs && uvGap(a, b)) blocks.add(pairKey(a.face, b.face));
    if (rgba && uvs && colorGap(a, b, rgba, width, height)) blocks.add(pairKey(a.face, b.face));
  }
  return blocks;
}

function uvGap(a, b) {
  if (!a.u0 || !b.u0) return false;
  const forward = uvDist(a.u0, b.u0) + uvDist(a.u1, b.u1);
  const flipped = uvDist(a.u0, b.u1) + uvDist(a.u1, b.u0);
  return Math.min(forward, flipped) > 1 / 256;
}

function uvDist(a, b) {
  const du = a[0] - b[0];
  const dv = a[1] - b[1];
  return Math.hypot(du, dv);
}

function sample(rgba, width, height, uv) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(uv[0] * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - uv[1]) * height)));
  const index = (y * width + x) * 4;
  return [rgba[index], rgba[index + 1], rgba[index + 2]];
}

function colorGap(a, b, rgba, width, height) {
  const au = [(a.u0[0] + a.u1[0]) / 2, (a.u0[1] + a.u1[1]) / 2];
  const bu = [(b.u0[0] + b.u1[0]) / 2, (b.u0[1] + b.u1[1]) / 2];
  const ca = sample(rgba, width, height, au);
  const cb = sample(rgba, width, height, bu);
  const dist = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
  return dist > 40;
}

export function growFaces(topology, normals, seeds, creaseRadians, blocks) {
  const selected = new Set(seeds);
  const stack = [...seeds];
  while (stack.length) {
    const face = stack.pop();
    for (const next of topology.neighbors[face]) {
      if (selected.has(next)) continue;
      if (blocks && blocks.has(pairKey(face, next))) continue;
      if (Number.isFinite(creaseRadians) && angleBetween(normals, face, next) > creaseRadians) continue;
      selected.add(next);
      stack.push(next);
    }
  }
  return selected;
}
