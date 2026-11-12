// Drives the touch up tool in a real browser: finish a car, mark a window as glass with the brush, undo, clean, download.
//   npx vite preview --port 4173 &   then   node scripts/asset-touch.mjs finished-car.glb
// The car must already have four wheel nodes and a window mask (any car this app finished). Env: SMOKE_URL, CHROMIUM, SHOTS, PHONE=1.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, devices } from "playwright-core";

const URL = process.env.SMOKE_URL || "http://127.0.0.1:4173/asset.html";
const EXE = process.env.CHROMIUM || "/opt/google/chrome/chrome";
const file = process.argv[2];
const shots = process.env.SHOTS || "";
if (!file) { console.log("usage: node scripts/asset-touch.mjs finished-car.glb"); process.exit(2); }
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext(process.env.PHONE ? { ...devices["Pixel 7"] } : { viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const failures = [], errors = [];
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) failures.push(msg); };
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|ERR_TUNNEL|ERR_INTERNET|ERR_NAME/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => { if (shots) await page.locator("#view").screenshot({ path: `${shots}/${name}.png` }); };

await page.goto(URL, { waitUntil: "load" });
await page.setInputFiles("#file", file);
await page.waitForSelector("#tiles .tile", { timeout: 120000 });
await page.click('.preset[data-id="se-car"]');
await page.check("#front");
await page.click("#finish");
await page.waitForSelector("#verdict .banner", { timeout: 600000 });
console.log("     " + await page.locator("#verdict .banner").innerText());
await page.waitForFunction(() => !document.querySelector("#touch").hidden, null, { timeout: 60000 }).catch(() => {});
check(await page.locator("#touch").isVisible(), "touch up tools are shown for a car with a window mask");
check(/Touch up is ready/.test(await page.locator("#touchnote").innerText()), "the verdict points at the touch up tools");
await page.locator("#view").scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await shot("1-finished");

// find a point on the car under the pointer: the middle of the canvas, a little above center, is on the side glass or roof
const box = await page.locator("#canvas").boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const drag = async (from, to) => {
  await page.mouse.move(...at(...from)); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(...at(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8));
  await page.mouse.up();
};
const info = () => page.evaluate(() => { const t = window.sovereignAsset.touch, c = t.core(); let glass = 0; for (let i = 0; i < c.mask.length; i += 4) if (c.mask[i] > 127) glass++; return { strokes: t.strokes(), glass, edited: t.edited() }; });

const start = await info();
if (shots) writeFileSync(`${shots}/finished.glb`, Buffer.from(await page.evaluate(() => { const b = window.sovereignAsset.state.result.bytes; let t = ""; for (let i = 0; i < b.length; i += 32768) t += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(t); }), "base64"));
await page.click('#touch [data-tool="chrome"]');
await page.uncheck("#tsim");
await page.fill("#tsize", "20").catch(async () => { await page.evaluate(() => { const s = document.querySelector("#tsize"); s.value = "20"; s.dispatchEvent(new Event("input", { bubbles: true })); }); });
await drag([0.35, 0.5], [0.65, 0.5]);
const chrome = await info();
check(chrome.strokes === 1, "a drag on the car makes one stroke (" + (await page.locator("#thelp").innerText()).slice(0, 60) + ")");
await page.check("#tshow");
await page.waitForTimeout(500);
await shot("2-chrome-stroke-areas-shown");
await page.click("#tundo");
const undone = await info();
check(undone.strokes === 0 && !undone.edited, "undo removes it");
await page.click('#touch [data-tool="glass"]');
await drag([0.4, 0.5], [0.6, 0.5]);
const glass = await info();
check(glass.glass > start.glass, "the glass tool adds glass to the mask (" + start.glass + " to " + glass.glass + " texels)");
await page.uncheck("#tshow");
await page.click('#tsw .sw[data-i="2"]');
await page.waitForTimeout(500);
await shot("3-glass-stroke-blue-paint");
check(/includes your touch up/.test(await page.locator("#touchnote").innerText()), "the verdict says the download carries the touch up");

// before and after views keep the edit
await page.click("#vbefore");
check(!(await page.locator("#touch").isVisible()), "the tools hide on the Before view");
await page.click("#vafter");
await page.waitForFunction(() => !document.querySelector("#touch").hidden);
check((await info()).glass === glass.glass, "the edit is still there after switching views");

const original = await page.evaluate(() => window.sovereignAsset.state.result.bytes.length);
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#dl")]);
const saved = readFileSync(await download.path());
if (shots) writeFileSync(`${shots}/touched.glb`, saved);
check(saved.subarray(0, 4).toString("latin1") === "glTF", "the download is a GLB (" + saved.length + " bytes, was " + original + ")");
const { openTouch } = await import("../src/assetapp/touchcore.js");
const reopened = await openTouch(new Uint8Array(saved));
let back = 0;
for (let k = 0; k < reopened.mask.length; k += 4) if (reopened.mask[k] > 127) back++;
check(back >= glass.glass, "the downloaded file carries the new glass (" + back + " texels)");
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
console.log(failures.length ? "\n" + failures.length + " FAILED" : "\nall touch up checks passed");
process.exit(failures.length ? 1 : 0);
