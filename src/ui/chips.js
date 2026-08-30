/* Context row, status bar, command prompt. */
import { state, layerByName, selMembers, afterChange } from '../core/state.js';
import { ix } from '../interaction.js';
import { fmtFtIn } from '../core/format.js';
import { defaultPrompt } from '../core/command.js';
import { WALL_THICKNESS } from '../core/walls.js';
import { entityLength, entityArea } from '../core/modify.js';
import { LTYPE_NAMES, LINEWEIGHTS_MM, fmtLw } from '../core/style.js';
import { HATCH_PATTERNS } from '../core/hatch.js';
import { applyProps } from '../actions.js';
import { DOOR_WIDTHS, WINDOW_WIDTHS } from '../core/dynblock.js';

const LT_SHORT = { CONTINUOUS: 'CONT', DASHED: 'DASH', HIDDEN: 'HID', CENTER: 'CTR', PHANTOM: 'PHAN', DOT: 'DOT', DIVIDE: 'DIV', BORDER: 'BOR' };

export function setPrompt(s){
  ix.lastPrompt = s || 'Command:';
  const el = document.getElementById('cmdprompt');
  if (el) el.textContent = ix.lastPrompt;
}

export function updateStatus(pt, from){
  const xy = document.getElementById('stXY');
  const ln = document.getElementById('stLen');
  const an = document.getElementById('stAng');
  if (pt && xy) xy.textContent = 'X ' + fmtFtIn(pt[0]) + '   Y ' + fmtFtIn(pt[1]);
  if (from && pt && ln && an){
    const dx = pt[0] - from[0], dy = pt[1] - from[1];
    const L = Math.sqrt(dx * dx + dy * dy);
    let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 360;
    ln.textContent = 'L ' + fmtFtIn(L);
    an.textContent = 'A ' + Math.round(a) + '°';
  } else {
    if (ln) ln.textContent = 'L ' + (state.lastLen ? fmtFtIn(state.lastLen) : '—');
    if (an) an.textContent = 'A ' + (state.lastAng ? Math.round(state.lastAng) + '°' : '—');
  }
}

