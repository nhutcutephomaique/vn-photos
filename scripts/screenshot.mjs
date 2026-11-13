/**
 * Chụp màn hình ở 3 kích thước để soát layout bằng mắt.
 * Chạy khi dev server đang bật:  npm run shots
 * Ảnh lưu vào ./.shots
 */
import { existsSync, mkdirSync } from "node:fs";
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
const outDir = process.env.SHOT_DIR ?? ".shots";
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1000", width: 1000, height: 700 },
  { name: "mobile-390", width: 390, height: 780 },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=vi-VN"],
});

for (const size of sizes) {
  const page = await browser.newPage();
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.screenshot({ path: `${outDir}/${size.name}.png` });
  console.log("✓", `${outDir}/${size.name}.png`);
  await page.close();
}

await browser.close();
