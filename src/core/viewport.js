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

export function zoomFit(){
  if (!state.entities.length){ homeView(); return; }
  const bb = membersBBox(state.entities);
  const w = Math.max(bb[2] - bb[0], 1), h = Math.max(bb[3] - bb[1], 1);
  state.view.scale = clamp(Math.min((vp.CW - 60) / w, (vp.CH - 220) / h), 2, 300);
  state.view.x = (bb[0] + bb[2]) / 2;
  state.view.y = (bb[1] + bb[3]) / 2 - 30 / state.view.scale;
}

export function zoomAt(sx, sy, factor){
  const w = S2W(sx, sy);
  state.view.scale = clamp(state.view.scale * factor, 1.2, 400);
  state.view.x = w[0] - (sx - vp.CW / 2) / state.view.scale;
  state.view.y = w[1] - (vp.CH / 2 - sy) / state.view.scale;
}
