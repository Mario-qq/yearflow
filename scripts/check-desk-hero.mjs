/**
 * 工作台头部自查（负责人 10-19：头部一行到底、尽量精简，学习卡在统计卡左边）。
 * 前置：vite dev（preview_start yearflow-dev）。跑法：node scripts/check-desk-hero.mjs [端口]
 *
 * 系统 Chrome + 空 context，示例甘特数据 + 两个长名字里程碑 + 学习设置 + 几条脉搏（紧急 / @人 / 要事）；
 * 1280 / 1440 / 1536（1920 屏 125% 缩放）/ 1920 × 深浅：头部只有一行、不横向溢出、学习卡与统计卡同高、
 * 统计卡三块（本周 / 学习 / 里程碑）都在。截图 docs/screenshots/desk/hero-*.png（只截头部 + 工具条）。
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

async function seed(page, theme) {
  await page.goto(`${BASE}/settings`);
  await page.waitForFunction(() => window.__store?.getState().hydrated);
  await page.evaluate(async (theme) => {
    const s = window.__store.getState();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    const t0 = fmt(today);
    const plus = (n) => fmt(new Date(today.getTime() + n * 864e5));
    const stamp = new Date().toISOString();
    let seq = 0;
    const it = (o) => ({ id: `w${seq++}`, kind: 'todo', urgency: 'normal', scope: 'work', status: 'open', order: seq, createdAt: `${t0}T08:00:00.000Z`, updatedAt: stamp, date: t0, ...o });
    const items = [
      it({ title: '请购导入和 MPS 导入的 URS', urgency: 'urgent', focusOn: t0 }),
      it({ title: '汇总周会材料', focusOn: t0 }),
      it({ kind: 'followup', title: '通知测试 apyi510', person: '徐蕊', mode: 'inform' }),
      it({ title: 'parking money', scope: 'life', time: '08:50' }),
    ];
    const { buildSeedBundle } = await import('/src/seed/seedData.ts');
    const bundle = buildSeedBundle(t0);
    const goals = bundle.goals.filter((g) => !g.archived);
    const ms = [
      { id: 'ms-a', goalId: goals[0].id, name: 'agent基础学习', date: plus(42), achieved: false, updatedAt: stamp },
      { id: 'ms-b', goalId: goals[1].id, name: 'SD模块流程基本了解与跨公司退货联调', date: plus(73), achieved: false, updatedAt: stamp },
    ];
    await s.replaceAllData({ ...bundle, milestones: [...ms], workItems: items, routines: [], routineLogs: [], dayMarks: [] });
    s.updateSettings({ theme, desk: { ...s.settings.desk, studyGoalIds: ['seed-goal-sap', 'seed-goal-english', 'seed-goal-agent'], anchor: { text: '', time: '09:30' } } });
  }, theme);
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const theme of ['light', 'dark']) {
  for (const w of [1280, 1440, 1536, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await seed(page, theme);
    await page.goto(`${BASE}/desk`);
    await page.waitForSelector('.dk-hero .dk-stats');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const hero = box('.dk-hero');
      const main = box('.dk-h-main');
      const study = box('.dk-h-study > *');
      const stats = box('.dk-stats');
      const h = document.querySelector('.dk-hero');
      return {
        heroH: hero.height,
        over: Math.max(document.documentElement.scrollWidth - innerWidth, h.scrollWidth - h.clientWidth),
        oneRow: study && Math.abs(main.top + main.height / 2 - (stats.top + stats.height / 2)) < 4 && Math.abs(study.top - stats.top) < 1,
        sameH: study && Math.abs(study.height - stats.height) < 1,
        studyW: study?.width,
        blocks: document.querySelectorAll('.dk-stats .dk-stat').length,
        whyH: document.querySelector('.dk-h-study .dk-st-why')?.getBoundingClientRect().height ?? 0,
      };
    });
    const tag = `${theme} ${w}`;
    check(`${tag}：头部一行（日期 ｜ 学习卡 ｜ 统计卡 同一水平线）`, r.oneRow);
    check(`${tag}：头部高度 ≤ 100px`, r.heroH <= 100, String(Math.round(r.heroH)));
    check(`${tag}：无横向溢出`, r.over <= 0, String(r.over));
    check(`${tag}：学习卡与统计卡同高、学习卡 ≥ 220px`, r.sameH && r.studyW >= 220, String(Math.round(r.studyW)));
    check(`${tag}：统计卡三块都在`, r.blocks === 3);
    check(`${tag}：学习卡说明行不折行`, r.whyH <= 22, String(Math.round(r.whyH)));
    await page.screenshot({ path: `${OUT}/hero-${theme}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 230 } });
    await ctx.close();
  }
}
check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
