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
import { rulesFor, closeDimChains, placeLabel, textBox, dimObstacles, polygonArea, centroidOf } from '../core/annotate.js';

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
'Units are decimal feet. Y axis points up. Origin near (0,0). All coordinates >= 0.\n' +
'walls: centerlines. th is thickness in feet (0.333, 0.5 or 0.667). Close exterior loops.\n' +
'openings: wall is the 0-based index into walls; t is 0..1 along the centerline; w is opening width in feet.\n' +
'fixtures.kind must be one of the names above. rot is degrees CCW.\n' +
'rooms: closed polygon of interior corners (not wall centerlines). One hatch + label per room.\n' +
'dims: overall exterior dimensions and major room sizes. 4 to 10 of them.\n' +
'Stay under 40 walls. Do not emit raw leftover lines. Output must be valid JSON.';

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

export function realizeResponse(text, ensureLayer){
  const extracted = extractResponse(text);
  if (extracted.legacy) return itemsToEntities(extracted.items, ensureLayer);
  return schemaToEntities(extracted.schema, ensureLayer);
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
    fresh.push(makeInsert({
      def: 'sym:' + name,
      name,
      layer: 'FIXTURES',
      x, y,
      rot: num(fx.rot) || 0
    }));
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
      pattern: String(hr.pattern || 'ANSI31')
    });
  });

  (schema.profiles || []).forEach(pr => {
    if (!pr || !Array.isArray(pr.pts) || pr.pts.length < 3) return;
    fresh.push({
      type: 'profile', layer: ensureLayer('PROFILE'),
      pts: pr.pts.map(p => snap6(num(p[0]), num(p[1]))),
      fill: pr.fill || null
    });
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
    fresh.push({
      type: 'callout', layer: ensureLayer('NOTES'),
      anchor, pts: spot.leader || [anchor, [spot.x, spot.y]],
      content, textH: 0.8
    });
  });

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
