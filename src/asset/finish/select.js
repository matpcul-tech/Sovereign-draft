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
  let boundary = 0;
  for (const list of edges.values()) {
    if (list.length === 1) boundary += 1;
    if (list.length > 2) nonManifold += 1;
    if (list.length !== 2) continue;
    const [a, b] = list;
    if (a === b) continue;
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  return { faceCount, neighbors, degenerate, duplicate, nonManifold, boundary };
}

export function wheelSurfaceBlocks(world) {
  const blocks = new Set();
  const faceCount = world.length / 9;
  if (faceCount < 4) return blocks;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < world.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      if (world[i + axis] < min[axis]) min[axis] = world[i + axis];
      if (world[i + axis] > max[axis]) max[axis] = world[i + axis];
    }
  }
  const size = min.map((value, axis) => max[axis] - value);
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;
  const low = min[1] + size[1] * 0.45;
  const buckets = [[], [], [], []];
  const seen = new Set();
  for (let i = 0; i < world.length; i += 3) {
    const x = world[i];
    const y = world[i + 1];
    const z = world[i + 2];
    if (y > low) continue;
    if (Math.abs(x - midX) < size[0] * 0.18) continue;
    if (Math.abs(z - midZ) < size[2] * 0.18) continue;
    const key = vertexKey(x, y, z);
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[(x < midX ? 0 : 1) + (z < midZ ? 0 : 2)].push([x, y, z]);
  }
  const cylinders = [];
  for (const points of buckets) {
    if (points.length < 4) continue;
    const pmin = [Infinity, Infinity, Infinity];
    const pmax = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let axis = 0; axis < 3; axis++) {
        if (point[axis] < pmin[axis]) pmin[axis] = point[axis];
        if (point[axis] > pmax[axis]) pmax[axis] = point[axis];
      }
    }
    const ey = pmax[1] - pmin[1];
    const ez = pmax[2] - pmin[2];
    const radius = Math.max(ey, ez) / 2;
    if (radius < Math.max(size[1], 1e-6) * 0.04) continue;
    if (ey > ez * 2.5 || ez > ey * 2.5) continue;
    cylinders.push({
      cx: (pmin[0] + pmax[0]) / 2,
      cy: (pmin[1] + pmax[1]) / 2,
      cz: (pmin[2] + pmax[2]) / 2,
      half: (pmax[0] - pmin[0]) / 2 + radius * 0.2,
      radius: radius * 1.08
    });
  }
  if (!cylinders.length) return blocks;
  const inside = new Uint8Array(faceCount);
  for (let face = 0; face < faceCount; face++) {
    const center = [0, 0, 0];
    for (let corner = 0; corner < 3; corner++) {
      center[0] += world[face * 9 + corner * 3];
      center[1] += world[face * 9 + corner * 3 + 1];
      center[2] += world[face * 9 + corner * 3 + 2];
    }
    center[0] /= 3;
    center[1] /= 3;
    center[2] /= 3;
    for (const cyl of cylinders) {
      if (Math.abs(center[0] - cyl.cx) > cyl.half) continue;
      if (Math.hypot(center[1] - cyl.cy, center[2] - cyl.cz) <= cyl.radius) inside[face] = 1;
    }
  }
  const edges = new Map();
  for (let face = 0; face < faceCount; face++) {
    for (let edge = 0; edge < 3; edge++) {
      const a = edge;
      const b = (edge + 1) % 3;
      const key = edgeKey(
        world[face * 9 + a * 3], world[face * 9 + a * 3 + 1], world[face * 9 + a * 3 + 2],
        world[face * 9 + b * 3], world[face * 9 + b * 3 + 1], world[face * 9 + b * 3 + 2]
      );
      const list = edges.get(key);
      if (list) list.push(face);
      else edges.set(key, [face]);
    }
  }
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    if (inside[list[0]] !== inside[list[1]]) blocks.add(pairKey(list[0], list[1]));
  }
  return blocks;
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

export function seamBlocks(world, uvs, rgba, width, height, partIds) {
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
    if (partIds && partIds[a.face] !== partIds[b.face]) blocks.add(pairKey(a.face, b.face));
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
