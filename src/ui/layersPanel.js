import { state, selMembers, pushUndo, afterChange } from '../core/state.js';
import { ix } from '../interaction.js';
import { closeSheets } from './sheets.js';
import { toast } from './toast.js';
import { syncCtx } from './chips.js';
import { draw } from '../render/draw.js';

export function renderLayers(){
  document.getElementById('assignNote').style.display = ix.assignMode ? 'block' : 'none';
  const box = document.getElementById('layerlist'); box.innerHTML = '';
  state.layers.forEach(L => {
    const r = document.createElement('div'); r.className = 'row' + (L.name === state.currentLayer ? ' cur' : '');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = L.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = L.name;
    const eye = document.createElement('button'); eye.className = 'eye' + (L.visible ? '' : ' off');
    eye.title = L.visible ? 'Hide' : 'Show';
    eye.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    eye.addEventListener('click', ev => { ev.stopPropagation(); L.visible = !L.visible; renderLayers(); draw(); });
    const lock = document.createElement('button'); lock.className = 'eye' + (L.locked ? '' : ' off');
    lock.title = L.locked ? 'Unlock' : 'Lock';
    lock.innerHTML = L.locked
      ? '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
    lock.addEventListener('click', ev => { ev.stopPropagation(); L.locked = !L.locked; renderLayers(); draw(); });
    const plot = document.createElement('button'); plot.className = 'eye' + (L.plot === false ? ' off' : '');
    plot.title = L.plot === false ? 'Not plotted' : 'Plot';
    plot.textContent = 'P';
    plot.style.font = '600 10px Outfit, system-ui';
    plot.addEventListener('click', ev => { ev.stopPropagation(); L.plot = L.plot === false; renderLayers(); });
    r.appendChild(sw); r.appendChild(nm); r.appendChild(eye); r.appendChild(lock); r.appendChild(plot);
    r.addEventListener('click', () => {
      if (ix.assignMode){
        const ms = selMembers();
        if (ms.length){ pushUndo(); ms.forEach(e => { e.layer = L.name; }); }
        closeSheets(); afterChange(); toast('Moved to ' + L.name);
      } else {
        state.currentLayer = L.name; renderLayers(); syncCtx();
      }
    });
    box.appendChild(r);
  });
}
