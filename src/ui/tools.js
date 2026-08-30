import { state } from '../core/state.js';
import { cancelPoly } from '../actions.js';
import { markActiveTool, syncCtx } from './chips.js';
import { openSheet } from './sheets.js';
import { renderSymbols } from './symbolsPanel.js';

export function setTool(t){
  if (state.tool === 'poly' && t !== 'poly') cancelPoly(true);
  state.tool = t;
  if (t !== 'select') state.boxMode = false;
  markActiveTool();
  if (t === 'symbol'){ renderSymbols(); openSheet('sheetSymbols'); }
  syncCtx();
}
