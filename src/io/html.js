/* A drawing you can email. No server, no seat — one HTML file with a page
 * per sheet, the schedule, and the JSON so it can be opened again.
 */
import { buildSVG } from './svg.js';
import { collectParts, buildingSchedule } from '../core/spec.js';
import { serializeProject } from './project.js';
import { entsInBBox } from '../core/legend.js';

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

function tableHtml(headers, rows){
  if (!rows || !rows.length) return '';
  const head = headers.map(h => '<th>' + esc(h) + '</th>').join('');
  const body = rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
  return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function svgForLayout(layout, ents, layers){
  const subset = (layout && layout.section && layout.section.bbox)
    ? entsInBBox(ents, layout.section.bbox, 0.4)
    : ents;
  return buildSVG(subset && subset.length ? subset : ents, layers);
}

export function toHTML(doc, opts){
  const o = opts || {};
  const d = doc || {};
  const layers = d.layers || [];
  const ents = d.entities || [];
  const layouts = d.layouts || [];
  const parts = collectParts(ents);
  const built = !parts.length ? buildingSchedule(ents) : null;
  const firm = d.firm || {};
  const name = d.name || 'Untitled';
  const json = serializeProject({
    projectName: name,
    firm,
    idSeq: ents.length + 1,
    gSeq: 1,
    layers,
    entities: ents,
    userBlocks: d.userBlocks || [],
    dimStyles: d.dimStyles,
    currentDimStyle: d.currentDimStyle,
    layouts,
    currentLayout: d.currentLayout,
    space: d.space,
    dxfVer: d.dxfVer,
    units: d.units
  }, true);

  const sheets = tableHtml(
    ['Sheet', 'Title'],
    layouts.map(L => [L.sheetNumber || L.id || '', L.name || ''])
  );
  const schedule = parts.length
    ? tableHtml(['Mark', 'Qty', 'Description', 'Size', 'Material'],
        parts.map(p => [p.mark, p.qty, p.desc, p.size, p.material || '—']))
    : (built && built.cells
      ? ((built.title ? '<p>' + esc(built.title) + '</p>' : '') + tableHtml(built.cells[0], built.cells.slice(1)))
      : '');

  const pages = (layouts.length ? layouts : [null]).map((L, i) => {
    const title = L ? ((L.sheetNumber || '') + ' ' + (L.name || '')).trim() : 'Model';
    const svg = L ? svgForLayout(L, ents, layers) : buildSVG(ents, layers, o);
    return '<article class="page" id="sheet-' + i + '"><h3>' + esc(title) + '</h3><div class="sheet">' + svg + '</div></article>';
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Sovereign Draft</title>
<style>
:root{--navy:#07101f;--gold:#d4a843;--ink:#e8e4dd;--dim:#8fa3c0;--line:#1b2c4a;--card:#0d1b33}
*{box-sizing:border-box}body{margin:0;background:var(--navy);color:var(--ink);font:15px/1.45 Outfit,system-ui,sans-serif}
header{padding:28px 32px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand{letter-spacing:.22em;font-size:11px;color:#00d4b8;font-weight:600}
h1{font-family:Georgia,serif;font-size:28px;margin:4px 0 0;font-weight:600}
h1 span{color:var(--gold)}
.meta{color:var(--dim);font-size:13px;text-align:right}
main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;padding:24px 32px 48px}
@media(max-width:900px){main{grid-template-columns:1fr}}
.pages{display:flex;flex-direction:column;gap:20px}
.page h3{margin:0 0 8px;font-size:13px;letter-spacing:.12em;color:var(--gold)}
.sheet{background:#f4efe4;border-radius:8px;padding:16px;overflow:auto}
.sheet svg{width:100%;height:auto;display:block}
aside h2{font-size:12px;letter-spacing:.14em;color:var(--gold);margin:0 0 10px}
aside section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)}
th{color:var(--gold);font-weight:600}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
button{background:var(--gold);color:var(--navy);border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;font-size:13px}
footer{padding:16px 32px 32px;color:var(--dim);font-size:12px}
@media print{aside,header .actions,footer{display:none}body{background:#fff;color:#111} .page{break-after:page}}
</style>
</head>
<body>
<header>
  <div>
    <div class="brand">SOVEREIGN DRAFT</div>
    <h1>${esc(name)} <span>issued</span></h1>
  </div>
  <div class="meta">
    ${esc(firm.company || '')}${firm.copyright ? '<br>' + esc(firm.copyright) : ''}
    <div class="actions">
      <button type="button" id="dl-json">Download JSON</button>
    </div>
  </div>
</header>
<main>
  <div class="pages">${pages}</div>
  <aside>
    <section>
      <h2>SHEETS</h2>
      ${sheets || '<p>No sheet set.</p>'}
    </section>
    <section>
      <h2>SCHEDULE</h2>
      ${schedule || '<p>No parts scheduled.</p>'}
    </section>
  </aside>
</main>
<footer>Opened without a CAD license. JSON is the source of truth — drop it back on sovereign-draft to edit.</footer>
<script type="application/json" id="drawing">${json.replace(/</g, '\\u003c')}</script>
<script>
document.getElementById('dl-json').onclick = function(){
  const t = document.getElementById('drawing').textContent;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], {type:'application/json'}));
  a.download = ${JSON.stringify((name || 'drawing').replace(/[^\w.-]+/g, '-'))} + '.json';
  a.click();
};
</script>
</body>
</html>
`;
}
