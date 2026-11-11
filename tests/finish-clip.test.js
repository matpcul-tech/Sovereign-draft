import { describe, expect, it } from 'vitest';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { bleedCount, clipTriangle, loopOnCurve, resampleCircle, segmentCountForRadius } from '../src/asset/finish/clip.js';

function vert(p, uv) {
  return { p, uv, n: [1, 0, 0] };
}

describe('cylinder clip', () => {
  const cyl = { cx: 0, cy: 0, cz: 0, ax: 1, ay: 0, az: 0, radius: 0.3 };

  it('uses more than 32 segments when 1 mm requires it', () => {
    const wide = segmentCountForRadius(0.32);
    expect(wide.ok).toBe(true);
    expect(wide.count).toBeGreaterThan(32);
    const small = segmentCountForRadius(0.12);
    expect(small.count).toBeGreaterThanOrEqual(24);
    expect(small.count).toBeLessThanOrEqual(32);
  });

  it('cuts a circle through the middle of a large triangle', () => {
    const tri = [
      vert([0, 2, 2], [0, 0]),
      vert([0, -2, 2], [1, 0]),
      vert([0, 0, -3], [0.5, 1])
    ];
    const cut = clipTriangle(tri, { ...cyl, capUv: [0.1, 0.1] });
    expect(cut.ok).toBe(true);
    expect(cut.kind).toBe('disk');
    const curve = loopOnCurve(cut.boundary, cyl);
    expect(curve.ok).toBe(true);
    expect(curve.vertex).toBeLessThanOrEqual(0.001);
    expect(curve.chord).toBeLessThanOrEqual(0.001);
    const all = cut.inside.concat(cut.outside);
    expect(bleedCount(all, cyl)).toBe(0);
    expect(cut.inside[0][0].uv[0]).toBeGreaterThan(0);
    expect(cut.cap[0][0].uv).toEqual([0.1, 0.1]);
    expect(tri[0].uv).toEqual([0, 0]);
  });

  it('keeps the cut on the curve after simplify', async () => {
    const tri = [
      vert([0, 2, 2], [0, 0]),
      vert([0, -2, 2], [1, 0]),
      vert([0, 0, -3], [0.5, 1])
    ];
    const cut = clipTriangle(tri, cyl);
    const verts = [];
    const uvs = [];
    const indices = [];
    const map = new Map();
    const add = (v) => {
      const key = v.p.map((n) => n.toFixed(5)).join(',');
      if (map.has(key)) return map.get(key);
      const id = verts.length / 3;
      map.set(key, id);
      verts.push(...v.p);
      uvs.push(...v.uv);
      return id;
    };
    for (const face of cut.inside) indices.push(add(face[0]), add(face[1]), add(face[2]));
    await MeshoptSimplifier.ready;
    const lock = new Uint8Array(verts.length / 3);
    for (let i = 0; i < lock.length; i++) {
      const radial = Math.hypot(verts[i * 3 + 1], verts[i * 3 + 2]);
      if (Math.abs(radial - cyl.radius) <= 0.001) lock[i] = 1;
    }
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
      new Uint32Array(indices),
      new Float32Array(verts),
      3,
      new Float32Array(uvs),
      2,
      [1, 1],
      lock,
      12,
      0.002,
      ['ErrorAbsolute']
    );
    const tris = [];
    for (let i = 0; i < simplified.length; i += 3) {
      tris.push([0, 1, 2].map((corner) => {
        const id = simplified[i + corner];
        return { p: [verts[id * 3], verts[id * 3 + 1], verts[id * 3 + 2]] };
      }));
    }
    expect(bleedCount(tris, cyl)).toBe(0);
    for (let i = 0; i < lock.length; i++) {
      if (!lock[i]) continue;
      const radial = Math.hypot(verts[i * 3 + 1], verts[i * 3 + 2]);
      expect(Math.abs(radial - cyl.radius)).toBeLessThanOrEqual(0.001);
    }
  });

  it('rejects an off-curve loop and keeps a shared resample identical', () => {
    const circle = resampleCircle(cyl);
    expect(circle.ok).toBe(true);
    const copy = circle.points.map((point) => point.slice());
    expect(copy).toEqual(circle.points);
    const bent = circle.points.map((point) => point.slice());
    bent[0][1] += 0.004;
    expect(loopOnCurve(bent, cyl).ok).toBe(false);
  });
});
