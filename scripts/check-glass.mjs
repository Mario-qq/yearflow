/**
 * 工作台透明自查（负责人 2026-10-27：系统真亚克力）。前置：vite dev 在 5173、npm run electron:tsc。
 * 跑法：node scripts/check-glass.mjs
 *
 * ① 网页版（系统 Chrome）：没有亚克力，选了图才透明 —— 用 Windows 自带壁纸当自选图。
 * ② 桌面版（Electron dev 模式 + 独立 userData，绝不碰真实数据）：窗后垫一块壁纸窗模拟桌面，
 *    用 desktopCapturer 截**系统合成后的真实画面**（页面截图里看不到亚克力）；再抢走焦点验「失焦用壁纸接住」。
 */
import { chromium, _electron as electron } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = 'http://localhost:5173';
const OUT = 'screenshots/glass'; // 不提交：桌面版截的是系统合成画面，会带上真实桌面、任务栏和别的窗口
mkdirSync(OUT, { recursive: true });
const PROFILE = join(tmpdir(), 'yearflow-glass-profile');
/** Windows 自带壁纸：当网页版的「自选图片」，也垫在桌面版窗后模拟桌面 */
const WP = ['C:/Windows/Web/Wallpaper/ThemeA/img20.jpg', 'C:/Windows/Web/Wallpaper/Windows/img0.jpg'].find((p) => existsSync(p));

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(200);
  }
}

/** 甘特示例 + 像负责人这一周的工作台数据（与 capture-ui-audit.mjs 同一份） */
async function seed(page, theme) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    s.updateSettings({ theme });
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const t0 = fmt(today);
    const dow = (today.getDay() + 6) % 7; // 周一 = 0
    const D = (n) => { const d = new Date(today); d.setDate(d.getDate() - dow + n); return fmt(d); };
    const stamp = new Date().toISOString();
    let seq = 0;
    const it = (o) => ({ id: `w${seq++}`, kind: 'todo', urgency: 'normal', scope: 'work', status: 'open', order: seq, createdAt: `${o.date ?? t0}T08:00:00.000Z`, updatedAt: stamp, ...o });
    const items = [
      it({ title: '整理 MRP 跑批慢的 sqexplain 结论', date: D(0), status: 'done' }),
      it({ title: '回复采购 apmt540 报错原因', date: D(0), status: 'done' }),
      it({ title: '更新 ARM 退货配置检查表', date: D(0), urgency: 'soon', deferCount: 3 }),
      it({ kind: 'followup', title: 'MRP 跑批优化进度：已降到 40 分钟', person: '张经理', mode: 'inform', date: D(1) }),
      it({ title: '确认 cmrp810 索引方案', date: D(1), status: 'done' }),
      it({ title: '写出货异常需求文档初稿', date: D(1), status: 'done' }),
      it({ title: 'SAP 迁移会议纪要发群', date: D(2), status: 'done' }),
      it({ title: '测试新报表 cxmr 的输出格式', date: D(2) }),
      it({ title: '给财务出月结差异清单', date: D(3), status: 'done' }),
      it({ title: '修复出货单过帐失败（客户急单）', date: t0, urgency: 'urgent', dueDate: t0 }),
      it({ title: '汇总周会材料', date: t0, urgency: 'soon', dueDate: t0 }),
      it({ title: '审 cpmi310 客制改动的代码', date: t0 }),
      it({ kind: 'followup', title: '下周六晚停机窗口', person: '张经理', mode: 'inform', date: t0 }),
      it({ kind: 'followup', title: 'cmrp810 索引脚本', person: '李工', mode: 'dispatch', date: t0, urgency: 'urgent' }),
      it({ title: '预约年度体检', date: t0, scope: 'life' }),
      it({ title: '给车做保养', date: D(5), scope: 'life' }),
      it({ title: 'ARM 跨公司退货联调', date: D(7), urgency: 'soon' }),
      it({ kind: 'followup', title: 'Q4 系统需求排期表', person: '陈总', mode: 'dispatch', date: D(8) }),
      it({ title: 'MRP 优化上线评审', date: D(8) }),
      it({ title: '准备 SAP MM 练习数据', date: D(9) }),
      it({ title: '研究 Informix 统计信息自动更新' }),
      it({ title: '整理 TIPTOP 常见报错知识库' }),
      it({ kind: 'followup', title: '新同事 ERP 权限开通', person: '王芳', mode: 'dispatch' }),
    ];
    const r = (id, title, rule, o = {}) => ({ id, title, scope: 'work', rule, startDate: D(-30), order: seq++, createdAt: stamp, updatedAt: stamp, ...o });
    const routines = [
      r('r1', '检查 MRP 夜间批次结果', { type: 'workday' }, { time: '09:00' }),
      r('r2', '提交上周周报', { type: 'weekly', daysOfWeek: [1] }, { time: '10:00' }),
      r('r3', '系统巡检', { type: 'weekly', daysOfWeek: [3] }),
      r('r4', '备份测试区数据库', { type: 'weekly', daysOfWeek: [5] }, { time: '17:30' }),
      r('r5', '打篮球', { type: 'weekly', daysOfWeek: [6] }, { scope: 'life' }),
      r('r6', '规划下周', { type: 'weekly', daysOfWeek: [0] }, { scope: 'life', time: '20:00' }),
    ];
    const logs = [0, 1, 2, 3].filter((n) => D(n) < t0).map((n) => ({ id: `r1:${D(n)}`, routineId: 'r1', date: D(n), status: 'done', doneAt: stamp, doneOn: D(n), createdAt: stamp, updatedAt: stamp }));
    if (D(0) < t0) logs.push({ id: `r2:${D(0)}`, routineId: 'r2', date: D(0), status: 'done', doneAt: stamp, doneOn: D(0), createdAt: stamp, updatedAt: stamp });
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    const bundle = buildSeedBundle(t0);
    await s.replaceAllData({ ...bundle, workItems: items, routines, routineLogs: logs, dayMarks: [] });
  }, theme);
  await page.waitForTimeout(800); // 设置是 500ms 防抖落库，跳页前等它写进去（否则主题丢）
}

