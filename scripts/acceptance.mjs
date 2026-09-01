/* The whole program in one pass.
 *
 * One continuous session against the built app, driven by real pointer and
 * key events, followed by node-side exchange checks against the source.
 * Every claim the unit tests hold in isolation is exercised here in
 * composition: draw, model, stack, roof, document, touch, edit, take off,
 * undo, and round trip. Any failed check or page error fails the run.
 *
 * Run with: npm run build && npx vite preview --port 4173 &
 *           node scripts/acceptance.mjs
 */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
};

/* ---------- browser phase ---------- */
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const cmd = async (t, w = 700) => {
  await page.evaluate(() => document.getElementById('cmdinput').focus());
  await page.fill('#cmdinput', t);
  await page.press('#cmdinput', 'Enter');
  await page.waitForTimeout(w);
};
const S = (fn, arg) => page.evaluate(fn, arg);

console.log('drawing set from one plan');
await S(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Sample cabin'); if (b) b.click(); });
await page.waitForTimeout(900);
const baseline = await S(() => window.__sovereign.state.entities.length);
const depthAfterLoad = await S(() => window.__sovereign.state.undoStack.length);
await cmd('MODEL', 1500);
check('MODEL buckets the plan into solids', await S(() => window.__sovereign.state.solids.length >= 4),
  await S(() => window.__sovereign.state.solids.map(s => s.name).join(',')));
await cmd('STACK 2', 1200);
check('STACK doubles the storey', await S(() => window.__sovereign.state.solids.some(s => /-L2$/.test(s.name))));
await cmd('DRAWINGS HIP 6 SHEETS', 25000);
const set = await S(() => {
  const s = window.__sovereign.state;
  return {
    titles: s.entities.filter(e => e.type === 'text' && /(LEVEL \d+ PLAN|ELEVATION|ROOF PLAN|SECTION .* AT)/.test(e.content || '')).map(e => e.content),
    marker: s.entities.filter(e => e.type === 'cutplane').length,
    poche: s.entities.filter(e => e.type === 'hatch' && e.layer === 'SECTION').length,
    openings: s.entities.filter(e => e.layer === 'OPENINGS').length,
    dims: s.entities.filter(e => e.type === 'dim').length,
    sheets: s.layouts.filter(L => /^V/.test(L.id)).map(L => L.sheetNumber)
  };
});
check('two level plans, four elevations, roof plan, section titled', set.titles.length === 8, set.titles.join(' | '));
check('the section marker lands on the plan', set.marker >= 1);
check('poche hatches the cuts', set.poche >= 2, set.poche);
check('openings show per facade and beyond the cut', set.openings >= 4, set.openings);
check('views arrive dimensioned', set.dims >= 10, set.dims);
check('sheets ladder plans, elevations, section', set.sheets.length >= 8, set.sheets.join(','));
await cmd('QTO', 900);
check('QTO tables the model with a total row', await S(() => {
  const t = window.__sovereign.state.entities.find(e => e.type === 'table' && e.title === 'MODEL TAKEOFF');
  return !!t && t.cells[t.cells.length - 1][0] === 'TOTAL';
}));

console.log('the model is touchable');
await S(() => document.getElementById('cmdinput').blur());
await S(() => { const b3 = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '3D'); if (b3) b3.click(); });
await page.waitForTimeout(2500);
const cb = await S(() => { const r = document.getElementById('cv3d').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
let sel = null;
outer: for (let fy = 0.3; fy <= 0.7; fy += 0.05){
  for (let fx = 0.15; fx <= 0.85; fx += 0.05){
    await page.mouse.click(cb.x + cb.w * fx, cb.y + cb.h * fy);
    await page.waitForTimeout(70);
    const n = await S(() => { const el = document.querySelector('.v3d-sel'); return el && el.style.display !== 'none' ? el.textContent.split(' ·')[0].trim() : null; });
    if (n === 'ROOF'){ sel = { x: cb.x + cb.w * fx, y: cb.y + cb.h * fy }; break outer; }
  }
}
check('click selects the roof by name', !!sel);
const roofBB = () => S(() => {
  const r = window.__sovereign.state.solids.find(s => s.name === 'ROOF');
  let z0 = 1e9, x0 = 1e9;
  for (const v of r.mesh.verts){ z0 = Math.min(z0, v[2]); x0 = Math.min(x0, v[0]); }
  return { z0, x0 };
});
const roofXYZ = () => S(() => {
  const r = window.__sovereign.state.solids.find(s => s.name === 'ROOF');
  const m = [1e9, 1e9, 1e9];
  for (const v of r.mesh.verts){ m[0] = Math.min(m[0], v[0]); m[1] = Math.min(m[1], v[1]); m[2] = Math.min(m[2], v[2]); }
  return m;
});
const before = await roofXYZ();
/* typed exact move: 6 ft along whichever axis the drag was going */
await page.mouse.move(sel.x, sel.y);
await page.mouse.down();
for (let i = 1; i <= 5; i++){ await page.mouse.move(sel.x + 12 * i, sel.y); await page.waitForTimeout(25); }
const dragHudText = await S(() => document.querySelector('.v3d-sel').textContent);
for (const ch of '6') await page.keyboard.press(ch);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.mouse.up();
await page.waitForTimeout(400);
const moved = await roofXYZ();
const deltas = [moved[0] - before[0], moved[1] - before[1], moved[2] - before[2]];
const oneAxisSix = deltas.filter(d => Math.abs(Math.abs(d) - 6) < 1e-6).length === 1
  && deltas.filter(d => Math.abs(d) < 1e-6).length === 2;
check('typed move lands exactly 6 ft on one axis', oneAxisSix,
  deltas.map(d => d.toFixed(3)).join(',') + ' hud: ' + dragHudText);
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const undone = await roofXYZ();
check('one undo returns the move', Math.abs(undone[0] - before[0]) + Math.abs(undone[1] - before[1]) + Math.abs(undone[2] - before[2]) < 1e-6);
/* measure reads zero on a repeated point */
await page.keyboard.press('m');
await page.waitForTimeout(150);
await page.mouse.click(sel.x, sel.y);
await page.waitForTimeout(150);
await page.mouse.click(sel.x, sel.y);
await page.waitForTimeout(250);
check('measure of the same point is zero', await S(() => /0"/.test(document.querySelector('.v3d-sel').textContent)));
await page.keyboard.press('m');
await page.waitForTimeout(150);

console.log('push-pull is exact');
await cmd('BOX 200 0 0 10 10 10', 500);
await S(() => document.getElementById('cmdinput').blur());
const vol = name => S(n => {
  const s = window.__sovereign.state.solids.find(x => x.name === n);
  let v = 0;
  for (const f of s.mesh.faces){
    const a = s.mesh.verts[f[0]], b = s.mesh.verts[f[1]], c = s.mesh.verts[f[2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) + b[0] * (c[1] * a[2] - a[1] * c[2]) + c[0] * (a[1] * b[2] - a[2] * b[1])) / 6;
  }
  return Math.abs(v);
}, name);
const ppOk = await S(() => {
  /* the scripted door: exactness without pixel hunting */
  const before2 = window.__sovereign.state.solids.find(s => s.name === 'BOX').mesh.faces.length;
  return before2 > 0;
});
check('a fresh box exists for face work', ppOk);
await cmd('JS', 400);
await S(() => { const el = document.getElementById('scCode'); if (el) el.value = "print('v', sd.solid.pushpull('BOX', 0, 5));"; });
await S(() => { const b = document.getElementById('scRun'); if (b) b.click(); });
await page.waitForTimeout(800);
const scOut = await S(() => (document.getElementById('scOut') || {}).textContent || '');
await S(() => { const c = document.querySelector('#sheetScript .sheet-close, #sheetScript button.close'); if (c) c.click(); });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const vAfter = await vol('BOX');
check('scripted push-pull moves a face by exactly 5', Math.abs(vAfter - 1500) < 1e-6 || Math.abs(vAfter - 500) < 1e-6,
  vAfter.toFixed(3) + ' out: ' + scOut.slice(0, 60));
await S(() => { try { document.dispatchEvent(new Event('sd-view2d')); } catch (e){ /* no */ } });
await page.waitForTimeout(400);

console.log('history holds');
const undoDepth = await S(() => window.__sovereign.state.undoStack.length) - depthAfterLoad;
for (let i = 0; i < undoDepth; i++){ await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }
const afterAll = await S(() => ({
  ents: window.__sovereign.state.entities.length,
  solids: window.__sovereign.state.solids.length
}));
check('the full undo chain walks back to the drawn plan', afterAll.ents === baseline && afterAll.solids === 0,
  afterAll.ents + ' vs ' + baseline + ' entities, ' + afterAll.solids + ' solids');
check('no page errors anywhere in the run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' ; '));
await browser.close();

/* ---------- node phase: exchange ---------- */
console.log('exchange round trips');
const { cabin24x36 } = await import('../src/core/demo.js');
const { state, defaultLayers } = await import('../src/core/state.js');
const { generateDrawings } = await import('../src/core/model3d.js');
const { viewSheets } = await import('../src/core/sheetset.js');
const { buildDXF, parseDXF } = await import('../src/io/dxf.js');
const { buildAllSheetsPDF } = await import('../src/io/pdf.js');
state.entities = cabin24x36();
state.layers = defaultLayers();
state.solids = [];
state.idSeq = 100000;
const gen = generateDrawings({ roof: 'hip', pitch: 6 });
const doc = buildDXF(state.entities, state.layers, { ver: 'R2000' });
const back = parseDXF(doc, n => n || '0');
check('the generated set survives DXF out and in', back.length > 100 && !/NaN|Infinity/.test(JSON.stringify(back).slice(0, 200000)), back.length + ' entities');
const sheets = viewSheets(gen.views);
const pdf = buildAllSheetsPDF(state.entities, { sheets, layerVisible: () => true, projectName: 'ACCEPT', dateStr: '2026-01-01' });
const pages = (pdf.pdf.match(/\/Type \/Page[^s]/g) || []).length;
check('the sheet package prints one PDF page per view', pages === sheets.length, pages + ' pages');

console.log(failures ? '\nACCEPTANCE FAILED: ' + failures + ' check(s)' : '\nACCEPTANCE OK');
process.exit(failures ? 1 : 0);
