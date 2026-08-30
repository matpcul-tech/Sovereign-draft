import { state } from '../core/state.js';
import { cancelPoly } from '../actions.js';
import { markActiveTool, syncCtx, setPrompt } from './chips.js';
import { openSheet } from './sheets.js';
import { renderSymbols } from './symbolsPanel.js';
import { defaultPrompt } from '../core/command.js';
import { ix } from '../interaction.js';

export function setTool(t){
  if ((state.tool === 'poly' || state.tool === 'hatch') && t !== state.tool) cancelPoly(true);
  state.tool = t;
  if (t !== 'select') state.boxMode = false;
  if (t === 'wall') state.wallMode = true;
  ix.modA = null; ix.arcPts = [];
  markActiveTool();
  if (t === 'symbol'){ renderSymbols(); openSheet('sheetSymbols'); }
  setPrompt(defaultPrompt(t, state));
  syncCtx();
}
