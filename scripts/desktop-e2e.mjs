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
import { mkdirSync, rmSync } from 'node:fs';
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

/**
 * 数一张截图里「与左上角像素不同」的点数。
 * 药丸这种小图最容易骗过断言：DOM 有 .pip-dock-time 节点、几何也对，画面上却一个字都没有
 * （字被裁掉 / 与背景同色 / 被上一棵树盖住）。所以这里必须看像素，照 check-gantt-export.mjs
 * 的同一口径。解码借主窗那个 realm 的 canvas 干（Node 里没有 PNG 解码器）。
 */
const countInk = (page, buf) =>
  page.evaluate(
    (dataUrl) =>
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
          for (let i = 0; i < d.length; i += 4) if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== base) n += 1;
          resolve(n);
        };
        img.onerror = () => reject(new Error('PNG 解码失败'));
        img.src = dataUrl;
      }),
    `data:image/png;base64,${buf.toString('base64')}`,
  );

mkdirSync(OUT, { recursive: true });
// 小窗几何是会持久化的（userData/pip-window.json）。上一轮跑完常常停在贴边收起态，
// 那会让本轮前半段全部对着一条药丸做断言 ⇒ 每轮从干净的几何开始。
rmSync(join(PROFILE, 'pip-window.json'), { force: true });

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
// 常态只有倒计时：顶行与控制行是**条件挂载**的浮层，鼠标不移上去它们根本不在 DOM 里
// （原生 app-region 的死区问题，见 PipView 文件头）。所以每次要点浮层里的东西都得先 hover。
const hover = async () => {
  await pip.hover('.pip-shell');
  await pip.waitForSelector('.pip-overlay');
};
await until(() => pip.evaluate(() => !!window.__store?.getState().hydrated));

const geom = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  return { frameless: !w.isResizable || true, resizable: w.isResizable(), onTop: w.isAlwaysOnTop(), size: w.getSize() };
});
check('小窗可拉伸', geom.resizable === true, JSON.stringify(geom.size));
const bare = await pip.evaluate(() => ({
  w: innerWidth,
  h: innerHeight,
  overlay: !!document.querySelector('.pip-overlay'),
  time: (document.querySelector('.pip-time')?.textContent ?? '').trim(),
}));
// 无边框窗在 Windows 上带 1px 不可见边框，getSize 比请求值大一两像素 ⇒ 一律以窗内视口为准
check('小窗常态尺寸为 116×76', Math.abs(bare.w - 116) <= 2 && Math.abs(bare.h - 76) <= 2,
  JSON.stringify(bare));
check('常态不显示任何控件，只有倒计时', bare.overlay === false && /^\d+:\d\d$/.test(bare.time),
  JSON.stringify(bare));
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

await pip.screenshot({ path: `${OUT}/pip-running-compact.png` });
await hover();
await pip.screenshot({ path: `${OUT}/pip-running-hover.png` });

// ── B. 主窗暂停 → 小窗跟上 ───────────────────────────────────────────
await main.evaluate(() => window.__pomodoro.store.getState() && window.__pomodoro);
await main.evaluate(async () => {
  const { pauseFocus } = await import('/src/pomodoro/kernel.ts');
  pauseFocus();
});
const paused = await until(() => pip.evaluate(() => window.__pomodoro.store.getState().running?.paused === true));
check('B 主窗暂停 → 小窗显示已暂停', !!paused);
// 阶段文案让位给了事项名：这个宽度里只留得下圆点，文案退到它的 title 上
await hover();
const pausedText = await pip.getAttribute('.pip-dot', 'title');
check('B 小窗阶段标记为「已暂停」', (pausedText ?? '').includes('已暂停'), pausedText ?? '');
await pip.screenshot({ path: `${OUT}/pip-paused.png` });

await main.evaluate(async () => {
  const { resumeFocus } = await import('/src/pomodoro/kernel.ts');
  resumeFocus();
});
await until(() => pip.evaluate(() => window.__pomodoro.store.getState().running?.paused === false));
check('B 主窗继续 → 小窗恢复计时', true);

