/* AI drafting: Claude returns constrained geometry (walls, openings, fixtures,
 * rooms, dims) — not leftover raw lines. Validate, snap to a 6" grid, fillet
 * wall corners, hatch rooms, dim overall + room sizes. Sheet-context mode
 * reads existing walls and only appends. Invalid JSON is retried once.
 */
import { clamp, snapGrid, dist, polyCentroid, dimGeom } from '../core/geometry.js';
import { entBBox } from '../core/entities.js';
import { wallFrags, wallWithOpenings } from '../core/walls.js';
import { makeHatch } from '../core/hatch.js';
import { alignedDim } from '../core/dimStyle.js';
import { SYMBOLS } from '../core/symbols.js';
import { filletLines } from '../core/modify.js';
import { makeInsert, locateInsert } from '../core/dynblock.js';
import { rulesFor, closeDimChains, placeLabel, textBox, dimObstacles, polygonArea, centroidOf, assertNoImpliedFill } from '../core/annotate.js';
import { makeLayout, makeViewport, fitViewport, PLOT_SCALES, SHEETS } from '../core/layout.js';
import { normalizeSheets, defaultSheetNumber } from '../core/document.js';
import { placeInMargin, makeTableAnnotation, addAnnotation, makeDetailCallout } from '../core/sheetspace.js';
import { buildKeynoteLegend, buildMarkSchedule, keynoteRows, collectMarks, attributeKeys, paperKeynoteColW, paperScheduleColW } from '../core/keynote.js';
import { membersBBox } from '../core/entities.js';

export const AI_SCHEMA_SPEC =
'You are the drafting engine inside a professional 2D CAD application. Convert the request into constrained architectural geometry.\n' +
'Respond with ONLY minified JSON, no markdown, no code fences, no commentary.\n' +
'Schema:\n' +
'{"drawingType":"plan"|"elevation"|"section"|"part"|"diagram",\n' +
' "walls":[{"a":[x1,y1,x2,y2],"th":0.5}],\n' +
' "openings":[{"kind":"door"|"window","wall":0,"t":0.5,"w":3,"swing":"L"|"R"}],\n' +
' "fixtures":[{"kind":"Toilet"|"Sink"|"Tub"|"Shower"|"Stove"|"Fridge"|"Bed"|"Sofa"|"Stairs"|"Table","x":0,"y":0,"rot":0}],\n' +
' "rooms":[{"name":"KITCHEN","pts":[[x,y],...]}],\n' +
' "dims":[{"a":[x1,y1,x2,y2]}],\n' +
' "profiles":[{"pts":[[x,y],...],"fill":"ANSI31"}],\n' +
' "centerlines":[{"pts":[[x,y],...]}],\n' +
' "callouts":[{"anchor":[x,y],"pts":[[x,y],[x,y]],"text":"NOSE CONE"}],\n' +
' "hatchRegions":[{"pts":[[x,y],...],"pattern":"ANSI31"}]}\n' +
'drawingType is REQUIRED. Choose it from the request:\n' +
'  floor plan, site plan, layout, footprint -> plan\n' +
'  front view, side view, elevation -> elevation\n' +
'  cutaway, cross section -> section\n' +
'  a machine, vehicle, assembly, or object with no building semantics -> part\n' +
'  flow, schematic, wiring -> diagram\n' +
'When the request is ambiguous, use plan.\n' +
'walls, openings, rooms and fixtures are BUILDING ONLY. For elevation, part or\n' +
'diagram emit profiles, centerlines, callouts and hatchRegions instead; any\n' +
'wall, door or window you send for those types is discarded.\n' +
'profiles: closed outlines of solid masses. No thickness, no openings, no swing.\n' +
'centerlines: construction axes. callouts: leader plus label, used instead of\n' +
'room names. hatchRegions: only where a cut face is genuinely hatched.\n' +
'Square-foot area tags are emitted for plan only.\n' +
'Any profile, callout or fixture may carry "mark":"E-1" and\n' +
'"attrs":{"type":"MERLIN 1D","material":"...","size":"...","qty":1}.\n' +
'Mark repeated parts so they can be scheduled. Nine identical engines are\n' +
'either nine items marked E-1 through E-9, or one item marked E with qty 9.\n' +
'Units are decimal feet. Y axis points up. Origin near (0,0). All coordinates >= 0.\n' +
'walls: centerlines. th is thickness in feet (0.333, 0.5 or 0.667). Close exterior loops.\n' +
'openings: wall is the 0-based index into walls; t is 0..1 along the centerline; w is opening width in feet.\n' +
'fixtures.kind must be one of the names above. rot is degrees CCW.\n' +
'rooms: closed polygon of interior corners (not wall centerlines). One hatch + label per room.\n' +
'dims: overall exterior dimensions and major room sizes. 4 to 10 of them.\n' +
'On elevation, section and part drawings dims are REQUIRED: overall height,\n' +
'overall width (or diameter), and a station at each major labeled part.\n' +
'A drawing with no dimensions cannot be built from.\n' +
'Every callout SHOULD include mark plus attrs qty and size. Parse "x9" as\n' +
'qty 9. Include material ONLY when the user named that material in the request.\n' +
'Never invent alloys, trade names, or certifications. If unknown, omit material.\n' +
'Stay under 40 walls. Do not emit raw leftover lines. Output must be valid JSON.\n' +
'\n' +
'You may also return a sheet set. Geometry is drawn once at true size; a sheet\n' +
'is a window onto it at a scale, so sheets are cheap and nothing is redrawn:\n' +
' "sheets":[{"number":"A-1","name":"OVERALL ELEVATION","size":"archd",\n' +
'   "views":[{"name":"SOUTH ELEVATION","scale":"1/16","drawingType":"elevation",\n' +
'             "extents":[x0,y0,x1,y1]}],\n' +
'   "annotations":["keynoteLegend"],\n' +
'   "details":[{"x":6.0,"y":4.0,"sheet":"A-2","view":1}]}]\n' +
'size is letter, tabloid or archd. scale is an architectural fraction such as\n' +
'1/16, 1/8, 1/4, 1/2 or 1. extents is the model rectangle that view shows.\n' +
'annotations may list keynoteLegend and schedule; both are derived from the\n' +
'marks you set, so mark the parts you want listed. details are cross reference\n' +
'bubbles in paper inches on this sheet pointing at a view on another sheet.\n' +
'Omit sheets entirely for a single drawing.';