export function syncCtx(){
  const $ = id => document.getElementById(id);
  const L = layerByName(state.currentLayer);
  if ($('chipLayerSw')) $('chipLayerSw').style.background = L ? L.color : '#d4a843';
  if ($('chipLayerNm')) $('chipLayerNm').textContent = state.currentLayer;
  if ($('chipClose')) $('chipClose').style.display = ((state.tool === 'poly' || state.tool === 'hatch' || state.tool === 'cloud' || state.tool === 'leader') && ix.polyPts.length > 2) ? '' : 'none';
  if ($('chipDone')) $('chipDone').style.display = ((state.tool === 'poly' || state.tool === 'hatch' || state.tool === 'cloud' || state.tool === 'leader') && ix.polyPts.length > 1) ? '' : 'none';
  if ($('chipOffDist')){
    $('chipOffDist').style.display = state.tool === 'offset' ? '' : 'none';
    $('chipOffDist').textContent = 'OFFSET ' + fmtFtIn(state.offsetDist || 0.5);
  }
  if ($('chipFilletR')){
    $('chipFilletR').style.display = state.tool === 'fillet' ? '' : 'none';
    $('chipFilletR').textContent = 'RADIUS ' + fmtFtIn(state.filletR);
  }
  if ($('chipChamferD')){
    $('chipChamferD').style.display = state.tool === 'chamfer' ? '' : 'none';
    $('chipChamferD').textContent = 'CHAMFER ' + fmtFtIn(state.chamferD);
  }
  const boxChip = $('chipBox');
  if (boxChip){
    boxChip.style.display = state.tool === 'select' ? '' : 'none';
    boxChip.classList.toggle('on', state.boxMode);
  }
  const ms = selMembers();
  const has = ms.length > 0;
  const anyG = ms.some(e => !!e.g);
  const anyInsert = ms.some(e => e.type === 'insert');
  const wallSel = ms.some(e => e.kind === 'wall');
  ['chipDelete','chipRotate','chipDup','chipAssign','chipBlock'].forEach(id => { if ($(id)) $(id).style.display = has ? '' : 'none'; });
  if ($('chipExplode')) $('chipExplode').style.display = (anyG || anyInsert || ms.some(e => e.type === 'table')) ? '' : 'none';
  if ($('chipEditTxt')) $('chipEditTxt').style.display = (ms.length === 1 && ms[0].type === 'text') ? '' : 'none';
  if ($('chipFlip')) $('chipFlip').style.display = (ms.length === 1 && (ms[0].type === 'dim' || ms[0].type === 'insert')) ? '' : 'none';
  if ($('chipDoor')) $('chipDoor').style.display = wallSel ? '' : 'none';
  if ($('chipWindow')) $('chipWindow').style.display = wallSel ? '' : 'none';

  if ($('chipSnap')) $('chipSnap').classList.toggle('on', state.snapOn);
  if ($('chipOrtho')) $('chipOrtho').classList.toggle('on', state.orthoOn);
  if ($('chipPolar')) $('chipPolar').classList.toggle('on', state.polarOn);
  if ($('stSnap')) $('stSnap').classList.toggle('on', state.snapOn);
  if ($('stOrtho')) $('stOrtho').classList.toggle('on', state.orthoOn);
  if ($('stPolar')) $('stPolar').classList.toggle('on', state.polarOn);
  if ($('stWall')) $('stWall').classList.toggle('on', state.wallMode || state.tool === 'wall');
  if ($('stUnits')){
    const u = state.units === 'mm' ? 'MM' : (state.units === 'm' ? 'M' : 'FT');
    $('stUnits').textContent = u;
    $('stUnits').classList.toggle('on', state.units !== 'ft');
  }
  const th = WALL_THICKNESS.find(t => Math.abs(t.th - state.wallTh) < 1e-6);
  if ($('chipWall')){
    $('chipWall').classList.toggle('on', state.wallMode || state.tool === 'wall');
    $('chipWall').textContent = 'WALL ' + (th ? th.label : '6"');
  }
  const lt = state.currentLt || 'CONTINUOUS';
  if ($('chipLt')){
    $('chipLt').textContent = 'LT ' + (LT_SHORT[lt] || lt.slice(0, 4));
    $('chipLt').classList.toggle('on', lt !== 'CONTINUOUS');
  }
  if ($('chipLw')){
    const lw = state.currentLw || 0;
    $('chipLw').textContent = 'LW ' + (lw ? Number(lw).toFixed(2) : 'DEF');
    $('chipLw').classList.toggle('on', !!lw);
  }
  if ($('chipDimSt')) $('chipDimSt').textContent = 'DIM ' + (state.currentDimStyle || 'ARCH');
  if ($('chipHatchPat')){
    $('chipHatchPat').style.display = state.tool === 'hatch' ? '' : 'none';
    $('chipHatchPat').textContent = state.hatchPattern || 'ANSI31';
  }
  if ($('stSpace')) $('stSpace').textContent = state.space === 'model' ? 'MODEL' : (state.currentLayout || 'PAPER');
  if ($('tabLayout')){
    const Lyt = state.layouts.find(l => l.id === state.currentLayout);
    $('tabLayout').textContent = Lyt ? Lyt.name.split(' ')[0] : 'A-1';
    $('tabLayout').classList.toggle('on', state.space !== 'model');
  }
  const modelTab = document.querySelector('.stab[data-space="model"]');
  if (modelTab) modelTab.classList.toggle('on', state.space === 'model');

  setPrompt(defaultPrompt(state.tool, state));
  updateStatus(state.lastPt);
  renderProps();
}

export function markActiveTool(){
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === state.tool));
}

function uniq(ms, get){
  const s = new Set(ms.map(get));
  return s.size === 1 ? [...s][0] : null;
}

function addRow(box, label, value){
  const r = document.createElement('div');
  r.className = 'prow';
  r.innerHTML = '<span>' + label + '</span><b>' + value + '</b>';
  box.appendChild(r);
}

function addSelect(box, label, value, options, onChange){
  const r = document.createElement('div');
  r.className = 'prow';
  const sp = document.createElement('span');
  sp.textContent = label;
  const sel = document.createElement('select');
  sel.className = 'field';
  if (value == null){
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'varies'; o.selected = true;
    sel.appendChild(o);
  }
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value; o.textContent = opt.label;
    if (value != null && String(opt.value) === String(value)) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { if (sel.value !== '') onChange(sel.value); });
  r.appendChild(sp); r.appendChild(sel);
  box.appendChild(r);
}

