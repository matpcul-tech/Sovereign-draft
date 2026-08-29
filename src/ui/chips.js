/* Context row (chips) and tool row state sync. */
import { state, layerByName, selMembers } from '../core/state.js';
import { ix } from '../interaction.js';

export function syncCtx(){
  const $ = id => document.getElementById(id);
  const L = layerByName(state.currentLayer);
  $('chipLayerSw').style.background = L ? L.color : '#d4a843';
  $('chipLayerNm').textContent = state.currentLayer;
  $('chipClose').style.display = (state.tool === 'poly' && ix.polyPts.length > 2) ? '' : 'none';
  $('chipDone').style.display = (state.tool === 'poly' && ix.polyPts.length > 1) ? '' : 'none';
  $('chipOffDist').style.display = state.tool === 'offset' ? '' : 'none';
  const boxChip = $('chipBox');
  boxChip.style.display = state.tool === 'select' ? '' : 'none';
  boxChip.classList.toggle('on', state.boxMode);
  const ms = selMembers();
  const has = ms.length > 0;
  const anyG = ms.some(e => !!e.g);
  $('chipDelete').style.display = has ? '' : 'none';
  $('chipRotate').style.display = has ? '' : 'none';
  $('chipDup').style.display = has ? '' : 'none';
  $('chipAssign').style.display = has ? '' : 'none';
  $('chipBlock').style.display = has ? '' : 'none';
  $('chipExplode').style.display = anyG ? '' : 'none';
  $('chipEditTxt').style.display = (ms.length === 1 && ms[0].type === 'text') ? '' : 'none';
  $('chipFlip').style.display = (ms.length === 1 && ms[0].type === 'dim') ? '' : 'none';
}

export function markActiveTool(){
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === state.tool));
}
