import { describe, expect, it } from 'vitest';
import { encodePng, decodePng } from '../src/asset/finish/png.js';
import { packGlb, readGlb, readImages } from '../src/asset/finish/glb.js';
import {
  MASK,
  REVIEW,
  aaWidths,
  cleanedBaseCheck,
  cleanExportedBase,
  detectGlassFaces,
  editMask,
  paddingConflicts,
  reviewImage,
  sideViewGlassCheck
} from '../src/asset/finish/mask.js';

function fill(width, height, rgba) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = rgba[0];
    out[i * 4 + 1] = rgba[1];
    out[i * 4 + 2] = rgba[2];
    out[i * 4 + 3] = rgba[3];
  }
  return out;
}

function put(buf, width, x, y, rgba) {
  const index = (y * width + x) * 4;
  buf[index] = rgba[0];
  buf[index + 1] = rgba[1];
  buf[index + 2] = rgba[2];
  buf[index + 3] = rgba[3];
}

const PAINT = [0, 255, 0, 255];
const GLASS = [255, 0, 0, 255];
const CHROME = [0, 0, 255, 255];
const OTHER = [0, 0, 0, 255];
const BODY = [28, 70, 140];

function face(id, x, y, z, role, color, neighbors) {
  return { id, x, y, z, role, colorEdgeGlass: color, neighbors };
}

