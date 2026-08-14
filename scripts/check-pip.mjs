/**
 * 悬浮小窗（Document PiP）实测：本机浏览器面板建不出 PiP 窗口
 * （`InvalidStateError: Internal error: no window`），必须用系统 Chrome 有头模式跑这一条。
 *
 * 前置：dev server 已运行。运行：node scripts/check-pip.mjs
 * 检查三件事：小窗真的建出来了 / 样式表搬过去了（背景色不是透明） / 三种形态的文案正确。
 *
 * ⚠️ 小窗里的控制键全是图标按钮（没有文字），断言与点击一律走 aria-label，别再找 textContent。
 */
import { chromium } from 'playwright';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

const pipInfo = () =>
  page.evaluate(() => {
    const w = window.documentPictureInPicture?.window;
    if (!w) return { open: false, err: String(window.__pipError ?? '') };
    return {
      open: true,
      theme: w.document.documentElement.dataset.theme,
      sheets: w.document.head.querySelectorAll('style,link').length,
      bg: w.getComputedStyle(w.document.body).backgroundColor,
      size: [w.innerWidth, w.innerHeight],
      title: w.document.title,
      text: w.document.body.innerText.replace(/\n/g, ' | '),
      buttons: Array.from(w.document.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    };
  });

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(800);

// ① 空闲态开窗（点击提供 transient user activation）
await page.getByRole('button', { name: '番茄钟' }).click();
await page.getByRole('button', { name: '悬浮小窗', exact: true }).click();
await page.waitForTimeout(600);
console.log('① 空闲：', JSON.stringify(await pipInfo(), null, 0));

// ② 专注中（3 秒一段，随后自动进休息）
await page.evaluate(() => {
  const st = window.__store.getState();
  st.updateSettings({ pomodoro: { ...st.settings.pomodoro, autoBreak: true, shortBreakMin: 5 } });
  const t = Object.values(st.tasks)[0];
  window.__pomodoro.start({ plannedMs: 3000, goalId: t.goalId, taskId: t.id });
});
await page.waitForTimeout(800);
console.log('② 专注中：', JSON.stringify(await pipInfo(), null, 0));

// ③ 到点：alert 醒目态 + 已自动进入休息
await page.waitForTimeout(3200);
console.log('③ 到点提醒：', JSON.stringify(await pipInfo(), null, 0));
console.log(
  '   运行态：',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__pomodoro.store.getState();
      return { phase: s.running?.phase, alert: s.alert?.kind };
    }),
  ),
);

// ④ 点「知道了」回到常规形态（休息倒计时）
await page.evaluate(() => {
  const w = window.documentPictureInPicture.window;
  w.document.querySelector('button[aria-label="知道了"]')?.click();
});
await page.waitForTimeout(400);
console.log('④ 确认后：', JSON.stringify(await pipInfo(), null, 0));

// ⑤ 深色主题跟随
await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
await page.waitForTimeout(400);
console.log('⑤ 深色：', JSON.stringify(await pipInfo(), null, 0));

await browser.close();
