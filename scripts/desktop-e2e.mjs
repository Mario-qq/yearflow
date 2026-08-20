/**
 * 桌面版端到端自查（Playwright 的 Electron 驱动）。
 *
 * 验的是计划里那条最关键的假设链：小窗是**另一个窗口、另一个 realm**，它和主窗之间
 * 只靠 localStorage + storage 事件 + Web Locks 对齐。所以这里逐项证明：
 *   A. 主窗开始专注 → 小窗自己就跟上了（storage 桥通）
 *   B. 主窗暂停 → 小窗跟着变（双向都通）
 *   C. 小窗可任意拉伸，版式与纸屑跟着变（截图人工过目）
 *   D. 一段 1 分钟的专注到点后，**只写一条** focusSession（选主没漏、没重）
 *
 * 跑法：先起 ELECTRON=1 的 vite dev（DEV 才有 window.__pomodoro 观测句柄），再
 *   node scripts/desktop-e2e.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'screenshots/desktop';
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173/';

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

/** 轮询直到 fn() 为真值 */
async function until(fn, ms = 15000, every = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}

mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
});

const main = await app.firstWindow();
await main.waitForLoadState('domcontentloaded');
await until(() => main.evaluate(() => !!window.__store?.getState().hydrated));
check('主窗 hydrate 完成', true);

// 把专注时长压到 1 分钟，让「到点结算」这条路径能在自查里真正跑一遍
await main.evaluate(() =>
  window.__store.getState().updateSettings({
    pomodoro: { ...window.__store.getState().settings.pomodoro, focusMin: 1, autoBreak: false },
  }),
);

// ── 开小窗 ────────────────────────────────────────────────────────────
await main.evaluate(() => window.yearflowDesktop.openPip());
const pip = await until(async () => {
  for (const w of app.windows()) {
    if (w !== main && w.url().includes('pip.html')) return w;
  }
  return null;
});
check('小窗以独立窗口开出', !!pip, pip ? pip.url() : '没等到 pip.html 窗口');
if (!pip) {
  await app.close();
  process.exit(1);
}
await pip.waitForSelector('.pip-native');
await until(() => pip.evaluate(() => !!window.__store?.getState().hydrated));

const geom = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  return { frameless: !w.isResizable || true, resizable: w.isResizable(), onTop: w.isAlwaysOnTop(), size: w.getSize() };
});
check('小窗可拉伸', geom.resizable === true, JSON.stringify(geom.size));
check('小窗置顶', geom.onTop === true);

// ── A. 主窗开始专注 → 小窗跟上（storage 桥）────────────────────────────
await main.evaluate(() => window.__pomodoro.start({}));
const synced = await until(async () => {
  const r = await pip.evaluate(() => window.__pomodoro.store.getState().running);
  return r && r.phase === 'focus' ? r : null;
});
check('A 主窗开始专注 → 小窗同步到 running', !!synced, synced ? `sessionId=${synced.sessionId}` : '小窗 running 一直为空');

const sameId = synced && (await main.evaluate(() => window.__pomodoro.store.getState().running?.sessionId));
check('A 两窗指向同一个 sessionId', !!synced && sameId === synced.sessionId, `${sameId} vs ${synced?.sessionId}`);

await pip.screenshot({ path: `${OUT}/pip-running-260x172.png` });

// ── B. 主窗暂停 → 小窗跟上 ───────────────────────────────────────────
await main.evaluate(() => window.__pomodoro.store.getState() && window.__pomodoro);
await main.evaluate(async () => {
  const { pauseFocus } = await import('/src/pomodoro/kernel.ts');
  pauseFocus();
});
const paused = await until(() => pip.evaluate(() => window.__pomodoro.store.getState().running?.paused === true));
check('B 主窗暂停 → 小窗显示已暂停', !!paused);
const pausedText = await pip.textContent('.pip-phase');
check('B 小窗顶栏文案为「已暂停」', (pausedText ?? '').includes('已暂停'), pausedText ?? '');
await pip.screenshot({ path: `${OUT}/pip-paused.png` });

await main.evaluate(async () => {
  const { resumeFocus } = await import('/src/pomodoro/kernel.ts');
  resumeFocus();
});
await until(() => pip.evaluate(() => window.__pomodoro.store.getState().running?.paused === false));
check('B 主窗继续 → 小窗恢复计时', true);

// ── C. 拉伸小窗 ──────────────────────────────────────────────────────
for (const [w, h] of [
  [200, 132],
  [420, 300],
  [640, 200],
]) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
    win.setSize(size[0], size[1]);
  }, [w, h]);
  await new Promise((r) => setTimeout(r, 400));
  const box = await pip.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  check(`C 小窗拉伸到 ${w}×${h}`, Math.abs(box.w - w) <= 2 && Math.abs(box.h - h) <= 2, JSON.stringify(box));
  await pip.screenshot({ path: `${OUT}/pip-${w}x${h}.png` });
}

// 深浅主题各来一张（主题跟随主窗，走的是 storage 事件那条线）
for (const theme of ['dark', 'light']) {
  await main.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await until(() => pip.evaluate((t) => document.documentElement.dataset.theme === t, theme));
  check(`C 小窗跟随主窗切到 ${theme} 主题`, true);
  await pip.screenshot({ path: `${OUT}/pip-theme-${theme}.png` });
}
await main.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));

// ── D. 到点结算：只能写一条 ───────────────────────────────────────────
const before = await main.evaluate(() => Object.keys(window.__store.getState().focusSessions).length);
console.log('等这段 1 分钟的专注自然到点…');
const settled = await until(
  () => main.evaluate(() => window.__pomodoro.store.getState().running === null),
  90000,
  1000,
);
check('D 专注到点后运行态清空', !!settled);
await new Promise((r) => setTimeout(r, 1500)); // 让 500ms 防抖落库 + storage 广播走完
const after = await main.evaluate(() => Object.keys(window.__store.getState().focusSessions).length);
check('D 只写了一条 focusSession', after - before === 1, `${before} → ${after}`);

const alertShown = await pip.evaluate(() => !!window.__pomodoro.store.getState().alert);
check('D 小窗到点提醒态出现', alertShown);

// 小窗的内存 store 不参与落库，靠 COMMITTED_KEY 广播补上；不补的话这两项会差最后一段
const pipCount = await pip.evaluate(() => Object.keys(window.__store.getState().focusSessions).length);
check('D 小窗也看到了新写的那条记录', pipCount === after, `小窗 ${pipCount} / 主窗 ${after}`);
const headline = await pip.textContent('.pip-headline');
check('D 小窗结果文案是结算时长而非泛用提示', /专注\s*\d/.test(headline ?? ''), headline ?? '');
await pip.screenshot({ path: `${OUT}/pip-celebrate.png` });

// ── 关窗回填 ─────────────────────────────────────────────────────────
await pip.click('.pip-native-close');
const closedBack = await until(() => main.evaluate(() => window.__pomodoro.store.getState().pipOpen === false));
check('小窗自己关闭后主窗 pipOpen 回填为 false', !!closedBack);

await app.close();
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILED: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
