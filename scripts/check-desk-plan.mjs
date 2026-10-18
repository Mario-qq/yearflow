/**
 * 工作台今天「年度计划」分区自查：行右键 / 行尾「⋯」菜单、分区折叠。前置：vite dev（preview_start yearflow-dev）。
 * 跑法：node scripts/check-desk-plan.mjs [端口]
 *
 * 隔离：系统 Chrome + 新建的空 context（IndexedDB 全新），甘特示例经 DEV 句柄 __store 注入，绝不碰真实数据。
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

const browser = await chromium.launch({ channel: 'chrome' });
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    s.updateSettings({ theme });
    const d = new Date();
    const t0 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    await s.replaceAllData(buildSeedBundle(t0));
  }, theme);
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/desk`);

  const today = page.locator('.dk-day.today');
  const rows = today.locator('.dk-row.plan');
  await rows.first().waitFor();
  const n = await rows.count();
  const checkCount = () => page.evaluate(() => Object.values(window.__store.getState().checkIns).filter((c) => !c.deletedAt).length);
  const statusOf = (taskTitle) =>
    page.evaluate((t) => {
      const s = window.__store.getState();
      const task = Object.values(s.tasks).find((x) => x.name === t);
      const d = new Date();
      const t0 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return Object.values(s.checkIns).find((c) => !c.deletedAt && c.taskId === task?.id && c.date === t0)?.status ?? null;
    }, taskTitle);

  // 找一行还没打卡的
    const rowTitle = await today.locator('.dk-row.plan:not(.done)').first().getAttribute('title');
  const row = today.locator(`.dk-row.plan[title="${rowTitle}"]`); // 按标题钉住这一行（打卡后 .done 会变）
  const label = await row.locator('.dk-t').innerText();
  const taskName = label.split(' · ').slice(1).join(' · ');
  const menu = page.locator('.dk-menu');

  // 1. 右键菜单
  await row.click({ button: 'right' });
  await menu.waitFor();
  const items = await menu.locator('button').allInnerTexts();
  check(`[${theme}] 右键出菜单`, ['完成', '做了一点', '今天跳过', '开始专注', '在甘特图中打开'].every((t) => items.some((x) => x.startsWith(t))), items.join(' | '));
  check(`[${theme}] 菜单标题写明来自年度计划`, (await menu.locator('.lbl').innerText()).startsWith('年度计划'));
  await page.screenshot({ path: `${OUT}/plan-menu-${theme}.png` });

  // 2. 做了一点 → 打卡写入；菜单再开有 ✓ 且出现撤销
  const before = await checkCount();
  await menu.getByRole('button', { name: /^做了一点/ }).click();
  check(`[${theme}] 做了一点 = 写一条 partial`, (await statusOf(taskName)) === 'partial' && (await checkCount()) === before + 1);
  await row.click({ button: 'right' });
  await menu.waitFor();
  check(`[${theme}] 再开菜单：做了一点带 ✓、有撤销打卡`, (await menu.getByRole('button', { name: /^做了一点/ }).innerText()).includes('✓') && (await menu.getByRole('button', { name: '撤销打卡' }).count()) === 1);

  // 3. 今天跳过：原位更新，不新增
  await menu.getByRole('button', { name: /^今天跳过/ }).click();
  check(`[${theme}] 今天跳过 = 原位改成 skipped`, (await statusOf(taskName)) === 'skipped' && (await checkCount()) === before + 1);
  // 4. ⋯ 按钮同一个菜单 → 撤销打卡
  await row.hover();
  await row.locator('.dk-more').click();
  await menu.waitFor();
  check(`[${theme}] 跳过后不再提供开始专注`, (await menu.getByRole('button', { name: /^开始专注/ }).count()) === 0);
  await menu.getByRole('button', { name: '撤销打卡' }).click();
  check(`[${theme}] ⋯ → 撤销打卡 = 记录删掉`, (await statusOf(taskName)) === null && (await checkCount()) === before);
  // 5. Ctrl+Z 撤回撤销
  await page.keyboard.press('Control+z');
  check(`[${theme}] Ctrl+Z 恢复刚撤销的打卡`, (await statusOf(taskName)) === 'skipped');

  // 6. 折叠
  const sec = today.locator('button.dk-sec', { hasText: '年度计划' });
  await sec.click();
  check(`[${theme}] 点标题收起，行隐藏`, (await rows.count()) === 0 && (await sec.innerText()).includes('▸'));
  await page.screenshot({ path: `${OUT}/plan-folded-${theme}.png` });
  await page.reload();
  await today.locator('button.dk-sec', { hasText: '年度计划' }).waitFor();
  check(`[${theme}] 收起状态刷新后还在`, (await rows.count()) === 0);
  await today.locator('button.dk-sec', { hasText: '年度计划' }).click();
  check(`[${theme}] 再点展开`, (await rows.count()) === n);

  // 7. 在甘特图中打开
  await rows.first().click({ button: 'right' });
  await menu.getByRole('button', { name: '在甘特图中打开' }).click();
  await page.waitForURL(/\/gantt/);
  check(`[${theme}] 在甘特图中打开 → 跳到甘特图`, page.url().includes('/gantt'));

  check(`[${theme}] 无页面错误`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