export const AI_SPEC = AI_SCHEMA_SPEC;

function snap6(x, y){ return snapGrid(x, y, 0.5); }

export const DRAWING_TYPES = ['plan', 'elevation', 'section', 'part', 'diagram'];

/* Resolve the model's drawingType. Missing or unrecognized values fall back to
 * plan, so existing plan behavior stays the default.
 */
export function normalizeDrawingType(v){
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return DRAWING_TYPES.indexOf(s) >= 0 ? s : 'plan';
}

export function serializeForAI(entities){
  const out = [];
  const r2 = v => Math.round(v * 100) / 100;
  const walls = entities.filter(e => e.kind === 'wall' && e.role === 'a');
  if (walls.length){
    walls.forEach(e => out.push('wall ' + r2(e.x1) + ',' + r2(e.y1) + ' ' + r2(e.x2) + ',' + r2(e.y2) + ' th' + r2(e.th || 0.5)));
  }
  for (const e of entities){
    if (e.kind === 'wall') continue;
    if (e.type === 'line') out.push('l ' + e.layer + ' ' + r2(e.x1) + ',' + r2(e.y1) + ' ' + r2(e.x2) + ',' + r2(e.y2));
    else if (e.type === 'circle') out.push('c ' + e.layer + ' ' + r2(e.cx) + ',' + r2(e.cy) + ' r' + r2(e.r));
    else if (e.type === 'arc') out.push('a ' + e.layer + ' ' + r2(e.cx) + ',' + r2(e.cy) + ' r' + r2(e.r) + ' ' + Math.round(e.a1) + '-' + Math.round(e.a2));
    else if (e.type === 'poly') out.push('p ' + e.layer + (e.closed ? ' closed ' : ' ') + e.pts.map(p => r2(p[0]) + ',' + r2(p[1])).join(' '));
    else if (e.type === 'text') out.push('x ' + e.layer + ' ' + r2(e.x) + ',' + r2(e.y) + ' "' + (e.content || '') + '"');
    else if (e.type === 'dim') out.push('d ' + r2(e.x1) + ',' + r2(e.y1) + ' ' + r2(e.x2) + ',' + r2(e.y2));
    else if (e.type === 'hatch') out.push('h ' + (e.pattern || 'ANSI31') + ' ' + (e.pts || []).map(p => r2(p[0]) + ',' + r2(p[1])).join(' '));
    else if (e.type === 'insert') out.push('insert ' + (e.def || e.name || 'block') + ' ' + r2(e.x) + ',' + r2(e.y) + (e.width ? (' w' + r2(e.width)) : '') + ' r' + Math.round(e.rot || 0));
  }
  let s = out.join('\n');
  if (s.length > 7000) s = s.slice(0, 7000) + '\n(truncated)';
  return s;
}

