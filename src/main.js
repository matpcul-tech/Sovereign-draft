/* Application entry: injects chrome, wires state / rendering / input. */
import './cad.css';
import { state, onChange, pushUndo, doUndo, doRedo, afterChange, selMembers, layerByName, ensureLayer, addLayer, entById, addEntity, OFFSETS, activeLayout } from './core/state.js';
import { fmtFtIn } from './core/format.js';
import { homeView, zoomFit } from './core/viewport.js';
import { ix } from './interaction.js';
import { initCanvas, resize, draw } from './render/draw.js';
import { bindInput } from './input.js';
import { setTool } from './ui/tools.js';
import { syncCtx, renderHistory, renderProps, cycleCurrentLt, cycleCurrentLw, cycleDimStyle, cycleHatchPattern } from './ui/chips.js';
import { openSheet, closeSheets } from './ui/sheets.js';
import { renderLayers } from './ui/layersPanel.js';
import { toast } from './ui/toast.js';
import { cancelPoly, closePoly, deleteSelection, duplicateSelection, saveBlockFromSelection, cycleWallTh, explodeSelection, flipSelection, rotateSelection90, placeAllSchedules, exportScheduleCSV, applyCleanup, applyOverkill, applyRooms, applyTakeoff } from './actions.js';
import { buildDXF, parseDXF } from './io/dxf.js';
import { buildPDF, scaleLabel } from './io/pdf.js';
import { renderPNG } from './io/png.js';
import { serializeProject, validateProject, applyProject, autosave, loadAutosave } from './io/project.js';
import { buildSVG } from './io/svg.js';
import { generateDraft, realizeResponse, serializeForAI } from './ai/draft.js';
import { loadAISettings, saveAISettings } from './ai/settings.js';
import { shellHTML } from './shell.js';
import { makeLayout, fitViewport, SHEETS } from './core/layout.js';
import { membersBBox } from './core/entities.js';
import { cabin24x36 } from './core/demo.js';

const $ = id => document.getElementById(id);

let booted = false;
let unbindResize = null;
let unbindInput = null;

export function boot(root){
  if (!root) return () => {};
  root.innerHTML = shellHTML();
  const cv = $('cv');
  initCanvas(cv);
  unbindInput = bindInput(cv);

  let autosaveTimer = null;
  onChange(() => {
    const hint = $('hint');
    if (hint) hint.style.opacity = state.entities.length ? 0 : 1;
    syncCtx();
    draw();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => autosave(state), 800);
  });

  const restored = loadAutosave();
  if (restored && (restored.entities.length || restored.userBlocks.length)){
    applyProject(state, restored);
    if ($('projName')) $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  unbindResize = () => window.removeEventListener('resize', onResize);
  resize();
  if (restored && restored.entities.length){ zoomFit(); toast('Restored your last session'); }
  else homeView();
  afterChange();
  wireUi();
  booted = true;
  window.__sovereign = { state, setTool, zoomFit, draw };
  return function cleanup(){
    if (unbindResize) unbindResize();
    if (typeof unbindInput === 'function') unbindInput();
    booted = false;
    if (window.__sovereign) delete window.__sovereign;
  };
}

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

