/* STL reading, both dialects.
 *
 * STL is the lingua franca of mesh exchange: every slicer, scanner and
 * modeller writes it. The writer has existed since the mesh kernel; without
 * a reader the exchange only flows outward.
 *
 * Binary STL is an 80 byte header, a face count, then fifty bytes per
 * triangle. ASCII STL is the word "solid" and a facet grammar. Telling them
 * apart by the leading word alone is the classic trap: plenty of binary
 * files begin with "solid" in their header, so the real test is whether the
 * byte length matches what the face count promises.
 */
import { makeMesh } from '../core/mesh.js';

export function parseSTL(input){
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : null;
  if (bytes){
    if (bytes.length >= 84){
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === bytes.length) return parseBinary(dv, n);
    }
    return parseAscii(new TextDecoder('latin1').decode(bytes));
  }
  return parseAscii(String(input || ''));
}

function parseBinary(dv, n){
  const verts = [];
  const faces = [];
  let p = 84;
  for (let i = 0; i < n; i++){
    p += 12;                                   /* the stored normal is advisory */
    const base = verts.length;
    for (let v = 0; v < 3; v++){
      verts.push([dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)]);
      p += 12;
    }
    p += 2;                                    /* attribute byte count */
    faces.push([base, base + 1, base + 2]);
  }
  return weld(makeMesh(verts, faces));
}

function parseAscii(text){
  const verts = [];
  const faces = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  const tri = [];
  while ((m = re.exec(text))){
    tri.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (tri.length === 3){
      const base = verts.length;
      tri.forEach(v => verts.push(v));
      faces.push([base, base + 1, base + 2]);
      tri.length = 0;
    }
  }
  return weld(makeMesh(verts, faces));
}

/* STL repeats every vertex per triangle. Welding coincident vertices is what
 * lets watertightness and edge sharing mean anything on the result. */
export function weld(mesh, tol){
  const t = tol == null ? 1e-6 : tol;
  const map = new Map();
  const verts = [];
  const remap = new Array(mesh.verts.length);
  mesh.verts.forEach((v, i) => {
    const k = Math.round(v[0] / t) + ',' + Math.round(v[1] / t) + ',' + Math.round(v[2] / t);
    if (map.has(k)) remap[i] = map.get(k);
    else { map.set(k, verts.length); remap[i] = verts.length; verts.push(v.slice()); }
  });
  const faces = [];
  for (const f of mesh.faces){
    const a = remap[f[0]], b = remap[f[1]], c = remap[f[2]];
    if (a === b || b === c || a === c) continue;   /* degenerate after welding */
    faces.push([a, b, c]);
  }
  return makeMesh(verts, faces);
}

export function looksLikeSTL(name, bytes){
  if (/\.stl$/i.test(String(name || ''))) return true;
  if (bytes && bytes.length >= 84){
    const dv = new DataView(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.length) return true;
  }
  return false;
}
