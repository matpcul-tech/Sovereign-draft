import * as THREE from "three";
function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function canvas(size) {
  const el = document.createElement("canvas");
  el.width = size;
  el.height = size;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  return { el, ctx };
}
function texture(el, color = true) {
  const map = new THREE.CanvasTexture(el);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = 8;
  return map;
}
function speckle(ctx, size, amount, alpha) {
  ctx.fillStyle = `rgba(20, 16, 12, ${alpha})`;
  for (let i = 0; i < amount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function paintMaps(hex) {
  const size = 256;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    image.data[i] = clampByte(image.data[i] + n);
    image.data[i + 1] = clampByte(image.data[i + 1] + n);
    image.data[i + 2] = clampByte(image.data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
  speckle(ctx, size, 70, 0.18);
  const rough = canvas(size);
  const pixels = rough.ctx.createImageData(size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = 150 + Math.random() * 50;
    pixels.data[i] = v;
    pixels.data[i + 1] = v;
    pixels.data[i + 2] = v;
    pixels.data[i + 3] = 255;
  }
  rough.ctx.putImageData(pixels, 0, 0);
  return { map: texture(el), roughnessMap: texture(rough.el, false) };
}
function brickMap() {
  const size = 512;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#6a534c";
  ctx.fillRect(0, 0, size, size);
  const brickW = 124;
  const brickH = 52;
  const gap = 8;
  let row = 0;
  for (let y = 0; y < size + brickH; y += brickH) {
    const offset = row % 2 ? brickW / 2 : 0;
    for (let x = -brickW; x < size + brickW; x += brickW) {
      const tone = 128 + Math.floor(Math.random() * 48);
      ctx.fillStyle = `rgb(${tone + 55}, ${Math.round(tone * 0.46)}, ${Math.round(tone * 0.36)})`;
      ctx.fillRect(x + offset + gap / 2, y + gap / 2, brickW - gap, brickH - gap);
    }
    row += 1;
  }
  speckle(ctx, size, 140, 0.12);
  return texture(el);
}
function noiseMap(base, spread) {
  const size = 256;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.random() - 0.5) * spread;
    image.data[i] = clampByte(image.data[i] + n);
    image.data[i + 1] = clampByte(image.data[i + 1] + n);
    image.data[i + 2] = clampByte(image.data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
  return texture(el);
}
function brushedMetalMap() {
  const size = 256;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#aeb4bc";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const v = 150 + Math.random() * 80;
    ctx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 8}, 0.35)`;
    ctx.fillRect(0, y, size, 1);
  }
  return texture(el);
}
function createPalette(paint) {
  const made = /* @__PURE__ */ new Map();
  const textures = [];
  function track(map) {
    textures.push(map);
    return map;
  }
  function build(slot) {
    if (slot === "paint") {
      const maps = paintMaps(paint);
      return new THREE.MeshPhysicalMaterial({
        map: track(maps.map),
        roughnessMap: track(maps.roughnessMap),
        roughness: 0.42,
        metalness: 0.62,
        clearcoat: 1,
        clearcoatRoughness: 0.14,
        envMapIntensity: 1,
        vertexColors: true
      });
    }
    if (slot === "glass") {
      return new THREE.MeshPhysicalMaterial({
        color: "#9aafbc",
        roughness: 0.05,
        metalness: 0.04,
        transparent: true,
        opacity: 0.5,
        envMapIntensity: 1.5
      });
    }
    if (slot === "light") {
      return new THREE.MeshStandardMaterial({
        color: "#fff3dc",
        emissive: "#ffd7a3",
        emissiveIntensity: 1.6,
        roughness: 0.32,
        metalness: 0
      });
    }
    if (slot === "brick") {
      return new THREE.MeshStandardMaterial({
        map: track(brickMap()),
        roughness: 0.9,
        metalness: 0,
        vertexColors: true
      });
    }
    if (slot === "metal") {
      return new THREE.MeshStandardMaterial({
        map: track(brushedMetalMap()),
        roughness: 0.32,
        metalness: 1,
        envMapIntensity: 1
      });
    }
    const bases = {
      rubber: ["#1a1a1a", 0.9, 0],
      concrete: ["#8c897f", 0.94, 0],
      asphalt: ["#2a2b28", 0.96, 0]
    };
    const [color, roughness, metalness] = bases[slot];
    return new THREE.MeshStandardMaterial({
      map: track(noiseMap(color, slot === "rubber" ? 18 : 28)),
      color,
      roughness,
      metalness,
      vertexColors: true
    });
  }
  return {
    get(slot) {
      const existing = made.get(slot);
      if (existing) return existing;
      const material = build(slot);
      made.set(slot, material);
      return material;
    },
    dispose() {
      for (const material of made.values()) material.dispose();
      for (const map of textures) map.dispose();
      made.clear();
    }
  };
}
export {
  brickMap,
  brushedMetalMap,
  createPalette,
  noiseMap,
  paintMaps
};
