/**
 * 年报 Y3 验收截图与断言（ANNUAL_SPEC §7.2 / §7.3 的 Y3 子集）：
 * beat 6–10 的关键文案与数字、[归档] 的 confirm + undo 栈 +1、
 * 长图 PNG 真实落盘且宽度符合 §4.5、打印样式（顶栏隐藏 / 强制浅色 / 全部 beat 可见）。
 *
 * 前置：dev server 已运行（YF_URL 指定端口）。运行：node scripts/capture-annual-y3.mjs
 * 环境两条（见 docs/PROGRESS.md）：
 * · 用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * · html-to-image 的 resolve 包在 rAF 里 ⇒ document.hidden 的窗口里导出永挂，
 *   所以导出这条只能在这里（真实 Chrome 前台页）验，不能在浏览器面板里验。
 */
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/annual';
// 长图原件 1800×8654（约 1.6 MB）不进仓库，只留一张缩略图作截图门槛的证据
const DL = mkdtempSync(join(tmpdir(), 'yearflow-annual-'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};
const shot = async (name, target = page.locator('main > div')) => {
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
};

// ── 种数据 ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(900);
await page.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await page.waitForSelector('.annual-beat', { timeout: 15_000 });

/**
 * 纯内存注入（不落库、不污染用户备份，goto 会丢掉，所以之后只做 SPA 内交互）：
 * · 专注会话 —— beat 9 节律热力唯一的数据源，示例数据刻意不含会话；
 * · 一个过期未达成的里程碑 —— beat 7 的全部叙事价值就在这一类（示例里两个都已达成）；
 * · 抹掉某个目标的全部记录 —— 造出 beat 8 的「静默超 30 天」，好测 [归档] 那条写库路径。
 */
await page.evaluate(() => {
  const st = window.__store.getState();
  const goalIds = Object.values(st.goals)
    .filter((g) => !g.deletedAt)
    .map((g) => g.id);
  const silent = 'seed-goal-ball';

  const sessions = {};
  let n = 0;
  for (let m = 1; m <= 8; m += 1) {
    for (let d = 2; d <= 26; d += 4) {
      const goalId = goalIds[(m + d) % goalIds.length];
      if (goalId === silent) continue;
      const date = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // 钟点刻意集中在 9/14/20 三档，热力图才有明显的强弱格
      const hour = [9, 14, 20, 21][(m + d) % 4];
      const startAt = new Date(2026, m - 1, d, hour, 5).toISOString();
      const focusMs = (20 + ((m * d) % 40)) * 60_000;
      const id = `seed-fs-${(n += 1)}`;
      sessions[id] = {
        id,
        goalId: d === 26 ? undefined : goalId,
        date,
        startAt,
        endAt: new Date(new Date(startAt).getTime() + focusMs).toISOString(),
        focusMs,
        plannedMs: 25 * 60_000,
        outcome: (m + d) % 5 === 0 ? 'stopped' : 'completed',
        source: 'timer',
        createdAt: startAt,
        updatedAt: startAt,
      };
    }
  }

  const checkIns = {};
  for (const [id, c] of Object.entries(st.checkIns)) {
    if (c.goalId !== silent) checkIns[id] = c;
  }

  const milestones = { ...st.milestones };
  milestones['inject-ms-overdue'] = {
    id: 'inject-ms-overdue',
    goalId: 'seed-goal-sap',
    name: 'MM 模块结课',
    date: '2026-05-20',
    achieved: false,
    updatedAt: new Date().toISOString(),
  };

  window.__store.setState({ focusSessions: sessions, checkIns, milestones });
});
await page.waitForTimeout(400);

// ── beat 6–10 的文案与数字 ────────────────────────────────────────────
const revealAll = async () => {
  await page.evaluate(() => {
    const el = document.querySelector('main');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.waitForTimeout(400);
};
await revealAll();

const text = await page.locator('main').innerText();
ok((await page.locator('.annual-beat').count()) === 11, `11 个 beat 全部在场（实际 ${await page.locator('.annual-beat').count()}）`);
ok(/个任务比原计划晚了，加起来推迟 \d+ 天/.test(text), 'beat 6 总推迟天数结论在场');
ok(/个任务没有基线，未参与统计/.test(text), 'beat 6 披露无基线任务数（否则「只推迟 3 天」会被误读）');
ok(/个过了日子仍未达成/.test(text), 'beat 7 区分「过期未达成」与「未到期」');
ok(/已到期里程碑的兑现率/.test(text), 'beat 7 兑现率分母只算已到期');
ok(/个目标已经静默超过 30 天/.test(text), 'beat 8 停滞结论在场');
ok(/最后一条记录|这个区间内没有任何记录/.test(text), 'beat 8 给出可申辩的原文（最后一条记录）');
ok(/你最能专注的时段是 周. \d+ 点/.test(text), 'beat 9 节律结论在场');
ok(/钟点与星期取开始时间/.test(text), 'beat 9 口径说明在场（date 归属 vs startAt 钟点）');
ok(/接下来：/.test(text), 'beat 10 收尾给出规则驱动的「接下来」');
ok(
  (await page.locator('main .recharts-wrapper').count()) === 0,
  '年报仍零 recharts（全仓唯一 import 点只有 AnnualOverview）',
);

// 深浅两主题逐 beat 落盘（Y3 只补 beat 6–10，Y2 的 0–5 已在 capture-annual.mjs 里）
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(300);
  await revealAll();
  const beats = page.locator('.annual-beat');
  for (let i = 6; i <= 10; i += 1) {
    const el = beats.nth(i);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(`annual-beat${i}-${theme}`, el);
  }
}
await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
await page.waitForTimeout(300);

// ── [归档]：confirm 文案 + 一条 undo ──────────────────────────────────
const undoBefore = await page.evaluate(() => window.__store.getState().undoStack.length);
let dialogText = '';
page.once('dialog', async (d) => {
  dialogText = d.message();
  await d.accept();
});
await page.locator('.annual-beat', { hasText: '停滞与放弃' }).getByRole('button', { name: '归档' }).first().click();
await page.waitForTimeout(500);
ok(/归档目标「.+」/.test(dialogText), `confirm 写明对象（实际：${dialogText.slice(0, 24)}…）`);
ok(/数据一条不删/.test(dialogText) && /Ctrl\+Z/.test(dialogText), 'confirm 写明后果与可撤销');
const undoAfter = await page.evaluate(() => window.__store.getState().undoStack.length);
ok(undoAfter === undoBefore + 1, `undo 栈恰好 +1（${undoBefore} → ${undoAfter}）`);
ok(
  await page.evaluate(() => Object.values(window.__store.getState().goals).some((g) => g.archived)),
  '目标已归档（走既有 patchGoal，一条命令）',
);
await page.evaluate(() => window.__store.getState().undo());
await page.waitForTimeout(400);
ok(
  (await page.evaluate(() => window.__store.getState().undoStack.length)) === undoBefore,
  'Ctrl+Z 后归档被撤销，栈回到原位',
);

// ── 长图导出（规格 §4.5）：真实落盘 + 宽度 900×2 ──────────────────────
await revealAll();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60_000 }),
  page.getByRole('button', { name: '导出长图' }).click(),
]);
const file = `${DL}/${download.suggestedFilename()}`;
await download.saveAs(file);
const size = statSync(file).size;
ok(/^yearflow-year-2026-full(-\dof\d)?\.png$/.test(download.suggestedFilename()), `文件名符合约定：${download.suggestedFilename()}`);
ok(size > 50_000, `长图真实落盘（${(size / 1024).toFixed(0)} kB）`);
// 从落盘的 PNG 头读真实像素尺寸（IHDR 的宽高固定在第 16..24 字节）
const buf = readFileSync(file);
const pngW = buf.readUInt32BE(16);
const pngH = buf.readUInt32BE(20);
ok(pngW === 1800, `长图宽 = 900 CSS px × scale 2 = 1800 实际像素（实测 ${pngW}）`);
ok(pngH <= 40_000, `长图高 ${pngH} px 在单张上限内（CSS 上限 20000 × 2）`);
console.log(`  长图尺寸：${pngW} × ${pngH}`);

