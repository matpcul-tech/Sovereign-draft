/* Application entry: injects chrome, wires state / rendering / input. */
import './cad.css';
import { state, onChange, pushUndo, doUndo, doRedo, afterChange, selMembers, layerByName, ensureLayer, addLayer, entById, addEntity, OFFSETS, activeLayout, defaultLayers } from './core/state.js';
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
import { cancelPoly, closePoly, deleteSelection, duplicateSelection, saveBlockFromSelection, cycleWallTh, explodeSelection, flipSelection, rotateSelection90, placeAllSchedules, exportScheduleCSV, applyCleanup, applyOverkill, applyRooms, applyTakeoff, applySheetSet, applyAttachXref , restoreLayerState, deleteLayerState, setAnnoScale, setPlotStyle, saveLayerState, solveConstraintsNow, deleteConstraintsOnSelection} from './actions.js';
import { buildDXF, sniffDrawing, openDXF } from './io/dxf.js';
import { isDwgBuffer, parseDwg } from './io/dwg.js';
import { buildPDF, buildAllSheetsPDF, scaleLabel } from './io/pdf.js';
import { renderPNG } from './io/png.js';
import { serializeProject, validateProject, applyProject, autosave, loadAutosave } from './io/project.js';
import { buildSVG } from './io/svg.js';
import { generateDraft, realizeResponse, realizeDocument, serializeForAI } from './ai/draft.js';
import { loadAISettings, saveAISettings } from './ai/settings.js';
import { shellHTML } from './shell.js';
import { makeLayout, makeViewport, fitViewport, SHEETS, TITLE_BLOCK_H } from './core/layout.js';
import { membersBBox } from './core/entities.js';
import { addSheet, addViewToSheet, normalizeSheets, findSheet } from './core/document.js';
import { buildKeynoteLegend, buildMarkSchedule, keynoteRows, collectMarks, scheduleColumns, markScheduleCSV, paperKeynoteColW, paperScheduleColW } from './core/keynote.js';
import { placeInMargin, makeTableAnnotation, addAnnotation, makeDetailCallout, danglingDetails, detailBubbleText } from './core/sheetspace.js';
import { cabin24x36, partPlate, gaDiagram } from './core/demo.js';
import { loadFirm, saveFirm, defaultFirm } from './core/titleblock.js';
import { generateSheetSet } from './core/sheetset.js';
import { toHTML } from './io/html.js';
import { encodeShare, decodeShare, shareUrl, tokenFromHash } from './io/share.js';
import { setDisplayUnits } from './core/format.js';
import { makeMText } from './core/mtext.js';
import { describeConstraint } from './core/constrain.js';
import { runScript, saveScript, deleteScript, scriptByName, EXAMPLE_SCRIPTS } from './core/script.js';
import { latin1ToBytes } from './io/pdffont.js';
import { mergeMeshes } from './core/mesh.js';
import { extrudeDrawing, meshesToFaces } from './core/solid.js';

const $ = id => document.getElementById(id);

let booted = false;
let unbindResize = null;
let unbindInput = null;

