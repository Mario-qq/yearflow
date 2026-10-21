/**
 * 全站视觉巡检截图（UI 美化前后对照）。前置：vite dev 在 5173。
 * 跑法：node scripts/capture-ui-audit.mjs <输出目录> [端口]
 * 隔离：系统 Chrome + 全新 context，示例数据经 DEV 句柄 __store 注入，不碰真实数据。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots/ui-audit';
const PORT = process.argv[3] ?? '5173';
const BASE = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

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

const ROUTES = (process.env.ROUTES ?? 'desk,gantt,checkin,review,year,settings').split(',');
const browser = await chromium.launch({ channel: 'chrome' });
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await seed(page, theme);
  for (const r of ROUTES) {
    await page.goto(`${BASE}/${r}`);
    await page.waitForFunction(() => window.__store?.getState().hydrated);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${r}-${theme}.png` });
  }
  // 甘特四档缩放（CLAUDE.md 自查门槛）
  if (!process.env.ROUTES) {
    await page.goto(`${BASE}/gantt`);
    await page.waitForTimeout(1000);
    for (const [k, z] of [['年', 'year'], ['季', 'quarter'], ['月', 'month'], ['周', 'week']]) {
      await page.getByRole('radio', { name: k, exact: true }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/gantt-${z}-${theme}.png` });
    }
  }
  // 浮层：命令面板
  await page.goto(`${BASE}/gantt`);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/palette-${theme}.png` });
  await ctx.close();
}
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
const mp = await m.newPage();
await seed(mp, 'dark');
await mp.goto(`${BASE}/checkin`);
await mp.waitForTimeout(1200);
await mp.screenshot({ path: `${OUT}/m-checkin-dark.png` });
await browser.close();
console.log('done');
