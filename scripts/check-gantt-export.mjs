/**
 * 甘特图「导出当前视图 PNG」的白板回归验收（src/gantt/lib/exportPng.ts）。
 *
 * 曾经的 bug：交给 html-to-image 的就是 `position:fixed; left:-100000px` 的离屏舞台，
 * 该样式进了 SVG <foreignObject> 后照样生效，内容被推出画布 —— 文件名、尺寸、体积全对，
 * 只有像素是空的。所以这里必须把落盘的 PNG 送回浏览器解码，数非背景像素。
 *
 * 前置：dev server 已运行（YF_URL 指定端口）。运行：node scripts/check-gantt-export.mjs
 * 环境两条（见 docs/PROGRESS.md）：系统 Chrome（channel:'chrome'）；
 * html-to-image 的 resolve 包在 rAF 里 ⇒ document.hidden 的窗口导出永挂，不能在面板里验。
 */
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const DL = mkdtempSync(join(tmpdir(), 'yearflow-gantt-'));

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(900);

for (const theme of ['light', 'dark']) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(600);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    // 事件总线是模块内私有 EventTarget，页面里够不着 ⇒ 走顶栏那颗「导出」按钮
    page.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const file = `${DL}/${theme}-${download.suggestedFilename()}`;
  await download.saveAs(file);
  const buf = readFileSync(file);
  const pngW = buf.readUInt32BE(16);
  const pngH = buf.readUInt32BE(20);
  ok(
    /^yearflow-gantt-\d{4}-\d{2}-\d{2}\.png$/.test(download.suggestedFilename()),
    `[${theme}] 文件名符合约定：${download.suggestedFilename()}`,
  );
  ok(statSync(file).size > 10_000, `[${theme}] 真实落盘（${(statSync(file).size / 1024).toFixed(0)} kB）`);
  console.log(`  [${theme}] 尺寸：${pngW} × ${pngH}`);

  // 关键一条：尺寸/体积对不等于有内容，把 PNG 解回来数非背景像素
  const nonBg = await page.evaluate(
    ([dataUrl]) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          const base = `${d[0]},${d[1]},${d[2]}`;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== base) n += 1;
          }
          resolve(n);
        };
        img.onerror = () => reject(new Error('PNG 解码失败'));
        img.src = dataUrl;
      }),
    [`data:image/png;base64,${buf.toString('base64')}`],
  );
  ok(nonBg > 100_000, `[${theme}] 不是白板：${nonBg} 个非背景像素`);
}

await browser.close();
console.log('\n全部通过。');
