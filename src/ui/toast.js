export function toast(msg, ms){
  const t = document.getElementById('toast');
  if (!t) return;
  /* The toast points at the tool rows often enough that it must never
   * sit on top of them: anchor it just above whatever the bottom panel
   * currently measures, statusbar included. */
  try {
    const bottom = document.getElementById('bottom');
    const status = document.getElementById('statusbar');
    const rise = (bottom ? bottom.getBoundingClientRect().height : 0) +
      (status ? status.getBoundingClientRect().height : 0);
    if (rise > 0) t.style.bottom = Math.round(rise + 14) + 'px';
  } catch (e){ /* node */ }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2200);
}
