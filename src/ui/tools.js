import { state } from '../core/state.js';
import { cancelPoly } from '../actions.js';
import { markActiveTool, syncCtx, setPrompt } from './chips.js';
import { openSheet } from './sheets.js';
import { renderSymbols } from './symbolsPanel.js';
import { defaultPrompt } from '../core/command.js';
import { ix } from '../interaction.js';

export function setTool(t){
  if (t === 'view3d'){
    try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ }
    return;
  }
  if ((state.tool === 'poly' || state.tool === 'hatch' || state.tool === 'cloud' || state.tool === 'leader' || state.tool === 'spline') && t !== state.tool) cancelPoly(true);
  if (t && t !== 'select' && t !== 'pan') state.lastTool = t;
  state.tool = t;
  if (t !== 'select') state.boxMode = false;
  if (t === 'wall') state.wallMode = true;
  ix.modA = null; ix.arcPts = [];
  markActiveTool();
  if (t === 'symbol'){ renderSymbols(); openSheet('sheetSymbols'); }
  if (t === 'image'){
    const f = document.getElementById('fileImage');
    if (f) f.click();
  }
  setPrompt(defaultPrompt(t, state));
  syncCtx();
}
