/* Share links in a real browser, both directions.
 *
 * The unit test for the share codec runs in Node, where web streams behave
 * differently enough that a gzip deadlock shipped: in Chromium, opening a
 * #sd= link and pressing Copy share link both hung with no toast. This
 * script drives the built app the way a person does:
 *
 *   1. Open a #sd= link made outside the app (a lesson starter) and check
 *      the drawing on the canvas is that drawing.
 *   2. Press Menu > Copy share link, read the URL off the clipboard, open it
 *      in a fresh browser profile and check the same drawing comes back.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/share-browser.mjs [url]
 *
 * Needs playwright-core and a Chromium. Set CHROMIUM to point at one, or
 * leave it unset to use the browser `npx playwright-core install chromium`
 * downloads (that is what CI does).
 */
import { chromium } from 'playwright-core';
import { encodeShare } from '../src/io/share.js';

const URL = (process.argv[2] || process.env.SMOKE_URL || 'http://localhost:4173/').replace(/#.*$/, '');
const EXE = process.env.CHROMIUM || undefined;
const IGNORE = [/ERR_CONNECTION_RESET/, /ERR_FAILED/, /ERR_NAME_NOT_RESOLVED/, /fonts\.g(oogle|static)/i];

const starter = {
  app: 'sovereign-draft', v: 7, name: 'Share round trip',
  layers: [
    { name: 'WALLS', color: '#d4a843', aci: 2, visible: true },
    { name: 'NOTES', color: '#e8e4dd', aci: 7, visible: true },
    { name: 'PREXIS-L00', color: '#6b7c93', aci: 8, visible: true, plot: false }
  ],
  entities: [
    { id: 1, type: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 24, y2: 0 },
    { id: 2, type: 'line', layer: 'WALLS', x1: 24, y1: 0, x2: 24, y2: 16 },
    { id: 3, type: 'line', layer: 'WALLS', x1: 24, y1: 16, x2: 0, y2: 16 },
    { id: 4, type: 'line', layer: 'WALLS', x1: 0, y1: 16, x2: 0, y2: 0 },
    { id: 5, type: 'text', layer: 'NOTES', x: 0, y: -3, size: 0.6, content: 'ROUND TRIP' }
  ],
  idSeq: 6,
  layouts: [], space: 'model'
};

const failures = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };

const browser = await chromium.launch(EXE ? { executablePath: EXE, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

async function openPage(url){
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new globalThis.URL(URL).origin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!IGNORE.some(re => re.test(t))) errors.push('console: ' + t);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  return { ctx, page, errors };
}

async function waitForDrawing(page, name){
  return page.waitForFunction(n => {
    const s = window.__sovereign && window.__sovereign.state;
    return s && s.projectName === n && s.entities.length > 0;
  }, name, { timeout: 8000 }).then(() => true, () => false);
}

async function summary(page){
  return page.evaluate(() => {
    const s = window.__sovereign.state;
    return {
      name: s.projectName,
      lines: s.entities.filter(e => e.type === 'line').length,
      text: s.entities.filter(e => e.type === 'text').map(e => e.content).join('|'),
      layers: s.layers.map(l => l.name)
    };
  });
}

/* 1. A link made outside the app opens the drawing. */
const token = await encodeShare(JSON.stringify(starter));
const a = await openPage(URL + '#sd=' + token);
check(await waitForDrawing(a.page, starter.name), 'a #sd= starter link opens its drawing');
const sa = await summary(a.page);
check(sa.lines === 4 && sa.text === 'ROUND TRIP', 'the opened drawing has the starter geometry (' + JSON.stringify(sa) + ')');
check(sa.layers.includes('PREXIS-L00'), 'a non-plotting stamp layer survives the link');
const toast = await a.page.evaluate(() => document.body.innerText.includes('Opened shared drawing'));
check(toast, 'the app says it opened the shared drawing');

/* 1b. The opened drawing is editable like any other: tap a line, tap the
 * Layer chip, tap a layer, and the line moves there. (The Layer chip used
 * to open the panel without assign mode, so the tap only changed the
 * current layer.) */
await a.page.evaluate(() => window.__sovereign.setTool('select'));
const pt = await a.page.evaluate(() => {
  const s = window.__sovereign.state, cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
  const w2s = (x, y) => [r.left + (x - s.view.x) * s.view.scale + cv.clientWidth / 2, r.top + cv.clientHeight / 2 - (y - s.view.y) * s.view.scale];
  return w2s(24, 8);
});
await a.page.mouse.click(pt[0], pt[1]);
await a.page.waitForTimeout(150);
const picked = await a.page.evaluate(() => window.__sovereign.state.selIds.length);
check(picked === 1, 'tapping a line of the shared drawing selects it');
if (picked === 1){
  await a.page.click('#chipAssign');
  await a.page.click('#layerlist .row:has(.nm:text-is("NOTES"))');
  const moved = await a.page.evaluate(() => {
    const s = window.__sovereign.state;
    return s.entities.filter(e => e.type === 'line' && e.layer === 'NOTES').length;
  });
  check(moved === 1, 'Layer chip then NOTES moves the selected line to NOTES');
  await a.page.evaluate(() => {
    const s = window.__sovereign.state;
    s.entities.forEach(e => { if (e.type === 'line') e.layer = 'WALLS'; });
    s.selIds = [];
  });
}

/* 2. Copy share link from the menu, then open that URL somewhere new. */
await a.page.evaluate(() => {
  const s = window.__sovereign.state;
  s.entities.push({ id: s.idSeq++, type: 'line', layer: 'WALLS', x1: 12, y1: 0, x2: 12, y2: 16 });
});
await a.page.click('#btnMenu');
await a.page.click('#mShare');
const copied = await a.page.waitForFunction(() => document.body.innerText.includes('Share link copied'), null, { timeout: 8000 }).then(() => true, () => false);
check(copied, 'Copy share link finishes and says so');
const url = copied ? await a.page.evaluate(() => navigator.clipboard.readText()) : '';
check(/#sd=[A-Za-z0-9_-]+$/.test(url), 'the clipboard holds a #sd= link');
check(a.errors.length === 0, 'no errors on the first page' + (a.errors.length ? ': ' + a.errors.join('; ') : ''));

if (url){
  const b = await openPage(URL + url.slice(url.indexOf('#')));
  check(await waitForDrawing(b.page, starter.name), 'the copied link opens in a fresh profile');
  const sb = await summary(b.page);
  check(sb.lines === 5 && sb.text === 'ROUND TRIP', 'the copied link carries the edit (' + JSON.stringify(sb) + ')');
  check(b.errors.length === 0, 'no errors on the second page' + (b.errors.length ? ': ' + b.errors.join('; ') : ''));
}

await browser.close();
if (failures.length){
  console.error('\n' + failures.length + ' share check(s) failed');
  process.exit(1);
}
console.log('\nshare links round-trip in a real browser');
