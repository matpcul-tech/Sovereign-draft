/* One real job, timed.
 *
 * The residential path a designer walks every day, driven through the
 * built app the way a person drives it: pointer on the canvas, chips and
 * rail buttons, the menu. Walls, openings, rooms, MODEL, ROOF, DORMER,
 * DRAWINGS, Export PDF. Each step is timed and watched for feedback.
 *
 * A step is SILENT when it neither changed the document nor said
 * anything. A silent step is a defect: the person on the phone cannot
 * tell whether it worked. Any silent step, page error or missing
 * download fails the run.
 *
 * Run with: npm run build && npx vite preview --port 4173 &
 *           node scripts/job.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.JOB_OUT || '/tmp/sovereign-job.pdf';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const S = (fn, arg) => page.evaluate(fn, arg);
const snap = () => S(() => {
  const s = window.__sovereign.state;
  return { ents: s.entities.length, solids: s.solids.length, layouts: s.layouts.length,
    rooms: s.entities.filter(e => e.type === 'room').length,
    inserts: s.entities.filter(e => e.type === 'insert').length,
    tool: s.tool, space: s.space, view3d: document.body.classList.contains('view3d') };
});
/* The toast text seen since the last clear, whatever it was. */
await S(() => {
  const t = document.getElementById('toast');
  window.__seen = [];
  new MutationObserver(() => { if (t.classList.contains('show') && t.textContent) window.__seen.push(t.textContent); })
    .observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
});
const seen = () => S(() => { const v = window.__seen.slice(); window.__seen = []; return [...new Set(v)]; });

/* Model to screen through the app's own view, the way a finger lands. */
const sxy = async (x, y) => S(([x, y]) => {
  const s = window.__sovereign.state; const cv = document.getElementById('cv'); const r = cv.getBoundingClientRect();
  return [r.left + (x - s.view.x) * s.view.scale + cv.clientWidth / 2, r.top + cv.clientHeight / 2 - (y - s.view.y) * s.view.scale];
}, [x, y]);
const dragWall = async (x1, y1, x2, y2) => {
  const a = await sxy(x1, y1), b = await sxy(x2, y2);
  await page.mouse.move(a[0], a[1]); await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 });
  await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up();
};
const tapAt = async (x, y) => { const p = await sxy(x, y); await page.mouse.click(p[0], p[1]); };

const rows = [];
let failures = 0;
async function step(name, fn, opts){
  const o = opts || {};
  const before = await snap();
  await seen();
  const t0 = Date.now();
  let err = null;
  try { await fn(); } catch (e){ err = e.message; }
  await page.waitForTimeout(o.settle || 500);
  const ms = Date.now() - t0;
  const after = await snap();
  const said = await seen();
  const changed = Object.keys(before).some(k => before[k] !== after[k]);
  const silent = !changed && !said.length;
  const ok = !err && !silent && (!o.expect || o.expect(before, after, said));
  if (!ok) failures++;
  rows.push({ name, ms, said: said.join(' | '), delta: Object.keys(after).filter(k => before[k] !== after[k]).map(k => k + ' ' + before[k] + '>' + after[k]).join(' '), ok, silent, err });
  console.log((ok ? '  ok    ' : (silent ? '  SILENT' : '  FAIL  ')) + ' ' + String(ms).padStart(6) + ' ms  ' + name + (said.length ? '   "' + said.join(' | ') + '"' : '') + (err ? '   ERROR ' + err : ''));
}

const T0 = Date.now();
console.log('one real job: walls to PDF');

await step('New drawing', async () => {
  await page.click('#btnMenu'); await page.waitForTimeout(200);
  await page.click('#mNew'); await page.waitForTimeout(150); await page.click('#mNew');
}, { expect: (b, a) => a.ents === 0 });

await step('WALL tool from the rail', async () => { await page.click('.tool[data-tool="wall"]'); },
  { expect: (b, a) => a.tool === 'wall' });

await step('Four exterior walls, 36 x 24, drawn by drag', async () => {
  await S(() => { const s = window.__sovereign.state; s.view.x = 18; s.view.y = 12; s.view.scale = 18; window.__sovereign.draw(); });
  await dragWall(0, 0, 36, 0); await dragWall(36, 0, 36, 24); await dragWall(36, 24, 0, 24); await dragWall(0, 24, 0, 0);
}, { expect: (b, a) => a.ents >= b.ents + 4 });

await step('One interior wall', async () => { await dragWall(18, 0, 18, 24); }, { expect: (b, a) => a.ents > b.ents });

await step('Select the south wall', async () => {
  await page.click('.tool[data-tool="select"]'); await tapAt(9, 0);
}, { expect: () => true });

await step('Door chip, then tap the wall', async () => {
  await page.click('#chipDoor'); await tapAt(9, 0);
}, { expect: (b, a) => a.inserts > b.inserts });

await step('Select the north wall, Window chip, tap it', async () => {
  await tapAt(27, 24); await page.click('#chipWindow'); await tapAt(27, 24);
}, { expect: (b, a) => a.inserts > b.inserts });

await step('Detect rooms from the menu', async () => {
  await page.click('#btnMenu'); await page.waitForTimeout(200); await page.click('#mRooms');
}, { expect: (b, a) => a.rooms >= 2 });

await step('Build tab, MODEL', async () => {
  await page.click('.ttab[data-row="toolrow-3d"]'); await page.waitForTimeout(150);
  await page.click('.tool[data-tool="bmodel"]');
}, { settle: 1500, expect: (b, a) => a.solids > b.solids });

await step('ROOF', async () => { await page.click('.tool[data-tool="broof"]'); },
  { settle: 1500, expect: (b, a) => a.solids > b.solids });

await step('Back to the plan', async () => { await page.click('#v3dPlan'); },
  { expect: () => true });

await step('DORMER, then tap the roof in plan', async () => {
  await page.click('.tool[data-tool="bdormer"]'); await page.waitForTimeout(300); await tapAt(9, 6);
}, { settle: 2500, expect: (b, a, said) => said.some(t => /Dormer on the/.test(t)) });

await step('DRAWINGS', async () => {
  await page.click('.tool[data-tool="bdwgs"]');
  /* Wait for the set's own report, not a fixed pause, so the time is real. */
  await page.waitForFunction(() => (window.__seen || []).some(t => /Drawing set:/.test(t)), null, { timeout: 90000 });
}, { settle: 300, expect: (b, a) => a.layouts > b.layouts });

await step('Export all sheets to one PDF', async () => {
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btnMenu'); await page.waitForTimeout(200); await page.click('#mExportAllPDF');
  const d = await dl; await d.saveAs(OUT);
}, { settle: 800, expect: (b, a, said) => said.some(t => new RegExp('^' + a.layouts + ' sheets exported').test(t)) });

const total = Date.now() - T0;
import { readFileSync } from 'node:fs';
const pages = (() => { try { const t = readFileSync(OUT, 'latin1'); const m = /\/Count (\d+)/.exec(t); return m ? Number(m[1]) : 0; } catch (e){ return 0; } })();
console.log('');
console.log('total ' + (total / 1000).toFixed(1) + ' s, ' + rows.length + ' steps, ' + rows.filter(r => r.silent).length + ' silent, pdf pages ' + pages);
if (pageErrors.length){ console.log('page errors:', pageErrors); failures++; }
if (!pages){ console.log('no PDF came out'); failures++; }
writeFileSync(OUT + '.json', JSON.stringify({ total, rows, pages, pageErrors }, null, 2));
await browser.close();
console.log(failures ? 'JOB FAILED (' + failures + ')' : 'JOB OK');
process.exit(failures ? 1 : 0);
