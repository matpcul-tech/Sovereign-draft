// Drives Sovereign Asset in a real browser: load a model, finish it, read the verdict, download the file.
//   npx vite preview --port 4173 &   then   node scripts/asset-browser.mjs [file.glb or a,b,c for a model with its texture files] [preset-id]
// Env: SMOKE_URL, CHROMIUM, SHOTS (folder for screenshots), PHONE=1 for a phone-size screen.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { chromium, devices } from "playwright-core";

const URL = process.env.SMOKE_URL || "http://127.0.0.1:4173/asset.html";
const EXE = process.env.CHROMIUM || "/opt/google/chrome/chrome";
const file = process.argv[2] || "fixtures/vehicle/sedan-01-textured.glb";
const preset = process.argv[3] || "game";
const shots = process.env.SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext(process.env.PHONE ? { ...devices["Pixel 7"] } : { viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const failures = [], errors = [];
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) failures.push(msg); };
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|ERR_TUNNEL|ERR_INTERNET|ERR_NAME/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };

await page.goto(URL, { waitUntil: "load" });
check(await page.locator(".shield").innerText() === "SOVEREIGN", "the sovereign marker is on screen");
await shot("1-start");
await page.setInputFiles("#file", file.split(","));
await page.waitForSelector("#tiles .tile", { timeout: 120000 });
check(await page.locator("#view canvas").isVisible(), "the model is on screen");
const tiles = await page.locator("#tiles").innerText();
console.log("     file: " + tiles.replace(/\s+/g, " "));
console.log("     found: " + (await page.locator("#issues").innerText()).replace(/\s+/g, " "));
await page.click(`.preset[data-id="${preset}"]`);
if (await page.locator("#front").count()) await page.check("#front");
await shot("2-loaded");
const started = Date.now();
await page.click("#finish");
await page.waitForSelector("#verdict .banner", { timeout: 600000 });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const banner = await page.locator("#verdict .banner").innerText();
console.log("     " + banner + " in " + seconds + " s: " + await page.locator("#verdict .sum").innerText());
for (const row of await page.locator("#verdict .checks li").all()) {
  const text = (await row.innerText()).replace(/\s+/g, " ");
  if (!text.startsWith("PASS")) console.log("     " + text.slice(0, 260));
}
check(banner === "READY" || banner === "NOT READY", "a verdict is shown");
const result = await page.evaluate(() => {
  const r = window.sovereignAsset.state.result;
  return { ready: r.ready, fails: r.checks.filter((c) => c.status === "fail").length, has: !!r.bytes, tris: r.after && r.after.triangles };
});
check(result.ready === (result.fails === 0 && result.has), "READY means no failed check and a file");
if (result.has) {
  const wait = page.waitForEvent("download");
  await page.click("#dl");
  const download = await wait;
  const path = await download.path();
  const bytes = readFileSync(path);
  check(bytes.length > 100 && bytes.toString("latin1", 0, 4) === "glTF", "the download is a GLB (" + download.suggestedFilename() + ", " + (bytes.length / 1048576).toFixed(2) + " MB)");
  if (shots) writeFileSync(`${shots}/${basename(file.split(",")[0])}.${preset}.glb`, bytes);
  check(!(await page.locator("#vafter").isDisabled()), "the finished model can be viewed");
}
await page.waitForTimeout(1200);
await shot("3-verdict");
await page.locator("#view").scrollIntoViewIfNeeded();
if (shots) await page.screenshot({ path: `${shots}/4-after-view.png` });
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
if (failures.length) { console.error(failures.length + " check(s) failed"); process.exit(1); }
console.log("all checks passed");
