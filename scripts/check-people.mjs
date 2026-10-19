/**
 * 人际模块自查（docs/PEOPLE_SPEC.md）：工具条「收尾今天」左边的「人际」小按钮（安静角标）+ 弹窗（需要关注、档案各栏、
 * 改名带跟进、@人 一键建档）、人物卡档案摘要与「记一笔」「打开档案」、重要日子倒推准备待办（确定 id、删掉不再生成）。
 * 负责人 10-19：人际不放工作台主体 ⇒ 头部不再有人际药丸，顶栏也没有单独的页面。
 * 前置：vite dev（preview_start yearflow-dev）。跑法：node scripts/check-people.mjs [端口]
 * 时钟固定在 2026-10-19（周一）15:00。截图到 docs/screenshots/people/*.png。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] ?? '5173';
const BASE = `http://localhost:${PORT}`;
const OUT = 'docs/screenshots/people';
mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
const TODAY = '2026-10-19';

async function seed(page, theme) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    s.updateSettings({ theme, desk: { ...s.settings.desk, studyGoalIds: [] } });
    const stamp = new Date().toISOString();
    const P = (id, o) => ({ id, relation: 'friend', order: Number(id.slice(1)), createdAt: '2026-09-01T00:00:00.000Z', updatedAt: stamp, ...o });
    const people = [
      P('p1', { name: '妈妈', relation: 'family', cadenceDays: 7, dates: [{ id: 'd1', label: '生日', month: 9, day: 20, lunar: true, year: 1965 }], loveLanguages: ['time'], likes: '养花、越剧', notes: '膝盖不好，爬楼梯吃力' }),
      P('p2', {
        name: '小美',
        relation: 'partner',
        cadenceDays: 1,
        dates: [{ id: 'd2', label: '生日', month: 11, day: 2, year: 1995 }, { id: 'd3', label: '恋爱纪念日', month: 3, day: 14, year: 2021 }],
        loveLanguages: ['words', 'gifts'],
        likes: '猫、抹茶、宫崎骏',
        dislikes: '香菜',
        ideas: [
          { id: 'i1', text: '提过想去看海', at: '2026-09-20' },
          { id: 'i2', text: '耳机坏了', at: '2026-10-02' },
        ],
      }),
      P('p3', { name: '张经理', relation: 'boss', cadenceDays: 30 }),
      P('p4', { name: '老同学阿杰', cadenceDays: 90 }),
    ];
    const I = (id, personId, date, o = {}) => ({ id, personId, date, kind: 'chat', createdAt: stamp, updatedAt: stamp, ...o });
    const interactions = [
      I('x1', 'p1', '2026-09-26', { kind: 'call', note: '问了膝盖', learned: '下个月想去复查膝盖' }),
      I('x2', 'p2', '2026-10-18', { kind: 'meet', note: '一起吃了日料', learned: '最近在准备教资考试，压力大' }),
      I('x3', 'p2', '2026-10-10', { note: '聊旅行', learned: '想年底去厦门' }),
      I('x4', 'p3', '2026-10-12', { kind: 'meet', note: '汇报 MRP 优化进度' }),
    ];
    const W = (id, o) => ({ id, kind: 'followup', urgency: 'normal', scope: 'work', status: 'open', order: 1, createdAt: stamp, updatedAt: stamp, mode: 'inform', date: '2026-10-19', ...o });
    const workItems = [
      W('w1', { title: '下周六晚停机窗口', person: '张经理' }),
      W('w2', { title: 'cmrp810 索引脚本', person: '李工', mode: 'dispatch' }),
      W('w3', { title: '体检报告结果', person: '妈妈', scope: 'life' }),
    ];
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    await s.replaceAllData({ ...buildSeedBundle('2026-10-19'), workItems, routines: [], routineLogs: [], dayMarks: [], habits: [], habitLogs: [], people, interactions });
  }, theme);
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
async function open(theme, w = 1440, h = 900, modal = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T15:00:00`));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seed(page, theme);
  await page.goto(`${BASE}/desk`);
  await page.waitForSelector('.dk-day.today');
  await page.waitForTimeout(400);
  if (modal) {
    await page.locator('.dk-people-btn').click();
    await page.waitForSelector('.pp-side');
    await page.waitForTimeout(300); // 等弹窗淡入播完
  }
  return { ctx, page };
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const workItems = (page) => st(page, () => Object.values(window.__store.getState().workItems));

// ── 工作台：「人际」小按钮 + 倒推准备 ──
for (const theme of ['dark', 'light']) {
  const { ctx, page } = await open(theme);
  const say = await page.locator('.dk-h-say').innerText();
  check(`${theme}：头部不再有人际药丸`, !/生日|该联系/.test(say), say.replace(/\n/g, ' '));
  const btn = page.locator('.dk-bar .dk-people-btn');
  const pos = await page.evaluate(() => {
    const a = document.querySelector('.dk-people-btn').getBoundingClientRect();
    const b = [...document.querySelectorAll('.dk-bar button')].find((x) => x.textContent.includes('收尾今天')).getBoundingClientRect();
    return { gap: Math.round(b.left - a.right), sameRow: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 2 };
  });
  check(`${theme}：「人际」在「收尾今天」左边、同一行`, pos.sameRow && pos.gap >= 0 && pos.gap <= 12, JSON.stringify(pos));
  // 妈妈：生日 10 天 + 23 天没联系；小美：生日 14 天 ⇒ 2 人
  check(`${theme}：角标 = 需要关注的人数（2），安静样式`, (await btn.locator('.dk-badge.soft').innerText()) === '2');
  check(`${theme}：顶栏没有单独的「人际」页`, (await page.locator('header nav a', { hasText: '人际' }).count()) === 0);
  const items = await workItems(page);
  const prep = items.filter((i) => i.id.startsWith('prep-')).map((i) => `${i.date} ${i.title}`).sort();
  check(
    `${theme}：自动倒推出两人共 6 件准备（妈妈 10 天：14 天那步排今天 + 7 天前 + 前一天；小美 14 天：三步）`,
    JSON.stringify(prep) ===
      JSON.stringify([
        '2026-10-19 想想妈妈 61 岁生日准备什么',
        '2026-10-19 想想小美 31 岁生日准备什么',
        '2026-10-22 把妈妈 61 岁生日的礼物 / 安排定下来',
        '2026-10-26 把小美 31 岁生日的礼物 / 安排定下来',
        '2026-10-28 明天妈妈 61 岁生日：写几句具体的话',
        '2026-11-01 明天小美 31 岁生日：写几句具体的话',
      ]),
    prep.join(' | '),
  );
  check(`${theme}：生成提示只弹一次、只进一条撤销`, (await page.locator('text=在工作台排了').count()) === 1 && (await st(page, () => window.__store.getState().undoStack.filter((c) => c.label.includes('排了准备')).length)) === 1);
  const today = await page.locator('.dk-day.today').innerText();
  check(`${theme}：今天卡上出现准备待办（生活区）`, today.includes('想想小美 31 岁生日准备什么'));
  const note = items.find((i) => i.id === 'prep-p2-d2-2026-11-02-14')?.note ?? '';
  check(`${theme}：准备待办备注带爱的语言 / 喜好 / 点子池`, /肯定的言辞/.test(note) && /抹茶/.test(note) && /香菜/.test(note) && /看海/.test(note), note.replace(/\n/g, ' / '));
  await page.screenshot({ path: `${OUT}/desk-${theme}.png` });
  await page.screenshot({ path: `${OUT}/desk-hero-${theme}.png`, clip: await page.locator('.dk-hero').boundingBox() });
  await ctx.close();
}

// ── 工作台交互（深色）──
{
  const { ctx, page } = await open('dark');
  const prepared = await st(page, () => window.__store.getState().people.p2.prepared);
  check('档案记下「这次已生成」', JSON.stringify(prepared) === '["d2@2026-11-02"]', JSON.stringify(prepared));
  // 删一件生成的待办 ⇒ 刷新后不再生成
  await st(page, async () => {
    const s = window.__store.getState();
    const before = s.workItems['prep-p2-d2-2026-11-02-14'];
    s.execute('删除', [{ table: 'workItems', type: 'delete', before }]);
  });
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.dk-day.today');
  await page.waitForTimeout(500);
  check('删掉生成的待办，刷新后不会再生成', !(await workItems(page)).some((i) => i.id === 'prep-p2-d2-2026-11-02-14'));

  // 点 @妈妈 ⇒ 人物卡带档案摘要
  await page.locator('.dk-who', { hasText: '妈妈' }).first().click();
  const card = page.locator('.dk-pop', { hasText: '妈妈' });
  const ct = await card.innerText();
  check('点 @人 打开人物卡，带档案摘要（关系 · 上次联系 · 生日 · 爱的语言 · 近况）', /家人/.test(ct) && /该联系了/.test(ct) && /生日/.test(ct) && /精心的时刻/.test(ct) && /复查膝盖/.test(ct), ct.replace(/\n/g, ' / '));
  await page.screenshot({ path: `${OUT}/personcard-dark.png` });
  await card.getByRole('button', { name: '记一笔' }).click();
  await card.locator('[aria-label="聊了什么"]').fill('视频，看了新开的花');
  await card.locator('[aria-label="新知道的事"]').fill('周末想去花市');
  check('人物卡里「记一笔」打字不被工作台快捷键抢走', (await card.locator('[aria-label="聊了什么"]').inputValue()) === '视频，看了新开的花');
  await page.screenshot({ path: `${OUT}/personcard-log-dark.png` });
  await card.locator('.pp-log button.primary').click();
  const it = await st(page, () => Object.values(window.__store.getState().interactions).find((i) => i.note === '视频，看了新开的花'));
  check('记一笔落库（今天 · 聊天 · 新知道的事）', it?.date === '2026-10-19' && it?.kind === 'chat' && it?.learned === '周末想去花市', JSON.stringify(it));
  // 「打开档案 →」⇒ 人际弹窗，选中妈妈
  await card.getByRole('button', { name: '打开档案 →' }).click();
  await page.waitForSelector('.pp-detail');
  check('人物卡「打开档案」⇒ 人际弹窗选中 TA、人物卡收起', (await page.locator('.pp-name').inputValue()) === '妈妈' && (await page.locator('.dk-pop').count()) === 0);
  check('刚记的一笔已进弹窗里的近况', (await page.locator('.pp-learned').innerText()).includes('周末想去花市'));
  await page.waitForTimeout(300); // 等弹窗淡入播完再截
  await page.screenshot({ path: `${OUT}/modal-from-card-dark.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc 关人际弹窗', (await page.locator('.pp').count()) === 0);

  // 没建档的 @人：人物卡给「建档」
  await page.locator('.dk-who', { hasText: '李工' }).first().click();
  const lcard = page.locator('.dk-pop', { hasText: '李工' });
  check('没建档的人，人物卡给「＋ 建档」', await lcard.getByRole('button', { name: '＋ 建档' }).isVisible());
  await page.keyboard.press('Escape');

  // 旧链接 /people 不再是页面
  await page.goto(`${BASE}/people`);
  await page.waitForTimeout(400);
  check('旧链接 /people 回到首页', !page.url().endsWith('/people'), page.url());
  await ctx.close();
}

// ── 人际弹窗 ──
for (const [theme, w] of [
  ['dark', 1440],
  ['light', 1440],
  ['dark', 1280],
]) {
  const { ctx, page } = await open(theme, w, 900, true);
  const side = await page.locator('.pp-side').innerText();
  const attn = await page.locator('.pp-group.attn .pp-row').allInnerTexts();
  check(`${theme} ${w}：「需要关注」一人一行：日子与没联系并在一行`, attn.length === 2 && /妈妈[\s\S]*生日 10 天 · 23 天没联系/.test(attn[0]) && /小美[\s\S]*生日 14 天/.test(attn[1]), attn.map((t) => t.replace(/\n/g, ' ')).join(' | '));
  check(`${theme} ${w}：@人 里没建档的「李工」可一键建档`, side.includes('＋ 李工'));
  if (w === 1440) await page.screenshot({ path: `${OUT}/people-welcome-${theme}.png` });
  await page.locator('.pp-row', { hasText: '小美' }).first().click();
  await page.waitForSelector('.pp-detail');
  const d = await page.locator('.pp-detail').innerText();
  check(`${theme} ${w}：档案页有近况（最新在前）`, /近况[\s\S]*准备教资考试[\s\S]*厦门/.test(d));
  check(`${theme} ${w}：重要日子按下一次排、带岁数 / 周年`, /生日\s*11 月 2 日\s*11\/2 · 还有 14 天 · 31 岁[\s\S]*恋爱纪念日\s*3 月 14 日\s*3\/14 · 还有 146 天 · 6 周年/.test(d), d.match(/重要日子[\s\S]{0,140}/)?.[0]?.replace(/\n/g, ' / '));
  const cols = await page.evaluate(() => {
    const a = document.querySelector('.pp-side').getBoundingClientRect();
    const b = document.querySelector('.pp-main').getBoundingClientRect();
    const d = document.querySelector('.pp').getBoundingClientRect();
    return { side: Math.round(a.width), sameTop: Math.abs(a.top - b.top) < 1, adj: Math.abs(b.left - a.right) < 1, av: Math.round(document.querySelector('.pp-head .dk-av').getBoundingClientRect().width), inView: d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth };
  });
  check(`${theme} ${w}：弹窗在屏内、左右两栏并排、头像 36px`, cols.sameTop && cols.adj && cols.side === 256 && cols.av === 36 && cols.inView, JSON.stringify(cols));
  const field = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.pp-field')].map((l) => {
      const k = l.querySelector('span').getBoundingClientRect();
      const t = l.querySelector('textarea').getBoundingClientRect();
      const sec = l.closest('.pp-sec').getBoundingClientRect();
      return { side: k.right <= t.left && Math.abs(k.top - t.top) < 10, wide: t.width > sec.width * 0.7 };
    });
    return { n: f.length, ok: f.every((x) => x.side && x.wide) };
  });
  check(`${theme} ${w}：喜欢 / 避开 / 背景：标签在左、输入框占满`, field.n === 3 && field.ok, JSON.stringify(field));
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.pp-main, .pp-side')].map((e) => e.scrollWidth - e.clientWidth)));
  check(`${theme} ${w}：无横向溢出`, overflow <= 0, String(overflow));
  await page.screenshot({ path: `${OUT}/people-detail-${theme}-${w}.png`, fullPage: false });
  await ctx.close();
}

// ── 人际弹窗交互（深色）──
{
  const { ctx, page } = await open('dark', 1440, 900, true);
  await page.locator('.pp-new input').click();
  await page.keyboard.type('王阿姨n'); // n 是工作台「新建」快捷键：弹窗里打字不能被抢走
  await page.keyboard.press('Backspace');
  check('弹窗里打字不触发工作台快捷键', (await page.locator('.dk-qa').count()) === 0 && (await page.locator('.pp-new input').inputValue()) === '王阿姨');
  await page.keyboard.press('Enter');
  check('左上角写名字回车 ⇒ 建档并选中', (await page.locator('.pp-name').inputValue()) === '王阿姨');

  // 农历生日
  await page.locator('.pp-sec', { hasText: '重要日子' }).getByRole('button', { name: '＋ 添加' }).click();
  const add = page.locator('.pp-dadd');
  await add.getByRole('radio', { name: '农历' }).click();
  await add.locator('[aria-label="月"]').selectOption('8');
  await add.locator('[aria-label="日"]').selectOption('15');
  await add.getByRole('button', { name: '添加' }).click();
  const dates = await page.locator('.pp-dates').innerText();
  // 农历八月十五 2027 = 2027-09-15（今年 09-25 已过）
  check('农历日子：显示「农历八月十五」，下一次是 2027-09-15', /农历八月十五\s*9\/15 · 还有 331 天/.test(dates), dates.replace(/\n/g, ' '));

  // 爱的语言、点子、喜好
  await page.locator('.pp-loves button', { hasText: '服务的行动' }).click();
  check('爱的语言可点选，下面给出怎么做', (await page.locator('.pp-sec', { hasText: '爱的语言' }).innerText()).includes('替 TA 做件事'));
  await page.locator('[aria-label="新点子"]').fill('想要一个泡脚桶');
  await page.keyboard.press('Enter');
  check('点子池回车记下', (await page.locator('.pp-ideas').innerText()).includes('泡脚桶'));
  await page.locator('[aria-label="喜欢"]').fill('跳广场舞');
  await page.locator('.pp-name').click(); // 失焦保存
  await page.waitForTimeout(100);
  const p = await st(page, () => Object.values(window.__store.getState().people).find((x) => x.name === '王阿姨'));
  check('档案字段落库（农历日子 / 爱的语言 / 点子 / 喜欢）', p?.dates?.[0]?.lunar === true && p?.loveLanguages?.[0] === 'service' && p?.ideas?.[0]?.text === '想要一个泡脚桶' && p?.likes === '跳广场舞', JSON.stringify(p));

  // 大号「记一笔」
  await page.locator('.pp-log [aria-label="聊了什么"]').fill('楼下碰到，聊了几句');
  await page.locator('.pp-log').getByRole('button', { name: '记一笔' }).click();
  check('记一笔后进互动记录', (await page.locator('.pp-timeline').innerText()).includes('楼下碰到'));
  await page.screenshot({ path: `${OUT}/people-edit-dark.png` });

  // 改名带跟进
  await page.locator('.pp-row', { hasText: '张经理' }).click();
  await page.waitForFunction(() => document.querySelector('.pp-name')?.value === '张经理');
  await page.locator('.pp-name').fill('张总');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const w1 = await st(page, () => window.__store.getState().workItems.w1.person);
  check('改名 ⇒ 没做完的 @人 跟进一起改名', w1 === '张总', w1);
  check('「要跟 TA 说的」列出 TA 的跟进', (await page.locator('.pp-detail').innerText()).includes('下周六晚停机窗口'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  check('Ctrl+Z 一次撤回改名（含跟进）', (await st(page, () => window.__store.getState().workItems.w1.person)) === '张经理');

  // @人 一键建档
  await page.locator('.pp-chip', { hasText: '李工' }).click();
  await page.waitForFunction(() => document.querySelector('.pp-name')?.value === '李工', null, { timeout: 3000 }).catch(() => {});
  check('点「＋ 李工」建档（默认同事）', (await page.locator('.pp-name').inputValue()) === '李工' && (await st(page, () => Object.values(window.__store.getState().people).find((x) => x.name === '李工')?.relation)) === 'colleague');
  await page.locator('.pp-new input').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('输入框里按 Esc 也能关弹窗', (await page.locator('.pp').count()) === 0);
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/Failed to load resource|supabase|net::ERR/i.test(e));
check('无页面报错', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