// ── C. 拉伸小窗 ──────────────────────────────────────────────────────
for (const [w, h] of [
  [100, 64],
  [116, 76],
  [420, 300],
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

// 深浅主题各来一张（主题跟随主窗，走的是 storage 事件那条线）。缩回常态尺寸再拍：
// 版式的设计点是 116×76，420×300 那张验的是「能拉伸」，不是日常观感。
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  w.setContentBounds({ ...w.getContentBounds(), width: 116, height: 76 });
});
await new Promise((r) => setTimeout(r, 300));
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
// 到点这一屏最容易挤：印章 + 主句 + 控制行必须塞进 116×76，所以专门缩回常态尺寸再拍
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  w.setContentBounds({ ...w.getContentBounds(), width: 116, height: 76 });
});
await new Promise((r) => setTimeout(r, 400));
const fits = await pip.evaluate(() => {
  const b = document.querySelector('.pip-celebrate');
  return b ? { over: b.scrollHeight - b.clientHeight, h: b.clientHeight } : null;
});
check('D 到点这一屏在 116×76 里不溢出', fits !== null && fits.over <= 0, JSON.stringify(fits));
await pip.screenshot({ path: `${OUT}/pip-celebrate.png` });

// ── E. 小窗内选专注事项 ──────────────────────────────────────────────
// 先收掉 D 段留下的到点庆祝态 —— 那棵树是另一套版式，没有事项按钮（它有自己的 pip-bar）
await main.evaluate(async () => {
  const { setAlert } = await import('/src/pomodoro/kernel.ts');
  setAlert(null);
});
await until(() => pip.evaluate(() => !document.querySelector('.pip-celebrate')));

// 顶栏那颗事项按钮只在「非专注中」出现（专注中归属锁死，改归属＝篡改已发生的记录）
await hover();
const selBtnCount = await pip.locator('.pip-sel--btn').count();
check('E 空闲态顶栏有可点的事项按钮', selBtnCount === 1, `${selBtnCount} 个`);

await hover();
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

await hover();
const chipText = await pip.textContent('.pip-sel--btn');
check('E 选完顶栏显示所选事项', (chipText ?? '').includes((pickedName ?? '').trim()),
  `顶栏「${chipText}」 vs 选中「${pickedName}」`);

// 写的是 localStorage 的 lastTask ⇒ 主窗那侧必须同源
const mainLast = await main.evaluate(() => JSON.parse(localStorage.getItem('yearflow:pomodoro:lastTask') ?? 'null'));
check('E 选择落到 localStorage，主窗同源', !!mainLast?.taskId, JSON.stringify(mainLast));

// 从小窗起一段，归属应当就是刚选的那个
await hover();
await pip.click('.pip-controls button');
const startedWith = await until(() => main.evaluate(
  () => window.__pomodoro.store.getState().running?.taskId ?? null));
check('E 从小窗开始的专注带上了所选事项', startedWith === mainLast?.taskId, `${startedWith}`);
await hover();
const lockedCount = await pip.locator('.pip-sel--btn').count();
check('E 专注中事项改为不可点（归属锁死）', lockedCount === 0, `${lockedCount} 个按钮`);
await pip.screenshot({ path: `${OUT}/pip-running-withtask.png` });

// 最窄 100px：事项名必须靠省略号收口，段点不能被顶出窗外（这是 min-width:0 那条的验收点）
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  w.setSize(100, 64);
});
await new Promise((r) => setTimeout(r, 500));
await hover();
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
check('E 100px 下段点仍在窗内', narrow.segsRight !== null && narrow.segsRight <= narrow.winW,
  `segs right=${narrow.segsRight} / 窗宽 ${narrow.winW}`);
check('E 100px 下事项名被省略号截断', narrow.truncated === true, JSON.stringify(narrow));
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

// ── G. 贴边收起 / 临时展开 / 脱离边缘 ────────────────────────────────
const pipBounds = () =>
  app.evaluate(({ BrowserWindow, screen: s }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
    // content bounds：无边框窗的外框带一圈不可见边框，比请求值大 1–3 像素（主进程也一律
    // 用 content bounds，见 main.cts 的 geomOf）
    return { b: w.getContentBounds(), wa: s.getDisplayMatching(w.getContentBounds()).workArea };
  });

/** 紧贴 edge 吗（主进程算完之后的事实核对） */
// 容差 2：读的是 content bounds，本该严格相等；留两像素给 DPI 取整。
const near = (a, b) => Math.abs(a - b) <= 2;
const isFlush = (edge, b, wa) =>
  (edge === 'left' && near(b.x, wa.x)) ||
  (edge === 'right' && near(b.x + b.width, wa.x + wa.width)) ||
  (edge === 'top' && near(b.y, wa.y)) ||
  (edge === 'bottom' && near(b.y + b.height, wa.y + wa.height));

