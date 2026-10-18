/**
 * 桌面版「每日自动备份 + 整库回滚」自查（DESK_SPEC §七）。走打包形态（app:// 协议）。
 *
 * 前置：npm run electron:build
 * 跑法：node scripts/check-desk-backup.mjs
 *
 * ⚠️ 跑在独立 userData 里（--user-data-dir），绝不碰真实 profile 与真实备份目录。
 */
import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'screenshots/desk';
const PROFILE = join(tmpdir(), 'yearflow-desk-backup-profile');
const BACKUPS = join(PROFILE, 'backups');
const MIRROR = join(tmpdir(), 'yearflow-desk-backup-mirror');
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const files = (kind) => (existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.endsWith(`-${kind}.json`)) : []);

rmSync(PROFILE, { recursive: true, force: true });
rmSync(MIRROR, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.', `--user-data-dir=${PROFILE}`], env });
const page = await app.firstWindow();
page.on('dialog', (d) => void d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.waitForLoadState('domcontentloaded');

// 1. 每天首次启动自动备份
const daily = await until(() => files('daily').length === 1);
check('首次启动写了一份每日备份', !!daily, readdirSync(BACKUPS).join(', '));
const json = JSON.parse(readFileSync(join(BACKUPS, files('daily')[0]), 'utf8'));
check('备份是标准导出格式且含工作台四张表', json.app === 'yearflow' && ['workItems', 'routines', 'routineLogs', 'dayMarks'].every((k) => Array.isArray(json.data[k])));

// 2. 设置页：载入示例前自动备份一份「操作前」
await page.getByRole('link', { name: '设置' }).first().click();
await until(() => page.getByText('备份与回滚').count());
check('桌面版设置页有「备份与回滚」', (await page.getByText('备份与回滚').count()) > 0);
await page.getByRole('button', { name: '载入示例数据' }).click();
check('载入示例前写了一份操作前备份', !!(await until(() => files('pre').length === 1)));
await until(() => page.getByText('目标 5').count());

// 3. 选每日备份（空库）→ 看差异 → 回滚
const rows = page.locator('section:has(h2:text("备份与回滚")) li button');
await until(async () => (await rows.count()) >= 2);
check('列表自动刷新出两份备份', (await rows.count()) >= 2, String(await rows.count()));
await rows.filter({ hasText: '每日' }).first().click();
const diffText = await until(async () => {
  const t = await page.locator('section:has(h2:text("备份与回滚"))').innerText();
  return t.includes('回滚会改动') ? t : null;
});
check('选中后显示回滚会改动什么', !!diffText && diffText.includes('目标 5'), diffText?.match(/回滚会改动：[^\n]*/)?.[0]);
await page.screenshot({ path: `${OUT}/backup-rollback.png` });
await page.getByRole('button', { name: '回滚到这一刻' }).click();
check('回滚后目标清零', !!(await until(() => page.getByText('目标 0').count())));
check('回滚前又备份了当前状态（可以再回滚）', !!(await until(() => files('pre').length === 2)));

// 4. 保留份数与文件名防穿越
const api = 'window.yearflowDesktop';
for (let i = 0; i < 12; i++) await page.evaluate(`${api}.backupWrite('{}', 'pre')`);
check('操作前备份只留 10 份', files('pre').length === 10, String(files('pre').length));
const traversal = await page.evaluate(`${api}.backupRead('../pip-window.json').then(() => 'read', (e) => String(e))`);
check('读备份拒绝目录穿越', traversal.includes('非法备份文件名'), traversal);

// 5. 另存一份到自选目录（异地兜底）。系统选目录对话框在主进程里换成桩
const sec = page.locator('section:has(h2:text("备份与回滚"))');
check('未设置时提示另存的理由', (await sec.innerText()).includes('重装系统'));
const stubDialog = (dir) => app.evaluate(({ dialog }, d) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] });
}, dir);
mkdirSync(MIRROR, { recursive: true });
writeFileSync(join(MIRROR, 'my-notes.txt'), '负责人自己的文件');
await stubDialog(MIRROR);
await page.getByRole('button', { name: '选择文件夹' }).click();
const mirrored = () => readdirSync(MIRROR).filter((f) => f.endsWith('-daily.json'));
check('选好目录立刻另存最新一份每日备份', !!(await until(() => mirrored().length === 1)), readdirSync(MIRROR).join(', '));
check('设置页显示另存目录与时间', !!(await until(async () => (await sec.innerText()).includes('上次另存'))));
await page.screenshot({ path: `${OUT}/backup-mirror.png` });
for (let i = 0; i < 35; i++) writeFileSync(join(MIRROR, `yearflow-202001${String(i % 28 + 1).padStart(2, '0')}-0000${String(i).padStart(2, '0')}000-daily.json`), '{}');
await page.evaluate(`${api}.backupWrite('{}', 'daily')`);
check('另存目录同样只留 30 份每日备份', mirrored().length === 30, String(mirrored().length));
check('另存目录里别的文件不碰', existsSync(join(MIRROR, 'my-notes.txt')));
check('另存的是最新那份', mirrored().sort().pop() === files('daily').sort().pop());
check('另存目录存进本机偏好', JSON.parse(readFileSync(join(PROFILE, 'shell-prefs.json'), 'utf8')).backupMirrorDir === MIRROR);
rmSync(MIRROR, { recursive: true, force: true });
const nDaily = files('daily').length;
await page.evaluate(`${api}.backupWrite('{}', 'daily')`);
const m = await page.evaluate(`${api}.backupMirror()`);
check('目录没了：本机备份照写，另存记下失败原因', files('daily').length >= nDaily && !!m.error, m.error);
await stubDialog(BACKUPS);
await page.getByRole('button', { name: '更换' }).click();
check('不许选本机备份目录本身', !!(await until(async () => (await sec.innerText()).includes('不能选本机备份文件夹'))));
await page.getByRole('button', { name: '不再另存' }).click();
check('不再另存后回到未设置', !!(await until(async () => (await sec.innerText()).includes('未设置'))));

check('无页面错误', errors.length === 0, errors.join(' | '));
await app.close();
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
