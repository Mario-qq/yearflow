/**
 * 工作台 W2（学习防忘）+ 工作台完善（编辑卡、例行管理、不做了可找回、例行带时间）截图 + 交互自查。
 * 前置：vite dev 在 5173（preview_start yearflow-dev）。跑法：node scripts/capture-desk-study.mjs [端口]
 *
 * 隔离：系统 Chrome + 每次新建的空 context（IndexedDB 全新），示例数据经 DEV 句柄 __store 注入，
 * 绝不碰真实数据。截图到 docs/screenshots/desk/。
 * 自动打卡那一项要真跑完一段 1 分钟的番茄钟（约 65 秒）。
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

const STUDY = ['seed-goal-sap', 'seed-goal-english', 'seed-goal-agent'];

/** 甘特示例 + 像负责人这一周的工作台数据 + 学习设置（学习目标 = SAP/英语/AI，午饭后 12:30，最晚 21:00） */
async function seed(page, theme, { study = true } = {}) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(
    async ({ theme, study, STUDY }) => {
      const s = window.__store.getState();
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
      const items = [
        it({ title: '整理 MRP 跑批慢的 sqexplain 结论', date: D(0), status: 'done' }),
        it({ title: '确认 cmrp810 索引方案', date: D(1), status: 'done' }),
        it({ title: '修复出货单过帐失败（客户急单）', date: t0, urgency: 'urgent', dueDate: t0 }),
        it({ title: '汇总周会材料', date: t0, urgency: 'soon' }),
        it({ title: '审 cpmi310 客制改动的代码', date: t0 }),
        it({ kind: 'followup', title: '下周六晚停机窗口', person: '张经理', mode: 'inform', date: t0 }),
        it({ title: 'ARM 跨公司退货联调', date: D(7), urgency: 'soon' }),
        it({ title: '研究 Informix 统计信息自动更新' }),
      ];
      const r = (id, title, rule, o = {}) => ({ id, title, scope: 'work', rule, startDate: D(-30), order: seq++, createdAt: stamp, updatedAt: stamp, ...o });
      const routines = [r('r1', '检查 MRP 夜间批次结果', { type: 'workday' }, { time: '09:00' }), r('r2', '提交上周周报', { type: 'weekly', daysOfWeek: [1] }, { time: '10:00' })];
      const { buildSeedBundle } = await import('/src/seed/seedData.ts');
      const bundle = buildSeedBundle(t0);
      await s.replaceAllData({ ...bundle, workItems: items, routines, routineLogs: [], dayMarks: [] });
      s.updateSettings({
        theme,
        desk: { ...s.settings.desk, ...(study ? { studyGoalIds: STUDY, anchor: { text: '午饭后在工位', time: '12:30' }, lastCall: '21:00' } : {}) },
      });
    },
    { theme, study, STUDY },
  );
  await page.waitForTimeout(800); // 设置 500ms 防抖落库
}

const todayOf = (page) => page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
const checkInsOn = (page, date) => page.evaluate((d) => Object.values(window.__store.getState().checkIns).filter((c) => !c.deletedAt && c.date === d).map((c) => ({ goalId: c.goalId, taskId: c.taskId, status: c.status })), date);

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};

