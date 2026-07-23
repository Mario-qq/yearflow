/**
 * 生成 PWA / 主屏图标。
 * - public/icon.svg（圆角、透明底）→ pwa-512.png / pwa-192.png：manifest "any" 用途，
 *   浏览器/桌面按原样显示，圆角+透明边角是预期效果。
 * - public/icon-maskable.svg（全出血、不透明底）→ pwa-512-maskable.png / apple-touch-icon.png：
 *   Android adaptive icon 与 iOS 主屏图标都会自己做形状裁切，源图必须铺满整个画布且不透明，
 *   否则裁切后四角会露出图层背景，显得难看。
 * 用系统 Chrome（channel: 'chrome'）截图光栅化，无需额外依赖。
 * 运行：node scripts/gen-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const roundedSvg = readFileSync(resolve('public/icon.svg'), 'utf8');
const fullBleedSvg = readFileSync(resolve('public/icon-maskable.svg'), 'utf8');
const targets = [
  { size: 512, file: 'public/pwa-512.png', svg: roundedSvg, transparent: true },
  { size: 192, file: 'public/pwa-192.png', svg: roundedSvg, transparent: true },
  { size: 512, file: 'public/pwa-512-maskable.png', svg: fullBleedSvg, transparent: false },
  { size: 180, file: 'public/apple-touch-icon.png', svg: fullBleedSvg, transparent: false },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const { size, file, svg, transparent } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:${transparent ? 'transparent' : '#17171c'}">${svg.replace(
      /width="512" height="512"/,
      `width="${size}" height="${size}"`,
    )}</body>`,
  );
  await page.screenshot({ path: resolve(file), omitBackground: transparent });
  console.log(`生成 ${file} (${size}×${size})`);
}
await browser.close();
