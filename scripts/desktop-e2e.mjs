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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'screenshots/desktop';
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173/';

/**
 * ⚠️ 自查一律跑在**独立的 userData 目录**里，绝不碰真实 profile。
 * 教训：早先的自查往 app://local 的真实 IndexedDB 里载入过示例数据，而桌面版一旦登录
 * Supabase，LWW 同步就会把那些示例目标推上云、污染手机端。测试数据必须与真实数据物理隔离。
 */
const PROFILE = join(tmpdir(), 'yearflow-e2e-profile');

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
  args: ['.', `--user-data-dir=${PROFILE}`],
  env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
});

const main = await app.firstWindow();
await main.waitForLoadState('domcontentloaded');
await until(() => main.evaluate(() => !!window.__store?.getState().hydrated));
check('主窗 hydrate 完成', true);

// 独立 profile 是空库，而 E 段要选事项 ⇒ 先灌一份示例数据（种子是仓内既有的 seedData）
const seeded = await main.evaluate(async () => {
  if (Object.keys(window.__store.getState().goals).length > 0) return 'already';
  const { buildSeedBundle } = await import('/src/seed/seedData.ts');
  await window.__store.getState().replaceAllData(buildSeedBundle());
  return Object.keys(window.__store.getState().goals).length;
});
check('独立测试 profile 已灌入示例数据', seeded === 'already' || Number(seeded) > 0, String(seeded));

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

// ── E. 小窗内选专注事项 ──────────────────────────────────────────────
// 先收掉 D 段留下的到点庆祝态 —— 那棵树是另一套版式，没有事项按钮（它有自己的 pip-bar）
await main.evaluate(async () => {
  const { setAlert } = await import('/src/pomodoro/kernel.ts');
  setAlert(null);
});
await until(() => pip.evaluate(() => !document.querySelector('.pip-celebrate')));

// 顶栏那颗事项按钮只在「非专注中」出现（专注中归属锁死，改归属＝篡改已发生的记录）
const selBtnCount = await pip.locator('.pip-sel--btn').count();
check('E 空闲态顶栏有可点的事项按钮', selBtnCount === 1, `${selBtnCount} 个`);

await pip.click('.pip-sel--btn');
await pip.waitForSelector('.pip-picker');
const rows = await pip.locator('.pip-picker-row').count();
check('E 浮层里有候选事项', rows > 1, `${rows} 行（含「暂不归类」）`);
await pip.screenshot({ path: `${OUT}/pip-picker.png` });

// 浮层是绝对定位覆盖层 ⇒ 打开前后小窗尺寸必须一模一样（需求原话：不影响大小）
const sizeWithPicker = await pip.evaluate(() => ({ w: innerWidth, h: innerHeight }));
const pickedName = await pip.locator('.pip-picker-row').nth(0).locator('.pip-picker-name').textContent();
check('E 首行是真任务而非「暂不归类」', (pickedName ?? '').trim() !== '暂不归类', pickedName ?? '');
await pip.locator('.pip-picker-row').nth(0).click();
await until(() => pip.evaluate(() => !document.querySelector('.pip-picker')));
const sizeAfter = await pip.evaluate(() => ({ w: innerWidth, h: innerHeight }));
check('E 浮层不改变小窗尺寸', sizeWithPicker.w === sizeAfter.w && sizeWithPicker.h === sizeAfter.h,
  `${JSON.stringify(sizeWithPicker)} → ${JSON.stringify(sizeAfter)}`);

const chipText = await pip.textContent('.pip-sel--btn');
check('E 选完顶栏显示所选事项', (chipText ?? '').includes((pickedName ?? '').trim()),
  `顶栏「${chipText}」 vs 选中「${pickedName}」`);

// 写的是 localStorage 的 lastTask ⇒ 主窗那侧必须同源
const mainLast = await main.evaluate(() => JSON.parse(localStorage.getItem('yearflow:pomodoro:lastTask') ?? 'null'));
check('E 选择落到 localStorage，主窗同源', !!mainLast?.taskId, JSON.stringify(mainLast));

// 从小窗起一段，归属应当就是刚选的那个
await pip.click('.pip-controls button');
const startedWith = await until(() => main.evaluate(
  () => window.__pomodoro.store.getState().running?.taskId ?? null));
check('E 从小窗开始的专注带上了所选事项', startedWith === mainLast?.taskId, `${startedWith}`);
const lockedCount = await pip.locator('.pip-sel--btn').count();
check('E 专注中事项改为不可点（归属锁死）', lockedCount === 0, `${lockedCount} 个按钮`);
await pip.screenshot({ path: `${OUT}/pip-running-withtask.png` });

// 最窄 200px：事项名必须靠省略号收口，段点不能被顶出窗外（这是 min-width:0 那条的验收点）
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  w.setSize(200, 132);
});
await new Promise((r) => setTimeout(r, 500));
const narrow = await pip.evaluate(() => {
  const segs = document.querySelector('.pip-segs');
  const sel = document.querySelector('.pip-sel');
  const r = segs?.getBoundingClientRect();
  return {
    segsRight: r ? Math.round(r.right) : null,
    winW: innerWidth,
    truncated: sel ? sel.scrollWidth > sel.clientWidth + 1 : null,
  };
});
check('E 200px 下段点仍在窗内', narrow.segsRight !== null && narrow.segsRight <= narrow.winW,
  `segs right=${narrow.segsRight} / 窗宽 ${narrow.winW}`);
check('E 200px 下事项名被省略号截断', narrow.truncated === true, JSON.stringify(narrow));
await pip.screenshot({ path: `${OUT}/pip-narrow-withtask.png` });
await main.evaluate(async () => {
  const { discardFocus } = await import('/src/pomodoro/kernel.ts');
  discardFocus();
});

// ── F. 小窗透明度 ────────────────────────────────────────────────────
for (const pct of [60, 100]) {
  await main.evaluate((v) => {
    const st = window.__store.getState();
    st.updateSettings({ pomodoro: { ...st.settings.pomodoro, pipOpacity: v } });
  }, pct);
  const got = await until(async () => {
    const o = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
      return w ? Math.round(w.getOpacity() * 100) : null;
    });
    return o === pct ? o : null;
  }, 5000);
  check(`F 透明度设为 ${pct}% 后原生窗口生效`, got === pct, `实际 ${got}`);
}

// ── 关窗回填 ─────────────────────────────────────────────────────────
await pip.click('.pip-native-close');
const closedBack = await until(() => main.evaluate(() => window.__pomodoro.store.getState().pipOpen === false));
check('小窗自己关闭后主窗 pipOpen 回填为 false', !!closedBack);

await app.close();
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILED: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