// ── 深浅 × 两档宽度：学习卡在今天的卡顶 ──
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    watch(page);
    await seed(page, theme);
    await page.goto(`${BASE}/desk`);
    await page.waitForSelector('.dk-day.today');
    // v4 起：学习卡在头部，统计卡左边，且和统计卡同高
    check(`${theme} ${w}：学习卡在头部（不在日卡里）`, (await page.locator('.dk-h-study .dk-study').count()) === 1 && (await page.locator('.dk-day .dk-study').count()) === 0);
    const [sb, tb] = await Promise.all([page.locator('.dk-h-study > *').boundingBox(), page.locator('.dk-stats').boundingBox()]);
    check(`${theme} ${w}：学习卡在统计卡左边、同高`, sb.x + sb.width <= tb.x && Math.abs(sb.height - tb.height) < 1, `${Math.round(sb.height)} vs ${Math.round(tb.height)}`);
    check(`${theme} ${w}：头部有学习点阵`, (await page.locator('.dk-stat .dk-dots').count()) === 1);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.dk-board, .dk-st-acts, .dk-st-top')].map((e) => e.scrollWidth - e.clientWidth)));
    check(`${theme} ${w}：无横向溢出（含学习卡按钮行）`, overflow <= 0, String(overflow));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/study-${theme}-${w}.png` });
    await ctx.close();
  }
}

// ── 交互（深色 1440） ──
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
watch(page);
await seed(page, 'dark');
await page.goto(`${BASE}/desk`);
await page.waitForSelector('.dk-study');
const today = await todayOf(page);

// 1. 推荐 + 换一个；推荐的那个不在年度计划里重复
const what1 = await page.locator('.dk-st-what').innerText();
const planTexts = await page.locator('.dk-day.today .dk-row.plan').allInnerTexts();
check('推荐的学习任务不在年度计划里重复出现', !planTexts.some((t) => t.includes(what1.split(' · ')[1])), what1);
check('头部学习卡显示要学的（脉搏里不再重复）', (await page.locator('.dk-h-study .dk-st-what').count()) === 1 && !(await page.locator('.dk-h-say').innerText()).includes('还没学'));
await page.locator('.dk-study button', { hasText: '换一个' }).click();
const what2 = await page.locator('.dk-st-what').innerText();
check('换一个 → 换成别的学习任务', what2 !== what1, `${what1} → ${what2}`);

// 2. S 开始 → 计时卡
await page.keyboard.press('s');
await page.waitForSelector('.dk-study.running');
await page.waitForTimeout(1200);
const timer = await page.locator('.dk-st-timer').innerText();
check('S 开始学习：倒计时 29:xx', /^29:\d\d$/.test(timer), timer);
const planned = await page.evaluate(() => window.__pomodoro.store.getState().running?.plannedMs);
check('番茄钟时长 = 每次学习 30 分钟', planned === 30 * 60_000, String(planned));
await page.screenshot({ path: `${OUT}/study-running-dark.png` });

// 3. 结束并打卡 → 收成一行，甘特打卡「完成」
await page.locator('.dk-study.running .dk-btn', { hasText: '结束并打卡' }).click();
await page.waitForSelector('.dk-st-line.done');
const ci = await checkInsOn(page, today);
check('结束并打卡 = 学习任务打卡完成', ci.some((c) => STUDY.includes(c.goalId) && c.status === 'done'), JSON.stringify(ci));
check('头部学习卡改成学过了', (await page.locator('.dk-h-study').innerText()).includes('今天学过了'));
await page.screenshot({ path: `${OUT}/study-done-dark.png` });
await page.keyboard.press('Control+z');
await page.waitForSelector('.dk-study:not(.running)');
check('Ctrl+Z 撤回打卡 → 学习卡回到没学', (await page.locator('.dk-st-line.done').count()) === 0);

// 4. 学习设置浮层
await page.locator('.dk-st-gear').click();
await page.waitForSelector('.dk-su-pop');
await page.waitForTimeout(150);
check('⚙ 弹出学习设置，学习目标打勾', (await page.locator('.dk-su-pop .dk-su-goal.on').count()) === 3);
await page.locator('.dk-su-pop .dk-su-more').click();
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}/study-setup-dark.png` });
const popBox = await page.locator('.dk-su-pop').boundingBox();
check('学习设置浮层在屏内', popBox.y >= 0 && popBox.y + popBox.height <= 900 + 1, JSON.stringify(popBox));
await page.keyboard.press('Escape');
check('Esc 收起学习设置', (await page.locator('.dk-su-pop').count()) === 0);