export function renderProps(){
  const box = document.getElementById('proplist');
  if (!box) return;
  const ms = selMembers();
  box.innerHTML = '';
  if (!ms.length){
    box.innerHTML = '<div class="subtle">Nothing selected. LT / LW / DIM chips set the style for new objects.</div>';
    return;
  }
  const e = ms[0];
  addRow(box, 'Count', String(ms.length));
  addRow(box, 'Type', e.type + (e.kind ? ' / ' + e.kind : (e.def ? ' / ' + e.def : '')));
  addSelect(box, 'Layer', uniq(ms, x => x.layer || ''),
    state.layers.map(L => ({ value: L.name, label: L.name })),
    v => applyProps({ layer: v }));
  addSelect(box, 'Linetype', uniq(ms, x => (x.lt || 'CONTINUOUS').toUpperCase()),
    LTYPE_NAMES.map(n => ({ value: n, label: n })),
    v => applyProps({ lt: v }));
  addSelect(box, 'Lineweight', uniq(ms, x => String(x.lw || 0)),
    LINEWEIGHTS_MM.map(n => ({ value: String(n), label: fmtLw(n) })),
    v => applyProps({ lw: Number(v) }));
  if (ms.some(x => x.type === 'dim')){
    addSelect(box, 'Dim style', uniq(ms.filter(x => x.type === 'dim'), x => x.dimStyle || state.currentDimStyle || 'ARCH'),
      (state.dimStyles || []).map(s => ({ value: s.name, label: s.name })),
      v => applyProps({ dimStyle: v }));
  }
  if (ms.length === 1 && e.type === 'insert' && (e.def === 'door' || e.def === 'window')){
    const widths = e.def === 'window' ? WINDOW_WIDTHS : DOOR_WIDTHS;
    addSelect(box, 'Width', String(e.width || 3),
      widths.map(w => ({ value: String(w), label: fmtFtIn(w) })),
      v => applyProps({ width: Number(v) }));
    addSelect(box, 'Swing', e.swing || 'L',
      [{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }],
      v => applyProps({ swing: v }));
  }
  if (ms.length === 1 && e.type === 'insert' && e.mark) addRow(box, 'Mark', e.mark);
  if (ms.length === 1 && e.type === 'insert' && e.name) addRow(box, 'Block', e.name);
  const len = ms.reduce((s, x) => s + entityLength(x), 0);
  const area = ms.reduce((s, x) => s + entityArea(x), 0);
  if (len) addRow(box, 'Length', fmtFtIn(len));
  if (area) addRow(box, 'Area', fmtFtIn(area) + '²');
}

export function renderHistory(){
  const el = document.getElementById('cmdhist');
  if (el) el.textContent = (state.cmdHistory || []).slice().reverse().join('\n') || '(empty)';
}

export function cycleCurrentLt(){
  const i = LTYPE_NAMES.indexOf(state.currentLt || 'CONTINUOUS');
  state.currentLt = LTYPE_NAMES[(i + 1) % LTYPE_NAMES.length];
  if (selMembers().length) applyProps({ lt: state.currentLt });
  else { afterChange(); }
  return state.currentLt;
}

export function cycleCurrentLw(){
  const i = LINEWEIGHTS_MM.indexOf(state.currentLw || 0);
  const next = LINEWEIGHTS_MM[(i + 1) % LINEWEIGHTS_MM.length];
  state.currentLw = next;
  if (selMembers().length) applyProps({ lw: next });
  else { afterChange(); }
  return next;
}

export function cycleDimStyle(){
  const styles = state.dimStyles || [];
  if (!styles.length) return state.currentDimStyle;
  const i = styles.findIndex(s => s.name === state.currentDimStyle);
  const next = styles[(i + 1) % styles.length];
  state.currentDimStyle = next.name;
  if (selMembers().some(e => e.type === 'dim')) applyProps({ dimStyle: next.name });
  else { afterChange(); }
  return next.name;
}

export function cycleHatchPattern(){
  const names = Object.keys(HATCH_PATTERNS);
  const i = Math.max(0, names.indexOf(state.hatchPattern || 'ANSI31'));
  state.hatchPattern = names[(i + 1) % names.length];
  afterChange();
  return state.hatchPattern;
}
