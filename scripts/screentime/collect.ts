/**
 * 屏幕时间采集（电脑端，Windows 计划任务每个工作日 9:00 起每 30 分钟跑一次，成功一次后当天其余跳过）
 *
 *   npx tsx scripts/screentime/collect.ts login            首次：登录 YearFlow 云同步账号（自己在终端输密码）
 *   npx tsx scripts/screentime/collect.ts connect IP:端口   手机「无线调试」页显示的地址，记下来以后自动连
 *   npx tsx scripts/screentime/collect.ts run [--force]    采集 + 自动打卡（计划任务跑的就是它）
 *   npx tsx scripts/screentime/collect.ts show 2026-10-12  只读：打印某天各应用分钟数，不写云端（对数用）
 *
 * 数据链路：hdc 读手机系统事件日志（AAFWK ABILITY_ONFOREGROUND/ONBACKGROUND）→ 算每个应用前台分钟
 * → upsert screen_time_days → 按任务的 screenTime 规则 upsert check_ins → 各端经既有云同步拿到。
 * 只确认「昨天及更早」的完整日；周一一次补齐周五~周日；漏跑的日子下次自动补（日志至少留 3 周）。
 *
 * 本机状态都在 %APPDATA%/YearFlow/screentime/（登录凭据、设备地址、进度、日志），不进仓库。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { nanoid } from 'nanoid';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dayjs, fmtDay } from '../../src/lib/date';
import {
  computeAppMinutes,
  planScreenTimeCheckIns,
  type AbilityEvent,
} from '../../src/lib/derive/screenTime';
import { appLabel, isSystemBundle } from '../../src/lib/screenTimeApps';
import type { CheckIn, ExemptionPeriod, Goal, ScreenTimeDay, Task } from '../../src/types/domain';

const REPO = resolve(import.meta.dirname, '../..');
const HOME = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData/Roaming'), 'YearFlow/screentime');
const AUTH_FILE = join(HOME, 'auth.json'); // { refreshToken }
const CONFIG_FILE = join(HOME, 'config.json'); // { device?: 'ip:port', hdc?: 路径 }
const STATE_FILE = join(HOME, 'state.json'); // { lastCollected?: 日期, lastSuccessDay?: 日期, lastNotifyDay?: 日期 }
const LOG_FILE = join(HOME, 'collect.log');

const BACKFILL_DAYS = 14; // 首次运行回填天数（日志实测至少保留 3 周）
const MAX_CATCHUP_DAYS = 20; // 断档太久时最多补这么多天
const RECHECK_DAYS = 7; // 每次对最近 N 天已采数据按最新规则重算（改了规则一周内自动生效）
const LOOK_MS = 6 * 3600_000; // 日界外前后多拉 6 小时事件，找跨零点会话的头和尾
const CHUNK_MS = 6 * 3600_000; // hisysevent 单次查询的时间窗（-m 上限 5000 条）
const MAX_EVENTS = 5000;

mkdirSync(HOME, { recursive: true });

// ---------- 小工具 ----------

function log(msg: string): void {
  const line = `${dayjs().format('YYYY-MM-DD HH:mm:ss')} ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

const writeJSON = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v, null, 2));

function loadEnv(): { url: string; anonKey: string } {
  const text = readFileSync(join(REPO, '.env.local'), 'utf-8');
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  const url = get('VITE_SUPABASE_URL');
  const anonKey = get('VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('.env.local 缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  return { url, anonKey };
}

function run(file: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((ok, fail) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) fail(err);
      else ok(stdout);
    });
  });
}

/** Windows 右下角通知（失败才弹，一天最多一次；成功只记日志） */
async function notify(title: string, body: string): Promise<void> {
  const esc = (s: string) => s.replace(/'/g, "''");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text')
$t.Item(0).AppendChild($x.CreateTextNode('${esc(title)}')) > $null
$t.Item(1).AppendChild($x.CreateTextNode('${esc(body)}')) > $null
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 20_000);
  } catch (e) {
    log(`通知弹出失败：${(e as Error).message}`);
  }
}

// ---------- 手机（hdc） ----------

