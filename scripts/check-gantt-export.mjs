/**
 * 甘特图「导出当前视图 PNG」（SPEC 4.6）的落盘与非白板校验。
 *
 * 为什么单独一个脚本：这条功能此前**从来没被自动验过**，于是它坏了很久没人发现 ——
 * 导出的 PNG 尺寸、体积、文件名全都对，只有像素是空的。根因与年报长图同一个：
 * 把 `position:fixed; left:-100000px` 的离屏节点直接交给 html-to-image，
 * 那条 left 在 SVG <foreignObject> 的坐标系里照样生效，内容被推出画布。
 * 所以断言必须数**非背景像素**，光看文件大小会被 100 kB 的纯色 PNG 骗过去。
 *
 * 前置：dev server 已运行（YF_URL 指定端口）。运行：node scripts/check-gantt-export.mjs
 * 环境两条（见 docs/PROGRESS.md）：
 * · 用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * · html-to-image 的 resolve 包在 rAF 里 ⇒ document.hidden 的窗口里永挂，
 *   只能在真实 Chrome 前台页验，不能在浏览器面板里验。
 */
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
/** 落盘目录。默认临时目录用完即弃；YF_KEEP 指向一个目录时留下产物供肉眼复核 */
const DL = process.env.YF_KEEP ?? mkdtempSync(join(tmpdir(), 'yearflow-gantt-png-'));

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};

/**
 * 把落盘的 PNG 送回浏览器解码，数一遍与左上角像素不同的点。
 * `xEnd` 限定只数左边一竖条 —— 用来单独盯住左侧网格那一列。
 */
const countNonBg = (page, buf, maxRows, xEnd) =>
  page.evaluate(
    ([dataUrl, rows, x1]) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = Math.min(x1 ?? img.width, img.width);
          cv.height = Math.min(rows, img.height);
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
    [`data:image/png;base64,${buf.toString('base64')}`, maxRows, xEnd],
  );

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();

// 新建 context = 独立 IndexedDB，数据得现种（PROGRESS 已记）
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(900);

await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

/*
 * 先把两个方向都滚开一段再导出。scrollLeft/Top 都是 0 时，克隆里的 sticky 补偿
 * 对不对根本看不出来 —— 而「左侧网格丢失」正是只在横向滚开后才暴露的那类 bug。
 */
const scrolled = await page.evaluate(() => {
  const el = document.querySelector('[data-gantt-scroller]') ?? document.querySelector('main div[style*="overflow"]');
  const s = el ?? [...document.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 500);
  s.scrollTo({ left: 600, top: 240 });
  return { left: s.scrollLeft, top: s.scrollTop };
});
ok(scrolled.left > 0 && scrolled.top > 0, `导出前已滚开（scrollLeft ${scrolled.left} / scrollTop ${scrolled.top}）`);
await page.waitForTimeout(500);

// 走命令面板那条入口（与用户实际路径一致，顺带验 bus 还通着）
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.type('导出当前视图');
await page.waitForTimeout(300);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60_000 }),
  page.keyboard.press('Enter'),
]);
const name = download.suggestedFilename();
const file = `${DL}/${name}`;
await download.saveAs(file);

ok(/^yearflow-gantt-\d{4}-\d{2}-\d{2}\.png$/.test(name), `文件名符合约定：${name}`);
const size = statSync(file).size;
ok(size > 20_000, `PNG 真实落盘（${(size / 1024).toFixed(0)} kB）`);

const buf = readFileSync(file);
const pngW = buf.readUInt32BE(16);
const pngH = buf.readUInt32BE(20);
ok(pngW > 2000 && pngH > 1000, `尺寸 = 视口 × pixelRatio 2（实测 ${pngW} × ${pngH}）`);

const nonBg = await countNonBg(page, buf, 3000);
// 门槛取 20 万：修复前实测是 0，修好后是两百多万，中间没有灰色地带
ok(nonBg > 200_000, `PNG 有真实内容，不是只有背景色的白板（${nonBg} 个非背景像素）`);

/*
 * 左侧网格单独验一条：整图的非背景像素数盖不住它 —— 左栏整条丢了，右边的时间轴
 * 照样贡献两百多万个像素，总数那条断言纹丝不动。这正是第一版修复漏掉的那个 bug
 * （给克隆里的 sticky 元素叠了一层多余的 translateX，把左栏推出了画面）。
 * 左栏宽度随折叠状态变，这里只数最左 600 设备像素（≈300 CSS px），稳过任何配置。
 */
const leftNonBg = await countNonBg(page, buf, 3000, 600);
ok(leftNonBg > 50_000, `左侧目标/任务网格在图里（最左 600px 内 ${leftNonBg} 个非背景像素）`);

await browser.close();
console.log('\n甘特图 PNG 导出校验全部通过。');
