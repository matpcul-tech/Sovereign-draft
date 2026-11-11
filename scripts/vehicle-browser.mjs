import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.SMOKE_URL || "http://127.0.0.1:5173/";
const EXE = process.env.CHROMIUM || "/opt/google/chrome/chrome";
const OUT = "/tmp/vehicle-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  headless: process.env.HEADLESS !== "0",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const failures = [];
const check = (ok, msg) => {
  console.log((ok ? "ok   " : "FAIL ") + msg);
  if (!ok) failures.push(msg);
};

async function shot(page, name) {
  await page.screenshot({ path: OUT + "/" + name + ".png", fullPage: false });
  console.log("shot " + name);
}

const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await desktop.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#cmdinput");
check(await page.locator("#cmdinput").isVisible(), "drafting command line is visible");
check(await page.locator("canvas").count() > 0, "drafting canvas is present");
await shot(page, "01-drafting");

await page.click("[data-row=toolrow-3d]");
await page.locator("#btnAsset").scrollIntoViewIfNeeded();
await page.click("#btnAsset");
await page.waitForSelector("#assetmode");
await page.waitForFunction(() => {
  const status = document.querySelector("#assetstatus");
  return status && /TRI/.test(status.textContent || "");
}, null, { timeout: 8000 });
const sedanStatus = await page.locator("#assetstatus").innerText();
check(/sedan/i.test(sedanStatus) && /TRI/.test(sedanStatus), "built-in sedan status: " + sedanStatus);
await shot(page, "02-sedan");

await page.click("[data-asset=vehicle]");
await page.waitForSelector("#vehiclepanel:not([hidden])");
await page.click("#vehsample");
await page.waitForFunction(() => {
  const summary = document.querySelector("#vehsummary");
  return summary && /tris/.test(summary.textContent || "");
}, null, { timeout: 8000 });
const summary = await page.locator("#vehsummary").innerText();
check(/1 materials/.test(summary), "fused sample is one material: " + summary);
const box = await page.locator("#assetview").boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
await page.click("#vehisland");
await page.click("[data-material=paint]");
await page.locator("#vehcolor").evaluate((el) => {
  el.value = "#ff0000";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click("[data-material=paint]");
const paintLabel = await page.locator("[data-material=paint]").innerText();
check(/Paint [1-9]/.test(paintLabel), "paint assignment label: " + paintLabel);
await page.locator("#vehdoor").fill("40");
await page.locator("#vehdoor").dispatchEvent("input");
await shot(page, "03-fused-paint");

await page.setInputFiles("#vehfile", "fixtures/vehicle/sedan-review.glb");
await page.waitForFunction(() => {
  const summary = document.querySelector("#vehsummary");
  return summary && /47[,.]?821 tris/.test(summary.textContent || "");
}, null, { timeout: 15000 });
const sedanSummary = await page.locator("#vehsummary").innerText();
check(/47[,.]?821/.test(sedanSummary), "imported sedan summary: " + sedanSummary);
const issues = await page.locator("#vehissues").innerText();
check(issues.includes("0.956"), "scale warning shown: " + issues.slice(0, 240));
check(issues.includes("WebP") || issues.includes("meshopt"), "compression warning shown");
const textured = await page.evaluate(() => ({
  error: window.__vehicleLoadError || "",
  canvas: !!document.querySelector("#assetview canvas")
}));
console.log("load error:", textured.error || "(none)");
const maps = await page.evaluate(() => window.__vehicleMaps || []);
console.log("maps", maps.slice(0, 8).join(" | "));
check(maps.some((item) => /:[1-9]\d{2,}$/.test(item)), "imported textures are on the meshes");
check(!!textured.canvas, "vehicle canvas is mounted");
await shot(page, "04-sedan-import");

await page.click("#assetclose");
await page.waitForSelector("#assetmode", { state: "detached" });
check(await page.locator("#btnAsset").isVisible(), "back to drawing restores the drafting shell");
await shot(page, "05-back-to-drafting");
await desktop.close();

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobile = await phone.newPage();
mobile.on("pageerror", (error) => errors.push("mobile " + error.message));
await mobile.goto(URL, { waitUntil: "networkidle" });
await mobile.click("[data-row=toolrow-3d]");
await mobile.locator("#btnAsset").scrollIntoViewIfNeeded();
await mobile.click("#btnAsset");
await mobile.waitForSelector("#assetmode");
await mobile.click("[data-asset=vehicle]");
await mobile.click("#vehsample");
await mobile.waitForSelector("#vehsummary");
const panel = await mobile.locator("#vehiclepanel").boundingBox();
const view = await mobile.locator("#assetview").boundingBox();
check(panel && panel.width > 300 && panel.height > 80, "mobile panel is on screen");
check(view && view.height > 120, "mobile model view stays visible: " + (view && view.height));
const importBox = await mobile.locator("#vehimport").boundingBox();
check(importBox && importBox.height >= 40, "import control is finger sized: " + (importBox && importBox.height));
await shot(mobile, "06-mobile");
await phone.close();

if (errors.length) {
  console.log("page errors:");
  for (const error of errors) console.log(error);
  failures.push("page errors: " + errors.join(" | "));
}
await browser.close();
if (failures.length) {
  console.log("FAILED");
  for (const failure of failures) console.log(failure);
  process.exit(1);
}
console.log("browser checks passed");
