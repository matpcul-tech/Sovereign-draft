/* DWG reader. AutoCAD DWG is a compressed binary; we do three things:
 *
 *  1. Detect it (AC10xx header).
 *  2. If the bytes actually contain an ASCII DXF (misnamed file, or a
 *     converter that wrapped one), parse that with the existing DXF reader.
 *  3. Otherwise lazy-load @mlightcad/libredwg-web (GPL, ~wasm) from a CDN
 *     only when the user opens a .dwg — it never ships in the app bundle.
 *
 * Mapped entities go through the same unit scaling as DXF ($INSUNITS / guess).
 */
import { parseDXF } from './dxf.js';

const AC_RE = /^AC10\d{2}/;

export function dwgVersion(bytes){
  const u8 = asU8(bytes);
  if (!u8 || u8.length < 6) return null;
  let s = '';
  for (let i = 0; i < 6; i++) s += String.fromCharCode(u8[i]);
  return AC_RE.test(s) ? s : null;
}

export function isDwgBuffer(bytes, filename){
  if (String(filename || '').toLowerCase().endsWith('.dwg')) return true;
  return !!dwgVersion(bytes);
}

function asU8(bytes){
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes.buffer && bytes.byteLength != null) return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
  if (bytes.byteLength != null) return new Uint8Array(bytes);
  return null;
}

function latin1Head(u8, n){
  const m = Math.min(u8.length, n || 32);
  let s = '';
  for (let i = 0; i < m; i++) s += String.fromCharCode(u8[i]);
  return s;
}

/* Some files named .dwg are DXF. A few converters embed an ASCII DXF. */
export function extractEmbeddedDxf(bytes){
  const u8 = asU8(bytes);
  if (!u8) return null;
  const head = latin1Head(u8, 64);
  if (/\bSECTION\b/.test(head) && !AC_RE.test(head)){
    return new TextDecoder('latin1').decode(u8);
  }
  /* Scan a prefix for 0/SECTION/2/ENTITIES in ASCII. Real DWG will not hit. */
  const scan = Math.min(u8.length, 1 << 20);
  let ascii = '';
  for (let i = 0; i < scan; i++){
    const c = u8[i];
    ascii += (c >= 9 && c < 127) ? String.fromCharCode(c) : '\n';
  }
  const idx = ascii.indexOf('SECTION');
  const ent = ascii.indexOf('ENTITIES');
  if (idx >= 0 && ent > idx && /\bEOF\b/.test(ascii)){
    const start = ascii.lastIndexOf('0', idx);
    const slice = ascii.slice(start < 0 ? idx : start);
    if ((slice.match(/\bLINE\b/g) || []).length + (slice.match(/\bCIRCLE\b/g) || []).length > 0){
      return slice;
    }
  }
  return null;
}

function num(v, d){
  const n = Number(v);
  return isFinite(n) ? n : (d || 0);
}

function layerOf(e){
  return String((e && (e.layer || e.layerName || (e.layer && e.layer.name))) || 'WALLS');
}

function pt(p){
  if (!p) return null;
  if (Array.isArray(p) && p.length >= 2) return [num(p[0]), num(p[1])];
  if (typeof p === 'object' && (p.x != null || p.X != null)) return [num(p.x != null ? p.x : p.X), num(p.y != null ? p.y : p.Y)];
  return null;
}

function ptsOf(e){
  const raw = e.points || e.pts || e.vertices || e.controlPoints || [];
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(p => {
    const q = pt(p);
    if (q) out.push(q);
  });
  return out;
}

function typeName(e){
  const t = e && (e.type || e.objectType || e.entityType || e.dxfName || e.name);
  return String(t || '').toUpperCase().replace(/^ACDB/, '').replace(/^DWG_/, '');
}