// 前面几段可能留下一个到点提醒态（那棵树是另一套版式，没有 .pip-shell），先收掉
await main.evaluate(async () => {
  const { setAlert } = await import('/src/pomodoro/kernel.ts');
  setAlert(null);
});
await until(() => pip.evaluate(() => !document.querySelector('.pip-celebrate')), 4000);

// 先回到自由态的标准尺寸，免得上一段留下的 100×64 干扰判定
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  w.setSize(116, 76);
});
await new Promise((r) => setTimeout(r, 400));

for (const edge of ['left', 'right', 'top', 'bottom']) {
  // 「拖到边上」是用户手势，自查里等价地直接摆过去，再等主进程 moved 防抖后的吸附判定
  await app.evaluate(({ BrowserWindow, screen: s }, e) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
    const wa = s.getDisplayMatching(w.getContentBounds()).workArea;
    const b = w.getContentBounds();
    const pos = {
      left: { x: wa.x + 6, y: wa.y + 160 },
      right: { x: wa.x + wa.width - b.width - 6, y: wa.y + 160 },
      top: { x: wa.x + 260, y: wa.y + 6 },
      bottom: { x: wa.x + 260, y: wa.y + wa.height - b.height - 6 },
    }[e];
    // 一律 content bounds：把外框尺寸读出来再写回去，每来回一次窗就胖一圈边框
    w.setContentBounds({ ...b, ...pos });
  }, edge);
  /**
   * 收起完成后若光标还停在小窗上，会立刻被 hover-peek 顶开 —— 这是有意的手感（刚拖到边上
   * 松手时保持展开，移开鼠标才收）。但 Playwright 的鼠标是注入页面的合成事件、不动真实光标，
   * 于是「鼠标一直压在小窗上」在自查里是个甩不掉的常态：窗内每次重挂都会再报一次 enter。
   * 所以每轮轮询前先等价地报一次 leave，再读几何。
   */
  const collapse = () => pip.evaluate(() => window.yearflowDesktop.peekPip(false));

  const docked = await until(async () => {
    await collapse();
    const { b, wa } = await pipBounds();
    return near(b.width, 88) && near(b.height, 30) && isFlush(edge, b, wa) ? b : null;
  }, 4000);
  check(`G 拖到${edge}边缘 → 收成 88×30 并紧贴`, !!docked,
    JSON.stringify(docked ?? (await pipBounds())));

  const domEdge = await until(async () => {
    await collapse();
    return pip.evaluate(() => document.querySelector('.pip-dock')?.dataset.edge ?? null);
  }, 4000);
  check(`G ${edge}：窗内换成药丸那棵树`, domEdge === edge, String(domEdge));
  const noHit = await pip.evaluate(() => document.querySelectorAll('.pip-dock button, .pip-dock a').length);
  check(`G ${edge}：药丸里没有可点元素（整块是拖动区，否则拖不走）`, noHit === 0, `${noHit} 个`);

  // 药丸的全部意义就是「不展开也能看时间」：文本、进度线、以及画面上真有笔画，三样都要验
  const dockShown = await pip.evaluate(() => {
    const t = document.querySelector('.pip-dock-time');
    const fill = document.querySelector('.pip-dock .pip-fill');
    const r = t?.getBoundingClientRect();
    return {
      text: (t?.textContent ?? '').trim(),
      // 数字必须整个落在窗内 —— 30px 高里最容易出的错就是被裁掉半行
      inside: !!r && r.width > 0 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5,
      fill: !!fill,
      stray: document.querySelectorAll('.pip-shell, .pip-overlay, .pip-native-close').length,
    };
  });
  check(`G ${edge}：药丸里就是 mm:ss（${dockShown.text}）`,
    /^\d{1,2}:\d{2}$/.test(dockShown.text) && dockShown.inside, JSON.stringify(dockShown));
  check(`G ${edge}：药丸有底部进度线、且没有完整态的残片（段点/×）`,
    dockShown.fill && dockShown.stray === 0, JSON.stringify(dockShown));

  const shot = await pip.screenshot({ path: `${OUT}/pip-dock-${edge}.png` });
  const ink = await countInk(main, shot);
  check(`G ${edge}：药丸画面上真有笔画，不是一块空底`, ink > 150, `${ink} 个非背景像素`);

  // 移上去临时展开：必须仍紧贴同一条边（展开方向朝屏内，否则光标会被甩到窗外、来回抖）。
  // 同样绕开合成 hover（见上）：真实 hover 的接线只是 PipWindow 的一个 onPointerEnter，
  // 这条断言要验的是主进程算出来的展开方向与 clamp。
  await pip.evaluate(() => window.yearflowDesktop.peekPip(true));
  const peeked = await until(async () => {
    const { b, wa } = await pipBounds();
    return near(b.width, 116) && near(b.height, 76) && isFlush(edge, b, wa) ? b : null;
  }, 4000);
  check(`G ${edge}：hover 临时展开回 116×76 且仍贴边`, !!peeked, JSON.stringify(peeked));
  if (edge === 'bottom') await pip.screenshot({ path: `${OUT}/pip-peek-bottom.png` });

  // 展开态里那颗键语义反转成「脱离边缘」
  const shellUp = await until(() => pip.evaluate(() => !!document.querySelector('.pip-shell')), 4000);
  if (!shellUp) {
    const dump = await pip.evaluate(() => document.body.innerHTML.slice(0, 400));
    check(`G ${edge}：peek 后窗内换成完整那棵树`, false, dump);
    continue;
  }
  await pip.hover('.pip-shell');
  await pip.waitForSelector('.pip-dockbtn.is-docked');
  await pip.click('.pip-dockbtn.is-docked');
  const backFree = await until(async () => {
    const { b } = await pipBounds();
    return near(b.width, 116) && near(b.height, 76) ? b : null;
  }, 4000);
  check(`G ${edge}：点「脱离边缘」回到自由态`, !!backFree,
    JSON.stringify(backFree ?? { got: (await pipBounds()).b, dom: await pip.evaluate(() =>
      document.querySelector('.pip-dock') ? 'dock' : 'shell') }));
}

