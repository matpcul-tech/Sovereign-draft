/* Application entry point: wires state, rendering, input and UI together. */
import { state, onChange, pushUndo, doUndo, doRedo, afterChange, selMembers, layerByName, ensureLayer, addLayer, entById, addEntity, defaultLayers, OFFSETS } from './core/state.js';
import { fmtFtIn } from './core/format.js';
import { rotateMembers } from './core/entities.js';
import { homeView, zoomFit } from './core/viewport.js';
import { ix } from './interaction.js';
import { initCanvas, resize, draw } from './render/draw.js';
import { bindInput } from './input.js';
import { setTool } from './ui/tools.js';
import { syncCtx } from './ui/chips.js';
import { openSheet, closeSheets } from './ui/sheets.js';
import { renderLayers } from './ui/layersPanel.js';
import { toast } from './ui/toast.js';
import { cancelPoly, closePoly, deleteSelection, duplicateSelection, saveBlockFromSelection } from './actions.js';
import { buildDXF, parseDXF } from './io/dxf.js';
import { buildPDF, scaleLabel } from './io/pdf.js';
import { renderPNG } from './io/png.js';
import { serializeProject, validateProject, applyProject, autosave, loadAutosave } from './io/project.js';
import { generateDraft, serializeForAI, itemsToEntities } from './ai/draft.js';
import { loadAISettings, saveAISettings } from './ai/settings.js';

const $ = id => document.getElementById(id);

/* ---------- boot ---------- */
const cv = $('cv');
initCanvas(cv);
bindInput(cv);

let autosaveTimer = null;
onChange(() => {
  $('hint').style.opacity = state.entities.length ? 0 : 1;
  syncCtx();
  draw();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosave(state), 800);
});

const restored = loadAutosave();
if (restored && (restored.entities.length || restored.userBlocks.length)){
  applyProject(state, restored);
  $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
}

window.addEventListener('resize', resize);
resize();
if (restored && restored.entities.length){ zoomFit(); toast('Restored your last session'); }
else homeView();
afterChange();

window.addEventListener('error', ev => {
  toast('Something went wrong: ' + (ev.message || 'unknown error'), 4000);
});

