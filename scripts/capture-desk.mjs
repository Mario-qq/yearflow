/**
 * 工作台 /desk 截图 + 交互自查（W1②）。前置：vite dev 在 5173（preview_start yearflow-dev）。
 * 跑法：node scripts/capture-desk.mjs [端口]
 *
 * 隔离：系统 Chrome + 每次新建的空 context（IndexedDB 全新），示例数据经 DEV 句柄 __store 注入，
 * 绝不碰真实数据。截图到 docs/screenshots/desk/。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] ?? '5173';
const BASE = `http://localhost:${PORT}`;
const OUT = 'docs/screenshots/desk';
mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/** 在页面里注入：甘特示例（设置页「载入示例数据」同源）+ 像负责人这一周的工作台数据 */
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

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

for (const theme of ['dark', 'light']) {
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await seed(page, theme);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.dk-day');
    check(`${theme} ${w}：首页落到 /desk`, new URL(page.url()).pathname === '/desk');
    check(`${theme} ${w}：七张日卡、今天一张`, (await page.locator('.dk-day').count()) === 7 && (await page.locator('.dk-day.today').count()) === 1);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.dk-board, .dk-month')].map((e) => e.scrollWidth - e.clientWidth)));
    check(`${theme} ${w}：无横向溢出`, overflow <= 0, String(overflow));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/week-${theme}-${w}.png` });
    await page.keyboard.press('m');
    await page.waitForSelector('.dk-mc');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/month-${theme}-${w}.png` });
    await page.keyboard.press('w');
    await ctx.close();
  }
}

// ── 交互（深色 1440） ──
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await seed(page, 'dark');
await page.goto(`${BASE}/desk`);
await page.waitForSelector('.dk-day.today');
const store = (fn) => page.evaluate(fn);
const dateOf = (title) => page.evaluate((t) => Object.values(window.__store.getState().workItems).find((i) => i.title === t)?.date ?? null, title);

// 1. 新建
await page.keyboard.press('n');
await page.keyboard.type('!! 联系 Informix 原厂 @王芳 下周二');
await page.waitForTimeout(100);
check('新建卡实时解析出跟进与日期', (await page.locator('.dk-qa-prev').innerText()).includes('跟进'));
await page.screenshot({ path: `${OUT}/quickadd-dark.png` });
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
check('回车后建成一条跟进', !!(await dateOf('联系 Informix 原厂')));

// 2. 拖动 → 浮出小月历 → 落到下周三
const title = '审 cpmi310 客制改动的代码';
const row = page.locator('.dk-day.today .dk-row', { hasText: title });
const b = await row.boundingBox();
await page.mouse.move(b.x + 60, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + 70, b.y + b.height / 2 + 8, { steps: 3 });
await page.waitForSelector('.dk-mover');
check('拖动时浮出小月历', (await page.locator('.dk-mover').count()) === 1);
const target = await store(() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow + 9); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
const cell = await page.locator(`[data-mv="${target}"]`).boundingBox();
await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, { steps: 10 });
await page.waitForTimeout(120);
check('小月历顶部提示落点', (await page.locator('[data-mv-tip]').innerText()).includes('下周三'));
await page.screenshot({ path: `${OUT}/drag-mover-dark.png` });
await page.mouse.up();
await page.waitForTimeout(150);
check('松手后小月历消失', (await page.locator('.dk-mover').count()) === 0);
check('落到下周三', (await dateOf(title)) === target, String(await dateOf(title)));
const deferred = await page.evaluate((t) => Object.values(window.__store.getState().workItems).find((i) => i.title === t).deferCount, title);
check('往后挪记一次 deferCount', deferred === 1);

// 3. 撤销
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
check('Ctrl+Z 撤回挪动', (await dateOf(title)) !== target);

// 4. 多选 + ⇧M
const r1 = page.locator('.dk-day.today .dk-row', { hasText: '汇总周会材料' });
const r2 = page.locator('.dk-day.today .dk-row', { hasText: '预约年度体检' });
await r1.click({ position: { x: 60, y: 12 } });
await r2.click({ position: { x: 60, y: 12 }, modifiers: ['Control'] });
check('Ctrl 多选出现选中条', (await page.locator('.dk-selbar').innerText()).includes('已选 2 件'));
await page.locator('.dk-selbar [data-mover-anchor]').click();
await page.waitForSelector('.dk-mover');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/select-mover-dark.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+M');
await page.waitForTimeout(150);
const nextMon = await store(() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow + 7); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
check('⇧M 把选中的挪到下周一', (await dateOf('汇总周会材料')) === nextMon && (await dateOf('预约年度体检')) === nextMon);

