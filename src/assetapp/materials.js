// Sovereign Asset: scanned surfaces for walls and roofs.
// Photographs of real stucco, block, brick and roof tile (Poly Haven, CC0: see
// public/asset-materials/LICENSE.txt). meters is how much real wall one tile of the scan covers,
// so the engine can lay it at true size on a model that has been given a size.
export const SCANS = {
  stucco: { meters: 2 },
  block: { meters: 1.6 },   // 8 courses of 200 mm
  brick: { meters: 1.3 },   // 17 courses of 75 mm
  roof: { meters: 3 }
};

// Mean color of a scan, so it can be tinted toward a wall's own paint.
export function meanColor(image) {
  let r = 0, g = 0, b = 0;
  const n = image.width * image.height, step = Math.max(1, Math.floor(n / 4096));
  let k = 0;
  for (let p = 0; p < n; p += step) { r += image.rgba[p * 4]; g += image.rgba[p * 4 + 1]; b += image.rgba[p * 4 + 2]; k++; }
  return [r / k, g / k, b / k];
}

// A loader for the browser: fetches the three images of one scan and decodes them.
// Returns null when any part cannot be had, and the engine then makes the surface itself.
export function browserMaterials(codec, base) {
  const cache = new Map();
  return async (name) => {
    if (!SCANS[name]) return null;
    if (!cache.has(name)) cache.set(name, (async () => {
      const out = { meters: SCANS[name].meters };
      for (const part of ["color", "normal", "roughness"]) {
        const res = await fetch(base + "asset-materials/" + name + "_" + part + ".jpg");
        if (!res.ok) return null;
        const img = await codec.decode(new Uint8Array(await res.arrayBuffer()), "image/jpeg");
        if (!img) return null;
        out[part] = img;
      }
      return out;
    })().catch(() => null));
    return cache.get(name);
  };
}