/* ---------- helpers ---------- */
function fileSlug(){
  const n = (state.projectName || 'sovereign-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return n || 'sovereign-draft';
}
function download(name, text, mime){
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ---------- topbar ---------- */
$('btnUndo').addEventListener('click', doUndo);
$('btnRedo').addEventListener('click', doRedo);
$('btnFit').addEventListener('click', () => { zoomFit(); draw(); });
$('btnMenu').addEventListener('click', () => {
  $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
  openSheet('sheetMenu');
});

/* ---------- tools ---------- */
document.querySelectorAll('.tool').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

/* ---------- chips ---------- */
$('chipAI').addEventListener('click', () => openSheet('sheetAI'));
$('chipLayer').addEventListener('click', () => { ix.assignMode = false; renderLayers(); openSheet('sheetLayers'); });
$('chipSnap').addEventListener('click', function(){ state.snapOn = !state.snapOn; this.classList.toggle('on', state.snapOn); });
$('chipOrtho').addEventListener('click', function(){ state.orthoOn = !state.orthoOn; this.classList.toggle('on', state.orthoOn); });
$('chipBox').addEventListener('click', function(){
  state.boxMode = !state.boxMode; this.classList.toggle('on', state.boxMode);
  if (state.boxMode) toast('Drag a box to select');
});
$('chipOffDist').addEventListener('click', function(){
  state.offIdx = (state.offIdx + 1) % OFFSETS.length;
  this.textContent = 'OFFSET ' + fmtFtIn(OFFSETS[state.offIdx]);
});
$('chipDone').addEventListener('click', () => cancelPoly(true));
$('chipClose').addEventListener('click', closePoly);
$('chipDelete').addEventListener('click', deleteSelection);
$('chipRotate').addEventListener('click', () => {
  const ms = selMembers(); if (!ms.length) return;
  pushUndo(); rotateMembers(ms); afterChange();
});
$('chipDup').addEventListener('click', duplicateSelection);
$('chipAssign').addEventListener('click', () => {
  if (!state.selIds.length) return;
  ix.assignMode = true; renderLayers(); openSheet('sheetLayers');
});
$('chipBlock').addEventListener('click', () => {
  if (!state.selIds.length) return;
  $('blkname').value = '';
  openSheet('sheetBlock');
  setTimeout(() => $('blkname').focus(), 300);
});
$('btnSaveBlock').addEventListener('click', () => {
  const name = $('blkname').value.trim() || ('Block ' + (state.userBlocks.length + 1));
  if (saveBlockFromSelection(name)){
    closeSheets(); toast('Block saved: ' + name);
    autosave(state);
  } else closeSheets();
});
$('chipExplode').addEventListener('click', () => {
  const ms = selMembers(); if (!ms.length) return;
  pushUndo();
  ms.forEach(e => { delete e.g; });
  afterChange(); toast('Exploded');
});
$('chipEditTxt').addEventListener('click', () => {
  const ms = selMembers();
  if (ms.length === 1 && ms[0].type === 'text'){
    ix.editTextId = ms[0].id; ix.pendingTextPt = null;
    $('txtval').value = ms[0].content || '';
    openSheet('sheetText');
    setTimeout(() => $('txtval').focus(), 300);
  }
});
$('chipFlip').addEventListener('click', () => {
  const ms = selMembers();
  if (ms.length === 1 && ms[0].type === 'dim'){ pushUndo(); ms[0].off = -ms[0].off; afterChange(); }
});

/* ---------- sheets ---------- */
$('backdrop').addEventListener('click', closeSheets);
$('btnAddLayer').addEventListener('click', () => { addLayer(); renderLayers(); syncCtx(); });

$('btnPlaceText').addEventListener('click', () => {
  const v = $('txtval').value.trim();
  if (ix.editTextId != null){
    const e = entById(ix.editTextId);
    if (e && v){ pushUndo(); e.content = v; afterChange(); }
    ix.editTextId = null;
  } else if (v && ix.pendingTextPt){
    pushUndo();
    addEntity({ type: 'text', layer: 'TEXT', x: ix.pendingTextPt[0], y: ix.pendingTextPt[1], size: 1.2, content: v });
    afterChange();
  }
  $('txtval').value = '';
  ix.pendingTextPt = null; closeSheets();
});

/* ---------- AI drafting ---------- */
$('chipCtx').addEventListener('click', function(){
  state.aiCtxOn = !state.aiCtxOn;
  this.textContent = 'Sheet context: ' + (state.aiCtxOn ? 'ON' : 'OFF');
  this.classList.toggle('on', state.aiCtxOn);
});
$('btnAISettings').addEventListener('click', openSettings);
$('mSettings').addEventListener('click', openSettings);
function openSettings(){
  const s = loadAISettings();
  $('setKey').value = s.apiKey;
  $('setModel').value = s.model;
  openSheet('sheetSettings');
}
$('btnSaveSettings').addEventListener('click', () => {
  saveAISettings({ apiKey: $('setKey').value.trim(), model: $('setModel').value });
  closeSheets();
  toast($('setKey').value.trim() ? 'AI settings saved' : 'API key removed');
});

$('btnGenerate').addEventListener('click', async () => {
  const prompt = $('aiprompt').value.trim();
  const st = $('aistatus');
  const btn = $('btnGenerate');
  if (!prompt){ st.textContent = 'Describe what to draft first.'; st.className = 'err'; return; }
  const settings = loadAISettings();
  if (!settings.apiKey){
    st.textContent = 'Add your Anthropic API key first.'; st.className = 'err';
    setTimeout(openSettings, 700);
    return;
  }
  btn.disabled = true; btn.textContent = 'Drafting…';
  st.className = ''; st.textContent = 'Claude is drafting your blueprint…';
  try {
    const items = await generateDraft({
      prompt,
      contextText: (state.aiCtxOn && state.entities.length) ? serializeForAI(state.entities) : null,
      apiKey: settings.apiKey,
      model: settings.model
    });
    const fresh = itemsToEntities(items, ensureLayer);
    pushUndo();
    fresh.forEach(e => addEntity(e));
    afterChange();
    st.textContent = 'Added ' + fresh.length + ' entities.';
    closeSheets(); zoomFit(); draw();
    toast('Drafted ' + fresh.length + ' entities. Undo removes them.');
  } catch (err){
    const msg = err && err.status === 401 ? 'API key rejected — check it in AI settings'
      : err && err.status === 429 ? 'Rate limited — wait a moment and retry'
      : (err && err.message) || 'unknown error';
    st.className = 'err'; st.textContent = 'Draft failed: ' + msg;
  } finally {
    btn.disabled = false; btn.textContent = 'Generate blueprint';
  }
});

/* ---------- menu: project name ---------- */
$('projName').addEventListener('change', function(){
  state.projectName = this.value.trim() || 'Untitled';
  autosave(state);
});

/* ---------- menu: exports ---------- */
$('mExportPDF').addEventListener('click', () => openSheet('sheetPDF'));
document.querySelectorAll('#pdfscl .chip').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#pdfscl .chip').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.pdfPPF = b.dataset.ppf;
  });
});
$('btnExportPDF').addEventListener('click', () => {
  closeSheets();
  if (!state.entities.length){ toast('Nothing to export yet'); return; }
  const { pdf, ppf } = buildPDF(state.entities, {
    ppf: state.pdfPPF,
    layerVisible: name => { const L = layerByName(name); return !L || L.visible; },
    projectName: state.projectName
  });
  download(fileSlug() + '.pdf', pdf, 'application/pdf');
  toast('PDF exported at ' + scaleLabel(ppf));
});
$('mExportDXF').addEventListener('click', () => {
  closeSheets();
  if (!state.entities.length){ toast('Nothing to export yet'); return; }
  download(fileSlug() + '.dxf', buildDXF(state.entities, state.layers), 'application/dxf');
  toast('DXF exported');
});
$('mExportPNG').addEventListener('click', () => {
  closeSheets();
  if (!state.entities.length){ toast('Nothing to export yet'); return; }
  const canvas = renderPNG(state.entities, layerByName, state.projectName);
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileSlug() + '.png';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }, 'image/png');
  toast('PNG exported');
});

