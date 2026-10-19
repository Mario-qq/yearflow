/**
 * 工作台 v3 自查（负责人 10-19 反馈一轮）：精简学习卡、新建卡点选 + 鼠标点击打开、工作/生活分区（非文字）、
 * 做完的就地显示、周末收成窄条 + 自动换行、年度计划放底并可选显示哪些、要事（Ivy Lee）、重要度、下班收尾。
 * 前置：vite dev（preview_start yearflow-dev）。跑法：node scripts/check-desk-v3.mjs [端口]
 *
 * 隔离：系统 Chrome + 每次新建的空 context，示例数据经 DEV 句柄注入；时钟固定在某个周四（page.clock.setFixedTime），
 * 这样本周前几天是「过去」、能看到做完的清单。截图到 docs/screenshots/desk/v3-*.png。
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

const THU = '2026-10-22';
const at = (hm) => new Date(`${THU}T${hm}:00`);

async function seed(page, theme) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    s.updateSettings({ theme, desk: { ...s.settings.desk, studyGoalIds: [] } });
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const t0 = fmt(today);
    const dow = (today.getDay() + 6) % 7;
    const D = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - dow + n);
      return fmt(d);
    };
    const stamp = new Date().toISOString();
    let seq = 0;
    const it = (o) => ({ id: `w${seq++}`, kind: 'todo', urgency: 'normal', scope: 'work', status: 'open', order: seq, createdAt: `${o.date ?? t0}T08:00:00.000Z`, updatedAt: stamp, ...o });
    const done = { status: 'done', doneAt: stamp };
    const items = [
      it({ title: '整理 MRP 跑批慢的 sqexplain 结论', date: D(0), ...done }),
      it({ title: '回复采购 apmt540 报错原因', date: D(0), ...done }),
      it({ title: '核对 9 月月结差异', date: D(0), ...done }),
      it({ title: '给 PM 发 ARM 范围确认邮件', date: D(0), ...done }),
      it({ title: '整理 TIPTOP 常见报错', date: D(0), ...done }),
      it({ title: '更新 ARM 退货配置检查表', date: D(0), urgency: 'soon', deferCount: 3 }),
      it({ kind: 'followup', title: 'MRP 跑批优化进度：已降到 40 分钟', person: '张经理', mode: 'inform', date: D(1), ...done }),
      it({ title: '确认 cmrp810 索引方案', date: D(1), ...done }),
      it({ title: '写出货异常需求文档初稿', date: D(1), ...done, important: true }),
      it({ title: '取快递', date: D(1), ...done, scope: 'life' }),
      it({ title: 'SAP 迁移会议纪要发群', date: D(2), ...done }),
      it({ title: '测试新报表 cxmr 的输出格式', date: D(2) }),
      it({ title: '修复出货单过帐失败（客户急单）', date: t0, urgency: 'urgent', dueDate: t0, important: true, focusOn: t0 }),
      it({ title: '汇总周会材料', date: t0, urgency: 'soon', dueDate: t0, focusOn: t0 }),
      it({ title: '审 cpmi310 客制改动的代码，重点看单身维护的锁表逻辑和 cl_err 的处理是否一致', date: t0, important: true }),
      it({ kind: 'followup', title: '下周六晚停机窗口', person: '张经理', mode: 'inform', date: t0 }),
      it({ kind: 'followup', title: 'cmrp810 索引脚本', person: '李工', mode: 'dispatch', date: t0, urgency: 'urgent' }),
      it({ title: '回复 IT 部门的权限申请', date: t0, ...done }),
      it({ title: '预约年度体检', date: t0, scope: 'life' }),
      it({ title: '给妈妈打电话', date: t0, scope: 'life', ...done }),
      it({ title: '给车做保养', date: D(5), scope: 'life' }),
      it({ title: '准备 SAP MM 练习数据', date: D(4) }),
      it({ title: 'ARM 跨公司退货联调', date: D(7), urgency: 'soon' }),
      it({ title: '研究 Informix 统计信息自动更新' }),
    ];
    const r = (id, title, rule, o = {}) => ({ id, title, scope: 'work', rule, startDate: D(-30), order: seq++, createdAt: stamp, updatedAt: stamp, ...o });
    const routines = [
      r('r1', '检查 MRP 夜间批次结果', { type: 'workday' }, { time: '09:00' }),
      r('r3', '系统巡检', { type: 'weekly', daysOfWeek: [3] }),
      r('r5', '打篮球', { type: 'weekly', daysOfWeek: [6] }, { scope: 'life' }),
      r('r7', '健身 30 分钟', { type: 'daily' }, { scope: 'life', time: '20:00' }),
    ];
    const logs = [0, 1, 2].map((n) => ({ id: `r1:${D(n)}`, routineId: 'r1', date: D(n), status: 'done', doneAt: stamp, doneOn: D(n), createdAt: stamp, updatedAt: stamp }));
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    await s.replaceAllData({ ...buildSeedBundle(t0), workItems: items, routines, routineLogs: logs, dayMarks: [] });
  }, theme);
  await page.waitForTimeout(800); // 设置 500ms 防抖落库
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const open = async (theme, w, h, hm = '15:00') => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(at(hm));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seed(page, theme);
  await page.goto(`${BASE}/desk`);
  await page.waitForSelector('.dk-day.today');
  await page.waitForTimeout(250);
  return { ctx, page };
};
const item = (page, title) => page.evaluate((t) => Object.values(window.__store.getState().workItems).find((i) => i.title.startsWith(t)), title);

// ── 版式：深浅 × 两档宽 ──
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    const { ctx, page } = await open(theme, w, h);
    const tag = `${theme} ${w}`;
    check(`${tag}：周末默认收成两根窄条`, (await page.locator('.dk-day.rail').count()) === 2);
    const widths = await page.$$eval('.dk-board > .dk-day', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    check(`${tag}：今天最宽、工作日比原来宽`, widths[3] === Math.max(...widths) && widths[0] > (w - 40) / 8, widths.join(','));
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.dk-board')].map((e) => e.scrollWidth - e.clientWidth)));
    check(`${tag}：无横向溢出`, overflow <= 0, String(overflow));
    check(`${tag}：行上不再写「生活」两个字`, !(await page.$$eval('.dk-m', (els) => els.some((e) => /生活/.test(e.textContent ?? '')))));
    const lifeBg = await page.$eval('.dk-day.today .dk-zone.life', (e) => getComputedStyle(e).backgroundColor);
    check(`${tag}：今天的生活区有底色`, lifeBg !== 'rgba(0, 0, 0, 0)', lifeBg);
    const order = await page.$eval('.dk-day.today .dk-db', (db) => [...db.children].map((c) => c.className.split(' ')[0]));
    const iw = order.indexOf('dk-zone');
    check(`${tag}：今天卡自上而下 要事 → 工作 → 生活 → 年度计划`, order[0] === 'dk-focus' && iw > 0 && order.lastIndexOf('dk-plan') === order.length - 1, order.join(' > '));
    const mon = page.locator('.dk-board > .dk-day').first();
    check(`${tag}：过去的日子做完的全显示（周一 5 件 + 例行）`, (await mon.locator('.dk-row.done').count()) === 6);
    const deco = await page.$eval('.dk-board > .dk-day .dk-row.done .dk-t', (e) => getComputedStyle(e).textDecorationLine);
    check(`${tag}：做完的不划线`, deco === 'none', deco);
    const longRow = page.locator('.dk-day.today .dk-row', { hasText: '审 cpmi310' });
    const lr = await longRow.evaluate((e) => ({ h: e.getBoundingClientRect().height, t: e.querySelector('.dk-t').scrollWidth - e.querySelector('.dk-t').clientWidth }));
    check(`${tag}：长标题自动换行、不截断`, lr.h > 32 && lr.t <= 0, JSON.stringify(lr));
    await page.screenshot({ path: `${OUT}/v3-week-${theme}-${w}.png` });
    await ctx.close();
  }
}

// ── 交互（深色 1440）──
{
  const { ctx, page } = await open('dark', 1440, 900);

  // 学习卡：设置学习目标后是两行小卡
  await page.evaluate(() => {
    const s = window.__store.getState();
    const g = Object.values(s.goals).find((x) => !x.archived);
    s.updateSettings({ desk: { ...s.settings.desk, studyGoalIds: [g.id], anchor: { text: '午饭后', time: '12:30' } } });
  });
  await page.waitForTimeout(200);
  const study = page.locator('.dk-day.today .dk-study');
  if ((await study.count()) > 0) {
    const h = await study.evaluate((e) => e.getBoundingClientRect().height);
    check('学习卡精简：高度 ≤ 64px（原约 128px）', h <= 64, String(Math.round(h)));
    await page.screenshot({ path: `${OUT}/v3-study-dark.png`, clip: await page.locator('.dk-day.today').boundingBox() });
  } else check('学习卡出现（示例目标今天要打卡）', (await page.locator('.dk-day.today .dk-st-line').count()) > 0, '今天没排 → 一行');

  // 鼠标点「新建」能打开（原 bug：点了没反应）
  await page.locator('.dk-fab').click();
  check('鼠标点「新建」打开新建卡', await page.locator('.dk-qa').isVisible());
  await page.keyboard.type('复查牙齿');
  await page.locator('.dk-qa .dk-seg.scope button', { hasText: '生活' }).click();
  await page.locator('.dk-qa .dk-seg button', { hasText: '紧急' }).click();
  await page.locator('.dk-qa .dk-tog.imp').click();
  await page.locator('.dk-qa .dk-tog.fo').click();
  check('点选后输入框仍有焦点', await page.locator('.dk-qa-in').evaluate((e) => e === document.activeElement));
  await page.screenshot({ path: `${OUT}/v3-quickadd-dark.png` });
  await page.keyboard.press('Enter');
  const qa = await item(page, '复查牙齿');
  check('新建按点选落库：生活 · 紧急 · 重要 · 今天要事', qa?.scope === 'life' && qa?.urgency === 'urgent' && qa?.important === true && qa?.focusOn === THU, JSON.stringify(qa && { s: qa.scope, u: qa.urgency, i: qa.important, f: qa.focusOn }));
  check('要事满 3 件后「要事」按钮变灰', await page.locator('.dk-qa .dk-tog.fo').isDisabled());
  await page.keyboard.type('周六 洗车 ~生活');
  const chipsDate = await page.locator('.dk-qa .dk-qa-date').innerText();
  check('一句话里写的日子显示在日期框', chipsDate.includes('周六'), chipsDate);
  await page.keyboard.press('Escape');
  check('Esc 收起新建卡', !(await page.locator('.dk-qa').count()));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z 撤回新建', !(await item(page, '复查牙齿')));

  // 日卡「＋」：在那天新建，周末预填生活
  await page.locator('.dk-board > .dk-day').nth(4).hover();
  await page.locator('.dk-board > .dk-day').nth(4).locator('[aria-label="在这天新建"]').click();
  check('日卡＋预填那天（周五 = 明天）', (await page.locator('.dk-qa-in').getAttribute('placeholder')).includes('明天'));
  await page.keyboard.press('Escape');

  // 头部 @人 点开人物卡（同一类 bug）
  await page.locator('.dk-h-say button', { hasText: '张经理' }).click();
  check('头部点 @人 打开人物卡', await page.locator('.dk-pop', { hasText: '张经理' }).isVisible());
  await page.keyboard.press('Escape');

  // 周末：展开 / 收起 / 记住
  await page.locator('.dk-wk').click();
  check('点「展开周末」⇒ 七张完整日卡', (await page.locator('.dk-day.rail').count()) === 0);
  await page.reload();
  await page.waitForSelector('.dk-day.today');
  check('展开状态刷新后保持', (await page.locator('.dk-day.rail').count()) === 0);
  await page.locator('.dk-wk').click();
  check('再点收起', (await page.locator('.dk-day.rail').count()) === 2);
  await page.locator('.dk-day.rail').first().click();
  check('点窄条也能展开', (await page.locator('.dk-day.rail').count()) === 0);
  await page.locator('.dk-wk').click();

  // 拖进生活区 = 改范围
  const src = page.locator('.dk-day.today .dk-zone.work .dk-row', { hasText: '下周六晚停机窗口' });
  const sb = await src.boundingBox();
  const lz = await page.locator('.dk-day.today .dk-zone.life').boundingBox();
  await page.mouse.move(sb.x + 40, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 50, sb.y + 20, { steps: 3 });
  await page.mouse.move(lz.x + 40, lz.y + lz.height / 2, { steps: 8 });
  check('拖到生活区：区高亮、提示带「生活」', (await page.locator('.dk-zone.life.drop').count()) === 1 && (await page.locator('[data-mv-tip]').innerText()).includes('生活'));
  await page.screenshot({ path: `${OUT}/v3-drag-life-dark.png` });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const moved = await item(page, '下周六晚停机窗口');
  check('松手 ⇒ 改成生活、日子不变', moved.scope === 'life' && moved.date === THU);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z 撤回改范围', (await item(page, '下周六晚停机窗口')).scope === 'work');

  // 重要 / 要事 快捷键
  await page.locator('.dk-day.today .dk-row', { hasText: '下周六晚停机窗口' }).click();
  await page.keyboard.press('*');
  await page.waitForTimeout(80);
  check('选中按 * ⇒ 标为重要', (await item(page, '下周六晚停机窗口')).important === true);
  await page.keyboard.press('f'); // 仍是选中状态
  await page.waitForTimeout(80);
  check('选中按 F ⇒ 今天的要事', (await item(page, '下周六晚停机窗口')).focusOn === THU);
  check('要事出现在今天卡顶部', (await page.locator('.dk-day.today .dk-focus .dk-row', { hasText: '下周六晚停机窗口' }).count()) === 1);
  await page.locator('.dk-day.today .dk-focus .dk-row', { hasText: '下周六晚停机窗口' }).click({ button: 'right' });
  await page.locator('.dk-menu button', { hasText: '移出要事' }).click();
  check('右键「移出要事」', !(await item(page, '下周六晚停机窗口')).focusOn);

  // 挑要事浮层
  await page.locator('.dk-day.today .dk-focus-pick').click();
  check('「再挑」打开挑要事浮层', await page.locator('.dk-fp').isVisible());
  await page.screenshot({ path: `${OUT}/v3-focus-picker-dark.png` });
  await page.locator('.dk-fp .dk-fl-row', { hasText: 'cmrp810 索引脚本' }).click();
  check('浮层里点 ☆ 设为要事', (await item(page, 'cmrp810 索引脚本')).focusOn === THU);
  check('满 3 件后其余变灰', (await page.locator('.dk-fp .dk-fl-row:disabled').count()) > 0);
  await page.locator('.dk-fp .dk-fl-row', { hasText: 'cmrp810 索引脚本' }).click();
  await page.keyboard.press('Escape');

  // 年度计划：在卡底、可选显示哪些
  const planRows = () => page.locator('.dk-day.today .dk-plan .dk-row.plan').count();
  const n0 = await planRows();
  check('今天有年度计划行（示例数据）', n0 > 0, String(n0));
  await page.locator('.dk-day.today .dk-plan').hover();
  await page.locator('.dk-day.today .dk-sec-act').click();
  check('「选择显示」打开浮层', await page.locator('.dk-pp').isVisible());
  await page.screenshot({ path: `${OUT}/v3-plan-picker-dark.png` });
  await page.locator('.dk-pp .dk-pp-row.task input').first().click();
  await page.waitForTimeout(80);
  check('勾掉一个任务 ⇒ 少一行，标「已隐藏 1」', (await planRows()) === n0 - 1 && (await page.locator('.dk-day.today .dk-sec-act').innerText()).includes('已隐藏 1'));
  await page.locator('.dk-pp button', { hasText: '全部显示' }).click();
  await page.keyboard.press('Escape');
  check('全部显示 ⇒ 恢复', (await planRows()) === n0);
  await page.locator('.dk-day.today .dk-plan .dk-row.plan').first().click({ button: 'right' });
  await page.locator('.dk-menu button', { hasText: '不在工作台显示' }).click();
  await page.waitForTimeout(80);
  check('行右键「不在工作台显示」', (await planRows()) === n0 - 1);
  await page.getByRole('button', { name: '撤销' }).last().click(); // 最新那条 toast
  await page.waitForTimeout(80);
  check('toast 撤销还原显示', (await planRows()) === n0);

  await ctx.close();
}

// ── 下班收尾（18:00）──
{
  const { ctx, page } = await open('dark', 1440, 900, '18:00');
  check('到点头部提示「该收尾了」', await page.locator('.dk-h-say .sd').isVisible());
  await page.locator('.dk-h-say .sd button').click();
  check('点开收尾面板', await page.locator('.dk-sd').isVisible());
  await page.waitForTimeout(350); // 等淡入动画播完再截
  await page.screenshot({ path: `${OUT}/v3-shutdown-dark.png` });
  const leftN = await page.locator('.dk-sd-row').count();
  await page.locator('.dk-sd-row', { hasText: '更新 ARM 退货配置检查表' }).locator('button', { hasText: '不做了' }).click();
  await page.waitForTimeout(80);
  check('逐条：不做了', (await item(page, '更新 ARM')).status === 'dropped' && (await page.locator('.dk-sd-row').count()) === leftN - 1);
  await page.locator('.dk-sd .dk-sd-k button', { hasText: '全部挪到' }).click();
  await page.waitForTimeout(80);
  check('全部挪到明天（周五）', (await page.locator('.dk-sd-row').count()) === 0 && (await item(page, '审 cpmi310')).date === '2026-10-23');
  await page.locator('.dk-sd .dk-fl-row', { hasText: '审 cpmi310' }).click();
  check('第 3 步挑明天要事', (await item(page, '审 cpmi310')).focusOn === '2026-10-23');
  await page.screenshot({ path: `${OUT}/v3-shutdown-done-dark.png` });
  await page.locator('.dk-sd button', { hasText: '收工' }).click();
  check('收工 ⇒ 头部「今天已收工」、不再提醒', (await page.locator('.dk-h-say', { hasText: '今天已收工' }).count()) === 1 && !(await page.locator('.dk-h-say .sd').count()));
  check('明天那张卡顶部显示要事', (await page.locator('.dk-day[data-day="2026-10-23"] .dk-focus .dk-row', { hasText: '审 cpmi310' }).count()) === 1);
  await ctx.close();
}

// 浅色收尾 + 新建各一张
{
  const { ctx, page } = await open('light', 1440, 900, '18:00');
  await page.locator('.dk-h-say .sd button').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/v3-shutdown-light.png` });
  await page.keyboard.press('Escape');
  await page.locator('.dk-fab').click();
  await page.keyboard.type('周六 带娃去公园');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/v3-quickadd-light.png` });
  await ctx.close();
}

check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