export function boot(root){
  if (!root) return () => {};
  root.innerHTML = shellHTML();
  if (typeof document !== 'undefined' && typeof location !== 'undefined'){
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('embed') === '1' || q.has('src') || (document.body && document.body.classList.contains('embed'))){
        document.body.classList.add('embed');
        document.documentElement.classList.add('embed');
      }
    } catch (e){ /* ignore */ }
  }
  const cv = $('cv');
  initCanvas(cv);
  unbindInput = bindInput(cv);

  let autosaveTimer = null;
  onChange(() => {
    const hint = $('hint');
    if (hint){
      const empty = !state.entities.length;
      hint.style.opacity = empty ? '1' : '0';
      hint.style.display = empty ? '' : 'none';
      hint.classList.toggle('empty', empty);
    }
    syncCtx();
    draw();
    if (state.view3d) syncOpen3d();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => autosave(state), 800);
  });

  const restored = (document.body && document.body.classList.contains('embed')) ? null : loadAutosave();
  if (restored && (restored.entities.length || restored.userBlocks.length)){
    applyProject(state, restored);
    if ($('projName')) $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
  }
  const savedFirm = loadFirm();
  if (savedFirm.company || savedFirm.copyright || savedFirm.drawnBy){
    if (!state.firm || !(state.firm.company || state.firm.copyright || state.firm.drawnBy))
      state.firm = savedFirm;
  } else if (!state.firm){
    state.firm = defaultFirm();
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
  loadShareFromLocation().catch(() => {});
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

async function loadShareFromLocation(){
  if (typeof location === 'undefined') return;
  const token = tokenFromHash(location.hash || '');
  if (!token) return;
  try {
    const text = await decodeShare(token);
    const p = validateProject(JSON.parse(text));
    applyProject(state, p);
    if ($('projName')) $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
    afterChange(); zoomFit(); draw();
    toast('Opened shared drawing');
  } catch (err){
    toast('Share link could not be read');
  }
}
function download(name, data, mime){
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

let view3dMod = null;
async function loadView3d(){
  if (!view3dMod) view3dMod = await import('./render/view3d.js');
  return view3dMod;
}

function solidOpts(){
  return {
    entities: state.entities,
    layers: state.layers,
    solids: state.solids,
    height: state.storyHeight,
    assumed: state.heightAssumed,
    onHeight: (h) => {
      const n = Math.max(6, Math.min(40, Number(h) || 8));
      state.storyHeight = n;
      state.heightAssumed = false;
      afterChange();
    },
    onClose: () => {
      state.view3d = false;
      syncCtx();
    },
    download: (name, buf, mime) => download((fileSlug() + '-' + name).replace(/-model/, ''), buf, mime)
  };
}

async function openView3d(){
  if (!state.entities.length){ toast('Nothing to view in 3D yet'); return; }
  try {
    const m = await loadView3d();
    if (m.isView3dOpen()){
      m.syncView3d(solidOpts());
      state.view3d = true;
      syncCtx();
      return;
    }
    m.showView3d(solidOpts());
    state.view3d = true;
    state.space = 'model';
    syncCtx();
    toast('3D · ' + (state.heightAssumed ? (fmtFtIn(state.storyHeight || 8) + ' ASSUMED') : fmtFtIn(state.storyHeight || 8)));
  } catch (err){
    toast((err && err.message) || '3D view failed');
  }
}

function closeView3d(){
  if (view3dMod && view3dMod.isView3dOpen()) view3dMod.hideView3d();
  state.view3d = false;
  syncCtx();
}

function toggleView3d(){
  if (state.view3d) closeView3d();
  else openView3d();
}

function syncOpen3d(){
  if (view3dMod && view3dMod.isView3dOpen()) view3dMod.syncView3d(solidOpts());
}

function wireUi(){
  $('btnUndo') && $('btnUndo').addEventListener('click', doUndo);
  $('btnRedo') && $('btnRedo').addEventListener('click', doRedo);
  $('btnFit') && $('btnFit').addEventListener('click', () => { zoomFit(); draw(); });
  $('btn3d') && $('btn3d').addEventListener('click', () => toggleView3d());
  $('stHeight') && $('stHeight').addEventListener('click', () => {
    try { document.dispatchEvent(new Event('sd-view3d')); } catch (e){ /* ignore */ }
  });
  $('btnMenu') && $('btnMenu').addEventListener('click', () => {
    $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
    fillFirmFields();
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
    if (ms.length === 1 && (ms[0].type === 'text' || ms[0].type === 'mtext')){
      ix.editTextId = ms[0].id; ix.pendingTextPt = null; ix.pendingMText = null;
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
    } else if (v && ix.pendingMText){
      /* The drag set the column; the text wraps into it. */
      const m = ix.pendingMText;
      pushUndo();
      addEntity(makeMText(v, { layer: 'TEXT', x: m.x, y: m.y, width: m.width, size: m.size, just: 'TL', style: state.currentTextStyle }));
      afterChange();
    } else if (v && ix.pendingTextPt){
      pushUndo();
      addEntity({ type: 'text', layer: 'TEXT', x: ix.pendingTextPt[0], y: ix.pendingTextPt[1], size: 1.2, content: v });
      afterChange();
    }
    $('txtval').value = '';
    ix.pendingTextPt = null; ix.pendingMText = null; closeSheets();
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
    btn.disabled = true; btn.textContent = 'Drafting…';
    st.className = ''; st.textContent = 'Grok is drafting geometry…';
    try {
      const text = await generateDraft({
        prompt,
        contextText: (state.aiCtxOn && state.entities.length) ? serializeForAI(state.entities) : null,
        apiKey: settings.apiKey,
        model: settings.model
      });
      const doc = realizeDocument(text, ensureLayer, { prompt });
      const fresh = doc.entities;
      pushUndo();
      fresh.forEach(e => addEntity(e));
      /* A returned sheet set replaces the current one. Geometry is not
       * duplicated: each sheet is a window onto what was just drawn. */
      if (doc.sheets && doc.sheets.length){
        state.layouts = doc.sheets;
        state.currentLayout = doc.sheets[0].id;
        state.space = 'model';
        renderSpaceTabs();
      }
      afterChange();
      const sheetNote = doc.sheets && doc.sheets.length
        ? ' across ' + doc.sheets.length + ' sheet' + (doc.sheets.length === 1 ? '' : 's')
        : '';
      st.textContent = 'Added ' + fresh.length + ' entities' + sheetNote + '.';
      closeSheets(); zoomFit(); draw();
      toast('Drafted ' + fresh.length + ' entities' + sheetNote + '. Undo removes them.');
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
  function fillFirmFields(){
    const f = state.firm || defaultFirm();
    if ($('firmCompany')) $('firmCompany').value = f.company || '';
    if ($('firmCopyright')) $('firmCopyright').value = f.copyright || '';
    if ($('firmDrawn')) $('firmDrawn').value = f.drawnBy || '';
  }
  function commitFirm(){
    state.firm = {
      company: ($('firmCompany') && $('firmCompany').value.trim()) || '',
      copyright: ($('firmCopyright') && $('firmCopyright').value.trim()) || '',
      drawnBy: ($('firmDrawn') && $('firmDrawn').value.trim()) || '',
      /* Editing a text field must not throw the logo away. */
      logo: (state.firm && state.firm.logo) || undefined
    };
    saveFirm(state.firm);
    autosave(state);
  }
  $('firmLogoBtn') && $('firmLogoBtn').addEventListener('click', () => $('fileLogo').click());
  $('fileLogo') && $('fileLogo').addEventListener('change', async ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      /* Any image the browser can decode becomes a small baseline JPEG, so
       * the PDF path only ever sees the one format it embeds verbatim. */
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      URL.revokeObjectURL(url);
      const k = Math.min(1, 480 / img.width, 200 / img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * k));
      cv.height = Math.max(1, Math.round(img.height * k));
      const cx2 = cv.getContext('2d');
      /* Transparent PNGs on white, the colour of the sheet they will sit on. */
      cx2.fillStyle = '#ffffff';
      cx2.fillRect(0, 0, cv.width, cv.height);
      cx2.drawImage(img, 0, 0, cv.width, cv.height);
      state.firm = Object.assign({}, state.firm, { logo: cv.toDataURL('image/jpeg', 0.85) });
      saveFirm(state.firm);
      autosave(state);
      toast('Logo saved: stamps on every printed sheet');
    } catch (e){
      toast('Could not read that image');
    }
  });
  $('firmLogoClear') && $('firmLogoClear').addEventListener('click', () => {
    if (!state.firm || !state.firm.logo){ toast('No logo set'); return; }
    state.firm = Object.assign({}, state.firm, { logo: undefined });
    saveFirm(state.firm);
    autosave(state);
    toast('Logo removed');
  });
  ['firmCompany', 'firmCopyright', 'firmDrawn'].forEach(id => {
    $(id) && $(id).addEventListener('change', commitFirm);
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
    const layerVisible = name => {
      const L = layerByName(name);
      return !L || (L.visible !== false && L.plot !== false);
    };
    const sheets = (state.layouts || []).filter(Boolean);
    sheets.forEach(layout => {
      const vp0 = layout.viewports && layout.viewports[0];
      if (vp0 && vp0.mx === 0 && vp0.my === 0) fitViewport(vp0, membersBBox(state.entities));
    });
    if (sheets.length){
      const { pdf, ppf } = buildAllSheetsPDF(state.entities, {
        sheets,
        layerVisible,
        projectName: state.projectName,
        firm: state.firm,
        font: state.plotFont,
        layers: state.layers,
        textStyles: state.textStyles,
        plotStyles: state.plotStyles,
        plotStyle: state.currentPlotStyle
      });
      download(fileSlug() + '.pdf', latin1ToBytes(pdf), 'application/pdf');
      toast('PDF · ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') + ' at ' + scaleLabel(ppf));
      return;
    }
    const { pdf, ppf } = buildPDF(state.entities, {
      ppf: state.pdfPPF,
      layerVisible,
      projectName: state.projectName,
      firm: state.firm,
      font: state.plotFont,
      layers: state.layers,
      textStyles: state.textStyles,
      plotStyles: state.plotStyles,
      plotStyle: state.currentPlotStyle
    });
    download(fileSlug() + '.pdf', latin1ToBytes(pdf), 'application/pdf');
    toast('PDF exported at ' + scaleLabel(ppf));
  });
  $('mExportDXF') && $('mExportDXF').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    download(fileSlug() + '.dxf', buildDXF(state.entities, state.layers, { ver: state.dxfVer, userBlocks: state.userBlocks }), 'application/dxf');
    toast('DXF ' + state.dxfVer + ' exported');
  });
  async function exportDwg(){
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    toast('Writing DWG…');
    try {
      const { writeDwg } = await import('./io/dwgwrite.js');
      const r = await writeDwg(state.entities, state.layers, {
        userBlocks: state.userBlocks,
        height: state.storyHeight,
        assumed: state.heightAssumed,
        layouts: state.layouts
      });
      download(fileSlug() + '.dwg', r.bytes, 'application/acad');
    toast(r.source === 'libredwg'
      ? 'DWG R2000 exported'
      : 'DWG R2000 — this app reopens it. AutoCAD Open: Export DXF R2000');
    } catch (err){
      toast((err && err.message) || 'DWG export failed — try DXF');
    }
  }
  $('mExportDWG') && $('mExportDWG').addEventListener('click', exportDwg);
  document.addEventListener('sd-export-dwg', exportDwg);
  function exportSvg(){
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    download(fileSlug() + '.svg', buildSVG(state.entities, state.layers), 'image/svg+xml');
    toast('SVG exported');
  }
  $('mExportSVG') && $('mExportSVG').addEventListener('click', exportSvg);
  document.addEventListener('sd-export-svg', exportSvg);
  document.addEventListener('sd-redraw', () => draw());
  $('mExportHTML') && $('mExportHTML').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    const html = toHTML({
      name: state.projectName, firm: state.firm, layers: state.layers,
      entities: state.entities, layouts: state.layouts, userBlocks: state.userBlocks,
      dimStyles: state.dimStyles, currentDimStyle: state.currentDimStyle,
      currentLayout: state.currentLayout, space: state.space, dxfVer: state.dxfVer,
      units: state.units
    });
    download(fileSlug() + '.html', html, 'text/html');
    toast('HTML drawing exported');
  });
  $('mShare') && $('mShare').addEventListener('click', async () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to share yet'); return; }
    try {
      const json = serializeProject(state, false);
      const token = await encodeShare(json);
      const url = shareUrl(token);
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(url);
        toast('Share link copied');
      } else {
        toast('Share: ' + url.slice(0, 48) + '…');
      }
    } catch (err){
      toast((err && err.message) || 'Share failed — export HTML instead');
    }
  });
  $('stUnits') && $('stUnits').addEventListener('click', () => {
    state.units = state.units === 'ft' ? 'mm' : (state.units === 'mm' ? 'm' : 'ft');
    setDisplayUnits(state.units);
    afterChange(); draw();
    toast('Units ' + state.units);
  });
  $('chipDxfVer') && $('chipDxfVer').addEventListener('click', function(){
    state.dxfVer = state.dxfVer === 'R12' ? 'R2000' : 'R12';
    this.textContent = state.dxfVer;
  });
  $('mExportPNG') && $('mExportPNG').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    const canvas = renderPNG(state.entities, layerByName, state.projectName, state.textStyles);
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

  function nameFromFile(filename){
    return String(filename || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Untitled';
  }
  function unitsNote(insunits, units){
    if (insunits === 1 || insunits === 4 || insunits === 5 || insunits === 6) return ' · ' + units + ' → feet';
    return '';
  }
  function replaceWithEntities(ents, name, layouts){
    pushUndo();
    state.entities = [];
    state.selIds = [];
    state.userBlocks = [];
    state.layers = defaultLayers();
    state.idSeq = 1;
    state.space = 'model';
    ix.polyPts = [];
    const prevLt = state.currentLt, prevLw = state.currentLw;
    state.currentLt = 'CONTINUOUS';
    state.currentLw = 0;
    (ents || []).forEach(e => {
      e.layer = ensureLayer(e.layer);
      addEntity(e);
    });
    state.currentLt = prevLt;
    state.currentLw = prevLw;
    if (layouts && layouts.length){
      state.layouts = layouts;
      state.currentLayout = layouts[0].id;
      state.space = layouts[0].id;
    }
    state.projectName = name || 'Untitled';
    if ($('projName')) $('projName').value = state.projectName === 'Untitled' ? '' : state.projectName;
    closeSheets(); afterChange(); zoomFit(); draw();
    if (layouts && layouts.length){
      try { renderLayouts(); renderSpaceTabs(); } catch (err){ /* chrome not ready */ }
    }
  }
  function openDrawingText(text, filename, opts){
    opts = opts || {};
    const kind = sniffDrawing(text, filename);
    if (kind === 'dwg'){
      toast('DWG is binary — Save As DXF in the other CAD, then Open here');
      return;
    }
    if (kind === 'json'){
      try {
        const p = validateProject(JSON.parse(text));
        if (opts.xref){
          applyAttachXref({ name: p.name, entities: p.entities }, { name: p.name || nameFromFile(filename), path: filename });
          zoomFit(); draw();
          return;
        }
        pushUndo();
        applyProject(state, p);
        closeSheets(); afterChange(); zoomFit(); draw();
        toast('Opened ' + (p.name || 'project'));
      } catch (err){ toast('Open failed: ' + err.message); }
      return;
    }
    try {
      const { entities, count, insunits, units, layouts } = openDXF(text, n => String(n || 'WALLS').toUpperCase().slice(0, 24));
      if (!count){ toast('No supported objects in that file'); return; }
      if (opts.xref){
        applyAttachXref({ name: nameFromFile(filename), entities }, { name: nameFromFile(filename), path: filename });
        zoomFit(); draw();
        return;
      }
      if (opts.merge){
        pushUndo();
        entities.forEach(e => { e.layer = ensureLayer(e.layer); addEntity(e); });
        afterChange(); zoomFit(); draw();
        toast('Inserted ' + count + ' objects' + unitsNote(insunits, units));
      } else {
        replaceWithEntities(entities, nameFromFile(filename), layouts);
        toast('Opened ' + count + ' objects' + unitsNote(insunits, units) + (layouts && layouts.length ? ' · ' + layouts.length + ' layout' + (layouts.length === 1 ? '' : 's') : ''));
      }
    } catch (err){ toast((opts.merge ? 'Insert' : 'Open') + ' failed: ' + err.message); }
  }
  function readDrawingFile(file, merge, asXref){
    if (!file) return;
    const n = String(file.name || '').toLowerCase();
    const name = nameFromFile(file.name);
    function attach(ents){
      applyAttachXref({ name, entities: ents }, { name, path: file.name });
      zoomFit(); draw();
    }
    if (n.endsWith('.stl')){
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const { parseSTL } = await import('./io/stl.js');
          const { addSolid, describeSolid } = await import('./core/model3d.js');
          const { meshVolume } = await import('./core/mesh.js');
          const mesh = parseSTL(rd.result);
          if (!mesh.faces.length){ toast('No triangles in that STL'); return; }
          pushUndo();
          const rec = addSolid(mesh, name.toUpperCase());
          afterChange();
          toast('STL: ' + describeSolid(rec), 4000);
          void meshVolume;
        } catch (e){ toast('Could not read that STL: ' + e.message, 4000); }
      };
      rd.readAsArrayBuffer(file);
      return;
    }
    if (n.endsWith('.dwg') || file.type === 'application/acad' || file.type === 'image/vnd.dwg'){
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const buf = rd.result;
          if (!isDwgBuffer(buf, file.name)){
            if (asXref){ openDrawingText(new TextDecoder('latin1').decode(buf), file.name, { xref: true }); return; }
            openDrawingText(new TextDecoder('latin1').decode(buf), file.name, { merge: !!merge });
            return;
          }
          toast('Opening DWG…');
          const r = await parseDwg(buf, { filename: file.name, ensureLayer: n => String(n || 'WALLS').toUpperCase().slice(0, 24) });
          if (!r.entities.length){ toast('No supported objects in that DWG'); return; }
          if (asXref){ attach(r.entities); return; }
          if (merge){
            pushUndo();
            r.entities.forEach(e => { e.layer = ensureLayer(e.layer); addEntity(e); });
            afterChange(); zoomFit(); draw();
            toast('Inserted ' + r.entities.length + ' objects from DWG');
          } else {
            replaceWithEntities(r.entities, nameFromFile(file.name), r.layouts);
            toast('Opened ' + r.entities.length + ' objects from DWG' + (r.layouts && r.layouts.length ? ' · paperspace kept' : ''));
          }
        } catch (err){
          toast((err && err.message) || 'DWG open failed — Save As DXF in the other CAD');
        }
      };
      rd.readAsArrayBuffer(file);
      return;
    }
    const rd = new FileReader();
    rd.onload = () => openDrawingText(String(rd.result || ''), file.name, { merge: !!merge, xref: !!asXref });
    rd.readAsText(file);
  }

  $('mOpenDrawing') && $('mOpenDrawing').addEventListener('click', () => $('fileOpen').click());
  $('hintOpen') && $('hintOpen').addEventListener('click', () => $('fileOpen').click());
  $('fileOpen') && $('fileOpen').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (f) readDrawingFile(f, false);
    ev.target.value = '';
  });
  $('mImportDXF') && $('mImportDXF').addEventListener('click', () => $('fileDXF').click());
  $('fileDXF') && $('fileDXF').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (f) readDrawingFile(f, true);
    ev.target.value = '';
  });
  function solidsOrDrawing(){
    /* Built solids if there are any, otherwise the whole plan extruded, so
     * the export is never silently empty. */
    if (state.solids && state.solids.length) return mergeMeshes(state.solids);
    const meshes = extrudeDrawing(state.entities, solidOpts());
    const faces = meshesToFaces(meshes);
    const verts = [], tris = [];
    faces.forEach(f => {
      const base = verts.length;
      (f.pts || []).forEach(p => verts.push(p));
      for (let i = 2; i < (f.pts || []).length; i++) tris.push([base, base + i - 1, base + i]);
    });
    return { verts, faces: tris };
  }
  function renderDraftSheet(){
    const sc = $('dsScale');
    if (sc) sc.value = String(state.annoPpf || 18);
    const pl = $('dsPlot');
    if (pl){
      pl.innerHTML = '';
      (state.plotStyles || []).forEach(t => {
        const o = document.createElement('option');
        o.value = t.name; o.textContent = t.name;
        pl.appendChild(o);
      });
      pl.value = state.currentPlotStyle || 'ISO';
    }
    const ts = $('dsTextStyle');
    if (ts){
      ts.innerHTML = '';
      (state.textStyles || []).forEach(t => {
        const o = document.createElement('option');
        o.value = t.name; o.textContent = t.name + (t.widthFactor !== 1 ? ' (' + t.widthFactor + 'x)' : '');
        ts.appendChild(o);
      });
      ts.value = state.currentTextStyle || 'STANDARD';
    }
    const box = $('dsStates');
    if (box){
      box.innerHTML = '';
      const states = state.layerStates || [];
      if (!states.length) box.innerHTML = '<div class="subtle">None saved yet</div>';
      states.forEach(st => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
        const name = document.createElement('span');
        name.textContent = st.name; name.style.flex = '1';
        const go = document.createElement('button'); go.textContent = 'Restore'; go.style.height = '34px';
        go.addEventListener('click', () => { restoreLayerState(st.name); renderLayers(); draw(); });
        const del = document.createElement('button'); del.textContent = 'x'; del.style.height = '34px';
        del.addEventListener('click', () => { deleteLayerState(st.name); renderDraftSheet(); });
        row.appendChild(name); row.appendChild(go); row.appendChild(del);
        box.appendChild(row);
      });
    }
    const cons = $('dsCons');
    if (cons){
      const ms = selMembers();
      const ids = new Set(ms.map(e => e.id));
      const ks = (state.constraints || []).filter(k => ids.has(k.a) || ids.has(k.b));
      cons.textContent = ms.length
        ? (ks.length ? ks.map(k => describeConstraint(k)).join(' · ') : 'No constraints on the selection')
        : 'Nothing selected';
    }
  }
  function renderScriptSheet(){
    const list = $('scList');
    if (!list) return;
    list.innerHTML = '<option value=\"\">— saved scripts —</option>';
    (state.scripts || []).forEach(sc => {
      const o = document.createElement('option');
      o.value = sc.name; o.textContent = sc.name;
      list.appendChild(o);
    });
    if (!(state.scripts || []).length){
      EXAMPLE_SCRIPTS.forEach(sc => {
        const o = document.createElement('option');
        o.value = 'EX:' + sc.name; o.textContent = sc.name + ' (example)';
        list.appendChild(o);
      });
    }
  }
  document.addEventListener('sd-open-sheet', ev => {
    if (ev.detail === 'sheetScript'){ renderScriptSheet(); openSheet('sheetScript'); }
  });
  $('mScript') && $('mScript').addEventListener('click', () => { renderScriptSheet(); openSheet('sheetScript'); });
  $('scList') && $('scList').addEventListener('change', ev => {
    const v = ev.target.value;
    if (!v) return;
    const rec = v.startsWith('EX:') ? EXAMPLE_SCRIPTS.find(x => x.name === v.slice(3)) : scriptByName(v);
    if (rec){ $('scName').value = rec.name; $('scCode').value = rec.code; }
  });
  $('scRun') && $('scRun').addEventListener('click', () => {
    const r = runScript($('scCode').value);
    const out = $('scOut');
    if (out) out.textContent = (r.ok ? r.output.join('\n') : 'ERROR (rolled back): ' + r.error + '\n' + r.output.join('\n')) || (r.ok ? 'ok, ' + r.created.length + ' entities created' : '');
    afterChange(); draw();
  });
  $('scSave') && $('scSave').addEventListener('click', () => {
    try {
      const n = saveScript($('scName').value, $('scCode').value);
      renderScriptSheet(); $('scList').value = n;
      toast('Saved. Run it any time with RUN ' + n);
    } catch (e){ toast(e.message); }
  });
  $('scDelete') && $('scDelete').addEventListener('click', () => {
    if (deleteScript($('scName').value)){ renderScriptSheet(); $('scCode').value = ''; toast('Deleted'); }
  });

  $('mDraft') && $('mDraft').addEventListener('click', () => { renderDraftSheet(); openSheet('sheetDraft'); });
  $('dsScale') && $('dsScale').addEventListener('change', ev => { setAnnoScale(ev.target.value); draw(); });
  $('dsPlot') && $('dsPlot').addEventListener('change', ev => { setPlotStyle(ev.target.value); });
  $('dsTextStyle') && $('dsTextStyle').addEventListener('change', ev => { state.currentTextStyle = ev.target.value; toast('New text uses ' + ev.target.value); });
  $('dsSaveState') && $('dsSaveState').addEventListener('click', () => {
    const el = $('dsStateName');
    saveLayerState(el ? el.value : '');
    if (el) el.value = '';
    renderDraftSheet();
  });
  $('dsSolve') && $('dsSolve').addEventListener('click', () => { solveConstraintsNow(); draw(); });
  $('dsUnconstrain') && $('dsUnconstrain').addEventListener('click', () => { deleteConstraintsOnSelection(); renderDraftSheet(); draw(); });

  $('mSTL') && $('mSTL').addEventListener('click', async () => {
    closeSheets();
    const { meshToSTL, meshVolume, isWatertight } = await import('./core/mesh.js');
    const m = solidsOrDrawing();
    if (!m.faces.length){ toast('Nothing to export in 3D yet'); return; }
    download(fileSlug() + '.stl', meshToSTL(m, state.projectName || 'sovereign'), 'model/stl');
    toast('STL: ' + m.faces.length + ' triangles, ' + Math.abs(meshVolume(m)).toFixed(1) + ' CF'
      + (isWatertight(m) ? '' : ', not closed'), 4000);
  });
  $('mOBJ') && $('mOBJ').addEventListener('click', async () => {
    closeSheets();
    const { meshToOBJ } = await import('./core/mesh.js');
    const m = solidsOrDrawing();
    if (!m.faces.length){ toast('Nothing to export in 3D yet'); return; }
    download(fileSlug() + '.obj', meshToOBJ(m, state.projectName || 'sovereign'), 'model/obj');
    toast('OBJ: ' + m.verts.length + ' vertices, ' + m.faces.length + ' faces');
  });
  $('mFont') && $('mFont').addEventListener('click', () => $('fileFont').click());
  $('fileFont') && $('fileFont').addEventListener('change', async ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const { parseTTF, embeddingAllowed } = await import('./io/ttf.js');
      const font = parseTTF(await f.arrayBuffer());
      /* A font that forbids embedding must not end up inside someone's
       * issued drawing set. */
      if (!embeddingAllowed(font)){ toast(font.name + ' does not permit embedding', 4000); return; }
      state.plotFont = font;
      toast(font.name + ' will be embedded in plots (' + font.numGlyphs + ' glyphs available)', 4000);
    } catch (e){
      toast('Could not read that font: ' + (e && e.message ? e.message : 'unknown'), 4000);
    }
  });
  $('mXref') && $('mXref').addEventListener('click', () => $('fileXref').click());
  $('fileXref') && $('fileXref').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (f) readDrawingFile(f, false, true);
    ev.target.value = '';
  });

  let dropDepth = 0;
  const dropmask = $('dropmask');
  function showDrop(on){ if (dropmask) dropmask.classList.toggle('on', !!on); }
  document.addEventListener('dragenter', ev => {
    const types = ev.dataTransfer && ev.dataTransfer.types;
    if (!types || (types.contains ? !types.contains('Files') : Array.prototype.indexOf.call(types, 'Files') < 0)) return;
    dropDepth++;
    showDrop(true);
    ev.preventDefault();
  });
  document.addEventListener('dragover', ev => {
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    ev.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    dropDepth = Math.max(0, dropDepth - 1);
    if (!dropDepth) showDrop(false);
  });
  document.addEventListener('drop', ev => {
    ev.preventDefault();
    dropDepth = 0;
    showDrop(false);
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) readDrawingFile(f, false);
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
    state.layouts = generateSheetSet(state.entities, state.layers, { projectName: state.projectName });
    state.currentLayout = state.layouts[0].id;
    state.space = state.layouts[0].id;
    afterChange(); zoomFit(); draw();
    renderLayouts(); renderSpaceTabs();
    toast(state.layouts.length + ' sheets — cover, overall, one page per room');
  });
  $('hintSample') && $('hintSample').addEventListener('click', () => $('mSample') && $('mSample').click());

  function loadSample(name, ents, layoutOpts){
    closeSheets();
    pushUndo();
    state.entities = [];
    ents.forEach(e => addEntity(e));
    state.projectName = name;
    state.autoRooms = false;
    if ($('projName')) $('projName').value = name;
    const layout = makeLayout(layoutOpts);
    if (layout.viewports[0]) fitViewport(layout.viewports[0], membersBBox(state.entities));
    state.layouts = [layout];
    state.currentLayout = layout.id;
    state.space = layout.id;
    afterChange(); zoomFit(); draw();
    renderLayouts(); renderSpaceTabs();
  }
  $('mSamplePart') && $('mSamplePart').addEventListener('click', () => {
    loadSample('12x8 Plate', partPlate(), { id: 'D1', name: 'D-1 Plate', sheet: 'letter', ppf: 864 });
    toast('Plate · 1:1 · GD&T with a named tolerance');
  });
  $('mSampleGA') && $('mSampleGA').addEventListener('click', () => {
    loadSample('GA Diagram', gaDiagram(), { id: 'G1', name: 'G-1 General Arrangement', sheet: 'archdp', ppf: 18 });
    toast('General arrangement — not a build spec');
  });

  $('mLayouts') && $('mLayouts').addEventListener('click', () => { renderLayouts(); openSheet('sheetLayouts'); });
  $('mSheetSet') && $('mSheetSet').addEventListener('click', () => {
    closeSheets();
    applySheetSet();
    renderLayouts(); renderSpaceTabs(); draw();
  });
  $('btnSheetSet') && $('btnSheetSet').addEventListener('click', () => {
    applySheetSet();
    closeSheets();
    renderLayouts(); renderSpaceTabs(); draw();
  });
  document.addEventListener('sd-sheets-changed', () => { renderLayouts(); renderSpaceTabs(); });

  $('btnAddSheet') && $('btnAddSheet').addEventListener('click', () => {
    pushUndo();
    const prev = activeLayout();
    state.layouts = addSheet(state.layouts, makeLayout, {
      sheet: prev ? prev.sheet : 'archd',
      ppf: prev ? prev.ppf : 18
    });
    const added = state.layouts[state.layouts.length - 1];
    state.currentLayout = added.id;
    state.space = added.id;
    const bb = membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    added.viewports.forEach(v => fitViewport(v, bb));
    renderLayouts(); renderSpaceTabs(); afterChange();
    toast('Sheet ' + added.sheetNumber + ' added');
  });

  $('btnAddView') && $('btnAddView').addEventListener('click', () => {
    const L = activeLayout();
    if (!L){ toast('No sheet selected'); return; }
    pushUndo();
    const vp = makeViewport(L.sheet, L.ppf);
    /* Stack the new view under the existing ones so it does not cover them. */
    const n = L.viewports.length;
    vp.ph = Math.max(1.5, vp.ph / (n + 1));
    L.viewports.forEach((v, i) => { v.ph = vp.ph; v.py = makeViewport(L.sheet, L.ppf).py + (n - i) * vp.ph; });
    const updated = addViewToSheet(L, vp, { drawingType: 'plan' });
    const idx = state.layouts.findIndex(x => x.id === L.id);
    state.layouts[idx] = updated;
    const bb = membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    state.layouts[idx].viewports.forEach(v => fitViewport(v, bb));
    renderLayouts(); renderSpaceTabs(); afterChange();
    toast('View ' + state.layouts[idx].viewports.length + ' added to ' + (updated.sheetNumber || updated.name));
  });

  $('btnAddDetail') && $('btnAddDetail').addEventListener('click', () => {
    const L = activeLayout();
    if (!L){ toast('Open a sheet first'); return; }
    if (state.layouts.length < 2){ toast('Add a second sheet to reference'); return; }
    const i = state.layouts.findIndex(x => x.id === L.id);
    const target = state.layouts[(i + 1) % state.layouts.length];
    const slot = placeInMargin(L, [0.6, 0.6]);
    if (!slot){ toast('No room for a callout on this sheet'); return; }
    pushUndo();
    const bubble = makeDetailCallout(slot.x + 0.3, slot.y + 0.3, {
      sheetId: target.id,
      viewId: (target.viewports[0] && target.viewports[0].id) || 1
    });
    state.layouts[i] = addAnnotation(L, bubble);
    renderLayouts(); afterChange();
    const t = detailBubbleText(state.layouts, bubble);
    toast('Detail ' + t.top + ' on ' + t.bottom);
  });

  $('mKeynotes') && $('mKeynotes').addEventListener('click', () => {
    closeSheets();
    const sheet = state.space !== 'model' ? activeLayout() : null;
    const rows = keynoteRows(state.entities, sheet);
    if (!rows.length){ toast('Nothing is marked yet'); return; }
    pushUndo();
    if (sheet){
      /* A legend belongs to the sheet, in paper inches, so it keeps its size
       * whatever scale the views are drawn at. */
      const t = buildKeynoteLegend(state.entities, sheet, [0, 0], { colW: paperKeynoteColW() });
      t.rowH = 0.22;
      const size = [t.colW.reduce((a, b) => a + b, 0), (t.cells.length + 1) * t.rowH];
      const slot = placeInMargin(sheet, size);
      if (!slot){ toast('No room on this sheet for a legend'); return; }
      const idx = state.layouts.findIndex(x => x.id === sheet.id);
      state.layouts[idx] = addAnnotation(sheet, makeTableAnnotation(slot.x, slot.y, t));
    } else {
      const bb = membersBBox(state.entities);
      addEntity(buildKeynoteLegend(state.entities, sheet, [bb[2] + 3, bb[3]]));
    }
    afterChange();
    toast(rows.length + ' keynote' + (rows.length === 1 ? '' : 's') + (sheet ? ' on ' + (sheet.sheetNumber || sheet.name) : ''));
  });

  $('mMarkSched') && $('mMarkSched').addEventListener('click', () => {
    closeSheets();
    const sheet = state.space !== 'model' ? activeLayout() : null;
    const groups = collectMarks(state.entities);
    if (!groups.length){ toast('Nothing is marked yet'); return; }
    const cols = scheduleColumns(state.entities);
    pushUndo();
    if (sheet){
      const t = buildMarkSchedule(state.entities, sheet, [0, 0], {
        columns: cols.length ? cols : undefined,
        colW: paperScheduleColW(cols.length ? cols : undefined)
      });
      t.rowH = 0.22;
      const size = [t.colW.reduce((a, b) => a + b, 0), (t.cells.length + 1) * t.rowH];
      const slot = placeInMargin(sheet, size);
      if (!slot){ toast('No room on this sheet for a schedule'); return; }
      const idx = state.layouts.findIndex(x => x.id === sheet.id);
      state.layouts[idx] = addAnnotation(sheet, makeTableAnnotation(slot.x, slot.y, t));
    } else {
      const bb = membersBBox(state.entities);
      addEntity(buildMarkSchedule(state.entities, sheet, [bb[2] + 3, bb[1] + 14], { columns: cols.length ? cols : undefined }));
    }
    afterChange();
    const total = groups.reduce((n, g) => n + g.qty, 0);
    toast(groups.length + ' mark' + (groups.length === 1 ? '' : 's') + ', ' + total + ' total');
  });

  $('mExportAllPDF') && $('mExportAllPDF').addEventListener('click', () => {
    closeSheets();
    if (!state.entities.length){ toast('Nothing to export yet'); return; }
    const bb = membersBBox(state.entities);
    state.layouts.forEach(L => L.viewports.forEach(v => { if (v.mx === 0 && v.my === 0) fitViewport(v, bb); }));
    const { pdf, pages } = buildAllSheetsPDF(state.entities, {
      sheets: state.layouts,
      layerVisible: name => {
        const L = layerByName(name);
        return !L || (L.visible !== false && L.plot !== false);
      },
      projectName: state.projectName,
      firm: state.firm
    });
    download(fileSlug() + '-sheets.pdf', pdf, 'application/pdf');
    toast(pages + ' sheet' + (pages === 1 ? '' : 's') + ' exported');
  });
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

  renderSpaceTabs();

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
  document.addEventListener('sd-view3d', () => openView3d());
  document.addEventListener('sd-view2d', () => closeView3d());
  document.addEventListener('sd-height', () => { syncCtx(); if (state.view3d) syncOpen3d(); });
}