function num(v){ v = Number(v); return isFinite(v) ? v : 0; }

/* Copy a mark and attributes onto a realized entity. Absent stays absent, so
 * an unmarked entity serializes exactly as it did before marks existed. */
function applyMark(ent, src){
  if (!src) return ent;
  if (src.mark) ent.mark = String(src.mark).toUpperCase().slice(0, 12);
  const a = src.attrs || src.attributes;
  if (a && typeof a === 'object'){
    const out = {};
    Object.keys(a).forEach(k => {
      const v = a[k];
      if (v == null || v === '') return;
      out[String(k).slice(0, 24)] = typeof v === 'number' ? v : String(v).slice(0, 64);
    });
    if (Object.keys(out).length) ent.attributes = out;
  }
  return ent;
}

export function namedInPrompt(prompt, value){
  if (!value) return false;
  const p = String(prompt || '').toLowerCase();
  const v = String(value).toLowerCase().trim();
  if (v.length < 3) return false;
  return p.indexOf(v) >= 0;
}

/* Drop materials the user did not name. A schedule that lists AL-LI 2198
 * because the model guessed is a lie. */
export function scrubInventedMaterials(entities, prompt){
  if (prompt == null) return entities;
  (entities || []).forEach(e => {
    if (!e.attributes || e.attributes.material == null || e.attributes.material === '') return;
    const m = String(e.attributes.material);
    if (namedInPrompt(prompt, m)) return;
    const first = m.split(/[/,]/)[0].trim();
    if (first.length >= 4 && namedInPrompt(prompt, first)) return;
    e.attributes.materialInvented = true;
    delete e.attributes.material;
  });
  return entities;
}

export function extractItems(text){
  const r = extractResponse(text);
  if (r.legacy){
    if (!r.items.length) throw new Error('Empty drawing returned');
    return r.items;
  }
  return r.items || [];
}

export function extractResponse(text){
  text = String(text || '').replace(/```json|```/g, '').trim();
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in response');
  const obj = JSON.parse(text.slice(first, last + 1));
  if (Array.isArray(obj.e) || Array.isArray(obj.entities)){
    return { legacy: true, items: obj.e || obj.entities, raw: obj };
  }
  if (obj.walls || obj.rooms || obj.fixtures || obj.dims || obj.openings || obj.drawingType){
    obj.drawingType = normalizeDrawingType(obj.drawingType);
    return { legacy: false, schema: obj, raw: obj };
  }
  throw new Error('Empty drawing returned');
}

export function realizeResponse(text, ensureLayer, opts){
  const extracted = extractResponse(text);
  if (extracted.legacy) return itemsToEntities(extracted.items, ensureLayer);
  const ents = schemaToEntities(extracted.schema, ensureLayer);
  scrubInventedMaterials(ents, opts && opts.prompt);
  return ents;
}

