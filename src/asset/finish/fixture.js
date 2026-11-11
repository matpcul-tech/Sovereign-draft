import * as THREE from "three";
import { encodePng } from "./png.js";
import { packGlb, sceneToDoc } from "./glb.js";

export const RANGES = {
  body: [0, 12],
  glass: [12, 14],
  wheel_fl: [14, 26],
  wheel_fr: [26, 38],
  wheel_rl: [38, 50],
  wheel_rr: [50, 62],
  degenerate: 62,
  duplicate: [63, 65]
};

function addBox(dst, min, max, uv) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const verts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [3, 6, 2], [3, 7, 6],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5]
  ];
  const start = dst.positions.length / 3;
  for (const vert of verts) {
    dst.positions.push(vert[0], vert[1], vert[2]);
    dst.uvs.push(uv[0], uv[1]);
  }
  for (const face of faces) dst.indices.push(start + face[0], start + face[1], start + face[2]);
}

function addTri(dst, a, b, c, uv) {
  const start = dst.positions.length / 3;
  dst.positions.push(...a, ...b, ...c);
  dst.indices.push(start, start + 1, start + 2);
  dst.uvs.push(uv[0], uv[1], uv[0], uv[1], uv[0], uv[1]);
}

export function fusedShellGeometry() {
  const dst = { positions: [], uvs: [], indices: [] };
  addBox(dst, [-0.85, 0.35, -2.2], [0.85, 1.2, 2.2], [0.25, 0.25]);
  addTri(dst, [-0.55, 0.95, 1.55], [0.55, 0.95, 1.55], [0.55, 1.15, 1.15], [0.25, 0.75]);
  addTri(dst, [-0.55, 0.95, 1.55], [0.55, 1.15, 1.15], [-0.55, 1.15, 1.15], [0.25, 0.75]);
  addBox(dst, [-1.05, 0.02, 1.25], [-0.7, 0.32, 1.6], [0.75, 0.75]);
  addBox(dst, [0.7, 0.02, 1.25], [1.05, 0.32, 1.6], [0.75, 0.75]);
  addBox(dst, [-1.05, 0.02, -1.6], [-0.7, 0.32, -1.25], [0.75, 0.75]);
  addBox(dst, [0.7, 0.02, -1.6], [1.05, 0.32, -1.25], [0.75, 0.75]);
  addTri(dst, [3, 3, 3], [3.02, 3, 3], [3.04, 3, 3], [0.1, 0.1]);
  addTri(dst, [3, 2, 3], [3.2, 2, 3], [3.2, 2.2, 3], [0.9, 0.1]);
  addTri(dst, [3, 2, 3], [3.2, 2, 3], [3.2, 2.2, 3], [0.9, 0.1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(dst.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(dst.uvs, 2));
  geometry.setIndex(dst.indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function atlasPng() {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      const left = x < 2;
      rgba[i] = left ? 180 : 20;
      rgba[i + 1] = left ? 40 : 40;
      rgba[i + 2] = left ? 40 : 180;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(4, 4, rgba);
}

export function fusedShellGlb() {
  const geometry = fusedShellGeometry();
  const material = new THREE.MeshStandardMaterial({ name: "atlas", color: "#ffffff", roughness: 1, metalness: 0 });
  material.userData.gltfPbr = {
    baseColorFactor: [1, 1, 1, 1],
    metallicFactor: 0,
    roughnessFactor: 1,
    emissiveFactor: [0, 0, 0],
    alphaMode: "OPAQUE",
    doubleSided: true,
    images: { baseColor: 0 }
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "shell";
  const group = new THREE.Group();
  group.name = "fused-shell";
  group.add(mesh);
  const image = { name: "atlas", mime: "image/png", bytes: atlasPng() };
  const doc = sceneToDoc(group, [image], { sceneName: "fused-shell" });
  return packGlb(doc);
}