function hdcPath(): string {
  const cfg = readJSON<{ hdc?: string }>(CONFIG_FILE, {});
  const candidates = [
    cfg.hdc,
    'E:/software/DevEco/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe',
    'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe',
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('找不到 hdc.exe：在 config.json 里写 {"hdc": "…/toolchains/hdc.exe"}');
  return found;
}

async function listTargets(hdc: string): Promise<string[]> {
  const out = await run(hdc, ['list', 'targets'], 20_000);
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('[Empty]'));
}

/** 已连着（USB 或之前的无线）就直接用；否则按记下的地址 tconn 一次 */
async function ensureDevice(hdc: string): Promise<string | null> {
  let targets = await listTargets(hdc);
  if (targets.length > 0) return targets[0];
  const { device } = readJSON<{ device?: string }>(CONFIG_FILE, {});
  if (!device) return null;
  try {
    const out = await run(hdc, ['tconn', device], 30_000);
    log(`tconn ${device}：${out.trim()}`);
  } catch (e) {
    log(`tconn ${device} 失败：${(e as Error).message}`);
  }
  targets = await listTargets(hdc);
  return targets[0] ?? null;
}

const shell = (hdc: string, target: string, cmd: string) => run(hdc, ['-t', target, 'shell', cmd], 90_000);

async function queryEvents(hdc: string, target: string, name: string, from: number, to: number): Promise<AbilityEvent[]> {
  const out = await shell(hdc, target, `hisysevent -l -s ${from} -e ${to} -c WHOLE_WORD -o AAFWK -n ${name} -m ${MAX_EVENTS}`);
  const rows = out.split(/\r?\n/).filter((l) => l.startsWith('{'));
  if (rows.length >= MAX_EVENTS) {
    // 6 小时 5000 条几乎不可能；真撞上就对半拆，宁慢勿漏
    const mid = Math.floor((from + to) / 2);
    return [
      ...(await queryEvents(hdc, target, name, from, mid)),
      ...(await queryEvents(hdc, target, name, mid, to)),
    ];
  }
  const fg = name === 'ABILITY_ONFOREGROUND';
  return rows.flatMap((l) => {
    try {
      const j = JSON.parse(l) as { time_: number; BUNDLE_NAME?: string; ABILITY_NAME?: string };
      return j.BUNDLE_NAME ? [{ time: j.time_, fg, bundle: j.BUNDLE_NAME, ability: j.ABILITY_NAME ?? '' }] : [];
    } catch {
      return [];
    }
  });
}

/** 某天各应用前台分钟；当天一条事件都没有（关机/日志已过期）返回 null，不当作「0 使用」写库 */
async function collectDay(hdc: string, target: string, date: string): Promise<Record<string, number> | null> {
  const dayStart = dayjs(date).startOf('day').valueOf();
  const dayEnd = dayjs(date).add(1, 'day').startOf('day').valueOf();
  const from = dayStart - LOOK_MS;
  const to = Math.min(dayEnd + LOOK_MS, Date.now());
  const events: AbilityEvent[] = [];
  for (let s = from; s < to; s += CHUNK_MS) {
    const e = Math.min(s + CHUNK_MS, to);
    events.push(...(await queryEvents(hdc, target, 'ABILITY_ONFOREGROUND', s, e)));
    events.push(...(await queryEvents(hdc, target, 'ABILITY_ONBACKGROUND', s, e)));
  }
  if (!events.some((e) => e.time >= dayStart && e.time < dayEnd)) return null;
  return computeAppMinutes(events, dayStart, dayEnd);
}

// ---------- 云端 ----------

async function connectCloud(): Promise<SupabaseClient> {
  const { url, anonKey } = loadEnv();
  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { refreshToken } = readJSON<{ refreshToken?: string }>(AUTH_FILE, {});
  if (!refreshToken) throw new Error('还没登录：先跑 npx tsx scripts/screentime/collect.ts login');
  const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new Error(`登录已失效（${error?.message ?? '无会话'}），重新跑 login`);
  // refresh token 一次性轮换：必须立刻存新的，否则下次就失效
  writeJSON(AUTH_FILE, { refreshToken: data.session.refresh_token });
  return sb;
}

