/**
 * Test hành vi canvas kiểu r/place:
 *   • mở trang là vừa khít bàn cờ
 *   • không zoom ra ngoài mức "toàn bàn cờ"
 *   • zoom vào được
 *   • kéo không làm bàn cờ rời khỏi màn hình
 *   • HUD hiện toạ độ, nút "Toàn bàn cờ" reset
 *
 * Chạy khi dev server đang bật:  npm run ui:test
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.error("Không tìm thấy Chrome/Edge. Đặt biến CHROME_PATH.");
  process.exit(1);
}

const url = process.argv[2] ?? "http://localhost:3000";
const VIEW = { width: 1000, height: 700 };
const HEADER = 58;
const STAGE_HEIGHT = VIEW.height - HEADER;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 1200));

const readWorld = () =>
  page.evaluate(() => {
    const element = document.querySelector(".world");
    if (!element) return null;
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const rect = element.getBoundingClientRect();
    return { scale: matrix.a, tx: rect.x, ty: rect.y, w: rect.width, h: rect.height };
  });

const fit = await readWorld();
assert.ok(fit, "không tìm thấy .world");
const expectedFit = Math.min(VIEW.width / 4096, STAGE_HEIGHT / 4096);
console.log("fit:", fit.scale.toFixed(4), "kỳ vọng:", expectedFit.toFixed(4));

assert.ok(Math.abs(fit.scale - expectedFit) < 0.002, "mở trang phải fit vừa bàn cờ");
assert.ok(Math.abs(fit.w - STAGE_HEIGHT) < 3, "bàn cờ phải cao đúng bằng vùng canvas");

// --- Không zoom ra ngoài fit -------------------------------------------
await page.mouse.move(300, 200);
for (let i = 0; i < 8; i += 1) await page.mouse.wheel({ deltaY: 240 });
await new Promise((resolve) => setTimeout(resolve, 200));
const zoomedOut = await readWorld();
console.log("sau khi zoom out:", zoomedOut.scale.toFixed(4));
assert.ok(zoomedOut.scale >= fit.scale - 0.0005, "không được zoom ra ngoài fit");

// --- Zoom vào -----------------------------------------------------------
await page.mouse.move(300, 200);
for (let i = 0; i < 6; i += 1) await page.mouse.wheel({ deltaY: -240 });
await new Promise((resolve) => setTimeout(resolve, 300));
const zoomedIn = await readWorld();
console.log("sau khi zoom in:", zoomedIn.scale.toFixed(3));
assert.ok(zoomedIn.scale > fit.scale * 2, "phải zoom vào được");

// --- Kéo: bàn cờ luôn phủ khung nhìn -----------------------------------
for (const [dx, dy] of [
  [1200, 900],
  [-1600, -1200],
]) {
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(300 + dx, 200 + dy, { steps: 12 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const world = await readWorld();
  const okX =
    world.w <= VIEW.width
      ? Math.abs(world.tx - (VIEW.width - world.w) / 2) < 2
      : world.tx <= 0.5 && world.tx + world.w >= VIEW.width - 0.5;
  const okY =
    world.h <= STAGE_HEIGHT
      ? Math.abs(world.ty - HEADER - (STAGE_HEIGHT - world.h) / 2) < 2
      : world.ty <= HEADER + 0.5 && world.ty + world.h >= VIEW.height - 0.5;

  console.log(`kéo ${dx},${dy} → tx ${Math.round(world.tx)} ty ${Math.round(world.ty)}`);
  assert.ok(okX && okY, "bàn cờ phải luôn phủ kín khung nhìn khi đã zoom");
}

// --- HUD ----------------------------------------------------------------
await page.mouse.move(500, 350);
await new Promise((resolve) => setTimeout(resolve, 150));
const hud = await page.$eval(".canvas-hud", (element) => element.textContent ?? "");
console.log("HUD:", hud);
assert.ok(/\(\d+,\s*\d+\)/.test(hud), "HUD phải hiện toạ độ");

// --- Reset --------------------------------------------------------------
await page.click(".canvas-controls .icon-btn.wide");
await new Promise((resolve) => setTimeout(resolve, 250));
const reset = await readWorld();
console.log("reset:", reset.scale.toFixed(4));
assert.ok(Math.abs(reset.scale - expectedFit) < 0.002, "nút 'Toàn bàn cờ' phải reset");

console.log("✓ canvas behaviour ok");
await browser.close();
