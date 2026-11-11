import * as THREE from "three";
import { maskClass } from "./mask.js";

export function applyGlassOverlay(root, mask, size) {
  clearGlassOverlay(root);
  if (!root || !mask || !size) return;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcY = y;
    for (let x = 0; x < size; x++) {
      const from = (srcY * size + x) * 4;
      const kind = maskClass(mask[from], mask[from + 1], mask[from + 2]);
      if (kind !== "glass" && kind !== "edge") continue;
      const to = (y * size + x) * 4;
      data[to] = 0;
      data[to + 1] = kind === "glass" ? 212 : 150;
      data[to + 2] = kind === "glass" ? 184 : 130;
      data[to + 3] = kind === "glass" ? 168 : 90;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.glassOverlay) return;
    const overlay = new THREE.Mesh(obj.geometry, material);
    overlay.name = "glass-overlay";
    overlay.userData.glassOverlay = true;
    overlay.renderOrder = 3;
    obj.add(overlay);
  });
  root.userData.glassOverlayMaterial = material;
}

export function clearGlassOverlay(root) {
  if (!root) return;
  const drop = [];
  root.traverse((obj) => {
    if (obj.userData && obj.userData.glassOverlay) drop.push(obj);
  });
  for (const obj of drop) obj.removeFromParent();
  const material = root.userData && root.userData.glassOverlayMaterial;
  if (material) {
    if (material.map) material.map.dispose();
    material.dispose();
    root.userData.glassOverlayMaterial = null;
  }
}
