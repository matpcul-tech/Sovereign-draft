/* AI drafting: turn a description into blueprint geometry via the Anthropic
 * API. The user supplies their own API key (Settings sheet); requests go
 * directly from the browser to api.anthropic.com.
 */
import Anthropic from '@anthropic-ai/sdk';
import { clamp } from '../core/geometry.js';
import { entBBox } from '../core/entities.js';
import { dimGeom, dist } from '../core/geometry.js';

export const AI_SPEC =
'You are the drafting engine inside a professional 2D CAD application. Convert the request into blueprint geometry.\n' +
'Respond with ONLY minified JSON, no markdown, no code fences, no commentary. Schema: {"e":[items]} where each item is one of:\n' +
'{"t":"l","ly":LAYER,"a":[x1,y1,x2,y2]} line\n' +
'{"t":"c","ly":LAYER,"a":[cx,cy,r]} circle\n' +
'{"t":"a","ly":LAYER,"a":[cx,cy,r,startDeg,endDeg]} arc, counterclockwise\n' +
'{"t":"p","ly":LAYER,"a":[[x,y],[x,y],...],"cl":1} polyline, cl 1 means closed\n' +
'{"t":"x","ly":"TEXT","a":[x,y,h],"s":"LABEL"} text, h is height in feet, 1 to 1.5\n' +
'{"t":"d","ly":"DIMS","a":[x1,y1,x2,y2]} linear dimension between two points\n' +
'Units are feet, decimals allowed. Y axis points up. Keep all coordinates at 0 or greater with the drawing near the origin.\n' +
'Layers: WALLS, DOORS, FIXTURES, DIMS, TEXT.\n' +
'Draft to professional drafting standards: exterior and interior walls as parallel double lines 0.5 ft apart on WALLS; door openings as a gap in the wall with the leaf as a line and a 90 degree swing arc on DOORS; fixtures simplified (sink as small rect, toilet as rect plus circle, stove and fridge as labeled rects) on FIXTURES; room name labels on TEXT centered in each room; overall exterior dimensions only, 2 to 4 of them, on DIMS.\n' +
'Stay under 60 items total. Favor polylines over many short lines. Output must be valid JSON.';

/* Compact plain-text serialization of the current drawing for sheet context. */
export function serializeForAI(entities){
  const out = [];
  const r2 = v => Math.round(v * 100) / 100;
  for (const e of entities){
    if (e.type === 'line') out.push('l ' + e.layer + ' ' + r2(e.x1) + ',' + r2(e.y1) + ' ' + r2(e.x2) + ',' + r2(e.y2));
    else if (e.type === 'circle') out.push('c ' + e.layer + ' ' + r2(e.cx) + ',' + r2(e.cy) + ' r' + r2(e.r));
    else if (e.type === 'arc') out.push('a ' + e.layer + ' ' + r2(e.cx) + ',' + r2(e.cy) + ' r' + r2(e.r) + ' ' + Math.round(e.a1) + '-' + Math.round(e.a2));
    else if (e.type === 'poly') out.push('p ' + e.layer + (e.closed ? ' closed ' : ' ') + e.pts.map(p => r2(p[0]) + ',' + r2(p[1])).join(' '));
    else if (e.type === 'text') out.push('x ' + e.layer + ' ' + r2(e.x) + ',' + r2(e.y) + ' "' + (e.content || '') + '"');
    else if (e.type === 'dim') out.push('d ' + r2(e.x1) + ',' + r2(e.y1) + ' ' + r2(e.x2) + ',' + r2(e.y2));
  }
  let s = out.join('\n');
  if (s.length > 7000) s = s.slice(0, 7000) + '\n(truncated)';
  return s;
}

function num(v){ v = Number(v); return isFinite(v) ? v : 0; }

/* Convert response items into entity objects (no ids). ensureLayer(name)
 * canonicalizes/creates layers. Throws when nothing is drawable.
 */
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
  // Flip each dimension outward, away from the drawing's center of mass.
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

/* Pull the item list out of a model response that should be JSON but may be
 * wrapped in fences or prose.
 */
export function extractItems(text){
  text = text.replace(/```json|```/g, '').trim();
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in response');
  const obj = JSON.parse(text.slice(first, last + 1));
  const items = obj.e || obj.entities || [];
  if (!items.length) throw new Error('Empty drawing returned');
  return items;
}

/* Call the API. Returns the raw item list. */
export async function generateDraft({ prompt, contextText, apiKey, model }){
  if (!apiKey) throw new Error('Add your Anthropic API key in AI settings first');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  let msg = AI_SPEC;
  if (contextText){
    msg += '\n\nCURRENT DRAWING (read only, same units and layers, do not repeat these entities, align new work to them):\n' + contextText;
    msg += '\n\nAdd entities that extend or modify this drawing per the request. Additions only.';
  }
  msg += '\n\nREQUEST: ' + prompt;

  const params = {
    model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: msg }]
  };
  let response;
  if (model === 'claude-opus-5'){
    // Server-side refusal fallbacks: if a safety classifier declines, the API
    // re-runs the request on a fallback model inside the same call.
    response = await client.beta.messages.create({
      ...params,
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01']
    });
  } else {
    response = await client.messages.create(params);
  }
  if (response.stop_reason === 'refusal') throw new Error('The model declined this request');
  const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractItems(text);
}