// 5. 专注跑到点 → 自动打卡（1 分钟 < 30 分钟 ⇒「做了一点」）
const pick = await page.evaluate(async () => {
  const { studyNow } = await import('/src/desk/study.ts');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const v = studyNow(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  return v.pick && { goalId: v.pick.goalId, taskId: v.pick.taskId };
});
await page.evaluate((p) => window.__pomodoro.start({ ...p, plannedMs: 60_000 }), pick);
console.log('…等一段 1 分钟的学习番茄钟跑到点（约 65 秒）');
await page.waitForFunction(
  ({ p, d }) => Object.values(window.__store.getState().checkIns).some((c) => !c.deletedAt && c.date === d && c.taskId === p.taskId),
  { p: pick, d: today },
  { timeout: 90_000 },
);
const auto = (await checkInsOn(page, today)).find((c) => c.taskId === pick.taskId);
check('学习专注跑到点自动打卡（不够 30 分钟 ⇒ 做了一点）', auto?.status === 'partial', JSON.stringify(auto));
await page.waitForTimeout(300);
check('自动打卡后学习卡收成「学过了」', (await page.locator('.dk-st-line.done').count()) === 1);
// 在头部这一行撑满卡高；看的是里面的字不折行
const lineH = (await page.locator('.dk-st-line.done .dk-st-txt').boundingBox()).height;
check('「学过了」这一行不折行（一行高）', lineH <= 22, String(lineH));
// 关掉自动进入的休息
await page.evaluate(() => window.__pomodoro.forceSettle());

// 6. 编辑事项：改标题 + 改成跟进 → 一条撤销
await page.locator('.dk-day.today .dk-row', { hasText: '审 cpmi310' }).click({ button: 'right' });
await page.locator('.dk-menu button', { hasText: '编辑…' }).click();
await page.waitForSelector('.dk-ed');
await page.locator('.dk-ed-title').fill('审 cpmi310 客制改动（第二版）');
await page.locator('.dk-ed .dk-seg button', { hasText: '跟进' }).click();
await page.locator('.dk-ed input[aria-label="跟进对象"]').fill('李工');
await page.locator('.dk-ed textarea').fill('重点看 MRP 展开那段');
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}/editor-item-dark.png` });
await page.locator('.dk-ed .dk-btn.primary').click();
const edited = await page.evaluate(() => Object.values(window.__store.getState().workItems).find((i) => i.id === 'w4'));
check('编辑卡保存：标题、跟进对象、备注一次改好', edited.title === '审 cpmi310 客制改动（第二版）' && edited.kind === 'followup' && edited.person === '李工' && edited.note === '重点看 MRP 展开那段', JSON.stringify(edited));
await page.keyboard.press('Control+z');
const undone = await page.evaluate(() => window.__store.getState().workItems.w4);
check('一次 Ctrl+Z 整体撤回编辑', undone.title === '审 cpmi310 客制改动的代码' && undone.kind === 'todo' && !undone.note);
// 选中 + Enter 打开编辑卡；Esc 放弃
await page.locator('.dk-day.today .dk-row', { hasText: '汇总周会材料' }).click({ position: { x: 80, y: 12 } });
await page.keyboard.press('Enter');
check('选中一件按 Enter 打开编辑卡', (await page.locator('.dk-ed').count()) === 1);
await page.locator('.dk-ed-title').fill('改了不保存');
await page.keyboard.press('Escape');
check('Esc 放弃编辑', (await page.locator('.dk-ed').count()) === 0 && (await page.evaluate(() => window.__store.getState().workItems.w3.title)) === '汇总周会材料');

// 7. 不做了 → 折叠里能找回
await page.locator('.dk-day.today .dk-row', { hasText: '汇总周会材料' }).click({ button: 'right' });
await page.locator('.dk-menu button', { hasText: '不做了' }).click();
const fold = page.locator('.dk-day.today .dk-fold', { hasText: '不做了' });
check('不做了 → 折叠里有「不做了 1」', (await fold.count()) === 1);
await fold.click();
const dropRow = page.locator('.dk-day.today .dk-row.skipped', { hasText: '汇总周会材料' });
check('展开能看到不做了的那件', (await dropRow.count()) === 1);
await dropRow.locator('.dk-chk').click();
check('再勾一次恢复为未完成', (await page.evaluate(() => window.__store.getState().workItems.w3.status)) === 'open');

// 8. 例行管理：新建（每周三 9:30）→ 暂停 → 恢复
await page.keyboard.press('i');
await page.waitForSelector('.dk-drawer');
await page.locator('.dk-drawer [role=tab]', { hasText: '例行' }).click();
await page.locator('.dk-drawer .dk-btn', { hasText: '新例行' }).click();
await page.waitForSelector('.dk-ed');
await page.locator('.dk-ed-title').fill('系统巡检');
await page.locator('.dk-ed .dk-seg button', { hasText: '每周' }).click();
for (const b of await page.locator('.dk-ed-days button.on').all()) await b.click();
await page.locator('.dk-ed-days button', { hasText: '三' }).click();
await page.locator('.dk-ed input[aria-label="时间点"]').fill('09:30');
await page.waitForTimeout(100);
await page.screenshot({ path: `${OUT}/editor-routine-dark.png` });
await page.locator('.dk-ed .dk-btn.primary').click();
const made = await page.evaluate(() => Object.values(window.__store.getState().routines).find((r) => r.title === '系统巡检'));
check('新建例行：每周三 9:30', made?.rule.type === 'weekly' && made.rule.daysOfWeek.join() === '3' && made.time === '09:30', JSON.stringify(made));
const rl = page.locator('.dk-rl', { hasText: '系统巡检' });
await rl.hover();
await rl.locator('.dk-rl-b', { hasText: '暂停' }).click();
check('例行列表里暂停', (await page.evaluate((id) => window.__store.getState().routines[id].paused, made.id)) === true);
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/drawer-routines-dark.png` });
await rl.locator('.dk-rl-b', { hasText: '恢复' }).click();
check('暂停的例行能在列表里恢复', !(await page.evaluate((id) => 'paused' in window.__store.getState().routines[id], made.id)));
await page.keyboard.press('Escape');
await page.keyboard.press('i');

