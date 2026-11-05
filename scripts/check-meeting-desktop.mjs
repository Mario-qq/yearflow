/**
 * 会议提醒·桌面版自查（生产构建 app://，独立 userData，不碰真实数据）：
 * 一句话新建「HH:mm 周会 …」（开始 = 现在 + 2 分钟，默认提前 10 分钟 ⇒ 下一轮轮询就该提醒）
 * → 断言主进程弹了系统通知、页面挂了横幅、点「知道了」收起；截图 screenshots/meeting/。
 * 前置：npm run electron:build（且没有 vite 在跑）。跑法：node scripts/check-meeting-desktop.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'screenshots/meeting';
const PROFILE = join(tmpdir(), 'yearflow-meeting-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
}

const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
// 记下主进程每一条系统通知（照常弹出）
await app.evaluate(({ Notification }) => {
  globalThis.__shown = [];
  const orig = Notification.prototype.show;
  Notification.prototype.show = function () {
    globalThis.__shown.push(`${this.title}|${this.body}`);
    return orig.call(this);
  };
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
await until(() => win.evaluate(() => location.pathname.startsWith('/desk')));
await win.waitForSelector('.dk-fab', { timeout: 20000 });

const d = new Date(Date.now() + 2 * 60000);
const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
await win.click('.dk-fab');
await win.fill('.dk-qa-in', `${hm} 周会 桌面验收`);
const chips = await win.locator('.dk-qa-prev').innerText();
check('一句话预览认出会议与提醒', chips.includes('会议') && chips.includes(hm) && chips.includes('提前 10 分钟'), chips.replace(/\n/g, ' '));
await win.screenshot({ path: `${OUT}/quickadd.png` });
await win.keyboard.press('Enter');
await win.keyboard.press('Escape');
const row = await until(() => win.locator('.dk-row', { hasText: '周会 桌面验收' }).count());
check('工作台出现会议行', Boolean(row));
const rowText = await win.locator('.dk-row', { hasText: '周会 桌面验收' }).first().innerText();
check('行首显示开始时间', rowText.includes(hm), rowText.replace(/\n/g, ' '));
check('行上有提醒铃铛', (await win.locator('.dk-row', { hasText: '周会 桌面验收' }).locator('.bell').count()) === 1);

const banner = await until(() => win.locator('.mt-alert').count(), 40000);
check('页面挂出会议提醒横幅', Boolean(banner));
const shown = await app.evaluate(() => globalThis.__shown);
check('主进程弹了系统通知', shown.some((s) => s.includes('周会 桌面验收')), JSON.stringify(shown));
await win.screenshot({ path: `${OUT}/alert-desktop.png` });
await win.click('.mt-alert-x');
check('点「知道了」收起', (await win.locator('.mt-alert').count()) === 0);

// 不重复提醒：再等一轮轮询
await new Promise((r) => setTimeout(r, 22000));
const again = await app.evaluate(() => globalThis.__shown.length);
const all = await app.evaluate(() => globalThis.__shown);
check("同一条提醒不重发", all.filter((s) => s.includes("周会 桌面验收")).length === 1, JSON.stringify(all));

await app.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