// 5. 人物卡
await page.locator('.dk-day.today .dk-who', { hasText: '张经理' }).first().click();
await page.waitForSelector('.dk-pop');
await page.waitForTimeout(120);
check('人物卡列出张经理的全部跟进', (await page.locator('.dk-pop .dk-row').count()) === 2);
check('周历高亮张经理、淡化其他', (await page.locator('.dk-board .dk-row.lit').count()) >= 1 && (await page.locator('.dk-board .dk-row.dim').count()) >= 1);
await page.screenshot({ path: `${OUT}/person-dark.png` });
await page.keyboard.press('Escape');
check('Esc 关人物卡并取消高亮', (await page.locator('.dk-pop').count()) === 0 && (await page.locator('.dk-board .dk-row.dim').count()) === 0);

// 6. 待处理抽屉 + 从抽屉拖进今天
await page.keyboard.press('i');
await page.waitForSelector('.dk-drawer');
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/drawer-dark.png` });
const pRow = page.locator('.dk-drawer .dk-row', { hasText: '研究 Informix' });
const pb = await pRow.boundingBox();
const tb = await page.locator('.dk-day.today').boundingBox();
await page.mouse.move(pb.x + 40, pb.y + pb.height / 2);
await page.mouse.down();
await page.mouse.move(pb.x + 30, pb.y + 20, { steps: 3 });
await page.mouse.move(tb.x + tb.width / 2, tb.y + 300, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(150);
const today = await store(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
check('从待处理拖进今天', (await dateOf('研究 Informix 统计信息自动更新')) === today);
await page.keyboard.press('i');

// 7. 日卡菜单 + 行右键
await page.locator('.dk-day.today').hover();
await page.locator('.dk-day.today .dk-dh-menu').click();
await page.waitForSelector('.dk-menu');
await page.screenshot({ path: `${OUT}/daymenu-dark.png` });
await page.keyboard.press('Escape');
await page.locator('.dk-day.today .dk-row', { hasText: '修复出货单' }).click({ button: 'right' });
await page.waitForSelector('.dk-menu');
await page.screenshot({ path: `${OUT}/rowmenu-dark.png` });
await page.locator('.dk-menu button', { hasText: '尽快' }).click();
const urg = await page.evaluate(() => Object.values(window.__store.getState().workItems).find((i) => i.title.startsWith('修复出货单')).urgency);
check('右键改紧急度', urg === 'soon');

// 8. 勾选完成（等打勾动画）
const doneRow = page.locator('.dk-day.today .dk-row', { hasText: '修复出货单' });
await doneRow.locator('.dk-chk').click();
await page.waitForTimeout(400);
const st = await page.evaluate(() => Object.values(window.__store.getState().workItems).find((i) => i.title.startsWith('修复出货单')).status);
check('勾选完成', st === 'done');

// 9. 年度计划行回写甘特打卡
const planRow = page.locator('.dk-day.today .dk-row.plan').first();
if ((await planRow.count()) > 0) {
  const before = await page.evaluate(() => Object.keys(window.__store.getState().checkIns).length);
  await planRow.locator('.dk-chk').click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => Object.keys(window.__store.getState().checkIns).length);
  check('年度计划勾选 = 甘特打卡', after === before + 1 || (await planRow.getAttribute('class')).includes('done'));
} else check('今天有年度计划行（示例数据）', false);

// 10. 手机：工作台不出现
const m = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
const mp = await m.newPage();
await mp.goto(`${BASE}/desk`);
await mp.waitForTimeout(800);
check('手机打开 /desk 回到打卡页', new URL(mp.url()).pathname === '/checkin');
// 顶栏导航在手机上是 CSS 隐藏（仍在 DOM 里），所以只看「看得见的」
check('手机上看不到工作台入口', !(await mp.locator('nav a', { hasText: '工作台' }).evaluateAll((els) => els.some((e) => e.offsetParent !== null))));
await m.close();

check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
