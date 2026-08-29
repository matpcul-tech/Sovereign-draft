import { state } from '../core/state.js';
import { SYMBOLS } from '../core/symbols.js';
import { closeSheets } from './sheets.js';
import { toast } from './toast.js';

export function renderSymbols(){
  const box = document.getElementById('symgrid'); box.innerHTML = '';
  SYMBOLS.forEach((s, i) => {
    const b = document.createElement('button'); b.className = 'symb';
    const d = document.createElement('div'); d.textContent = s.name;
    const sm = document.createElement('small'); sm.textContent = s.sub;
    b.appendChild(d); b.appendChild(sm);
    b.addEventListener('click', () => {
      state.activeSym = { u: false, i }; closeSheets();
      toast(s.name + ': tap the sheet to place');
    });
    box.appendChild(b);
  });
  const bw = document.getElementById('blkwrap'), bg = document.getElementById('blkgrid');
  bg.innerHTML = '';
  bw.style.display = state.userBlocks.length ? '' : 'none';
  state.userBlocks.forEach((s, i) => {
    const b = document.createElement('button'); b.className = 'symb';
    const d = document.createElement('div'); d.textContent = s.name;
    const sm = document.createElement('small'); sm.textContent = 'block';
    b.appendChild(d); b.appendChild(sm);
    b.addEventListener('click', () => {
      state.activeSym = { u: true, i }; closeSheets();
      toast(s.name + ': tap the sheet to place');
    });
    bg.appendChild(b);
  });
}
