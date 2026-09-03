import { state } from '../core/state.js';
import {
  cancelPoly, openSolidTool, extrudeSelection, revolveSelection, boolean3d,
  modelPlan, makeStack, makeRoof, makeDrawings, makeTakeoff3d, reviseSelection
} from '../actions.js';
import { zoomFit } from '../core/viewport.js';
import { draw } from '../render/draw.js';
import { toast } from './toast.js';
import { markActiveTool, syncCtx, setPrompt } from './chips.js';
import { openSheet } from './sheets.js';
import { renderSymbols } from './symbolsPanel.js';
import { defaultPrompt } from '../core/command.js';
import { ix } from '../interaction.js';

const T3D = {
  box3d: 'box', cyl3d: 'cyl', sph3d: 'sphere', cone3d: 'cone'
};

export function setTool(t){
  if (t === 'view3d'){
    try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ }
    return;
  }
  if (T3D[t]){ openSolidTool(T3D[t]); return; }
  /* The building verbs run with their common defaults; the command line
   * takes arguments when the defaults are not the job. */
  if (t === 'bmodel'){ modelPlan(); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'bstack'){ makeStack('2'); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'broof'){ makeRoof('HIP 6'); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'bdormer'){
    /* In 3D the dormer places where you tap the roof itself; from the
     * plan (or a paper sheet, which flips back to model space so the
     * tap does not pan) it places at a tap on the plan. */
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('view3d')){
      try { document.dispatchEvent(new Event('sd-dormer3d')); } catch (e){ /* node */ }
      toast('Tap the roof slope where the dormer goes · 6 ft wide');
      return;
    }
    try {
      document.dispatchEvent(new CustomEvent('sd-space', { detail: { space: 'model' } }));
    } catch (e){ /* node */ }
    setTool('dormer');
    zoomFit(); draw();
    toast('Tap the roof in plan · 6 ft dormer · DORMER x y w types it exactly');
    return;
  }
  if (t === 'brevise'){
    /* Mark the change from the phone: select what moved, tap REVISE,
     * and the drawing gains a cloud, a numbered delta and a revision
     * row that reprints into every sheet's revision block. */
    const r = reviseSelection('');
    if (r) draw();
    return;
  }
  if (t === 'bdwgs'){ makeDrawings('HIP 6 SHEETS'); zoomFit(); draw(); return; }
  if (t === 'bqto'){ makeTakeoff3d(); zoomFit(); draw(); return; }
  if (t === 'extrude3d'){ extrudeSelection(''); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'revolve3d'){ revolveSelection(''); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'union3d'){ boolean3d('union', ''); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if (t === 'sub3d'){ boolean3d('subtract', ''); try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* node */ } return; }
  if ((state.tool === 'poly' || state.tool === 'hatch' || state.tool === 'cloud' || state.tool === 'leader' || state.tool === 'spline') && t !== state.tool) cancelPoly(true);
  if (t && t !== 'select' && t !== 'pan') state.lastTool = t;
  state.tool = t;
  if (t !== 'select') state.boxMode = false;
  if (t === 'wall') state.wallMode = true;
  ix.modA = null; ix.arcPts = [];
  markActiveTool();
  try {
    const btn = document.querySelector('.tool[data-tool="' + t + '"]');
    const row = btn && btn.closest('.toolrow');
    if (row && !row.classList.contains('on') && !document.body.classList.contains('view3d')){
      document.dispatchEvent(new CustomEvent('sd-toolrow', { detail: { row: row.id } }));
    }
  } catch (e){ /* node */ }
  if (t === 'symbol'){ renderSymbols(); openSheet('sheetSymbols'); }
  if (t === 'image'){
    const f = document.getElementById('fileImage');
    if (f) f.click();
  }
  setPrompt(defaultPrompt(t, state));
  syncCtx();
}