async function selectAll<T>(sb: SupabaseClient, table: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('data').range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`读取 ${table} 失败：${error.message}`);
    out.push(...(data as { data: T }[]).map((r) => r.data));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function upsert(sb: SupabaseClient, table: string, rows: Array<{ id: string; updatedAt: string; deletedAt?: string }>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((e) => ({ id: e.id, data: e, updated_at: e.updatedAt, deleted_at: e.deletedAt ?? null }));
    const { error } = await sb.rpc('upsert_rows', { p_table: table, p_rows: chunk });
    if (error) throw new Error(`写入 ${table} 失败：${error.message}`);
  }
}

// ---------- 命令 ----------

interface State {
  lastCollected?: string;
  lastSuccessDay?: string;
  lastNotifyDay?: string;
}

async function cmdRun(force: boolean): Promise<void> {
  const state = readJSON<State>(STATE_FILE, {});
  const today = fmtDay(dayjs());
  const yesterday = fmtDay(dayjs().subtract(1, 'day'));
  if (!force && state.lastSuccessDay === today) {
    log('今天已经同步过，跳过');
    return;
  }

  const fail = async (title: string, body: string) => {
    log(`失败：${title} ${body}`);
    if (state.lastNotifyDay !== today) {
      await notify(title, body);
      writeJSON(STATE_FILE, { ...readJSON<State>(STATE_FILE, {}), lastNotifyDay: today });
    }
    process.exitCode = 1;
  };

  let sb: SupabaseClient;
  try {
    sb = await connectCloud();
  } catch (e) {
    return fail('YearFlow 屏幕时间：云端登录失效', `${(e as Error).message}`);
  }

  const hdc = hdcPath();
  const target = await ensureDevice(hdc);
  if (!target) {
    return fail(
      'YearFlow 屏幕时间：连不上手机',
      '打开手机「开发者选项 → 无线调试」，再运行 screentime:connect 填页面上的 IP:端口；半小时后自动重试',
    );
  }

  // 要采的日子：上次之后到昨天（首次回填 BACKFILL_DAYS 天，断档最多补 MAX_CATCHUP_DAYS 天）
  const floor = dayjs().subtract(MAX_CATCHUP_DAYS, 'day');
  let start = state.lastCollected ? dayjs(state.lastCollected).add(1, 'day') : dayjs().subtract(BACKFILL_DAYS, 'day');
  if (start.isBefore(floor)) start = floor;
  const toCollect: string[] = [];
  for (let d = start; fmtDay(d) <= yesterday; d = d.add(1, 'day')) toCollect.push(fmtDay(d));

  const now = new Date().toISOString();
  const collected: ScreenTimeDay[] = [];
  for (const date of toCollect) {
    try {
      const apps = await collectDay(hdc, target, date);
      if (!apps) {
        log(`${date}：手机日志里没有这天的记录，跳过`);
        continue;
      }
      collected.push({ id: date, date, apps, collectedAt: now, updatedAt: now });
      const top = Object.entries(apps)
        .filter(([b]) => !isSystemBundle(b))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([b, m]) => `${appLabel(b)} ${Math.round(m)}分`)
        .join('、');
      log(`${date}：${top || '无应用使用'}`);
    } catch (e) {
      return fail('YearFlow 屏幕时间：读手机日志失败', `${date}：${(e as Error).message}`);
    }
  }
  try {
    await upsert(sb, 'screen_time_days', collected);
  } catch (e) {
    return fail('YearFlow 屏幕时间：写云端失败', (e as Error).message);
  }

  // 规则打卡：新采的日子 + 最近 RECHECK_DAYS 天已有数据（改了规则自动回溯一周）
  const recheckFrom = fmtDay(dayjs().subtract(RECHECK_DAYS, 'day'));
  const firstDay = [recheckFrom, ...collected.map((c) => c.date)].sort()[0];
  try {
    const [goals, tasks, exemptions, checkIns, days] = await Promise.all([
      selectAll<Goal>(sb, 'goals'),
      selectAll<Task>(sb, 'tasks'),
      selectAll<ExemptionPeriod>(sb, 'exemptions'),
      selectAll<CheckIn>(sb, 'check_ins', (q) => q.gte('data->>date', firstDay)),
      selectAll<ScreenTimeDay>(sb, 'screen_time_days', (q) => q.gte('data->>date', firstDay)),
    ]);
    const ruled = tasks.filter((t) => !t.deletedAt && t.screenTime && t.screenTime.apps.length > 0);
    const writes: CheckIn[] = [];
    const ts = new Date().toISOString();
    for (const day of days.filter((d) => !d.deletedAt && d.date <= yesterday).sort((a, b) => a.date.localeCompare(b.date))) {
      const ops = planScreenTimeCheckIns({
        date: day.date,
        apps: day.apps,
        goals,
        tasks: ruled,
        checkIns,
        exemptions,
        label: appLabel,
        now: ts,
        newId: () => nanoid(),
      });
      for (const op of ops) {
        if (op.type === 'delete') writes.push({ ...op.before, deletedAt: ts, updatedAt: ts });
        else writes.push(op.after);
        const name = tasks.find((t) => t.id === (op.type === 'delete' ? op.before : op.after).taskId)?.name;
        log(`  ${day.date} ${name}：${op.type === 'delete' ? '撤销自动打卡' : `${op.after.status}${op.after.minutes ? ` ${op.after.minutes}分` : ''}`}`);
      }
    }
    await upsert(sb, 'check_ins', writes);
    log(`完成：采集 ${collected.length} 天，规则任务 ${ruled.length} 个，打卡变更 ${writes.length} 条`);
  } catch (e) {
    return fail('YearFlow 屏幕时间：自动打卡失败', (e as Error).message);
  }

  const lastCollected = collected.length > 0 ? collected[collected.length - 1].date : state.lastCollected;
  writeJSON(STATE_FILE, { ...readJSON<State>(STATE_FILE, {}), lastCollected, lastSuccessDay: today });
}