function requireLayout(){
  return { makeViewport: (sheet, ppf) => {
    const s = SHEETS[sheet] || SHEETS.letter;
    const m = 0.5, tb = TITLE_BLOCK_H;
    return { px: m, py: m + tb, pw: s.w - m * 2, ph: s.h - m * 2 - tb, mx: 0, my: 0, ppf: ppf || 18 };
  } };
}

/* Sheet navigator: Model plus one tab per sheet, rebuilt whenever the sheet
 * set changes so adding a sheet is immediately reachable. */
function renderSpaceTabs(){
  const box = $('spacetabs'); if (!box) return;
  box.innerHTML = '';
  const mk = (label, space, on) => {
    const b = document.createElement('button');
    b.className = 'stab' + (on ? ' on' : '');
    b.textContent = label;
    b.dataset.space = space;
    b.addEventListener('click', () => goToSpace(space));
    box.appendChild(b);
  };
  mk('Model', 'model', state.space === 'model');
  state.layouts.forEach(L => mk(L.sheetNumber || L.name, L.id, state.space === L.id));
}

function goToSpace(space){
  if (space === 'model'){ state.space = 'model'; }
  else {
    state.currentLayout = space;
    state.space = space;
    const L = activeLayout();
    const bb = membersBBox(state.entities.length ? state.entities : [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    if (L) L.viewports.forEach(v => { if (v.mx === 0 && v.my === 0) fitViewport(v, bb); });
  }
  renderSpaceTabs(); syncCtx(); draw();
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
      renderLayouts(); renderSpaceTabs(); syncCtx(); draw();
    });
    box.appendChild(r);
  });
}

/* Static PWA entry (GitHub Pages / Vite). The React host boots via boot(#cad-host) instead.
 * embed.html / ?embed=1 / ?src= is claimed by src/embed.js so we don't double-boot. */
if (typeof document !== 'undefined'){
  const staticRoot = document.getElementById('app');
  let embedMode = false;
  try {
    const q = new URLSearchParams(location.search);
    embedMode = q.get('embed') === '1' || q.has('src') || (document.body && document.body.classList.contains('embed'));
  } catch (e){ embedMode = false; }
  if (staticRoot && !booted && !embedMode){
    boot(staticRoot);
    /* The service worker registers itself. vite-plugin-pwa injects its own
     * registerSW script into the page, so there is nothing to do here. The
     * dynamic import that used to sit here was marked vite-ignore, which
     * left a bare specifier the browser cannot resolve: it failed on every
     * single page load and logged an error for a registration that had
     * already happened. */
  }
}