/* Legacy raw-item converter kept so existing tests (and older model replies) still work. */
export function itemsToEntities(items, ensureLayer){
  const fresh = [];
  for (const it of items){
    if (!it || !it.t || !it.a) continue;
    const ly = ensureLayer(it.ly);
    const a = it.a;
    try {
      if (it.t === 'l' && a.length >= 4) fresh.push({ type: 'line', layer: ly, x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]) });
      else if (it.t === 'c' && a.length >= 3) fresh.push({ type: 'circle', layer: ly, cx: num(a[0]), cy: num(a[1]), r: Math.abs(num(a[2])) || 0.5 });
      else if (it.t === 'a' && a.length >= 5) fresh.push({ type: 'arc', layer: ly, cx: num(a[0]), cy: num(a[1]), r: Math.abs(num(a[2])) || 0.5, a1: num(a[3]), a2: num(a[4]) });
      else if (it.t === 'p' && Array.isArray(a) && a.length >= 2){
        const pts = [];
        for (const p of a){ if (Array.isArray(p) && p.length >= 2) pts.push([num(p[0]), num(p[1])]); }
        if (pts.length >= 2) fresh.push({ type: 'poly', layer: ly, closed: !!it.cl, pts });
      }
      else if (it.t === 'x' && a.length >= 2) fresh.push({ type: 'text', layer: 'TEXT', x: num(a[0]), y: num(a[1]), size: clamp(num(a[2]) || 1.2, 0.5, 4), content: String(it.s || '') });
      else if (it.t === 'd' && a.length >= 4) fresh.push({ type: 'dim', layer: 'DIMS', x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]), off: 2 });
    } catch (e){ /* skip malformed item */ }
  }
  if (!fresh.length) throw new Error('Nothing drawable in the response');
  const bb = [1e9, 1e9, -1e9, -1e9];
  fresh.forEach(e => { if (e.type !== 'dim') entBBox(e, bb); });
  if (bb[0] < 1e8){
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    fresh.forEach(e => {
      if (e.type !== 'dim') return;
      const g1 = dimGeom(e);
      e.off = -e.off; const g2 = dimGeom(e); e.off = -e.off;
      const d1 = dist(g1.mid[0], g1.mid[1], cx, cy), d2 = dist(g2.mid[0], g2.mid[1], cx, cy);
      if (d2 > d1) e.off = -e.off;
    });
  }
  return fresh;
}