async function cmdShow(date: string): Promise<void> {
  const hdc = hdcPath();
  const target = await ensureDevice(hdc);
  if (!target) throw new Error('连不上手机');
  const apps = await collectDay(hdc, target, date);
  if (!apps) return console.log(`${date}：手机日志里没有这天的记录`);
  for (const [b, m] of Object.entries(apps).filter(([b]) => !isSystemBundle(b)).sort((a, b) => b[1] - a[1])) {
    console.log(`${m.toFixed(1).padStart(7)} 分  ${appLabel(b)}${appLabel(b) === b ? '' : `（${b}）`}`);
  }
}

async function cmdConnect(addr: string | undefined): Promise<void> {
  if (!addr || !/^[\d.]+:\d+$/.test(addr)) throw new Error('用法：connect 192.168.1.23:12345（手机「无线调试」页上显示的地址）');
  const hdc = hdcPath();
  console.log((await run(hdc, ['tconn', addr], 30_000)).trim());
  const targets = await listTargets(hdc);
  if (!targets.includes(addr)) throw new Error(`没连上 ${addr}，当前设备：${targets.join(', ') || '无'}`);
  writeJSON(CONFIG_FILE, { ...readJSON(CONFIG_FILE, {}), device: addr });
  console.log(`已连上并记住 ${addr}`);
}

async function cmdLogin(): Promise<void> {
  const { url, anonKey } = loadEnv();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((ok) => rl.question(q, ok));
  const email = await ask('YearFlow 云同步邮箱：');
  const password = await ask('密码（输入可见，只发给 Supabase，不落盘）：');
  rl.close();
  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) throw new Error(`登录失败：${error?.message ?? '无会话'}`);
  writeJSON(AUTH_FILE, { refreshToken: data.session.refresh_token });
  console.log(`已登录 ${data.user?.email}，凭据存在 ${AUTH_FILE}`);
}

const [cmd, arg] = process.argv.slice(2);
const main =
  cmd === 'login' ? cmdLogin()
  : cmd === 'connect' ? cmdConnect(arg)
  : cmd === 'show' ? cmdShow(arg ?? fmtDay(dayjs().subtract(1, 'day')))
  : cmd === 'run' ? cmdRun(process.argv.includes('--force'))
  : Promise.reject(new Error('用法：collect.ts login | connect IP:端口 | run [--force] | show [日期]'));

main.catch((e) => {
  log(`错误：${(e as Error).message}`);
  process.exitCode = 1;
});
