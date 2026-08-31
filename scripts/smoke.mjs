/* Load the built app in a real browser and fail if it does not come up.
 *
 * The unit suite cannot catch a module that throws on load when nothing
 * imports it. That is exactly what happened to src/render/draw.js: it called
 * makeIndexCache at module level without importing it, so the canvas never
 * rendered, while node --check, the build and all 684 tests passed. This
 * script loads the page, watches for uncaught errors, and checks the canvas
 * actually has paint on it.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs [url]
 *
 * Needs playwright-core and a Chromium. Set CHROMIUM to point at one.
 */
import { chromium } from 'playwright-core';

const URL = process.argv[2] || process.env.SMOKE_URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* Blocked fonts and analytics are the sandbox, not the app. */
const IGNORE = [/ERR_CONNECTION_RESET/, /ERR_FAILED/, /ERR_NAME_NOT_RESOLVED/, /fonts\.g(oogle|static)/i];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('uncaught: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (IGNORE.some(re => re.test(t))) return;
  errors.push('console: ' + t);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  let colours = 0;
  if (c){
    try {
      const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 600), Math.min(c.height, 400)).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
      colours = seen.size;
    } catch { colours = -1; }
  }
  return { canvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0, colours, buttons: document.querySelectorAll('button').length };
});
await browser.close();

const fail = [];
if (!probe.canvas) fail.push('no canvas: the app did not boot');
if (probe.w < 100 || probe.h < 100) fail.push('canvas is ' + probe.w + 'x' + probe.h);
/* One colour is an empty canvas. A drawn sheet has several. */
if (probe.colours <= 1) fail.push('canvas has ' + probe.colours + ' colours, so nothing was drawn');
if (probe.buttons < 10) fail.push('only ' + probe.buttons + ' buttons: the shell did not build');
errors.forEach(e => fail.push(e));

console.log('canvas  ' + probe.w + 'x' + probe.h + ', ' + probe.colours + ' colours, ' + probe.buttons + ' buttons');
if (fail.length){
  console.error('SMOKE FAILED');
  fail.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('SMOKE OK');
