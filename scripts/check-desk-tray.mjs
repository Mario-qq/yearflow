/**
 * 桌面版「托盘常驻 + 学习提醒通路」自查（DESK_SPEC §五 第 2 层）。走打包形态（app:// 协议）。
 *
 * 前置：npm run electron:build
 * 跑法：node scripts/check-desk-tray.mjs
 *
 * ⚠️ 跑在独立 userData 里（--user-data-dir），绝不碰真实 profile。
 * ⚠️ 不去切「开机自启」：那会改真实注册表（HKCU\…\Run），这里只读它的状态。
 */
import { _electron as electron } from 'playwright';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILE = join(tmpdir(), 'yearflow-desk-tray-profile');
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

rmSync(PROFILE, { recursive: true, force: true });
const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
const page = await app.firstWindow();
page.on('dialog', (d) => void d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.waitForLoadState('domcontentloaded');
await until(() => page.locator('.dk-day').count());

// 1. 托盘偏好：默认关窗收进托盘、开机自启关着（只读，不切）
const prefs = await page.evaluate(() => window.yearflowDesktop.getShellPrefs());
check('默认关窗收进托盘、不开机自启', prefs.closeToTray === true && prefs.openAtLogin === false && prefs.canAutoStart === true, JSON.stringify(prefs));

// 2. 设置页：学习提醒 + 桌面常驻；勾学习目标
await page.getByRole('link', { name: '设置' }).first().click();
await until(() => page.getByText('桌面常驻').count());
check('桌面版设置页有「桌面常驻」与「学习提醒」', (await page.getByText('桌面常驻').count()) > 0 && (await page.getByText('学习提醒').count()) > 0);
await page.getByRole('button', { name: '载入示例数据' }).click();
await until(() => page.getByText('目标 5').count());
for (const name of ['SAP系统', '英语']) await page.locator('.dk-su-goal', { hasText: name }).click();
await page.waitForTimeout(700); // 设置防抖落库

// 3. 关主窗 = 收进托盘：窗口隐藏但没销毁，应用还活着，渲染进程照常跑计时
const hidden = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.close();
  return new Promise((r) => setTimeout(() => r({ alive: !w.isDestroyed(), visible: w.isVisible(), n: BrowserWindow.getAllWindows().length }), 400));
});
check('关窗后窗口隐藏、没销毁', hidden.alive && !hidden.visible && hidden.n === 1, JSON.stringify(hidden));
const ticks = await page.evaluate(() => new Promise((r) => { let n = 0; const t = setInterval(() => { n++; if (n === 5) { clearInterval(t); r(n); } }, 100); setTimeout(() => r(n), 3000); }));
check('收进托盘后渲染进程的定时器照常跑（提醒轮询靠它）', ticks === 5, String(ticks));
check('第一次收进托盘写了偏好文件（说明只弹一次）', existsSync(join(PROFILE, 'shell-prefs.json')) && JSON.parse(readFileSync(join(PROFILE, 'shell-prefs.json'), 'utf8')).trayHintShown === true);

// 4. 点通知 / 托盘「开始学习」的通路：主进程发 app:navigate + tray:study → 主窗跳到工作台并起学习番茄钟
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.show();
  w.webContents.send('app:navigate', '/desk');
  w.webContents.send('tray:study');
});
const running = await until(() => page.locator('.dk-study.running').count());
check('托盘「开始学习」→ 工作台学习卡进入计时', !!running && new URL(page.url()).pathname === '/desk', page.url());
const planned = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('pomodoro') && k.includes('running')) ?? '') ?? 'null')?.plannedMs ?? null);
check('学习番茄钟时长 = 30 分钟', planned === 30 * 60_000, String(planned));
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await page.screenshot({ path: 'docs/screenshots/desk/desktop-study-running.png' });
await page.locator('.dk-study.running .dk-btn', { hasText: '放弃' }).click();

// 5. 通知 IPC 接受 route（不点真通知：Windows 原生 toast 点不了；跳转通路见上）
const ok = await page.evaluate(() => window.yearflowDesktop.notify('YearFlow 托盘自查（可忽略）', { title: '自查', route: '/desk' }));
check('notify 带 route 能发', ok === true);

// 6. 改成关窗即退出：关窗后应用退出
await page.evaluate(() => window.yearflowDesktop.setShellPref('closeToTray', false));
const exited = new Promise((r) => app.process().once('exit', () => r(true)));
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
check('关掉「收进托盘」后关窗即退出', await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 8000))]));

check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));
// 应用此时已经自己退出了（上一项），不再 app.close()
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