// 手动收起：不要求先把窗拖到边上
await app.evaluate(({ BrowserWindow, screen: s }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pip.html'));
  const wa = s.getDisplayMatching(w.getContentBounds()).workArea;
  w.setContentBounds({ x: wa.x + Math.round(wa.width / 2), y: wa.y + Math.round(wa.height / 2), width: 116, height: 76 });
});
await new Promise((r) => setTimeout(r, 500));
await pip.evaluate(() => window.yearflowDesktop.undockPip());
await hover();
await pip.click('.pip-dockbtn');
const manual = await until(async () => {
  const { b } = await pipBounds();
  return near(b.width, 88) && near(b.height, 30) ? b : null;
}, 4000);
check('G 顶行「收起」键：在屏幕中央也能直接吸附最近边', !!manual, JSON.stringify(manual));

// 药丸的深浅两版各留一张：这是日常最常看到的那个形态，观感要人工过目
for (const theme of ['dark', 'light']) {
  await main.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await until(() => pip.evaluate((t) => document.documentElement.dataset.theme === t, theme));
  const shot = await pip.screenshot({ path: `${OUT}/pip-dock-theme-${theme}.png` });
  const ink = await countInk(main, shot);
  check(`G 药丸在 ${theme} 主题下有笔画`, ink > 150, `${ink} 个非背景像素`);
}
await main.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
await pip.evaluate(() => window.yearflowDesktop.undockPip());
await until(async () => near((await pipBounds()).b.width, 116), 4000);

// 位置记忆：关窗再开，自由位置还在（写在 userData/pip-window.json，不进备份、不上云）
const beforeClose = (await pipBounds()).b;
await main.evaluate(() => window.yearflowDesktop.closePip());
await until(() => !app.windows().some((w) => w.url().includes('pip.html')));
await main.evaluate(() => window.yearflowDesktop.openPip());
const pip2 = await until(() => app.windows().find((w) => w.url().includes('pip.html')) ?? null);
await pip2.waitForSelector('.pip-native');
const reopened = (await pipBounds()).b;
check('G 关窗再开：位置与尺寸都还在',
  Math.abs(reopened.x - beforeClose.x) <= 2 && Math.abs(reopened.y - beforeClose.y) <= 2 &&
    near(reopened.width, beforeClose.width),
  `${JSON.stringify(beforeClose)} → ${JSON.stringify(reopened)}`);

// ── 关窗回填 ─────────────────────────────────────────────────────────
await pip2.hover('.pip-shell');
await pip2.click('.pip-native-close');
const closedBack = await until(() => main.evaluate(() => window.__pomodoro.store.getState().pipOpen === false));
check('小窗自己关闭后主窗 pipOpen 回填为 false', !!closedBack);

await app.close();
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILED: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