const glassState = (page) =>
  page.evaluate(() => ({
    glass: document.documentElement.dataset.glass ?? null,
    wallOn: document.querySelector('.gl-wall')?.classList.contains('on') ?? false,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    dayBg: document.querySelector('.dk-day') ? getComputedStyle(document.querySelector('.dk-day')).backgroundColor : null,
  }));
/** 颜色带不足 1 的 alpha（半透明） */
const translucent = (c) => /\/\s*0?\.\d+\)$|,\s*0?\.\d+\)$/.test(c ?? '');

// ───────── ① 网页版 ─────────
{
  const wpUrl = `data:image/jpeg;base64,${readFileSync(WP).toString('base64')}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await seed(page, theme);
    await page.evaluate((u) => localStorage.setItem('yearflow-glass-image', u), wpUrl);
    await page.goto(`${BASE}/desk`);
    await until(() => page.evaluate(() => document.documentElement.dataset.glass === 'image'));
    await sleep(800);
    const s = await glassState(page);
    check(`网页 ${theme}：工作台进入图片垫底模式`, s.glass === 'image' && s.wallOn, JSON.stringify(s));
    check(`网页 ${theme}：页面底透明、日卡半透明`, s.bodyBg === 'rgba(0, 0, 0, 0)' && translucent(s.dayBg), `${s.bodyBg} / ${s.dayBg}`);
    await page.screenshot({ path: `${OUT}/web-desk-${theme}.png` });
    await page.goto(`${BASE}/gantt`);
    await sleep(800);
    check(`网页 ${theme}：甘特图不受影响`, (await glassState(page)).glass === null);
    if (theme === 'dark') {
      await page.goto(`${BASE}/settings`);
      await sleep(600);
      check('设置页有「工作台透明」开关与通透程度滑块', (await page.getByText('工作台透明').count()) > 0 && (await page.locator('input[type=range]').count()) > 0);
      await page.getByText('工作台透明').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/web-settings-${theme}.png` });
      await page.getByLabel('工作台透明').uncheck();
      await page.goto(`${BASE}/desk`);
      await sleep(600);
      check('关掉开关：工作台回到实色', (await glassState(page)).glass === null);
      await page.goto(`${BASE}/settings`);
      await page.getByLabel('工作台透明').check();
      // 通透程度滑块写到 --gl-a
      await page.locator('input[type=range]').fill('100');
      await page.goto(`${BASE}/desk`);
      await sleep(600);
      const a = await page.evaluate(() => document.documentElement.style.getPropertyValue('--gl-a'));
      check('通透程度拉满：--gl-a = 0.3', a === '0.3', a);
      await page.screenshot({ path: `${OUT}/web-desk-${theme}-clear.png` });
    }
    await ctx.close();
  }
  await browser.close();
}

