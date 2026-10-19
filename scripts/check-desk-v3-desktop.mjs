/**
 * 工作台 v3 桌面打包形态自查：负责人是在桌面版里点「新建」没反应的，所以在构建后的 Electron 窗口里再验一遍。
 * 前置：npm run electron:build。跑法：node scripts/check-desk-v3-desktop.mjs
 * ⚠️ 独立 userData（--user-data-dir），绝不碰真实 profile。
 */
import { _electron as electron } from 'playwright';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILE = join(tmpdir(), 'yearflow-desk-v3-profile');
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

rmSync(PROFILE, { recursive: true, force: true });
const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.waitForLoadState('domcontentloaded');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
await page.waitForSelector('.dk-day', { timeout: 20000 });

const fab = page.locator('.dk-fab');
const region = await fab.evaluate((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region') || getComputedStyle(e).getPropertyValue('app-region'));
check('「新建」不在窗口拖动区里（拖动区会吞掉鼠标）', region !== 'drag', region || '(none)');
await fab.click();
check('桌面版：鼠标点「新建」打开新建卡', await page.locator('.dk-qa').isVisible());
await page.keyboard.type('桌面版点选新建');
await page.locator('.dk-qa .dk-seg.scope button', { hasText: '生活' }).click();
await page.locator('.dk-qa .dk-seg button', { hasText: '尽快' }).click();
await page.keyboard.press('Enter');
const it = await page.evaluate(() => Object.values(window.__store?.getState?.().workItems ?? {}).find((i) => i.title === '桌面版点选新建') ?? null);
const row = page.locator('.dk-day.today .dk-zone.life .dk-row', { hasText: '桌面版点选新建' });
check('建成并落在今天的生活区', (await row.count()) === 1, it ? `${it.scope}/${it.urgency}` : '');
await page.keyboard.press('Escape');

const railN = await page.locator('.dk-day.rail').count();
const today = await page.evaluate(() => new Date().getDay());
check('周末默认收成窄条', railN === (today === 0 || today === 6 ? 1 : 2), String(railN));
await page.locator('.dk-bar button', { hasText: '收尾今天' }).click();
check('「收尾今天」打开面板', await page.locator('.dk-sd').isVisible());
await page.waitForTimeout(350);
await page.screenshot({ path: 'docs/screenshots/desk/v3-desktop-shutdown.png' });
await page.keyboard.press('Escape');
check('Esc 关闭收尾面板', !(await page.locator('.dk-sd').count()));
check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));

await app.evaluate(({ app }) => app.exit(0));
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