function wireUi(){
  $('btnUndo') && $('btnUndo').addEventListener('click', doUndo);
  $('btnRedo') && $('btnRedo').addEventListener('click', doRedo);
  $('btnFit') && $('btnFit').addEventListener('click', () => { zoomFit(); draw(); });
  $('btnMenu') && $('btnMenu').addEventListener('click', () => {
    $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
    openSheet('sheetMenu');
  });
  $('btnProps') && $('btnProps').addEventListener('click', () => { renderProps(); openSheet('sheetProps'); });

  document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  $('chipAI') && $('chipAI').addEventListener('click', () => openSheet('sheetAI'));
  $('chipLayer') && $('chipLayer').addEventListener('click', () => { ix.assignMode = false; renderLayers(); openSheet('sheetLayers'); });
  $('chipSnap') && $('chipSnap').addEventListener('click', () => { state.snapOn = !state.snapOn; syncCtx(); });
  $('chipOrtho') && $('chipOrtho').addEventListener('click', () => { state.orthoOn = !state.orthoOn; if (state.orthoOn) state.polarOn = false; syncCtx(); });
  $('chipPolar') && $('chipPolar').addEventListener('click', () => { state.polarOn = !state.polarOn; if (state.polarOn) state.orthoOn = false; syncCtx(); });
  $('stSnap') && $('stSnap').addEventListener('click', () => { state.snapOn = !state.snapOn; syncCtx(); });
  $('stOrtho') && $('stOrtho').addEventListener('click', () => { state.orthoOn = !state.orthoOn; if (state.orthoOn) state.polarOn = false; syncCtx(); });
  $('stPolar') && $('stPolar').addEventListener('click', () => { state.polarOn = !state.polarOn; if (state.polarOn) state.orthoOn = false; syncCtx(); });
  $('stWall') && $('stWall').addEventListener('click', () => { state.wallMode = !state.wallMode; if (state.wallMode) setTool('wall'); syncCtx(); });
  $('chipWall') && $('chipWall').addEventListener('click', () => {
    if (state.tool !== 'wall'){ state.wallMode = true; setTool('wall'); }
    else {
      const label = cycleWallTh();
      toast('Wall ' + label);
    }
    syncCtx();
  });
  $('chipLt') && $('chipLt').addEventListener('click', () => { toast('Linetype ' + cycleCurrentLt()); });
  $('chipLw') && $('chipLw').addEventListener('click', () => {
    const n = cycleCurrentLw();
    toast(n ? ('Lineweight ' + Number(n).toFixed(2) + ' mm') : 'Lineweight default');
  });
  $('chipDimSt') && $('chipDimSt').addEventListener('click', () => { toast('Dim style ' + cycleDimStyle()); });
  $('chipHatchPat') && $('chipHatchPat').addEventListener('click', () => { toast('Hatch ' + cycleHatchPattern()); });
  $('chipBox') && $('chipBox').addEventListener('click', function(){
    state.boxMode = !state.boxMode; this.classList.toggle('on', state.boxMode);
    if (state.boxMode) toast('Drag a box to select');
  });
  $('chipOffDist') && $('chipOffDist').addEventListener('click', function(){
    state.offIdx = (state.offIdx + 1) % OFFSETS.length;
    state.offsetDist = OFFSETS[state.offIdx];
    this.textContent = 'OFFSET ' + fmtFtIn(state.offsetDist);
  });
  $('chipFilletR') && $('chipFilletR').addEventListener('click', () => {
    const opts = [0, 0.25, 0.5, 1, 2];
    const i = opts.findIndex(x => Math.abs(x - state.filletR) < 1e-6);
    state.filletR = opts[(i + 1) % opts.length];
    syncCtx(); toast('Fillet ' + (state.filletR ? fmtFtIn(state.filletR) : 'sharp'));
  });
  $('chipChamferD') && $('chipChamferD').addEventListener('click', () => {
    const opts = [0.25, 0.5, 1];
    const i = opts.findIndex(x => Math.abs(x - state.chamferD) < 1e-6);
    state.chamferD = opts[(i + 1) % opts.length];
    syncCtx();
  });
  $('chipDone') && $('chipDone').addEventListener('click', () => cancelPoly(true));
  $('chipClose') && $('chipClose').addEventListener('click', closePoly);
  $('chipDelete') && $('chipDelete').addEventListener('click', deleteSelection);
  $('chipRotate') && $('chipRotate').addEventListener('click', rotateSelection90);
  $('chipDup') && $('chipDup').addEventListener('click', duplicateSelection);
  $('chipAssign') && $('chipAssign').addEventListener('click', () => {
    if (!state.selIds.length) return;
    ix.assignMode = true; renderLayers(); openSheet('sheetLayers');
  });
  $('chipBlock') && $('chipBlock').addEventListener('click', () => {
    if (!state.selIds.length) return;
    $('blkname').value = '';
    openSheet('sheetBlock');
    setTimeout(() => $('blkname').focus(), 300);
  });
  $('btnSaveBlock') && $('btnSaveBlock').addEventListener('click', () => {
    const name = $('blkname').value.trim() || ('Block ' + (state.userBlocks.length + 1));
    if (saveBlockFromSelection(name)){ closeSheets(); toast('Block saved: ' + name); autosave(state); }
    else closeSheets();
  });
  $('chipExplode') && $('chipExplode').addEventListener('click', explodeSelection);
  $('chipEditTxt') && $('chipEditTxt').addEventListener('click', () => {
    const ms = selMembers();
    if (ms.length === 1 && ms[0].type === 'text'){
      ix.editTextId = ms[0].id; ix.pendingTextPt = null;
      $('txtval').value = ms[0].content || '';
      openSheet('sheetText');
      setTimeout(() => $('txtval').focus(), 300);
    }
  });
  $('chipFlip') && $('chipFlip').addEventListener('click', flipSelection);
  $('chipDoor') && $('chipDoor').addEventListener('click', () => {
    toast('Tap the wall to place a door');
    setTool('select');
    ix.openingKind = 'door';
    /* Next tap on a wall — handled via a one-shot: switch to a lightweight mode */
    state.tool = 'opening-door';
  });
  $('chipWindow') && $('chipWindow').addEventListener('click', () => {
    toast('Tap the wall to place a window');
    state.tool = 'opening-window';
  });

  $('backdrop') && $('backdrop').addEventListener('click', closeSheets);
  $('btnAddLayer') && $('btnAddLayer').addEventListener('click', () => { addLayer(); renderLayers(); syncCtx(); });

  $('btnPlaceText') && $('btnPlaceText').addEventListener('click', () => {
    const v = $('txtval').value.trim();
    if (ix.editTextId != null){
      const e = entById(ix.editTextId);
      if (e && v){ pushUndo(); e.content = v; afterChange(); }
      ix.editTextId = null;
    } else if (ix.pendingLeader){
      if (v){ ix.pendingLeader.content = v; afterChange(); }
      ix.pendingLeader = null;
    } else if (v && ix.pendingTextPt){
      pushUndo();
      addEntity({ type: 'text', layer: 'TEXT', x: ix.pendingTextPt[0], y: ix.pendingTextPt[1], size: 1.2, content: v });
      afterChange();
    }
    $('txtval').value = '';
    ix.pendingTextPt = null; closeSheets();
  });

  $('chipCtx') && $('chipCtx').addEventListener('click', function(){
    state.aiCtxOn = !state.aiCtxOn;
    this.textContent = 'Sheet context: ' + (state.aiCtxOn ? 'ON' : 'OFF');
    this.classList.toggle('on', state.aiCtxOn);
  });
  $('btnAISettings') && $('btnAISettings').addEventListener('click', openSettings);
  $('mSettings') && $('mSettings').addEventListener('click', openSettings);
  function openSettings(){
    const s = loadAISettings();
    $('setKey').value = s.apiKey;
    $('setModel').value = s.model;
    openSheet('sheetSettings');
  }
  $('btnSaveSettings') && $('btnSaveSettings').addEventListener('click', () => {
    saveAISettings({ apiKey: $('setKey').value.trim(), model: $('setModel').value });
    closeSheets();
    toast($('setKey').value.trim() ? 'AI settings saved' : 'API key removed');
  });

  $('btnGenerate') && $('btnGenerate').addEventListener('click', async () => {
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
    st.className = ''; st.textContent = 'Claude is drafting walls, rooms and dims…';
    try {
      const text = await generateDraft({
        prompt,
        contextText: (state.aiCtxOn && state.entities.length) ? serializeForAI(state.entities) : null,
        apiKey: settings.apiKey,
        model: settings.model
      });
      const fresh = realizeResponse(text, ensureLayer);
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
      toast(msg, 4000);
    } finally {
      btn.disabled = false; btn.textContent = 'Generate blueprint';
    }
  });

  $('projName') && $('projName').addEventListener('change', function(){
    state.projectName = this.value.trim() || 'Untitled';
    autosave(state);
  });

  $('mExportPDF') && $('mExportPDF').addEventListener('click', () => openSheet('sheetPDF'));
  document.querySelectorAll('#pdfscl .chip').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pdfscl .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.pdfPPF = b.dataset.ppf;
    });
  });
  $('btnExportPDF') && $('btnExportPDF').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    const layout = state.space !== 'model' ? activeLayout() : null;
    if (layout){
      /* Fit viewport if still at origin. */
      const vp0 = layout.viewports[0];
      if (vp0 && vp0.mx === 0 && vp0.my === 0) fitViewport(vp0, membersBBox(state.entities));
    }
    const { pdf, ppf } = buildPDF(state.entities, {
      ppf: layout ? layout.ppf : state.pdfPPF,
      layerVisible: name => {
        const L = layerByName(name);
        return !L || (L.visible !== false && L.plot !== false);
      },
      projectName: state.projectName,
      layout: layout || undefined
    });
    download(fileSlug() + '.pdf', pdf, 'application/pdf');
    toast('PDF exported at ' + scaleLabel(ppf));
  });
  $('mExportDXF') && $('mExportDXF').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    download(fileSlug() + '.dxf', buildDXF(state.entities, state.layers, { ver: state.dxfVer, userBlocks: state.userBlocks }), 'application/dxf');
    toast('DXF ' + state.dxfVer + ' exported');
  });
  function exportSvg(){
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    download(fileSlug() + '.svg', buildSVG(state.entities, state.layers), 'image/svg+xml');
    toast('SVG exported');
  }
  $('mExportSVG') && $('mExportSVG').addEventListener('click', exportSvg);
  document.addEventListener('sd-export-svg', exportSvg);
  document.addEventListener('sd-redraw', () => draw());
  $('chipDxfVer') && $('chipDxfVer').addEventListener('click', function(){
    state.dxfVer = state.dxfVer === 'R12' ? 'R2000' : 'R12';
    this.textContent = state.dxfVer;
  });
  $('mExportPNG') && $('mExportPNG').addEventListener('click', () => {
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
  $('mSaveJSON') && $('mSaveJSON').addEventListener('click', () => {
    closeSheets();
    download(fileSlug() + '-project.json', serializeProject(state, true), 'application/json');
    toast('Project saved');
  });
  $('mOpenJSON') && $('mOpenJSON').addEventListener('click', () => $('fileOpen').click());
  $('fileOpen') && $('fileOpen').addEventListener('change', ev => {
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
  $('mImportDXF') && $('mImportDXF').addEventListener('click', () => $('fileDXF').click());
  $('fileDXF') && $('fileDXF').addEventListener('change', ev => {
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

  let newArmed = false, newTimer = null;
  $('mNew') && $('mNew').addEventListener('click', () => {
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
    if ($('projName')) $('projName').value = '';
    closeSheets(); afterChange(); homeView(); draw();
  });

  $('mSample') && $('mSample').addEventListener('click', () => {
    closeSheets();
    pushUndo();
    cabin24x36().forEach(e => addEntity(e));
    state.projectName = '24x36 Cabin';
    state.autoRooms = true;
    if ($('projName')) $('projName').value = '24x36 Cabin';
    afterChange(); zoomFit(); draw();
    toast('Sample cabin — live rooms, grid, associative dims');
  });

  $('mLayouts') && $('mLayouts').addEventListener('click', () => { renderLayouts(); openSheet('sheetLayouts'); });
  $('mSchedules') && $('mSchedules').addEventListener('click', () => {
    closeSheets();
    placeAllSchedules();
  });
  $('mSchedCSV') && $('mSchedCSV').addEventListener('click', () => {
    closeSheets();
    download(fileSlug() + '-doors.csv', exportScheduleCSV('door'), 'text/csv');
    toast('Door schedule CSV');
  });
  $('mCleanup') && $('mCleanup').addEventListener('click', () => {
    closeSheets();
    applyCleanup();
  });
  $('mRooms') && $('mRooms').addEventListener('click', () => {
    closeSheets();
    applyRooms();
  });
  $('mTakeoff') && $('mTakeoff').addEventListener('click', () => {
    closeSheets();
    applyTakeoff();
  });
  $('mOverkill') && $('mOverkill').addEventListener('click', () => {
    closeSheets();
    applyOverkill();
  });
  $('mTrace') && $('mTrace').addEventListener('click', () => {
    closeSheets();
    const f = $('fileImage');
    if (f) f.click();
  });
  $('fileImage') && $('fileImage').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      ix.imageSrc = String(rd.result || '');
      state.tool = 'image';
      toast('Tap two corners to place the underlay');
      draw();
    };
    rd.readAsDataURL(f);
    ev.target.value = '';
  });
  $('mHistory') && $('mHistory').addEventListener('click', () => { renderHistory(); openSheet('sheetHistory'); });

  document.querySelectorAll('#spacetabs .stab').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.space === 'model') state.space = 'model';
      else {
        state.space = state.currentLayout;
        const L = activeLayout();
        if (L && L.viewports[0]) fitViewport(L.viewports[0], membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]));
      }
      syncCtx(); draw();
    });
  });

  document.querySelectorAll('#sheetSizes .chip').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#sheetSizes .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const L = activeLayout(); if (!L) return;
      L.sheet = b.dataset.sheet;
      const { makeViewport } = requireLayout();
      L.viewports = [makeViewport(L.sheet, L.ppf)];
      if (state.entities.length) fitViewport(L.viewports[0], membersBBox(state.entities));
      syncCtx(); draw();
    });
  });
  document.querySelectorAll('#layoutScl .chip').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#layoutScl .chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const L = activeLayout(); if (!L) return;
      L.ppf = Number(b.dataset.ppf);
      L.viewports.forEach(v => { v.ppf = L.ppf; });
      draw();
    });
  });
  $('btnFitVP') && $('btnFitVP').addEventListener('click', () => {
    const L = activeLayout(); if (!L || !state.entities.length) return;
    fitViewport(L.viewports[0], membersBBox(state.entities));
    toast('Viewport fit at ' + scaleLabel(L.viewports[0].ppf));
    draw();
  });
  $('btnAddLayout') && $('btnAddLayout').addEventListener('click', () => {
    const n = state.layouts.length + 1;
    const L = makeLayout({ id: 'A' + n, name: 'A-' + n + ' Plan', sheet: 'archd', ppf: 18 });
    state.layouts.push(L);
    state.currentLayout = L.id;
    renderLayouts(); syncCtx();
  });

  window.addEventListener('error', ev => {
    toast('Something went wrong: ' + (ev.message || 'unknown error'), 4000);
  });
}

