import { ix } from '../interaction.js';

export function openSheet(id){
  closeSheets();
  document.getElementById('backdrop').classList.add('open');
  document.getElementById(id).classList.add('open');
}

export function closeSheets(){
  document.getElementById('backdrop').classList.remove('open');
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
  ix.assignMode = false;
  const note = document.getElementById('assignNote');
  if (note) note.style.display = 'none';
}

export function anySheetOpen(){
  return !!document.querySelector('.sheet.open');
}
