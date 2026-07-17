/**
 * 由 public/icon.svg 生成 PWA PNG 图标（512/192/apple-touch 180）。
 * 用系统 Chrome（channel: 'chrome'）截图光栅化，无需额外依赖。
 * 运行：node scripts/gen-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svg = readFileSync(resolve('public/icon.svg'), 'utf8');
const targets = [
  { size: 512, file: 'public/pwa-512.png' },
  { size: 192, file: 'public/pwa-192.png' },
  { size: 180, file: 'public/apple-touch-icon.png' },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const { size, file } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent">${svg.replace(
      /width="512" height="512"/,
      `width="${size}" height="${size}"`,
    )}</body>`,
  );
  await page.screenshot({ path: resolve(file), omitBackground: true });
  console.log(`生成 ${file} (${size}×${size})`);
}
await browser.close();