// 9. 例行右键「编辑这个例行…」改时间
await page.locator('.dk-day.today .dk-row.routine', { hasText: '检查 MRP' }).click({ button: 'right' });
await page.locator('.dk-menu button', { hasText: '编辑这个例行' }).click();
await page.waitForSelector('.dk-ed');
await page.locator('.dk-ed input[aria-label="时间点"]').fill('08:45');
await page.locator('.dk-ed .dk-btn.primary').click();
check('右键编辑例行改时间', (await page.evaluate(() => window.__store.getState().routines.r1.time)) === '08:45');

// 10. 新建一句话带时间
await page.keyboard.press('n');
await page.keyboard.type('每周五 17:30 备份测试区数据库');
await page.waitForTimeout(100);
check('新建预览出时间标签', (await page.locator('.dk-qa-prev').innerText()).includes('17:30'));
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
check('一句话建例行带时间', (await page.evaluate(() => Object.values(window.__store.getState().routines).find((r) => r.title === '备份测试区数据库')?.time)) === '17:30');

// 11. 设置页「学习提醒」
await page.goto(`${BASE}/settings`);
await page.waitForSelector('.dk-setup');
check('设置页有学习提醒一节', (await page.locator('h2', { hasText: '学习提醒' }).count()) === 1);
await page.locator('.dk-setup').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/settings-study-dark.png` });
await ctx.close();

// ── 没设学习目标：一行安静的引导 ──
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  watch(p);
  await seed(p, 'light', { study: false });
  await p.goto(`${BASE}/desk`);
  await p.waitForSelector('.dk-day.today');
  check('没设学习目标：头部一行引导', (await p.locator('.dk-st-line.setup').count()) === 1);
  await c.close();
}

// ── 到点提醒（假桌面壳：只记下 notify / 托盘提示，不弹真通知） ──
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript(() => {
    const calls = (window.__desk = { notices: [], tray: [] });
    const nop = () => Promise.resolve();
    const off = () => () => {};
    window.yearflowDesktop = {
      openPip: () => Promise.resolve(true),
      closePip: () => Promise.resolve(true),
      closeSelf: nop,
      setPipOpacity: (p) => Promise.resolve(p),
      dockPip: nop,
      undockPip: nop,
      peekPip: nop,
      focusMain: nop,
      notify: (body, opts) => (calls.notices.push({ body, ...opts }), Promise.resolve(true)),
      getShellPrefs: () => Promise.resolve({ closeToTray: true, openAtLogin: false, canAutoStart: true }),
      setShellPref: () => Promise.resolve({ closeToTray: true, openAtLogin: false, canAutoStart: true }),
      onShellPrefs: off,
      setTrayStatus: (t) => (calls.tray.push(t), Promise.resolve()),
      onNavigate: off,
      onTrayStudy: off,
      backupWrite: () => Promise.resolve('x.json'),
      backupList: () => Promise.resolve([]),
      backupRead: () => Promise.resolve('{}'),
      backupOpenDir: () => Promise.resolve(''),
      backupMirror: () => Promise.resolve({ dir: null, at: null, error: null }),
      backupMirrorChoose: () => Promise.resolve({ dir: null, at: null, error: null }),
      backupMirrorClear: () => Promise.resolve({ dir: null, at: null, error: null }),
      backupMirrorOpen: () => Promise.resolve(''),
      onPowerResume: off,
      onPipState: off,
      onPipMode: off,
      onPipHover: off,
    };
  });
  const p = await c.newPage();
  watch(p);
  await seed(p, 'dark');
  await p.goto(`${BASE}/desk`);
  await p.waitForSelector('.dk-study');
  const r = await p.evaluate(async () => {
    const { tickStudyNudge } = await import('/src/desk/studyNudge.ts');
    localStorage.removeItem(Object.keys(localStorage).find((k) => k.startsWith('yearflow:desk:nudge:')) ?? '_');
    const d = new Date();
    const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    return {
      before: tickStudyNudge(at(12, 29)),
      anchor: tickStudyNudge(at(12, 31)),
      again: tickStudyNudge(at(13, 0)),
      last: tickStudyNudge(at(21, 5)),
      lastAgain: tickStudyNudge(at(21, 30)),
      notices: window.__desk.notices,
      tray: window.__desk.tray,
    };
  });
  check('12:29 不提醒，12:31 第一次提醒', r.before === null && r.anchor === 'anchor', JSON.stringify(r).slice(0, 200));
  check('同一次不重复提醒；21:05 最晚提醒一次', r.again === null && r.last === 'lastCall' && r.lastAgain === null);
  check('通知文案：到点学习了 / 15 分钟也算，点了跳工作台', r.notices[0]?.title === '到点学习了' && r.notices[1]?.body.includes('15 分钟也算') && r.notices.every((n) => n.route === '/desk'), JSON.stringify(r.notices));
  check('托盘提示写今天还没学', r.tray.some((t) => t.startsWith('今天还没学')), JSON.stringify(r.tray));
  // 学过了就不再提醒
  await p.locator('.dk-study button', { hasText: '已学过' }).click();
  const after = await p.evaluate(async () => {
    const { tickStudyNudge } = await import('/src/desk/studyNudge.ts');
    Object.keys(localStorage).filter((k) => k.startsWith('yearflow:desk:nudge:')).forEach((k) => localStorage.removeItem(k));
    const d = new Date();
    return { n: tickStudyNudge(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 10)), tray: window.__desk.tray.at(-1) };
  });
  check('学过了就不提醒，托盘提示改成学过了', after.n === null && after.tray.startsWith('今天学过了'), JSON.stringify(after));
  await c.close();
}

check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