/**
 * 「不是白板」这一条必须验（Y3 实测踩到过）：把离屏舞台本身交给 html-to-image 时，
 * `position:fixed; left:-100000px` 在 SVG <foreignObject> 里照样生效，内容被推出画布，
 * 导出的是一张只有背景色的图 —— 尺寸、文件大小、文件名全都对，只有像素是空的。
 * 所以这里把落盘的 PNG 送回浏览器解码，数一遍非背景像素。
 */
const nonBg = await page.evaluate(
  ([dataUrl]) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = Math.min(3000, img.height);
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const base = `${d[0]},${d[1]},${d[2]}`;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== base) n += 1;
        }
        resolve(n);
      };
      img.onerror = () => reject(new Error('PNG 解码失败'));
      img.src = dataUrl;
    }),
  [`data:image/png;base64,${buf.toString('base64')}`],
);
ok(nonBg > 200_000, `长图有真实内容，不是只有背景色的白板（前 3000 行里 ${nonBg} 个非背景像素）`);

// 缩略图（规格 §7.3 的「导出长图缩略 1 张」）：原件太大不进仓库
const thumb = await page.evaluate(
  ([dataUrl, w]) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = Math.round((img.height / img.width) * w);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = () => reject(new Error('PNG 解码失败'));
      img.src = dataUrl;
    }),
  [`data:image/png;base64,${buf.toString('base64')}`, 450],
);
writeFileSync(`${OUT}/annual-export-thumb.png`, Buffer.from(thumb, 'base64'));
console.log(`  → ${OUT}/annual-export-thumb.png`);

// ── 打印样式（规格 §4.5） ─────────────────────────────────────────────
await page.emulateMedia({ media: 'print' });
// beforeprint 由真实打印触发，这里手动派发以验证强制浅色那条路径
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
await page.waitForTimeout(300);
ok(
  (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light',
  'beforeprint 强制浅色（临时改 data-theme，不写 store）',
);
ok(
  (await page.locator('[data-annual-noprint]').first().isVisible()) === false,
  '打印下顶部条与页内按钮隐藏',
);
// 切到 print media 会让还停在淡入过程中的 beat 走完 420ms 的 transition，
// 不等就会读到 0.9997 这种中间值（实测），那不是失败，只是没量到终点
await page.waitForTimeout(700);
const opacities = await page.evaluate(() =>
  [...document.querySelectorAll('.annual-beat')].map((el) => getComputedStyle(el).opacity),
);
ok(
  opacities.every((o) => Number(o) === 1),
  `打印下全部 beat 可见（含没滚到的）：${opacities.join(',')}`,
);
ok(
  (await page.evaluate(() => getComputedStyle(document.querySelector('main')).overflow)) === 'visible',
  '打印下解开 main 的 overflow（否则只印一屏）',
);
ok(
  (await page.evaluate(() =>
    getComputedStyle(document.querySelector('.annual-print-title')).display,
  )) === 'block',
  '打印下标题行顶替被隐藏的顶部条',
);
await shot('annual-print-light', page.locator('main > div'));
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
await page.emulateMedia({ media: 'screen' });

// ── 深色主题：切回并确认 afterprint 已还原 ────────────────────────────
await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
await page.waitForTimeout(300);
ok(
  (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
  'afterprint 后主题还原，不残留浅色',
);

await browser.close();
console.log('\n全部通过。');
