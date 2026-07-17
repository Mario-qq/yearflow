/**
 * PWA 冒烟验证：vite preview（需已在 4173 运行）上检查 manifest 可达 + SW 注册成功。
 * 运行：npx vite preview --port 4173 & node scripts/check-pwa.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'load' });

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const res = await fetch(link.href);
  return res.ok ? await res.json() : null;
});

let sw = null;
for (let i = 0; i < 20 && !sw; i++) {
  sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    return reg?.active ? { scope: reg.scope, state: reg.active.state } : null;
  });
  if (!sw) await page.waitForTimeout(500);
}

console.log(
  'manifest:',
  manifest ? `${manifest.name} · ${manifest.icons.length} icons · display=${manifest.display}` : '缺失',
);
console.log('serviceWorker:', JSON.stringify(sw));
await browser.close();
process.exit(manifest && sw ? 0 : 1);
