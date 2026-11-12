// What each finish is for. Every number here can be changed in Settings before a run.
// Street Empire numbers come from that repo's docs/build-kit.md.

export const PRESETS = [
  {
    id: "clean",
    name: "Clean up",
    blurb: "Fix what is broken. Keep every triangle and the size.",
    options: { triangles: null, maxTexture: 4096, textureFormat: "keep", size: null }
  },
  {
    id: "game",
    name: "Game ready",
    blurb: "Clean, cut to 30,000 triangles, 1024 px WebP textures.",
    options: { triangles: 30000, maxTexture: 1024, textureFormat: "webp", size: null }
  },
  {
    id: "se-car",
    name: "Street Empire car",
    blurb: "Splits the four wheels, builds the window mask, one material.",
    car: true,
    slots: ["sedan", "muscle", "suv", "van", "taxi", "police", "lowrider", "pickup"],
    lengths: { sedan: 4.9, muscle: 4.8, suv: 4.8, van: 5.1, taxi: 4.9, police: 5.2, lowrider: 5.4, pickup: 5.2 },
    fileName: (slot) => slot + "@keep.glb",
    options: {}
  },
  {
    id: "se-building",
    name: "Street Empire building",
    blurb: "Clean, under 60,000 triangles, 1024 px textures.",
    slots: ["house", "house-2", "house-3", "store", "apt", "tower", "shed"],
    fileName: (slot) => slot + ".glb",
    options: { triangles: 60000, maxTexture: 1024, textureFormat: "keep", size: null }
  },
  {
    id: "se-character",
    name: "Street Empire character",
    blurb: "Needs a skeleton. 1.8 m tall, under 15,000 triangles, animations dropped.",
    slots: ["player", "unc", "crew", "reds", "reds-2", "blues", "golds", "locals", "cop", "ped"],
    fileName: (slot) => slot + ".glb",
    options: { triangles: 15000, maxTexture: 1024, textureFormat: "keep", size: { axis: "height", meters: 1.8 }, requireSkeleton: true, dropAnimations: true }
  },
  {
    id: "print",
    name: "3D print check",
    blurb: "Closes every hole it can and fails on any edge left open.",
    options: { triangles: null, maxTexture: null, textureFormat: "keep", size: null, closeHoles: "all", requireClosed: true, ground: true, center: true }
  }
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
