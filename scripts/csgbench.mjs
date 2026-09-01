/* CSG ceiling benchmark: npm run build not needed, runs on src directly.
 *
 * Two probes. The overlap probe is the worst case, two equal spheres half
 * embedded, verified against the closed-form union volume and the
 * inclusion-exclusion identity. The drill probe is the architectural case,
 * a thin cylinder through a big fine mesh, where the overlap pruning does
 * its work. Run with: node scripts/csgbench.mjs
 */
import { makeSphere, makeCylinder, meshVolume } from '../src/core/mesh.js';
import { csgUnion, csgSubtract, csgIntersect } from '../src/core/csg.js';

const r = 10, d = 10;
const vSphere = 4 / 3 * Math.PI * r * r * r;
const vLens = Math.PI * (4 * r + d) * (2 * r - d) * (2 * r - d) / 12;
const vUnion = 2 * vSphere - vLens;

console.log('overlap probe: two spheres r=10, centres 10 apart');
for (const seg of [16, 32, 48, 64, 96]){
  const A = makeSphere(0, 0, 0, r, seg);
  const B = makeSphere(d, 0, 0, r, seg);
  let t0 = performance.now();
  const U = csgUnion(A, B);
  const tU = performance.now() - t0;
  t0 = performance.now();
  csgSubtract(A, B);
  const tS = performance.now() - t0;
  t0 = performance.now();
  const I = csgIntersect(A, B);
  const tI = performance.now() - t0;
  const errU = Math.abs(meshVolume(U) - vUnion) / vUnion;
  const ident = Math.abs(meshVolume(A) + meshVolume(B) - meshVolume(U) - meshVolume(I)) / vSphere;
  console.log(' ', String(A.faces.length).padStart(5), 'faces/op | union',
    tU.toFixed(0).padStart(6) + 'ms | subtract', tS.toFixed(0).padStart(6) + 'ms | intersect',
    tI.toFixed(0).padStart(6) + 'ms | vol err', (errU * 100).toFixed(3) + '% | identity', ident.toExponential(1));
}

console.log('drill probe: thin cylinder through a big sphere');
for (const seg of [48, 64, 96]){
  const S = makeSphere(0, 0, 0, 50, seg);
  const C = makeCylinder(0, 0, -60, 2, 120, 48);
  const t0 = performance.now();
  const M = csgSubtract(S, C);
  const t = performance.now() - t0;
  console.log(' ', String(S.faces.length).padStart(5), 'faces minus', C.faces.length,
    '| subtract', t.toFixed(0).padStart(6) + 'ms | out', M.faces.length, 'faces');
}