/* Realize a constrained schema into entities. Never mutates existing ones. */
export function schemaToEntities(schema, ensureLayer){
  const fresh = [];
  /* One resolved value drives every downstream pass. */
  const drawingType = normalizeDrawingType(schema.drawingType);
  const rules = rulesFor(drawingType);
  /* Hard gate, not a prompt request: a model that ignores the schema still
   * cannot put a wall, door or window on an elevation, part or diagram. */
  const rawWalls = Array.isArray(schema.walls) ? schema.walls : [];
  const rawOpenings = Array.isArray(schema.openings) ? schema.openings : [];
  if (!rules.building && (rawWalls.length || rawOpenings.length)){
    console.warn('[ai] dropped ' + rawWalls.length + ' wall(s) and ' + rawOpenings.length +
      ' opening(s): not valid on a ' + drawingType);
  }
  const walls = rules.building ? rawWalls : [];
  const wallGroups = [];
  walls.forEach((w, i) => {
    if (!w || !w.a || w.a.length < 4) return;
    let [x1, y1] = snap6(num(w.a[0]), num(w.a[1]));
    let [x2, y2] = snap6(num(w.a[2]), num(w.a[3]));
    if (dist(x1, y1, x2, y2) < 0.4) return;
    const th = [4 / 12, 6 / 12, 8 / 12].reduce((best, t) => Math.abs((w.th || 0.5) - t) < Math.abs((w.th || 0.5) - best) ? t : best, 0.5);
    const ly = ensureLayer('WALLS');
    const frags = wallFrags(x1, y1, x2, y2, th, ly);
    const g = 'aiw' + i;
    frags.forEach(f => { f.g = g; });
    wallGroups.push({ g, members: frags, a: [x1, y1, x2, y2], th });
    fresh.push(...frags);
  });

  /* Fillet adjacent wall centerlines that share an endpoint (r = 0 → clean corner). */
  for (let i = 0; i < wallGroups.length; i++){
    for (let j = i + 1; j < wallGroups.length; j++){
      const A = wallGroups[i].a, B = wallGroups[j].a;
      const endsA = [[A[0], A[1]], [A[2], A[3]]];
      const endsB = [[B[0], B[1]], [B[2], B[3]]];
      let share = false;
      for (const p of endsA) for (const q of endsB) if (dist(p[0], p[1], q[0], q[1]) < 0.6) share = true;
      if (!share) continue;
      const la = wallGroups[i].members.find(m => m.role === 'a');
      const lb = wallGroups[j].members.find(m => m.role === 'a');
      if (!la || !lb) continue;
      const res = filletLines(la, lb, 0);
      if (res.ok){
        /* Apply trim-to-corner on the outer faces too (best-effort). */
        res.replace.forEach(p => {
          const idx = fresh.indexOf(p.orig);
          if (idx >= 0) fresh[idx] = p.ents[0];
        });
      }
    }
  }

  const openings = rules.building ? rawOpenings : [];
  openings.forEach(o => {
    if (!o) return;
    const wg = wallGroups[o.wall];
    if (!wg) return;
    const t = clamp(num(o.t), 0.15, 0.85);
    const w = Math.max(1.5, num(o.w) || 3);
    const cl = { x1: wg.a[0], y1: wg.a[1], x2: wg.a[2], y2: wg.a[3], th: wg.th, layer: 'WALLS' };
    const kind = o.kind === 'window' ? 'window' : 'door';
    const ins = makeInsert({
      def: kind,
      name: kind === 'window' ? 'Window' : 'Door',
      layer: 'DOORS',
      width: w,
      swing: rules.doorSwings ? (o.swing === 'R' ? 'R' : 'L') : null,
      noSwing: !rules.doorSwings,
      host: wg.g, t, cl, th: wg.th
    });
    locateInsert(ins, cl);
    fresh.push(ins);
    wg.inserts = (wg.inserts || []).concat([ins]);
    wg.members.forEach(m => {
      const idx = fresh.indexOf(m);
      if (idx >= 0) fresh.splice(idx, 1);
    });
    const add = wallWithOpenings(cl, wg.inserts.map(e => ({ t: e.t, width: e.width || 3 })));
    add.forEach(f => { f.g = wg.g; fresh.push(f); });
    wg.members = add;
  });

  (rules.building ? (schema.fixtures || []) : []).forEach(fx => {
    const name = (SYMBOLS.find(s => s.name.toLowerCase() === String(fx.kind || '').toLowerCase()) || {}).name;
    if (!name) return;
    const [x, y] = snap6(num(fx.x), num(fx.y));
    fresh.push(applyMark(makeInsert({
      def: 'sym:' + name,
      name,
      layer: 'FIXTURES',
      x, y,
      rot: num(fx.rot) || 0
    }), fx));
  });

  /* The geometry pass emits no text. A room entity carries its own single
   * label, so a name is never stamped twice. */
  (rules.roomLabels ? (schema.rooms || []) : []).forEach(r => {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 3) return;
    const pts = r.pts.map(p => snap6(num(p[0]), num(p[1])));
    if (rules.impliedHatch){
      const h = makeHatch(pts, { layer: ensureLayer('HATCH'), pattern: 'ANSI31' });
      if (h) fresh.push(h);
    }
    const c = polyCentroid(pts);
    fresh.push({
      type: 'room', layer: ensureLayer('ROOMS'),
      name: String(r.name || 'ROOM').toUpperCase(),
      pts, cx: c[0], cy: c[1],
      area: rules.areaTags ? polygonArea(pts) : 0
    });
  });

  /* Explicit regions are the only hatch a section or part ever gets. */
  (schema.hatchRegions || []).forEach(hr => {
    if (!hr || !Array.isArray(hr.pts) || hr.pts.length < 3) return;
    fresh.push({
      type: 'hatchRegion', layer: ensureLayer('HATCH'),
      pts: hr.pts.map(p => snap6(num(p[0]), num(p[1]))),
      pattern: String(hr.pattern || 'ANSI31'),
      explicit: true
    });
  });

  (schema.profiles || []).forEach(pr => {
    if (!pr || !Array.isArray(pr.pts) || pr.pts.length < 3) return;
    /* A profile is an outline. It only carries a fill where the drawing type
     * allows implied hatch, so an elevation or a part stays unfilled unless an
     * explicit hatchRegion asked for one. */
    if (pr.fill && !rules.impliedHatch){
      console.warn('[ai] dropped fill on a profile: not valid on a ' + drawingType);
    }
    fresh.push(applyMark({
      type: 'profile', layer: ensureLayer('PROFILE'),
      pts: pr.pts.map(p => snap6(num(p[0]), num(p[1]))),
      fill: rules.impliedHatch ? (pr.fill || null) : null
    }, pr));
  });

  (schema.centerlines || []).forEach(cn => {
    if (!cn || !Array.isArray(cn.pts) || cn.pts.length < 2) return;
    fresh.push({
      type: 'centerline', layer: ensureLayer('DEFPOINTS'),
      pts: cn.pts.map(p => snap6(num(p[0]), num(p[1])))
    });
  });

  /* Dimensions: the chain is reconciled before anything is drawn, so the
   * overall always equals the sum of its segments. */
  if (rules.dims){
    const segs = [];
    (schema.dims || []).forEach(d => {
      if (!d || !d.a || d.a.length < 4) return;
      const a = snap6(num(d.a[0]), num(d.a[1]));
      const b = snap6(num(d.a[2]), num(d.a[3]));
      if (dist(a[0], a[1], b[0], b[1]) < 0.5) return;
      segs.push({ a, b });
    });
    closeDimChains(segs).forEach(sg => fresh.push(alignedDim(sg.a, sg.b, 2)));
  }

  /* Labels last, so dimensions and each other are already on the sheet to test
   * against. Centroid first, then outside the extents with a leader, stepping
   * to the next free side on collision. Text never lands on a dim line. */
  const labelExt = [1e9, 1e9, -1e9, -1e9];
  fresh.forEach(e => entBBox(e, labelExt));
  const taken = labelExt[0] < 1e8 ? dimObstacles(fresh.filter(e => e.type === 'dim')) : [];
  const ext = labelExt[0] < 1e8 ? labelExt : [0, 0, 1, 1];

  fresh.filter(e => e.type === 'room').forEach(r => {
    const label = r.name + (r.area ? '  ' + Math.round(r.area) + ' SF' : '');
    const spot = placeLabel({ content: label, size: 1.0, pts: r.pts, obstacles: taken, extents: ext, anchor: [r.cx, r.cy] });
    taken.push(spot.box);
    /* expandRoom draws the label from cx/cy, so steer it rather than adding text. */
    r.cx = spot.x + 1.6;
    r.cy = spot.y + 0.3;
  });

  (rules.callouts ? (schema.callouts || []) : []).forEach(co => {
    if (!co) return;
    const content = String(co.text || co.content || '').trim();
    if (!content) return;
    const src = Array.isArray(co.anchor) ? co.anchor : (Array.isArray(co.pts) && co.pts.length ? co.pts[0] : null);
    if (!src) return;
    const anchor = snap6(num(src[0]), num(src[1]));
    const spot = placeLabel({ content, size: 0.8, pts: [], obstacles: taken, extents: ext, anchor });
    taken.push(spot.box);
    fresh.push(applyMark({
      type: 'callout', layer: ensureLayer('NOTES'),
      anchor, pts: spot.leader || [anchor, [spot.x, spot.y]],
      content, textH: 0.8
    }, co));
  });

  /* Nothing downstream may reintroduce a fill the drawing type forbids. */
  assertNoImpliedFill(fresh, drawingType);

  if (!fresh.length) throw new Error('Nothing drawable in the response');

  const bb = [1e9, 1e9, -1e9, -1e9];
  fresh.forEach(e => { if (e.type !== 'dim') entBBox(e, bb); });
  if (bb[0] < 1e8){
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    fresh.forEach(e => {
      if (e.type !== 'dim') return;
      const g1 = dimGeom(e);
      e.off = -e.off; const g2 = dimGeom(e); e.off = -e.off;
      const d1 = dist(g1.mid[0], g1.mid[1], cx, cy), d2 = dist(g2.mid[0], g2.mid[1], cx, cy);
      if (d2 > d1) e.off = -e.off;
    });
  }
  return fresh;
}

