/* High-resolution PNG export with a title block and scale bar. Returns a
 * canvas; the caller turns it into a blob and downloads it.
 */
import { membersBBox } from '../core/entities.js';
import { clamp } from '../core/geometry.js';
import { drawEnt } from '../render/ent.js';

export function renderPNG(entities, layerByName, projectName, styles){
  const bb = membersBBox(entities);
  const wft = Math.max(bb[2] - bb[0], 1) + 4, hft = Math.max(bb[3] - bb[1], 1) + 4;
  const ppf = clamp(2200 / wft, 8, 60);
  const W = Math.round(wft * ppf), TB = 96, H = Math.round(hft * ppf) + TB;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const oc = off.getContext('2d');
  oc.fillStyle = '#07101f'; oc.fillRect(0, 0, W, H);
  const ox = bb[0] - 2, oy = bb[3] + 2;
  const toS = (x, y) => [(x - ox) * ppf, (oy - y) * ppf];
  for (const e of entities){
    const L = layerByName(e.layer);
    if (L && !L.visible) continue;
    drawEnt(oc, e, L ? L.color : '#e8e4dd', false, toS, ppf, undefined, styles);
  }
  const ty = H - TB;
  oc.fillStyle = '#0b1830'; oc.fillRect(0, ty, W, TB);
  oc.strokeStyle = '#d4a843'; oc.lineWidth = 2;
  oc.beginPath(); oc.moveTo(0, ty); oc.lineTo(W, ty); oc.stroke();
  oc.fillStyle = '#00d4b8'; oc.beginPath(); oc.arc(26, ty + 34, 5, 0, Math.PI * 2); oc.fill();
  oc.font = '600 10px Outfit, system-ui'; oc.textAlign = 'left'; oc.textBaseline = 'alphabetic';
  oc.fillText('S O V E R E I G N', 40, ty + 26);
  oc.fillStyle = '#e8e4dd'; oc.font = '600 24px "Playfair Display", Georgia, serif';
  oc.fillText(projectName || 'Sovereign Draft', 40, ty + 52);
  oc.fillStyle = '#8fa3c0'; oc.font = '300 12px Outfit, system-ui';
  oc.fillText(new Date().toLocaleDateString() + '  ·  units: feet', 40, ty + 74);
  let barFt = 10; if (barFt * ppf > W / 3) barFt = 5; if (barFt * ppf > W / 3) barFt = 2;
  const bw = barFt * ppf, bx = W - bw - 30, by = ty + 48;
  oc.strokeStyle = '#e8e4dd'; oc.lineWidth = 2;
  oc.beginPath(); oc.moveTo(bx, by); oc.lineTo(bx + bw, by); oc.stroke();
  oc.beginPath(); oc.moveTo(bx, by - 6); oc.lineTo(bx, by + 6); oc.stroke();
  oc.beginPath(); oc.moveTo(bx + bw, by - 6); oc.lineTo(bx + bw, by + 6); oc.stroke();
  oc.beginPath(); oc.moveTo(bx + bw / 2, by - 4); oc.lineTo(bx + bw / 2, by + 4); oc.stroke();
  oc.fillStyle = '#8fa3c0'; oc.font = '300 12px Outfit, system-ui'; oc.textAlign = 'center';
  oc.fillText(barFt + ' FT', bx + bw / 2, by - 12);
  return off;
}