/* ---------- menu: project files ---------- */
$('mSaveJSON').addEventListener('click', () => {
  closeSheets();
  download(fileSlug() + '-project.json', serializeProject(state, true), 'application/json');
  toast('Project saved');
});
$('mOpenJSON').addEventListener('click', () => $('fileOpen').click());
$('fileOpen').addEventListener('change', ev => {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const p = validateProject(JSON.parse(rd.result));
      pushUndo();
      applyProject(state, p);
      closeSheets(); afterChange(); zoomFit(); draw();
      toast('Project opened');
    } catch (err){ toast('Open failed: ' + err.message); }
  };
  rd.readAsText(f);
  ev.target.value = '';
});
$('mImportDXF').addEventListener('click', () => $('fileDXF').click());
$('fileDXF').addEventListener('change', ev => {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    closeSheets();
    try {
      const added = parseDXF(String(rd.result), ensureLayer);
      if (!added.length){ toast('No supported entities found in that DXF'); return; }
      pushUndo();
      added.forEach(e => addEntity(e));
      afterChange(); zoomFit(); draw();
      toast('Imported ' + added.length + ' entities (feet assumed)');
    } catch (err){ toast('Import failed: ' + err.message); }
  };
  rd.readAsText(f);
  ev.target.value = '';
});

/* ---------- menu: new drawing (double-tap to confirm) ---------- */
let newArmed = false, newTimer = null;
$('mNew').addEventListener('click', () => {
  const lbl = $('mNewLabel');
  if (!newArmed){
    newArmed = true; lbl.textContent = 'Tap again to clear the sheet';
    lbl.style.color = '#c45a3c';
    newTimer = setTimeout(() => { newArmed = false; lbl.textContent = 'New drawing'; lbl.style.color = ''; }, 2600);
    return;
  }
  clearTimeout(newTimer); newArmed = false;
  lbl.textContent = 'New drawing'; lbl.style.color = '';
  pushUndo();
  state.entities = []; state.selIds = []; ix.polyPts = [];
  state.projectName = 'Untitled';
  $('projName').value = '';
  closeSheets(); afterChange(); homeView(); draw();
});

/* Debug/e2e handle. Read-only by convention; the UI owns all mutation. */
window.__sovereign = { state };

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator){
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => { /* PWA disabled in this build */ });
}