async function callAnthropic({ prompt, contextText, apiKey, model }){
  const sys = AI_SCHEMA_SPEC + (contextText
    ? '\n\nCURRENT DRAWING (read only, same units, do not repeat these entities, align new work to them):\n' + contextText + '\n\nAdd entities that extend this drawing. Additions only. Never delete.'
    : '') + '\n\nREQUEST: ' + prompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: sys }]
    })
  });
  if (res.status === 401){ const err = new Error('API key rejected'); err.status = 401; throw err; }
  if (res.status === 429){ const err = new Error('Rate limited'); err.status = 429; throw err; }
  if (!res.ok){
    const t = await res.text().catch(() => '');
    const err = new Error('Anthropic HTTP ' + res.status + (t ? ': ' + t.slice(0, 180) : ''));
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (body.stop_reason === 'refusal') throw new Error('The model declined this request');
  return (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

export async function generateDraft({ prompt, contextText, apiKey, model }){
  if (!apiKey) throw new Error('Add your Anthropic API key in AI settings first');
  let text;
  try {
    text = await callAnthropic({ prompt, contextText, apiKey, model });
    extractResponse(text);
    return text;
  } catch (err){
    if (err && err.status) throw err;
    /* Retry once on invalid JSON. */
    text = await callAnthropic({
      prompt: prompt + '\n\nYour previous reply was not valid JSON matching the schema. Reply with ONLY the JSON object.',
      contextText, apiKey, model
    });
    extractResponse(text);
    return text;
  }
}


/* ---------- sheet set ---------- */

/* "1/16", "1/4\" = 1'-0\"" or 18 all resolve to points per model foot. */
export function parseScale(v){
  if (typeof v === 'number' && isFinite(v) && v > 0){
    return nearestPlotScale(v);
  }
  const s = String(v == null ? '' : v).trim();
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac){
    const inches = Number(frac[1]) / Number(frac[2]);
    if (inches > 0) return nearestPlotScale(inches * 72);
  }
  const whole = s.match(/^(\d+(?:\.\d+)?)/);
  if (whole){
    const n = Number(whole[1]);
    /* A bare small number is inches per foot; a large one is already ppf. */
    return nearestPlotScale(n <= 4 ? n * 72 : n);
  }
  return 18;
}

function nearestPlotScale(ppf){
  let best = PLOT_SCALES[0].ppf, bestD = Infinity;
  PLOT_SCALES.forEach(s => {
    const d = Math.abs(s.ppf - ppf);
    if (d < bestD){ bestD = d; best = s.ppf; }
  });
  return best;
}

function sheetSizeKey(v){
  const s = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
  if (s.indexOf('tabloid') >= 0 || s === 'b') return 'tabloid';
  if (s.indexOf('letter') >= 0 || s === 'a') return 'letter';
  if (s.indexOf('portrait') >= 0) return 'archdp';
  if (SHEETS[s]) return s;
  return 'archd';
}

/* Turn the model's sheet proposals into real sheets, with views windowed onto
 * geometry that already exists. Nothing is redrawn. */
export function schemaToSheets(schema, entities){
  const proposals = Array.isArray(schema && schema.sheets) ? schema.sheets : [];
  if (!proposals.length) return [];
  const all = membersBBox(entities.length ? entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);

  const built = proposals.slice(0, 12).map((sp, i) => {
    const size = sheetSizeKey(sp && sp.size);
    const number = (sp && sp.number) ? String(sp.number).toUpperCase().slice(0, 8) : defaultSheetNumber(i);
    const views = Array.isArray(sp && sp.views) && sp.views.length ? sp.views : [{}];
    const layout = makeLayout({
      id: 'AI' + number.replace(/[^A-Za-z0-9]/g, ''),
      name: (sp && sp.name) ? String(sp.name).toUpperCase().slice(0, 40) : number,
      sheet: size,
      ppf: parseScale(views[0] && views[0].scale)
    });
    layout.sheetNumber = number;
    layout.viewports = views.slice(0, 4).map((v, vi) => {
      const vp = makeViewport(size, parseScale(v && v.scale));
      /* Stack views down the sheet so they do not sit on top of each other. */
      if (views.length > 1){
        const base = makeViewport(size, vp.ppf);
        vp.ph = base.ph / views.length;
        vp.py = base.py + (views.length - 1 - vi) * vp.ph;
      }
      const ext = Array.isArray(v && v.extents) && v.extents.length >= 4
        ? [num(v.extents[0]), num(v.extents[1]), num(v.extents[2]), num(v.extents[3])]
        : all;
      const win = [Math.min(ext[0], ext[2]), Math.min(ext[1], ext[3]), Math.max(ext[0], ext[2]), Math.max(ext[1], ext[3])];
      if (v && v.scale){
        /* Honor the scale the model asked for and centre on the extents. */
        vp.mx = (win[0] + win[2]) / 2;
        vp.my = (win[1] + win[3]) / 2;
      } else {
        fitViewport(vp, win);
      }
      vp.name = (v && v.name) ? String(v.name).toUpperCase().slice(0, 40) : null;
      vp.drawingType = normalizeDrawingType(v && v.drawingType ? v.drawingType : schema.drawingType);
      return vp;
    });
    return layout;
  });

  const sheets = normalizeSheets(built);

  /* Derived annotations, scoped per sheet. Both read the marks already set. */
  const withAnnotations = sheets.map((sheet, i) => {
    const wanted = (proposals[i] && proposals[i].annotations) || [];
    let out = sheet;
    (Array.isArray(wanted) ? wanted : [wanted]).forEach(w => {
      const kind = String(w || '').toLowerCase();
      if (kind.indexOf('keynote') >= 0 || kind.indexOf('legend') >= 0){
        const rows = keynoteRows(entities, out);
        if (!rows.length) return;
        const colW = paperKeynoteColW();
        const t = buildKeynoteLegend(entities, out, [0, 0], { colW });
        t.rowH = 0.22;
        const slot = placeInMargin(out, [colW.reduce((a,b)=>a+b,0), (t.cells.length + 1) * 0.22]);
        if (slot) out = addAnnotation(out, makeTableAnnotation(slot.x, slot.y, t));
      } else if (kind.indexOf('sched') >= 0){
        if (!collectMarks(entities).length) return;
        const cols = attributeKeys(entities).slice(0, 3);
        const t = buildMarkSchedule(entities, out, [0, 0], {
          columns: cols.length ? cols : undefined,
          colW: paperScheduleColW(cols.length ? cols : undefined)
        });
        t.rowH = 0.22;
        const size = [t.colW.reduce((a, b) => a + b, 0), (t.cells.length + 1) * t.rowH];
        const slot = placeInMargin(out, size);
        if (slot) out = addAnnotation(out, makeTableAnnotation(slot.x, slot.y, t));
      }
    });
    return out;
  });

  return attachDetails(withAnnotations, proposals);
}

/* Cross references are resolved after every sheet exists, so a bubble on A-1
 * can point at A-2 even though A-2 was not built yet when A-1 was read. */
function attachDetails(sheets, proposals){
  const byNumber = {};
  sheets.forEach(s => { byNumber[String(s.sheetNumber).toUpperCase()] = s.id; });
  return sheets.map((sheet, i) => {
    const wanted = (proposals[i] && proposals[i].details) || [];
    let out = sheet;
    (Array.isArray(wanted) ? wanted : []).slice(0, 12).forEach(d => {
      if (!d) return;
      const sheetId = byNumber[String(d.sheet || d.sheetNumber || '').toUpperCase()];
      if (!sheetId) return;
      const viewId = Number(d.view != null ? d.view : d.viewId) || 1;
      out = addAnnotation(out, makeDetailCallout(num(d.x), num(d.y), { sheetId, viewId }));
    });
    return out;
  });
}

/* The document the model returned: geometry plus an optional sheet set.
 * realizeResponse stays entity only so existing callers are untouched. */
export function realizeDocument(text, ensureLayer, opts){
  const extracted = extractResponse(text);
  if (extracted.legacy){
    return { entities: itemsToEntities(extracted.items, ensureLayer), sheets: [], drawingType: 'plan' };
  }
  const schema = extracted.schema;
  const entities = schemaToEntities(schema, ensureLayer);
  scrubInventedMaterials(entities, opts && opts.prompt);
  return {
    entities,
    sheets: schemaToSheets(schema, entities),
    drawingType: normalizeDrawingType(schema.drawingType)
  };
}