/* Map a libredwg-style entity (or anything close) onto our kernel. */
export function mapDwgEntity(e){
  if (!e || typeof e !== 'object') return null;
  const t = typeName(e);
  const layer = layerOf(e);
  if (t === 'LINE' || t === 'XLINE' || t === 'RAY'){
    const a = pt(e.start || e.startPoint || e.p1) || [num(e.x1), num(e.y1)];
    const b = pt(e.end || e.endPoint || e.p2) || [num(e.x2), num(e.y2)];
    if (t === 'XLINE') return { type: 'xline', layer, x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
    return { type: 'line', layer, x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  }
  if (t === 'CIRCLE'){
    const c = pt(e.center) || [num(e.cx), num(e.cy)];
    return { type: 'circle', layer, cx: c[0], cy: c[1], r: Math.abs(num(e.radius != null ? e.radius : e.r, 0.1)) || 0.1 };
  }
  if (t === 'ARC'){
    const c = pt(e.center) || [num(e.cx), num(e.cy)];
    const a1 = (e.startAngle != null ? e.startAngle : e.a1);
    const a2 = (e.endAngle != null ? e.endAngle : e.a2);
    const deg = (v) => Math.abs(v) > 6.3 ? num(v) : num(v) * 180 / Math.PI;
    return { type: 'arc', layer, cx: c[0], cy: c[1], r: Math.abs(num(e.radius != null ? e.radius : e.r, 0.1)) || 0.1, a1: deg(a1), a2: deg(a2) };
  }
  if (t === 'LWPOLYLINE' || t === 'POLYLINE' || t === 'SPLINE' || t === 'SOLID' || t === '3DFACE'){
    const pts = ptsOf(e);
    if (pts.length < 2) return null;
    return { type: 'poly', layer, closed: !!(e.closed || e.isClosed || (e.flag & 1)), pts };
  }
  if (t === 'TEXT' || t === 'MTEXT' || t === 'ATTRIB'){
    const p = pt(e.position || e.insertionPoint || e.start) || [num(e.x), num(e.y)];
    return { type: 'text', layer, x: p[0], y: p[1], size: Math.abs(num(e.height != null ? e.height : e.size, 1)) || 1, content: String(e.text || e.content || e.value || '') };
  }
  if (t === 'ELLIPSE'){
    const c = pt(e.center) || [num(e.cx), num(e.cy)];
    const mx = e.majorAxis || e.major;
    const rx = mx ? Math.hypot(num(mx.x != null ? mx.x : mx[0]), num(mx.y != null ? mx.y : mx[1])) : num(e.rx, 1);
    const ratio = num(e.ratio != null ? e.ratio : (e.ry != null && rx ? e.ry / rx : 1), 1);
    return { type: 'ellipse', layer, cx: c[0], cy: c[1], rx: rx || 1, ry: Math.abs(rx * ratio) || rx, rot: 0 };
  }
  if (t === 'HATCH'){
    const pts = ptsOf(e);
    if (pts.length < 3) return null;
    return { type: 'hatch', layer, pts, pattern: String(e.pattern || e.patternName || 'ANSI31'), scale: num(e.scale, 1) || 1 };
  }
  if (t === 'DIMENSION' || t === 'ALIGNED_DIMENSION'){
    const a = pt(e.defPoint1 || e.start) || [num(e.x1), num(e.y1)];
    const b = pt(e.defPoint2 || e.end) || [num(e.x2), num(e.y2)];
    return { type: 'dim', layer: layer === 'WALLS' ? 'DIMS' : layer, x1: a[0], y1: a[1], x2: b[0], y2: b[1], off: 2 };
  }
  if (t === 'LEADER' || t === 'MLEADER'){
    const pts = ptsOf(e);
    if (pts.length < 2) return null;
    return { type: 'leader', layer, pts, content: String(e.text || e.content || '') };
  }
  return null;
}

export function mapDwgDatabase(db, ensureLayer){
  const ens = [];
  const push = (e) => {
    const m = mapDwgEntity(e);
    if (!m) return;
    if (ensureLayer) m.layer = ensureLayer(m.layer);
    ens.push(m);
  };
  if (!db) return ens;
  const lists = [db.entities, db.modelSpace, db.ents, db.objects];
  lists.forEach(list => {
    if (Array.isArray(list)) list.forEach(push);
  });
  if (db.tables && db.tables.blocks){
    /* skip block defs — INSERTs should already be exploded by the parser, or ignored */
  }
  if (!ens.length && Array.isArray(db)) db.forEach(push);
  return ens;
}

async function loadLibreDwg(loader){
  if (loader) return loader();
  /* Specifier is built at runtime so the PWA bundle does not pull a GPL wasm. */
  const pkg = ['@mlightcad', 'libredwg-web'].join('/');
  const cdn = 'https://cdn.jsdelivr.net/npm/' + pkg + '@0.7.10/+esm';
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch (err){
    try {
      return await import(/* @vite-ignore */ cdn);
    } catch (err2){
      throw new Error('DWG reader unavailable. Save As DXF in the other CAD, or add @mlightcad/libredwg-web.');
    }
  }
}

async function runParser(mod, bytes){
  const u8 = asU8(bytes);
  if (typeof mod.parse === 'function') return mod.parse(u8.buffer);
  if (typeof mod.parseDwg === 'function') return mod.parseDwg(u8);
  if (mod.DWGParser){
    const p = new mod.DWGParser();
    if (typeof p.parse === 'function') return p.parse(u8.buffer);
  }
  if (mod.LibreDwg || mod.default){
    const L = mod.LibreDwg || mod.default;
    const inst = typeof L.create === 'function' ? await L.create() : (typeof L === 'function' ? new L() : L);
    if (inst && typeof inst.dwg_read_data === 'function') return inst.dwg_read_data(u8);
    if (inst && typeof inst.parse === 'function') return inst.parse(u8);
    if (typeof L.parse === 'function') return L.parse(u8);
  }
  throw new Error('Unrecognized DWG parser API');
}

export async function parseDwg(bytes, opts){
  const o = opts || {};
  const ensureLayer = o.ensureLayer || (n => String(n || 'WALLS').toUpperCase().slice(0, 24));
  const embedded = extractEmbeddedDxf(bytes);
  if (embedded){
    return { entities: parseDXF(embedded, ensureLayer), source: 'dxf' };
  }
  if (!dwgVersion(bytes) && !String(o.filename || '').toLowerCase().endsWith('.dwg')){
    throw new Error('Not a DWG file');
  }
  const mod = await loadLibreDwg(o.loader);
  const db = await runParser(mod, bytes);
  const entities = mapDwgDatabase(db, ensureLayer);
  return { entities, source: 'libredwg', raw: db };
}