describe('car window mask', () => {
  const wheels = [
    { cx: -0.8, cy: 0.3, cz: 1.3, radius: 0.32, halfWidth: 0.15 },
    { cx: 0.8, cy: 0.3, cz: 1.3, radius: 0.32, halfWidth: 0.15 },
    { cx: -0.8, cy: 0.3, cz: -1.3, radius: 0.32, halfWidth: 0.15 },
    { cx: 0.8, cy: 0.3, cz: -1.3, radius: 0.32, halfWidth: 0.15 }
  ];
  const car = { beltY: 0.75, wheels, minComponent: 3 };

  it('does not call tires or grille glass from color alone', () => {
    const faces = [
      face(0, 0, 1.05, 0.2, 'cabin', true, [1]),
      face(1, 0.05, 1.06, 0.2, 'cabin', true, [0, 2]),
      face(2, 0.1, 1.07, 0.2, 'cabin', true, [1]),
      face(3, -0.8, 0.3, 1.3, 'tire', true, []),
      face(4, 0, 0.45, 2.1, 'grille', true, []),
      face(5, 0.4, 1.1, 0.8, 'cabin', true, []),
      face(6, 0.2, 1.02, 0.3, 'cabin', false, [])
    ];
    const found = detectGlassFaces(faces, car);
    expect(found.ready).toBe(true);
    expect(found.glass).toEqual([0, 1, 2]);
    expect(found.excluded).toBe(2);
    expect(found.ambiguous).toBe(1);
    expect(detectGlassFaces(faces, { wheels }).ready).toBe(false);
  });

  it('measures antialias width and rejects a wider blur', () => {
    const thin = fill(6, 1, PAINT);
    put(thin, 6, 2, 0, [128, 128, 0, 255]);
    put(thin, 6, 3, 0, GLASS);
    put(thin, 6, 4, 0, GLASS);
    put(thin, 6, 5, 0, GLASS);
    expect(aaWidths(thin, 6, 1).pass).toBe(true);
    expect(aaWidths(thin, 6, 1).max).toBe(1);
    const wide = fill(8, 1, PAINT);
    put(wide, 8, 2, 0, [80, 80, 0, 255]);
    put(wide, 8, 3, 0, [120, 40, 0, 255]);
    put(wide, 8, 4, 0, [180, 20, 0, 255]);
    put(wide, 8, 5, 0, GLASS);
    put(wide, 8, 6, 0, GLASS);
    put(wide, 8, 7, 0, GLASS);
    expect(aaWidths(wide, 8, 1).pass).toBe(false);
    expect(aaWidths(wide, 8, 1).max).toBe(3);
  });

  it('counts side-view glass, belt line, and paint fringe', () => {
    const samples = [];
    for (let i = 0; i < 80; i++) samples.push({ onCar: true, kind: 'paint', y: 0.4 + (i % 2) });
    for (let i = 0; i < 20; i++) samples.push({ onCar: true, kind: 'glass', y: 1.1 });
    const ok = sideViewGlassCheck(samples, 0.75);
    expect(ok.pass).toBe(true);
    expect(ok.ratio).toBeCloseTo(0.2);
    samples.push({ onCar: true, kind: 'glass', y: 0.4 });
    const low = sideViewGlassCheck(samples, 0.75);
    expect(low.pass).toBe(false);
    expect(low.belowBelt).toBe(1);

    const mask = fill(8, 4, PAINT);
    const base = fill(8, 4, [...BODY, 255]);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) put(mask, 8, x, y, GLASS);
    expect(cleanedBaseCheck(base, mask, 8, 4, BODY).bodyInGlass).toBe(16);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) put(base, 8, x, y, [34, 34, 34, 255]);
    put(base, 8, 4, 1, [34, 34, 34, 255]);
    const fringe = cleanedBaseCheck(base, mask, 8, 4, BODY);
    expect(fringe.bodyInGlass).toBe(0);
    expect(fringe.fringe).toBe(1);
    put(base, 8, 4, 1, [...BODY, 255]);
    expect(cleanedBaseCheck(base, mask, 8, 4, BODY).pass).toBe(true);
  });

  it('edits the mask by hand and pads only a free gutter', () => {
    const mask = fill(6, 4, PAINT);
    const added = editMask(mask, 6, 4, { op: 'add', pixels: [{ x: 1, y: 1 }] });
    expect(added[(1 * 6 + 1) * 4]).toBe(255);
    expect(mask[(1 * 6 + 1) * 4]).toBe(0);
    const removed = editMask(added, 6, 4, { op: 'remove', pixels: [{ x: 1, y: 1 }] });
    expect(removed[(1 * 6 + 1) * 4 + 1]).toBe(255);
    const brushed = editMask(mask, 6, 4, { op: 'add', pixels: [{ x: 3, y: 2 }], radius: 1 });
    expect(brushed[(2 * 6 + 3) * 4]).toBe(255);
    expect(brushed[(0 * 6 + 3) * 4]).toBe(0);

    expect(paddingConflicts([
      { kind: 'paint', minX: 0, minY: 0, maxX: 4, maxY: 4 },
      { kind: 'glass', minX: 22, minY: 0, maxX: 26, maxY: 4 }
    ], 8).ready).toBe(true);
    const tight = paddingConflicts([
      { kind: 'paint', minX: 0, minY: 0, maxX: 4, maxY: 4 },
      { kind: 'glass', minX: 10, minY: 0, maxX: 14, maxY: 4 }
    ], 8);
    expect(tight.ready).toBe(false);
    expect(tight.conflicts).toBeGreaterThan(0);
    expect(tight.detail).toMatch(/UVs were not moved/);

    const width = 24;
    const height = 24;
    const base = fill(width, height, [10, 10, 10, 255]);
    const classes = fill(width, height, [10, 10, 10, 255]);
    for (let y = 4; y < 10; y++) {
      for (let x = 4; x < 10; x++) {
        put(base, width, x, y, [...BODY, 255]);
        put(classes, width, x, y, PAINT);
      }
    }
    const before = base.slice();
    const cleaned = cleanExportedBase(base, classes, width, height);
    expect(base[0]).toBe(before[0]);
    expect(cleaned.ready).toBe(true);
    expect(cleaned.log.padded).toBeGreaterThan(0);
    expect(cleaned.base[(6 * width + 6) * 4]).toBe(BODY[0]);
    const crowded = fill(12, 8, [10, 10, 10, 255]);
    const crowdedMask = fill(12, 8, [10, 10, 10, 255]);
    const crowdedBase = fill(12, 8, [10, 10, 10, 255]);
    for (let y = 1; y < 6; y++) {
      for (let x = 1; x < 4; x++) {
        put(crowdedBase, 12, x, y, [...BODY, 255]);
        put(crowdedMask, 12, x, y, PAINT);
      }
      for (let x = 6; x < 10; x++) {
        put(crowdedBase, 12, x, y, [34, 34, 34, 255]);
        put(crowdedMask, 12, x, y, GLASS);
      }
    }
    const blocked = cleanExportedBase(crowdedBase, crowdedMask, 12, 8);
    expect(blocked.conflicts).toBeGreaterThan(0);
    expect(blocked.ready).toBe(false);
    expect(blocked.log.padded).toBe(0);
    expect(crowded[0]).toBe(10);
  });

  it('paints the review at 4x and keeps a zero emissive mask in the GLB', () => {
    const mask = fill(2, 2, OTHER);
    put(mask, 2, 0, 0, GLASS);
    put(mask, 2, 1, 0, PAINT);
    put(mask, 2, 0, 1, CHROME);
    const review = reviewImage(mask, 2, 2, 4);
    expect(review.width).toBe(8);
    expect(review.height).toBe(8);
    expect([...review.rgba.slice(0, 4)]).toEqual(REVIEW.glass);
    expect([...review.rgba.slice(4 * 4, 4 * 4 + 4)]).toEqual(REVIEW.paint);
    const chrome = review.rgba.slice((4 * 8 + 0) * 4, (4 * 8 + 0) * 4 + 4);
    expect([...chrome]).toEqual(REVIEW.chrome);

    const basePng = encodePng(2, 2, fill(2, 2, [...BODY, 255]));
    const maskPng = encodePng(2, 2, mask);
    const bytes = packGlb({
      sceneName: 'car',
      roots: [0, 1],
      materials: [{
        name: 'atlas',
        emissiveFactor: [0, 0, 0],
        extras: { kitMask: true },
        baseColorImage: { name: 'base', mime: 'image/png', bytes: basePng },
        emissiveImage: { name: 'mask', mime: 'image/png', bytes: maskPng }
      }],
      meshes: [{
        name: 'body',
        primitives: [{
          material: 0,
          position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint16Array([0, 1, 2])
        }]
      }],
      nodes: [
        { name: 'body', mesh: 0 },
        { name: 'wheel_fl', extras: { kitWheel: true } }
      ]
    });
    const { json } = readGlb(bytes);
    const material = json.materials[0];
    expect(material.emissiveFactor).toEqual([0, 0, 0]);
    expect(material.emissiveTexture.index).toBeGreaterThanOrEqual(0);
    expect(material.extras.kitMask).toBe(true);
    expect(json.materials).toHaveLength(1);
    expect(json.nodes.map((node) => node.name)).toEqual(['body', 'wheel_fl']);
    expect(json.nodes[1].extras.kitWheel).toBe(true);
    const images = readImages(bytes);
    expect(images).toHaveLength(2);
    const maskBack = decodePng(images[1].bytes);
    expect(maskBack.rgba[0]).toBe(255);
    expect(MASK.size).toBe(1024);
  });
});
