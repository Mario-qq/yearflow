/**
 * 日常习惯自查（DESK_SPEC §十二）：今天那列顶上的胶囊、点一下打卡 / 记破戒、右键菜单、编辑卡、抽屉「习惯」页、
 * 「别连着断两天」的颜色、到点通知（模拟桌面桥）。头部不再有「紧急的都处理完了」「年度计划还有」两个药丸。
 * 前置：vite dev（preview_start yearflow-dev）。跑法：node scripts/check-habits.mjs [端口]
 * 截图到 docs/screenshots/desk/habits-*.png。
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

const MON = '2026-10-19';
const at = (hm) => new Date(`${MON}T${hm}:00`);

async function seed(page, theme, withHabits = true) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(
    async ({ theme, withHabits }) => {
      const s = window.__store.getState();
      s.updateSettings({ theme, desk: { ...s.settings.desk, studyGoalIds: [] } });
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const today = new Date();
      const t0 = fmt(today);
      const ago = (n) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return fmt(d);
      };
      const stamp = new Date().toISOString();
      const h = (id, o) => ({ id, kind: 'do', startDate: ago(30), order: Number(id.slice(1)), createdAt: stamp, updatedAt: stamp, ...o });
      const habits = withHabits
        ? [
            h('h1', { title: '冲牙', icon: '🦷', cue: '刷完牙后', time: '21:30', why: '牙龈出血' }),
            h('h2', { title: '不吃热食', icon: '🧊', kind: 'avoid', cue: '吃饭时', time: '11:50' }),
            h('h3', { title: '喝够 8 杯水', icon: '💧' }),
            h('h4', { title: '午休闭眼 10 分钟', cue: '午饭后' }),
            h('h5', { title: '睡前不刷手机', icon: '📵', kind: 'avoid' }),
          ]
        : [];
      const log = (hid, date, status) => ({ id: `${hid}:${date}`, habitId: hid, date, status, createdAt: stamp, updatedAt: stamp });
      const habitLogs = withHabits
        ? [
            // 冲牙：前 6 天都做了、昨天漏了 ⇒ 琥珀「昨天断了，今天接上」
            ...[2, 3, 4, 5, 6, 7].map((n) => log('h1', ago(n), 'done')),
            // 不吃热食：5 天前破过一次 ⇒ 守住 4 天
            log('h2', ago(5), 'slip'),
            // 喝水：今天已做
            ...[0, 1, 2, 3].map((n) => log('h3', ago(n), 'done')),
            // 午休：连漏两天 ⇒ 红
            log('h4', ago(3), 'done'),
            // 睡前不刷手机：昨天破了
            log('h5', ago(1), 'slip'),
          ]
        : [];
      const items = [
        { id: 'w1', kind: 'todo', title: '修复出货单过帐失败', urgency: 'urgent', scope: 'work', status: 'open', date: t0, order: 1, createdAt: stamp, updatedAt: stamp },
        { id: 'w2', kind: 'todo', title: '预约年度体检', urgency: 'normal', scope: 'life', status: 'open', date: t0, order: 2, createdAt: stamp, updatedAt: stamp },
      ];
      const { buildSeedBundle } = await import('/src/seed/seedData.ts');
      await s.replaceAllData({ ...buildSeedBundle(t0), workItems: items, routines: [], routineLogs: [], dayMarks: [], habits, habitLogs });
    },
    { theme, withHabits },
  );
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const open = async (theme, w, h, { hm = '15:00', withHabits = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(at(hm));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seed(page, theme, withHabits);
  await page.goto(`${BASE}/desk`);
  await page.waitForSelector('.dk-day.today');
  await page.waitForTimeout(250);
  return { ctx, page };
};
const chip = (page, title) => page.locator('.dk-day.today .dk-hb', { hasText: title });
const logOf = (page, id) => page.evaluate((id) => window.__store.getState().habitLogs[id] ?? null, id);

// ── 版式：深浅 × 两档宽 ──
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    const { ctx, page } = await open(theme, w, h);
    const tag = `${theme} ${w}`;
    const first = await page.$eval('.dk-day.today .dk-db', (db) => db.children[0]?.className);
    check(`${tag}：今天卡最上面是习惯条`, first === 'dk-habits', first);
    check(`${tag}：5 个习惯胶囊 + ＋`, (await page.locator('.dk-day.today .dk-hb').count()) === 5 && (await page.locator('.dk-day.today .dk-hb-add').count()) === 1);
    check(`${tag}：其他日子没有习惯条`, (await page.locator('.dk-day:not(.today) .dk-habits').count()) === 0);
    const cls = async (t) => (await chip(page, t).getAttribute('class')) ?? '';
    check(`${tag}：冲牙昨天漏了 ⇒ 琥珀 + 「昨天断了」`, (await cls('冲牙')).includes('b1') && (await chip(page, '冲牙').innerText()).includes('昨天断了'), await chip(page, '冲牙').innerText());
    check(`${tag}：悬停说明里有完整的话 + 最近两周`, /今天接上[\s\S]*最近两周/.test((await chip(page, '冲牙').getAttribute('title')) ?? ''));
    check(`${tag}：午休连漏两天 ⇒ 红`, (await cls('午休')).includes('b2'));
    check(`${tag}：喝水今天做了 ⇒ done + 4天`, (await cls('喝够')).includes('done') && (await chip(page, '喝够').innerText()).includes('4天'));
    check(`${tag}：不吃热食 ⇒ 4天`, (await chip(page, '不吃热食').innerText()).includes('4天'));
    const bgs = await page.$$eval('.dk-day.today .dk-hb', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    check(`${tag}：几种状态底色互不相同（琥珀 / 红 / 绿 / 淡）`, new Set(bgs).size >= 4, bgs.join(' | '));
    const box = await page.$eval('.dk-day.today', (d) => {
      const r = d.getBoundingClientRect();
      return [...d.querySelectorAll('.dk-hb, .dk-hb-add')].every((c) => {
        const b = c.getBoundingClientRect();
        return b.left >= r.left - 0.5 && b.right <= r.right + 0.5;
      });
    });
    check(`${tag}：胶囊都在今天卡内（自动换行，不溢出）`, box);
    const stripH = await page.$eval('.dk-day.today .dk-habits', (e) => e.getBoundingClientRect().height);
    check(`${tag}：5 个习惯最多占 ${w >= 1920 ? 2 : 3} 行`, stripH <= (w >= 1920 ? 2 : 3) * 28, String(Math.round(stripH)));
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.dk-board')].map((e) => e.scrollWidth - e.clientWidth)));
    check(`${tag}：无横向溢出`, overflow <= 0, String(overflow));
    const say = await page.locator('.dk-h-say').innerText();
    check(`${tag}：头部不再有「紧急」「年度计划」两个药丸`, !/紧急|年度计划/.test(say), say.replace(/\n/g, ' '));
    await page.screenshot({ path: `${OUT}/habits-week-${theme}-${w}.png` });
    const card = await page.locator('.dk-day.today').boundingBox();
    await page.screenshot({ path: `${OUT}/habits-today-${theme}-${w}.png`, clip: { x: card.x - 4, y: card.y - 4, width: card.width + 8, height: Math.min(card.height + 8, 300) } });
    await ctx.close();
  }
}

// ── 交互（深色 1440）──
{
  const { ctx, page } = await open('dark', 1440, 900);

  await chip(page, '冲牙').click();
  check('点「冲牙」⇒ 今天做了', (await logOf(page, `h1:${MON}`))?.status === 'done');
  check('胶囊变 done、断了的提示消失', ((await chip(page, '冲牙').getAttribute('class')) ?? '').includes('done') && !(await chip(page, '冲牙').innerText()).includes('断了'));
  check('出撤销 toast', await page.getByText('「冲牙」做了').isVisible());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z 撤回打卡', (await logOf(page, `h1:${MON}`)) === null);
  await chip(page, '冲牙').click();
  await chip(page, '冲牙').click();
  check('再点一下 = 取消', (await logOf(page, `h1:${MON}`)) === null);

  await chip(page, '不吃热食').click();
  check('点「不吃热食」⇒ 今天破了一次', (await logOf(page, `h2:${MON}`))?.status === 'slip');
  check('胶囊变红「今天破了」', ((await chip(page, '不吃热食').getAttribute('class')) ?? '').includes('slip') && (await chip(page, '不吃热食').innerText()).includes('今天破了'));
  await chip(page, '不吃热食').click();

  // 右键菜单
  await chip(page, '冲牙').click({ button: 'right' });
  const menu = page.locator('.dk-menu');
  check('右键出菜单（今天做了 / 补记昨天 / 编辑 / 暂停 / 删除）', (await menu.innerText()).includes('昨天其实做了') && (await menu.innerText()).includes('编辑'), (await menu.innerText()).replace(/\n/g, ' / '));
  await page.screenshot({ path: `${OUT}/habits-menu-dark.png` });
  await menu.getByText('昨天其实做了').click();
  check('补记昨天 ⇒ 不再算断', (await logOf(page, `h1:2026-10-18`))?.status === 'done' && !((await chip(page, '冲牙').getAttribute('class')) ?? '').includes('b1'));

  // 编辑卡
  await chip(page, '冲牙').click({ button: 'right' });
  await menu.getByText('编辑…').click();
  const ed = page.locator('.dk-pop.dk-ed');
  check('右键「编辑…」打开习惯编辑卡', (await ed.isVisible()) && (await ed.locator('.dk-ed-title').inputValue()) === '冲牙');
  await page.screenshot({ path: `${OUT}/habits-editor-dark.png` });
  await ed.locator('[aria-label="锚点"]').fill('晚上刷完牙后');
  await ed.getByRole('button', { name: '保存' }).click();
  check('保存锚点', (await page.evaluate(() => window.__store.getState().habits.h1.cue)) === '晚上刷完牙后');

  // ＋ 新建
  await page.locator('.dk-day.today .dk-hb-add').click();
  check('点 ＋ 打开新建习惯', await page.locator('.dk-pop.dk-ed', { hasText: '新建日常习惯' }).isVisible());
  await page.keyboard.type('饭后散步');
  await page.locator('.dk-hb-icons button', { hasText: '🚶' }).click();
  await page.locator('.dk-ed-days button', { hasText: '六' }).click();
  await page.locator('.dk-ed-days button', { hasText: '日' }).click();
  await page.locator('.dk-pop.dk-ed').getByRole('button', { name: '加习惯' }).click();
  const walk = await page.evaluate(() => Object.values(window.__store.getState().habits).find((h) => h.title === '饭后散步'));
  check('新习惯落库：图标 + 只工作日', walk?.icon === '🚶' && JSON.stringify(walk?.daysOfWeek) === '[1,2,3,4,5]', JSON.stringify(walk && { i: walk.icon, d: walk.daysOfWeek }));
  check('新习惯出现在今天顶上', await chip(page, '饭后散步').isVisible());

  // 暂停 ⇒ 消失；抽屉里恢复
  await chip(page, '饭后散步').click({ button: 'right' });
  await menu.getByText('暂停').click();
  check('暂停后从今天顶上消失', (await chip(page, '饭后散步').count()) === 0);
  await page.locator('.dk-bar button', { hasText: '待处理' }).click();
  await page.locator('.dk-drawer [role="tab"]', { hasText: '习惯' }).click();
  const row = page.locator('.dk-drawer .dk-rl', { hasText: '饭后散步' });
  check('抽屉「习惯」页列出暂停的', (await row.innerText()).includes('已暂停'));
  await page.screenshot({ path: `${OUT}/habits-drawer-dark.png` });
  await row.getByRole('button', { name: '恢复' }).click();
  check('抽屉里恢复', (await chip(page, '饭后散步').count()) === 1);
  await ctx.close();
}

// ── 没有习惯时：只有一个淡淡的「＋ 日常习惯」 ──
{
  const { ctx, page } = await open('light', 1440, 900, { withHabits: false });
  check('没有习惯 ⇒ 只显示「＋ 日常习惯」', (await page.locator('.dk-day.today .dk-hb-add.empty').innerText()).includes('日常习惯') && (await page.locator('.dk-hb').count()) === 0);
  await ctx.close();
}

// ── 到点通知（页面载入后再挂一个假的桌面桥：desktop() 每次调用时现读 window，载入前挂会让桌面壳组件跟着启动）──
{
  const { ctx, page } = await open('dark', 1440, 900, { hm: '21:40' });
  const fired = await page.evaluate(async () => {
    window.__notes = [];
    window.yearflowDesktop = {
      notify: async (body, opts) => (window.__notes.push({ body, ...opts }), true),
      setTrayStatus: async () => {},
      onPowerResume: () => () => {},
    };
    const m = await import('/src/desk/studyNudge.ts');
    const first = m.tickHabitNudge(new Date('2026-10-19T21:40:00'));
    const again = m.tickHabitNudge(new Date('2026-10-19T21:41:00'));
    return { first, again, notes: window.__notes };
  });
  const body = fired.notes.map((n) => n.body).join(' | ');
  check('21:40：冲牙（21:30 没做）+ 不吃热食（11:50 没破）合成一条通知', fired.first.length === 2 && fired.notes.filter((n) => /冲牙/.test(n.body)).length === 1 && /不吃热食/.test(body), body);
  check('冲牙通知带「昨天断了，今天接上」', /冲牙：刷完牙后。昨天断了，今天接上/.test(body), body);
  check('同一天不重复提醒', fired.again.length === 0);
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/Failed to load resource|supabase|net::ERR/i.test(e));
check('无页面报错', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
