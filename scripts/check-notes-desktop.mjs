/**
 * 便签桌面版自查（docs/NOTES_SPEC.md §二，跑 app:// 生产构建）：
 * 贴到桌面（独立置顶小窗、内容双向同步、换色）、取下、重开应用自动贴回、进回收站自动关、
 * 全局速记热键（Ctrl+Alt+N，用 SendKeys 发真实按键）、设置页热键状态。
 *
 * 前置：npm run electron:build。跑法：node scripts/check-notes-desktop.mjs
 * ⚠️ 独立 userData（每次清空），不碰真实数据。截图到 screenshots/notes-desktop/（本机，不提交）。
 */
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'screenshots/notes-desktop';
const PROFILE = join(tmpdir(), 'yearflow-notes-profile');
mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(200);
  }
}

const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
const stickyFile = join(PROFILE, 'sticky-notes.json');
const readSticky = () => (existsSync(stickyFile) ? JSON.parse(readFileSync(stickyFile, 'utf8')) : {});
const errs = [];
const watch = (page) => {
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
};
const stickyOf = (app) => app.windows().find((w) => w.url().includes('note.html?id='));
const cardText = (main, sel) => main.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);

let app = await launch();
let main = await app.firstWindow();
watch(main);
await until(() => main.evaluate(() => location.pathname.startsWith('/desk')));
await sleep(800);

// 记一条
await main.keyboard.press('Alt+KeyN');
await main.waitForSelector('.nt .nt-input');
await main.keyboard.type('贴纸测试');
await main.keyboard.press('Enter');
await main.waitForSelector('.nt-card');
const id = await main.$eval('.nt-card', (e) => e.dataset.noteId);
check('桌面版面板能记便签', !!id);

// 贴到桌面
await main.hover(`[data-note-id="${id}"]`);
const winP = app.waitForEvent('window');
await main.click(`[data-note-id="${id}"] .nt-act[title^="贴到桌面"]`);
const sticky = await winP;
watch(sticky);
await sticky.waitForSelector('.nt-win-text', { timeout: 10000 });
check('贴纸窗打开并拿到内容', (await sticky.inputValue('.nt-win-text')) === '贴纸测试');
const top = await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('note.html?id=')).map((w) => w.isAlwaysOnTop()),
);
check('贴纸窗置顶', top.length === 1 && top[0] === true);
check('卡片标「贴在桌面」', await until(async () => /贴在桌面/.test(await cardText(main, `[data-note-id="${id}"] .nt-flags`))));
check('位置记进 sticky-notes.json', !!(await until(async () => readSticky()[id])));

// 贴纸里改字 ⇒ 主窗跟上
await sticky.click('.nt-win-text');
await sticky.keyboard.press('Control+End');
await sticky.keyboard.type('\n在贴纸上补一句');
const synced = await until(async () => /在贴纸上补一句/.test(await cardText(main, `[data-note-id="${id}"] .nt-body`)));
check('贴纸改字 ⇒ 主窗便签跟上', !!synced);

// 主窗改字 ⇒ 贴纸跟上
await main.click(`[data-note-id="${id}"] .nt-line.nt-title`);
await main.waitForSelector('.nt-editor');
await main.keyboard.press('Control+End');
await main.keyboard.type('\n主窗补一句');
await sleep(700);
await main.keyboard.press('Escape');
const back = await until(async () => /主窗补一句/.test(await sticky.inputValue('.nt-win-text')));
check('主窗改字 ⇒ 贴纸跟上', !!back);

// 贴纸换色
await sticky.click('.nt-win-btn[title="颜色"]');
await sticky.click('.nt-win-colors .nt-swatch[data-color="yellow"]');
check('贴纸换色 ⇒ 主窗便签变色', !!(await until(async () => (await main.$eval(`[data-note-id="${id}"]`, (e) => e.dataset.color)) === 'yellow')));
check('贴纸自己也变色', !!(await until(async () => (await sticky.$eval('.nt-win', (e) => e.dataset.color)) === 'yellow')));
await sticky.screenshot({ path: `${OUT}/sticky.png` });

// 重开应用 ⇒ 贴回去
await sleep(800); // 落库防抖
await app.close();
app = await launch();
// 不能用 firstWindow()：贴回来的贴纸窗可能比主窗先挂上，按地址找主窗
main = await until(async () => app.windows().find((w) => !w.url().includes('note.html') && w.url().startsWith('app://')));
watch(main);
const restored = await until(async () => stickyOf(app));
check('重开应用后贴纸自动贴回', !!restored);
if (restored) {
  watch(restored);
  const text = await until(async () => {
    const v = await restored.inputValue('.nt-win-text');
    return /主窗补一句/.test(v) ? v : null;
  }, 20000);
  check('贴回的贴纸拿到内容（主窗 hydrate 后才回话）', !!text);
}

// 取下
await until(() => main.evaluate(() => location.pathname.startsWith('/desk')));
await sleep(500);
const s2 = stickyOf(app);
const closed = s2.waitForEvent('close');
await s2.click('.nt-win-btn[title^="从桌面取下"]');
await closed;
check('取下 = 关窗、不再记位置', !!(await until(async () => !readSticky()[id])));

// 进回收站 ⇒ 贴纸自己关
await main.keyboard.press('Alt+KeyN');
await main.waitForSelector(`[data-note-id="${id}"]`);
await main.hover(`[data-note-id="${id}"]`);
const winP2 = app.waitForEvent('window');
await main.click(`[data-note-id="${id}"] .nt-act[title^="贴到桌面"]`);
const s3 = await winP2;
await s3.waitForSelector('.nt-win-text');
const closed3 = s3.waitForEvent('close');
await main.hover(`[data-note-id="${id}"]`);
await main.click(`[data-note-id="${id}"] .nt-act[title^="删除"]`);
check('便签进回收站 ⇒ 贴纸自己关掉', !!(await Promise.race([closed3.then(() => true), sleep(5000).then(() => false)])));

// 全局速记热键
const registered = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+N'));
check('全局热键 Ctrl+Alt+N 已注册', registered);
const before = await main.$$eval('.nt-card', (els) => els.length);
execFileSync('powershell', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^%n')"]);
const quick = await until(async () => app.windows().find((w) => w.url().includes('note.html?quick=1')));
check('按下 Ctrl+Alt+N 弹出速记框', !!quick);
if (quick) {
  watch(quick);
  const visible = await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('quick=1') && w.isVisible())));
  check('速记框可见', !!visible);
  await quick.waitForSelector('.nt-win-text');
  await quick.fill('.nt-win-text', '速记：周五前交差旅报销');
  await quick.screenshot({ path: `${OUT}/quick.png` });
  await quick.press('.nt-win-text', 'Enter');
  const got = await until(async () => (await main.$$eval('.nt-card', (els) => els.map((e) => e.textContent).join('|'))).includes('周五前交差旅报销'));
  check('回车 ⇒ 主窗多一条便签', !!got && (await main.$$eval('.nt-card', (els) => els.length)) === before + 1);
  const hidden = await until(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('quick=1') && w.isVisible())));
  check('记下后速记框收起', !!hidden);
}

// 设置页热键状态
await main.keyboard.press('Escape');
await main.getByRole('link', { name: /设置/ }).click();
const status = await until(async () => /全局速记 Ctrl\+Alt\+N/.test(await main.evaluate(() => document.body.innerText)));
check('设置页显示全局速记热键状态', !!status);

check('全程没有页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await app.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
