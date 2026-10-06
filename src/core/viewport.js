/* Screen/world mapping. Screen Y grows down, world Y grows up. */
import { state } from './state.js';
import { clamp } from './geometry.js';
import { membersBBox } from './entities.js';

export const vp = { CW: 0, CH: 0, DPR: 1 };

export function W2S(x, y){
  return [(x - state.view.x) * state.view.scale + vp.CW / 2, vp.CH / 2 - (y - state.view.y) * state.view.scale];
}
export function S2W(sx, sy){
  return [state.view.x + (sx - vp.CW / 2) / state.view.scale, state.view.y + (vp.CH / 2 - sy) / state.view.scale];
}

export function homeView(){
  state.view.scale = 26;
  state.view.x = (vp.CW / 2 - 60) / state.view.scale;
  state.view.y = (vp.CH / 2 - 130) / state.view.scale;
}

/* The canvas runs under the top bar and command line and under the
 * toolbars at the bottom. A fit that ignores them hides a starter's note
 * under the top bar on a phone. In the browser the free band is measured
 * from the page; elsewhere it falls back to the old fixed margins. */
export function freeBand(){
  let top = 80, bottom = vp.CH - 140;
  if (typeof document === 'undefined' || !document.getElementById) return { top, bottom };
  const cv = document.getElementById('cv');
  const y0 = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect().top : 0;
  const shown = el => el && el.getBoundingClientRect && el.getClientRects().length > 0 &&
    getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  let t = 0, b = vp.CH, seen = false;
  ['topbar', 'cmdline'].forEach(id => {
    const el = document.getElementById(id);
    if (shown(el)){ const r = el.getBoundingClientRect(); if (r.height) { t = Math.max(t, r.bottom - y0); seen = true; } }
  });
  ['bottom', 'statusbar'].forEach(id => {
    const el = document.getElementById(id);
    if (shown(el)){ const r = el.getBoundingClientRect(); if (r.height) { b = Math.min(b, r.top - y0); seen = true; } }
  });
  if (!seen || b - t < 80) return { top, bottom };
  return { top: t, bottom: b };
}

export function zoomFit(){
  if (!state.entities.length){ homeView(); return; }
  const bb = membersBBox(state.entities);
  const w = Math.max(bb[2] - bb[0], 1), h = Math.max(bb[3] - bb[1], 1);
  const band = freeBand();
  const pad = 18;
  state.view.scale = clamp(Math.min((vp.CW - 2 * pad - 24) / w, (band.bottom - band.top - 2 * pad) / h), 2, 300);
  state.view.x = (bb[0] + bb[2]) / 2;
  /* put the middle of the drawing in the middle of the free band */
  state.view.y = (bb[1] + bb[3]) / 2 - (vp.CH / 2 - (band.top + band.bottom) / 2) / state.view.scale;
}

/* Fit the building itself: walls (with a margin for the dims that hug
 * them), not the schedule tables and legends parked off to the side.
 * Falls back to the plain fit when there are no walls to speak of. */
export function zoomToPlan(){
  const core = state.entities.filter(e =>
    e.layer === 'WALLS' || e.layer === 'DOORS' || e.layer === 'WINDOWS' || e.type === 'room');
  if (!core.length){ zoomFit(); return; }
  const bb = membersBBox(core);
  if (!(bb[0] < 1e8)){ zoomFit(); return; }
  const pad = Math.max(4, (bb[2] - bb[0]) * 0.16);
  const w = Math.max(bb[2] - bb[0] + pad * 2, 1), h = Math.max(bb[3] - bb[1] + pad * 2, 1);
  const band = freeBand();
  state.view.scale = clamp(Math.min((vp.CW - 40) / w, (band.bottom - band.top) / h), 2, 300);
  state.view.x = (bb[0] + bb[2]) / 2;
  state.view.y = (bb[1] + bb[3]) / 2 - (vp.CH / 2 - (band.top + band.bottom) / 2) / state.view.scale;
}

export function zoomAt(sx, sy, factor){
  const w = S2W(sx, sy);
  state.view.scale = clamp(state.view.scale * factor, 1.2, 400);
  state.view.x = w[0] - (sx - vp.CW / 2) / state.view.scale;
  state.view.y = w[1] - (vp.CH / 2 - sy) / state.view.scale;
}
