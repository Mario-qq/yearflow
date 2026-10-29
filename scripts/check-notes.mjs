/**
 * 便签自查（docs/NOTES_SPEC.md）：顶栏入口 + Alt+N、搜索兼新建、编辑会话（一条撤销 / 空便签丢弃 / 清单自动续行）、
 * 标签过滤、清单勾选、颜色 / 置顶 / 归档 / 回收站 / 永久删除、转待办（整条 / 某一行）、编辑中远端改动 ⇒ 冲突副本、
 * 刷新后数据还在（Dexie v6）、面板版式（电脑右侧 384 宽、手机全宽）、Esc 关面板。
 * 前置：vite dev（preview_start yearflow-dev）。跑法：node scripts/check-notes.mjs [端口]
 * 时钟固定在 2026-10-29 15:00。截图到 docs/screenshots/notes/*.png。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] ?? '5173';
const BASE = `http://localhost:${PORT}`;
const OUT = 'docs/screenshots/notes';
mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
const TODAY = '2026-10-29';

async function seed(page, theme) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    s.updateSettings({ theme });
    const at = (d, h = 9) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
    const N = (id, body, o = {}) => ({ id, body, editedAt: at(28), createdAt: at(20), updatedAt: at(28), ...o });
    const notes = [
      N('n1', '供应商联系人\n张工 138 0000 1234（报价）\n李经理 139 1111 2222 #采购', { color: 'yellow', pinnedAt: at(25) }),
      N('n2', '周会要点\n- [x] 确认 Q4 预算\n- [ ] 催张工报价 #会议\n- [ ] 排期表发给王总', { pinnedAt: at(26) }),
      N('n3', 'MM 模块学习思路\n先看采购订单流程，再看收货。\n- [x] 物料主数据\n- [ ] 收货 101 移动类型\n参考 https://help.sap.com/mm #SAP', { color: 'blue', editedAt: at(29, 6) }),
      N('n4', '灵感：甘特图支持按季度折叠 #灵感', { color: 'green', editedAt: at(27) }),
      N('n5', 'VPN 备用地址与说明', { color: 'gray', localOnly: true, editedAt: at(26) }),
      N('n6', '采购价差记录\n10 月：+3.2%\n9 月：-1.1%\n8 月：+0.4%\n7 月：+2.0%\n6 月：+1.6%\n5 月：-0.3%\n4 月：+0.9%\n3 月：+1.1%\n#采购', { color: 'pink', editedAt: at(22) }),
      N('n7', '去年的年会节目单', { archivedAt: at(10), editedAt: at(1) }),
      N('n8', '过时的会议室密码', { trashedAt: at(27), editedAt: at(5) }),
    ];
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    await s.replaceAllData({ ...buildSeedBundle('2026-10-29'), notes });
  }, theme);
  await page.waitForTimeout(700);
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
async function open(theme, w = 1440, h = 900) {
  const mobile = w < 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T15:00:00`));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seed(page, theme);
  await page.goto(`${BASE}/${w < 768 ? 'checkin' : 'desk'}`);
  await page.waitForTimeout(600);
  return { ctx, page };
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return {
      notes: Object.values(s.notes),
      undo: s.undoStack.map((c) => c.label),
      work: Object.values(s.workItems),
    };
  });
const cards = (page) => page.$$eval('.nt-list .nt-card', (els) => els.map((e) => e.dataset.noteId));
const openPanel = async (page) => {
  await page.keyboard.press('Alt+KeyN');
  await page.waitForSelector('.nt .nt-input');
  await page.waitForTimeout(250);
};

// ── 电脑 · 深色：主流程 ───────────────────────────────────────────────
{
  const { ctx, page } = await open('dark');
  check('顶栏有便签按钮', (await page.$('button[title="便签（Alt+N）"]')) !== null);
  await openPanel(page);
  check('Alt+N 打开面板且输入框聚焦', await page.evaluate(() => document.activeElement?.classList.contains('nt-input')));
  const box = await page.$eval('.nt', (e) => e.getBoundingClientRect().toJSON());
  check('面板贴右、宽 384、从顶栏下沿到底', Math.round(box.width) === 384 && Math.round(box.right) === 1440 && Math.round(box.top) === 48 && Math.round(box.bottom) === 900, JSON.stringify(box));
  check('置顶区按置顶时刻倒序在前', (await cards(page)).slice(0, 2).join() === 'n2,n1', (await cards(page)).join());
  check('最近区按内容修改时间倒序', (await cards(page)).slice(2).join() === 'n3,n4,n5,n6', (await cards(page)).join());
  check('底部计数：归档 1、回收站 1', /归档 1/.test(await page.textContent('.nt-bottom')) && /回收站 1/.test(await page.textContent('.nt-bottom')));
  check('标签条：#采购 2 次排第一', (await page.textContent('.nt-tags .nt-chip')).replace(/\s/g, '') === '#采购2');
  await page.screenshot({ path: `${OUT}/panel-dark.png` });

  // 回车新建
  await page.keyboard.type('取件码 6-2-1103');
  await page.keyboard.press('Enter');
  let st = await state(page);
  const quick = st.notes.find((n) => n.body === '取件码 6-2-1103');
  check('回车记下一条、输入框清空', !!quick && (await page.inputValue('.nt-input')) === '');
  check('新的一条排在「其他」第一位', (await cards(page))[2] === quick?.id);

  // Ctrl+Enter 展开写 + 清单续行
  await page.keyboard.type('出差清单');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.nt-editor');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] 身份证');
  await page.keyboard.press('Enter');
  await page.keyboard.type('充电器');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // 空清单行回车 = 结束清单
  await page.keyboard.type('#出差');
  check('清单回车自动续行、空行回车结束', (await page.inputValue('.nt-editor')) === '出差清单\n- [ ] 身份证\n- [ ] 充电器\n#出差', JSON.stringify(await page.inputValue('.nt-editor')));
  await page.screenshot({ path: `${OUT}/editor-dark.png` });
  await page.waitForTimeout(700); // 防抖保存
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  st = await state(page);
  const trip = st.notes.find((n) => n.body.startsWith('出差清单'));
  check('Esc 收起编辑、内容已保存', !!trip && trip.body.endsWith('#出差') && !(await page.$('.nt-editor')));
  check('一次编辑会话 = 一条撤销', st.undo.filter((l) => l.includes('出差清单')).length === 1, st.undo.slice(-3).join(' / '));
  check('Esc 收起编辑后面板仍开着', (await page.$('.nt')) !== null);

  // 新建空白直接收起 ⇒ 不留东西
  const before = (await state(page)).notes.length;
  const undoBefore = (await state(page)).undo.length;
  await page.click('.nt-new');
  await page.waitForSelector('.nt-editor');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  st = await state(page);
  check('新建空白什么都不写就收起 ⇒ 不留便签、不留撤销', st.notes.length === before && st.undo.length === undoBefore);

  // 搜索 / 标签
  await page.fill('.nt-input', '张工');
  check('搜索「张工」命中两条', (await cards(page)).sort().join() === 'n1,n2', (await cards(page)).join());
  await page.fill('.nt-input', '');
  await page.click('.nt-tags .nt-chip:has-text("#采购")');
  check('点标签 = 按标签过滤', (await page.inputValue('.nt-input')) === '#采购' && (await cards(page)).sort().join() === 'n1,n6');
  await page.click('.nt-tags .nt-chip:has-text("#采购")');
  check('再点一次取消过滤', (await page.inputValue('.nt-input')) === '');

  // 清单勾选（预览态）
  await page.click('[data-note-id="n2"] .nt-check:not(.is-done) .nt-box');
  st = await state(page);
  check('预览里点勾 = 改正文那一行', st.notes.find((n) => n.id === 'n2').body.includes('- [x] 催张工报价'));
  check('清单进度显示 2/3', (await page.textContent('[data-note-id="n2"] .nt-progress')).trim() === '2/3');

  // 颜色
  await page.hover('[data-note-id="n4"]');
  await page.click('[data-note-id="n4"] .nt-act[title="颜色"]');
  await page.click('[data-note-id="n4"] .nt-swatch[data-color="purple"]');
  st = await state(page);
  check('改颜色', st.notes.find((n) => n.id === 'n4').color === 'purple');
  check('改颜色不让便签跳位', (await cards(page)).indexOf('n4') === (await cards(page)).indexOf('n3') + 1);

  // 转待办：某一行
  await page.hover('[data-note-id="n2"]');
  await page.click('[data-note-id="n2"] .nt-act[title^="转成待办"]');
  await page.click('.nt-todo-menu button:has-text("排期表发给王总")');
  st = await state(page);
  const w = st.work.find((x) => x.title === '排期表发给王总');
  check('转待办（某一行）⇒ 待处理待办', !!w && !w.date && w.status === 'open');
  check('便签记下转成的待办', st.notes.find((n) => n.id === 'n2').convertedTo?.includes(w?.id));
  check('卡片上出现「已转待办」标记', /已转待办 1/.test(await page.textContent('[data-note-id="n2"] .nt-flags')));

  // 置顶 / 归档 / 回收站
  await page.hover('[data-note-id="n4"]');
  await page.click('[data-note-id="n4"] .nt-act[title="置顶"]');
  check('置顶后进置顶区第一', (await cards(page))[0] === 'n4');
  await page.hover('[data-note-id="n4"]');
  await page.click('[data-note-id="n4"] .nt-act[title="归档"]');
  st = await state(page);
  const n4 = st.notes.find((n) => n.id === 'n4');
  check('归档：离开主列表、顺手取消置顶', !(await cards(page)).includes('n4') && n4.archivedAt && !n4.pinnedAt);
  await page.hover('[data-note-id="n6"]');
  await page.click('[data-note-id="n6"] .nt-act[title^="删除"]');
  check('删除进回收站', !(await cards(page)).includes('n6') && /回收站 2/.test(await page.textContent('.nt-bottom')));
  await page.click('.nt-bottom .nt-link:has-text("回收站")');
  check('回收站视图按删除时刻倒序', (await cards(page)).join() === 'n6,n8', (await cards(page)).join());
  await page.screenshot({ path: `${OUT}/trash-dark.png` });
  await page.click('[data-note-id="n6"] .nt-act[title="恢复"]');
  await page.click('[data-note-id="n8"] .nt-act[title="永久删除"]');
  st = await state(page);
  check('恢复 / 永久删除', !st.notes.find((n) => n.id === 'n6').trashedAt && !st.notes.find((n) => n.id === 'n8'));
  await page.click('.nt-back');

  // 编辑中远端改了同一条 ⇒ 冲突副本
  await page.click('[data-note-id="n3"] .nt-line.nt-title');
  await page.waitForSelector('.nt-editor');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n本机补一句');
  await page.evaluate(() => {
    const s = window.__store.getState();
    const n = s.notes.n3;
    s.applyRemote({ notes: { puts: [{ ...n, body: n.body + '\n手机上补的', updatedAt: new Date(Date.now() + 1000).toISOString() }], deletes: [] } });
  });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  st = await state(page);
  const copy = st.notes.find((n) => n.conflictOf === 'n3');
  check('编辑中远端改动 ⇒ 你这版存原便签、另一版成冲突副本', st.notes.find((n) => n.id === 'n3').body.endsWith('本机补一句') && copy?.body.endsWith('手机上补的'));
  check('冲突副本置顶并带标记', (await cards(page))[0] === copy?.id && /冲突副本/.test(await page.textContent(`[data-note-id="${copy?.id}"]`)));

  // 刷新后数据还在（Dexie v6）
  await page.waitForTimeout(800); // 落库防抖
  await page.reload();
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  st = await state(page);
  check('刷新后便签都在（落库成功）', !!st.notes.find((n) => n.body.startsWith('出差清单')) && !!st.notes.find((n) => n.conflictOf === 'n3') && st.notes.length >= 9, String(st.notes.length));

  // Esc 关面板 / 再按 Alt+N
  await openPanel(page);
  await page.keyboard.press('Escape');
  check('输入框里 Esc（空）= 关面板', (await page.$('.nt')) === null);
  await openPanel(page);
  await page.keyboard.press('Alt+KeyN');
  await page.waitForTimeout(100);
  check('再按 Alt+N 关面板', (await page.$('.nt')) === null);
  await ctx.close();
}

// ── 命令面板 ─────────────────────────────────────────────────────────
{
  const { ctx, page } = await open('dark');
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('.max-h-80');
  await page.waitForTimeout(100);
  await page.keyboard.type('1111 2222');
  await page.waitForTimeout(150);
  const first = await page.textContent('.max-h-80 button');
  check('命令面板按正文搜到便签', /便签/.test(first) && /供应商联系人/.test(first), first);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nt-editor');
  check('回车 = 打开面板并展开那条', (await page.$eval('.nt-card.is-editing', (e) => e.dataset.noteId)) === 'n1');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('两下 Esc：先收起编辑、再关面板', (await page.$('.nt')) === null);
  const n0 = (await state(page)).notes.length;
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('.max-h-80'); // 命令面板在下一帧才聚焦输入框
  await page.waitForTimeout(100);
  await page.keyboard.type('新建便签');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nt-editor');
  await page.keyboard.type('从命令面板记的');
  await page.waitForTimeout(700);
  check('命令面板「新建便签」', (await state(page)).notes.length === n0 + 1);
  await ctx.close();
}

// ── 浅色 · 截图 ───────────────────────────────────────────────────────
{
  const { ctx, page } = await open('light');
  await openPanel(page);
  await page.screenshot({ path: `${OUT}/panel-light.png` });
  await page.click('[data-note-id="n3"] .nt-line.nt-title');
  await page.waitForSelector('.nt-editor');
  await page.screenshot({ path: `${OUT}/editor-light.png` });
  await ctx.close();
}

// ── 甘特图页也能用 ───────────────────────────────────────────────────
{
  const { ctx, page } = await open('dark');
  await page.goto(`${BASE}/gantt`);
  await page.waitForTimeout(800);
  await openPanel(page);
  check('甘特图页 Alt+N 也能打开', (await page.$('.nt')) !== null);
  await page.screenshot({ path: `${OUT}/gantt-dark.png` });
  await ctx.close();
}

// ── 手机 · 深色 ─────────────────────────────────────────────────────
{
  const { ctx, page } = await open('dark', 375, 812);
  await page.click('button[title="便签（Alt+N）"]');
  await page.waitForSelector('.nt');
  await page.waitForTimeout(300);
  const box = await page.$eval('.nt', (e) => e.getBoundingClientRect().toJSON());
  check('手机：面板全宽', Math.round(box.width) === 375 && Math.round(box.left) === 0, JSON.stringify(box));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('手机：没有横向滚动', !overflow);
  check('手机：卡片操作常显（没有悬停）', (await page.$eval('[data-note-id="n1"] .nt-acts', (e) => getComputedStyle(e).opacity)) === '1');
  await page.screenshot({ path: `${OUT}/mobile-dark.png` });
  await ctx.close();
}

check('全程没有页面报错', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