// ───────── ② 桌面版（真实系统亚克力） ─────────
{
  const backdrop = resolve(PROFILE + '-backdrop.html');
  writeFileSync(backdrop, `<!doctype html><body style="margin:0;height:100vh;background:url('file:///${WP}') center/cover"></body>`);
  const env = { ...process.env, VITE_DEV_SERVER_URL: `${BASE}/` };
  const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 窗后垫一块铺满屏幕的壁纸窗，模拟「窗口后面是桌面」，截图才稳定
  await app.evaluate(async ({ BrowserWindow, screen }, file) => {
    const wa = screen.getPrimaryDisplay().workArea;
    const main = BrowserWindow.getAllWindows()[0];
    const back = new BrowserWindow({ ...wa, frame: false, focusable: false, skipTaskbar: true, show: true });
    await back.loadFile(file);
    // 窗序钉死：壁纸窗压在所有别的应用之上、主窗再压在壁纸窗之上，否则别的窗口会插到中间
    back.setAlwaysOnTop(true, 'normal');
    main.setAlwaysOnTop(true, 'floating');
    globalThis.__back = back;
    globalThis.__main = main;
    main.setBounds({ x: wa.x + 24, y: wa.y + 16, width: Math.min(1440, wa.width - 48), height: Math.min(900, wa.height - 32) });
    main.moveTop();
    main.focus();
  }, backdrop);

  const shot = (name) =>
    app.evaluate(async ({ desktopCapturer, screen }) => {
      const main = globalThis.__main;
      const d = screen.getPrimaryDisplay();
      const sf = d.scaleFactor;
      const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf } });
      const b = main.getBounds();
      const img = src.thumbnail.crop({ x: Math.round(b.x * sf), y: Math.round(b.y * sf), width: Math.round(b.width * sf), height: Math.round(b.height * sf) });
      return img.toPNG().toString('base64');
    }).then((b64) => writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64')));
  const focusMain = () => app.evaluate(() => globalThis.__main.focus());

  // 载入示例数据（工作台有内容才看得出卡片）：复用网页版同一份 seed（它会先跳 /settings）
  await seed(page, 'dark');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
    await sleep(800); // 设置 500ms 防抖落库，跳页前等它写进去（否则主题丢）
    await page.goto(`${BASE}/desk`);
    await until(() => page.evaluate(() => document.documentElement.dataset.glass === 'acrylic'));
    await focusMain();
    await sleep(1200);
    const s = await glassState(page);
    check(`桌面 ${theme}：工作台进入系统亚克力模式`, s.glass === 'acrylic' && !s.wallOn, JSON.stringify(s));
    const src = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    check(`桌面 ${theme}：亚克力深浅跟应用主题（nativeTheme）`, src === theme, src);
    await shot(`desktop-desk-${theme}-active`);
    // 真实情况：窗后是用户此刻开着的别的窗口（常见是白色浏览器）
    await app.evaluate(() => globalThis.__back.hide());
    await focusMain();
    await sleep(900);
    await shot(`desktop-desk-${theme}-active-real`);
    await app.evaluate(() => {
      // 重新显示会把壁纸窗顶到最前：再把主窗钉回它上面
      globalThis.__back.showInactive();
      globalThis.__main.setAlwaysOnTop(true, 'floating');
      globalThis.__main.moveTop();
    });
    await focusMain();

    if (theme === 'dark') {
      // 抢走焦点：系统亚克力变实色，页面应换上壁纸垫底
      await app.evaluate(({ BrowserWindow, screen }) => {
        const wa = screen.getPrimaryDisplay().workArea;
        globalThis.__thief = new BrowserWindow({ x: wa.x + wa.width - 220, y: wa.y + wa.height - 140, width: 200, height: 120, title: '焦点', alwaysOnTop: true });
        globalThis.__thief.focus();
      });
      const on = await until(() => page.evaluate(() => document.querySelector('.gl-wall')?.classList.contains('on')), 5000);
      check('桌面：失焦时壁纸垫底层淡入接住', !!on);
      await sleep(600);
      await shot(`desktop-desk-${theme}-inactive`);
      await app.evaluate(() => {
        globalThis.__thief.close();
        globalThis.__thief = null;
      });
    }
  }
  await page.goto(`${BASE}/gantt`);
  await sleep(800);
  check('桌面：甘特图仍是实色（不透明）', (await glassState(page)).glass === null);
  const menu = await app.evaluate(() => ({ visible: globalThis.__main.isMenuBarVisible(), autoHide: globalThis.__main.isMenuBarAutoHide() }));
  check('桌面：顶部菜单栏默认收起（Alt 呼出）', !menu.visible && menu.autoHide, JSON.stringify(menu));
  await app.evaluate(() => {
    globalThis.__main.setAlwaysOnTop(false);
    globalThis.__back?.close();
  });
  await app.close();
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
