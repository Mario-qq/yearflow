/**
 * 打包形态的冒烟自查：跑 app:// 自定义协议这条**只在生产构建才走**的路径。
 * desktop-e2e.mjs 跑的是 vite dev（为了 DEV 观测句柄），走的是 http://localhost —— 恰好
 * 绕开了协议注册、SPA 深链接回退、BrowserRouter 在自定义 origin 下的 History API。
 *
 * 前置：npm run electron:build
 * 跑法：node scripts/desktop-smoke.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'screenshots/desktop';

/**
 * ⚠️ 自查一律跑在**独立的 userData 目录**里，绝不碰真实 profile。
 * 教训：早先的自查往 app://local 的真实 IndexedDB 里载入过示例数据，而桌面版一旦登录
 * Supabase，LWW 同步就会把那些示例目标推上云、污染手机端。测试数据必须与真实数据物理隔离。
 */
const PROFILE = join(tmpdir(), 'yearflow-smoke-profile');
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

mkdirSync(OUT, { recursive: true });

const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL; // 强制走 app://
const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });

const main = await app.firstWindow();
await main.waitForLoadState('domcontentloaded');

check('主窗走 app:// 协议', main.url().startsWith('app://local/'), main.url());
const origin = await main.evaluate(() => location.origin);
check('有真实 origin（localStorage/IDB/Web Locks 的前提）', origin === 'app://local', origin);
check('secure context（navigator.locks 要求）', await main.evaluate(() => window.isSecureContext));
check('service worker 未注册（桌面构建已关 PWA）', (await main.evaluate(() => navigator.serviceWorker?.controller ?? null)) === null);

// BrowserRouter 在自定义 origin 下必须能正常 pushState 并落到 /gantt
const routed = await until(() => main.evaluate(() => location.pathname.startsWith('/gantt')));
check('BrowserRouter 落到 /gantt', !!routed, await main.evaluate(() => location.pathname));

// ⚠️ 生产构建里没有 window.__store（那是 import.meta.env.DEV 才挂的观测句柄），
// 所以这个脚本一律走 UI 与 DOM，不碰任何 dev 句柄。
//
// 桌面壳是全新 origin（app://local），IndexedDB 是空的 —— 这正是「数据要靠备份 JSON
// 迁移过来」的那个状态。自查里先从 UI 载入示例数据，否则甘特图只有空态可截。
const empty = await main.evaluate(() => document.body.innerText.includes('还没有目标'));
if (empty) {
  await main.getByRole('link', { name: /设置/ }).click();
  await main.getByRole('button', { name: '载入示例数据' }).click();
  await main.getByRole('link', { name: /甘特图/ }).click();
  const seeded = await until(() => main.evaluate(() => document.querySelectorAll('svg rect').length > 0));
  check('空库时可从 UI 载入示例数据（迁移前的初始状态）', !!seeded);
}

const ganttReady = await until(() => main.evaluate(() => !!document.querySelector('svg')));
check('甘特图渲染出 SVG', !!ganttReady);

const errs = [];
main.on('pageerror', (e) => errs.push(String(e)));
main.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});

// SPA 深链接：切到 /settings 再当场刷新，验协议处理器的 index.html 回退
await main.getByRole('link', { name: /设置/ }).click();
await until(() => main.evaluate(() => location.pathname === '/settings'));
check('客户端路由切到 /settings 无白屏', await main.evaluate(() => document.body.innerText.length > 20));
await main.reload();
await main.waitForLoadState('domcontentloaded');
const afterReload = await until(() => main.evaluate(() => document.body.innerText.length > 20));
check('在 /settings 上刷新仍能加载（协议 index.html 回退）', !!afterReload, await main.evaluate(() => location.pathname));

// 四档缩放 × 深浅主题（CLAUDE.md 质量门槛）
await main.getByRole('link', { name: /甘特图/ }).click();
await until(() => main.evaluate(() => document.querySelectorAll('svg rect').length > 0));
for (const theme of ['dark', 'light']) {
  await main.evaluate((t) => {
    localStorage.setItem('yearflow-theme', t);
    document.documentElement.dataset.theme = t;
  }, theme);
  // 四档缩放是 role=radiogroup「缩放级别」里的 role=radio，不是普通 button
  const zooms = main.getByRole('radiogroup', { name: '缩放级别' });
  for (const [zoom, label] of [['year', '年'], ['quarter', '季'], ['month', '月'], ['week', '周']]) {
    await zooms.getByRole('radio', { name: label, exact: true }).click();
    await new Promise((r) => setTimeout(r, 600));
    const bars = await main.evaluate(() => document.querySelectorAll('svg rect').length);
    check(`甘特图 ${theme}/${zoom} 有内容`, bars > 0, `${bars} 个 rect`);
    await main.screenshot({ path: `${OUT}/gantt-${theme}-${zoom}.png` });
  }
}
check('加载过程无 console error / pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));

await app.close();
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILED: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