function requireLayout(){
  return { makeViewport: (sheet, ppf) => {
    const s = SHEETS[sheet] || SHEETS.letter;
    const m = 0.5, tb = 0.9;
    return { px: m, py: m + tb, pw: s.w - m * 2, ph: s.h - m * 2 - tb, mx: 0, my: 0, ppf: ppf || 18 };
  } };
}

function renderLayouts(){
  const box = $('layoutlist'); if (!box) return;
  box.innerHTML = '';
  state.layouts.forEach(L => {
    const r = document.createElement('button');
    r.className = 'mrow';
    r.textContent = L.name + '  ·  ' + (SHEETS[L.sheet] || {}).name;
    if (L.id === state.currentLayout) r.style.color = '#d4a843';
    r.addEventListener('click', () => {
      state.currentLayout = L.id;
      state.space = L.id;
      renderLayouts(); syncCtx(); draw();
    });
    box.appendChild(r);
  });
}

/* Static PWA entry (GitHub Pages / Vite). The React host boots via boot(#cad-host) instead. */
if (typeof document !== 'undefined'){
  const staticRoot = document.getElementById('app');
  if (staticRoot && !booted){
    boot(staticRoot);
    if ('serviceWorker' in navigator){
      import('virtual:pwa-register').then(({ registerSW }) => {
        registerSW({ immediate: true });
      }).catch(() => { /* PWA plugin not in this build */ });
    }
  }
}

