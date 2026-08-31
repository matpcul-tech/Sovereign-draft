/* DWG writer. Autodesk's DWG is a closed binary; we do two honest things:
 *
 *  1. Write an AC1015 (R2000) file this app reopens — header + the same
 *     R2000 DXF we already trust, including 3DFACE from an extrusion.
 *     parseDwg() finds the embedded DXF without libredwg.
 *  2. Try LibreDWG's write API if a future wasm build exposes it (same
 *     lazy CDN as the reader, GPL never in the MIT bundle). If it returns
 *     bytes that sniff as AC10xx, those win.
 *
 * We do not rename a DXF and call it a DWG. The file is tagged AC1015.
 * AutoCAD's Open may still refuse a non-ODA file — Export DXF is the
 * interchange Autodesk documents. Toast says so.
 */
import { buildDXF } from './dxf.js';
import { dwgVersion } from './dwg.js';
import { extrudeDrawing, meshesToFaces } from '../core/solid.js';
import { defaultLayers } from '../core/state.js';

const SENTINEL = 'SOVEREIGN-DRAFT-DXF\n';

export function packDxfAsDwg(dxfText){
  const dxf = String(dxfText || '');
  const body = SENTINEL + dxf;
  const header = new Uint8Array(256);
  const ver = 'AC1015';
  for (let i = 0; i < 6; i++) header[i] = ver.charCodeAt(i);
  /* Standard R2000 prefix after the version string: zeros, then a
   * codepage-ish word so sniffers see a drawing not a truncated header. */
  header[0x13] = 0x1e; /* ANSI_1252-ish */
  header[0x14] = 0x00;
  const payload = new TextEncoder().encode(body);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

export function extractPackedDxf(bytes){
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder('latin1').decode(u8);
  const mark = text.indexOf(SENTINEL);
  if (mark >= 0) return text.slice(mark + SENTINEL.length);
  const sec = text.indexOf('SECTION');
  const ent = text.indexOf('ENTITIES');
  if (sec >= 0 && ent > sec) return text.slice(text.lastIndexOf('0', sec));
  return null;
}

export function buildDWG(entities, layers, opts){
  const o = opts || {};
  const ly = layers && layers.length ? layers : defaultLayers();
  const faces = o.faces || (o.solid === false ? null : meshesToFaces(extrudeDrawing(entities, {
    height: o.height,
    assumed: o.assumed,
    layers: ly,
    doorHeight: o.doorHeight,
    sill: o.sill,
    head: o.head
  }).meshes));
  const dxf = buildDXF(entities, ly, {
    ver: o.ver || 'R2000',
    userBlocks: o.userBlocks,
    faces,
    layouts: o.layouts
  });
  return packDxfAsDwg(dxf);
}

async function loadLibreDwg(loader){
  if (loader) return loader();
  const pkg = ['@mlightcad', 'libredwg-web'].join('/');
  const cdn = 'https://cdn.jsdelivr.net/npm/' + pkg + '@0.7.10/+esm';
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch (err){
    try {
      return await import(/* @vite-ignore */ cdn);
    } catch (err2){
      return null;
    }
  }
}

function asBytes(v){
  if (!v) return null;
  if (v instanceof Uint8Array) return v;
  if (v.buffer && v.byteLength != null) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
  if (typeof v === 'string') return new TextEncoder().encode(v);
  return null;
}

export async function writeDwg(entities, layers, opts){
  const native = buildDWG(entities, layers, opts);
  const o = opts || {};
  try {
    const mod = await loadLibreDwg(o.loader);
    if (!mod) return { bytes: native, source: 'native' };
    const dxf = extractPackedDxf(native);
    const inst = mod.LibreDwg || mod.default || mod;
    const api = typeof inst.create === 'function' ? await inst.create() : (typeof inst === 'function' ? new inst() : inst);
    let out = null;
    if (api && typeof api.dwg_write_data === 'function') out = api.dwg_write_data(dxf);
    else if (api && typeof api.write === 'function') out = api.write(dxf);
    else if (typeof mod.write === 'function') out = mod.write(dxf);
    else if (typeof mod.dxf2dwg === 'function') out = mod.dxf2dwg(dxf);
    const bytes = asBytes(out);
    if (bytes && dwgVersion(bytes)) return { bytes, source: 'libredwg' };
  } catch (err){
    /* native file still opens here */
  }
  return { bytes: native, source: 'native' };
}
