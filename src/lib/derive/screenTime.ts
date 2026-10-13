import type {
  CheckIn,
  CheckInStatus,
  ExemptionPeriod,
  Goal,
  ScreenTimeRule,
  Task,
} from '../../types/domain';
import { toDay } from '../date';
import { isExempt, isScheduledDow } from './scheduled';

/**
 * 屏幕时间 → 打卡（纯函数）。数据来源：电脑端 scripts/screentime 经 hdc 读手机系统事件日志
 * （AAFWK ABILITY_ONFOREGROUND / ABILITY_ONBACKGROUND）。鸿蒙不给三方应用读使用统计的接口，
 * 这是唯一的全自动路径；口径已与系统「使用时长统计」对照（2026-10-12 全天误差 < 1 分钟）。
 */

/** 一条前后台事件（hisysevent 行的最小子集） */
export interface AbilityEvent {
  time: number; // 毫秒时间戳
  fg: boolean; // true = ONFOREGROUND，false = ONBACKGROUND
  bundle: string;
  ability: string;
}

/**
 * 一天内各应用的前台分钟（一位小数）。
 * - 以 bundle+ability 配对前台→后台得到会话；同一应用多个 ability 的会话取并集，不重复计时
 * - 会话按 [dayStart, dayEnd) 裁剪：跨零点的会话两天各算各的
 *   （调用方须多拉日界外的事件：前看几小时找跨零点会话的开头，后看到次日找结尾）
 * - 没有后台事件的会话（系统组件常见，或日志在会话中途被截断）止于下一个其它应用的前台事件；
 *   之后再无事件则丢弃 —— 宁可少算，不造出几小时的假时长
 */
export function computeAppMinutes(
  events: AbilityEvent[],
  dayStart: number,
  dayEnd: number,
): Record<string, number> {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const intervals = new Map<string, Array<[number, number]>>();
  const push = (bundle: string, s: number, e: number) => {
    const from = Math.max(s, dayStart);
    const to = Math.min(e, dayEnd);
    if (to <= from) return;
    let list = intervals.get(bundle);
    if (!list) intervals.set(bundle, (list = []));
    list.push([from, to]);
  };

  const open = new Map<string, { bundle: string; start: number }>();
  for (const ev of sorted) {
    const key = `${ev.bundle}|${ev.ability}`;
    if (ev.fg) {
      if (!open.has(key)) open.set(key, { bundle: ev.bundle, start: ev.time });
    } else {
      const o = open.get(key);
      if (o) {
        push(o.bundle, o.start, ev.time);
        open.delete(key);
      }
    }
  }
  for (const o of open.values()) {
    const next = sorted.find((ev) => ev.fg && ev.time > o.start && ev.bundle !== o.bundle);
    if (next) push(o.bundle, o.start, next.time);
  }

  const out: Record<string, number> = {};
  for (const [bundle, list] of intervals) {
    list.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [cs, ce] = list[0];
    for (let i = 1; i < list.length; i++) {
      const [s, e] = list[i];
      if (s <= ce) ce = Math.max(ce, e);
      else {
        total += ce - cs;
        [cs, ce] = [s, e];
      }
    }
    total += ce - cs;
    out[bundle] = Math.round(total / 6000) / 10;
  }
  return out;
}

/** 规则关联应用的当日合计（整分钟，四舍五入） */
export function ruleTotalMinutes(rule: ScreenTimeRule, apps: Record<string, number>): number {
  return Math.round(rule.apps.reduce((sum, b) => sum + (apps[b] ?? 0), 0));
}

/** 打卡备注：屏幕时间：哔哩哔哩 69 分、王者荣耀 28 分（上限 60 分） */
export function screenTimeNote(
  rule: ScreenTimeRule,
  apps: Record<string, number>,
  label: (bundle: string) => string,
): string {
  const parts = rule.apps.map((b) => `${label(b)} ${Math.round(apps[b] ?? 0)} 分`);
  const tail = rule.mode === 'cap' ? `（上限 ${rule.minutes} 分）` : `（目标 ${rule.minutes} 分）`;
  return `屏幕时间：${parts.join('、')}${tail}`;
}

/** 规则在这一天想要的打卡结果；null = 不该有自动打卡 */
export function evaluateRule(
  rule: ScreenTimeRule,
  apps: Record<string, number>,
  scheduled: boolean,
): { status: CheckInStatus; minutes?: number } | null {
  if (rule.apps.length === 0) return null;
  const total = ruleTotalMinutes(rule, apps);
  if (rule.mode === 'reach') {
    // 累计型任何在期日都可记（非排期日多一条记录不影响缺卡与 streak 判定）
    if (total >= rule.minutes) return { status: 'done', minutes: total };
    if (total >= 1) return { status: 'partial', minutes: total };
    return null;
  }
  // 上限型只在应打卡日判：随缘任务/非排期日/免打卡日没有「今天守住了」的意义
  if (!scheduled) return null;
  return total <= rule.minutes ? { status: 'done' } : null;
}

const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

export type ScreenTimeOp =
  | { type: 'create'; after: CheckIn }
  | { type: 'update'; before: CheckIn; after: CheckIn }
  | { type: 'delete'; before: CheckIn };

/**
 * 某一天按规则应做的打卡变更。不碰手动打卡的状态（source 缺省）：
 * 累计型且手动记录没填分钟时只补 minutes；其余一律不动。
 * 自动打卡（source='screentime'）按最新数据覆盖或撤掉 ⇒ 同一天重采幂等。
 * 当天只剩被删掉的自动打卡（墓碑）= 用户手动删过 ⇒ 不再写回。checkIns 须含软删除行。
 */
export function planScreenTimeCheckIns(args: {
  date: string;
  apps: Record<string, number>;
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  label: (bundle: string) => string;
  now: string; // ISO
  newId: () => string;
}): ScreenTimeOp[] {
  const { date, apps, now } = args;
  const liveGoals = new Set(
    args.goals.filter((g) => !g.deletedAt && !g.archived).map((g) => g.id),
  );
  const dow = toDay(date).day();
  const ops: ScreenTimeOp[] = [];

  for (const task of args.tasks) {
    const rule = task.screenTime;
    if (!rule || task.deletedAt || !liveGoals.has(task.goalId)) continue;
    if (date < task.startDate || date > task.endDate) continue;

    const scheduled =
      isScheduledDow(task.recurrence, dow) && !isExempt(date, task.goalId, args.exemptions);
    const want = evaluateRule(rule, apps, scheduled);
    const note = screenTimeNote(rule, apps, args.label);

    const same = args.checkIns.filter(
      (c) => c.goalId === task.goalId && c.taskId === task.id && c.date === date,
    );
    const existing = same
      .filter((c) => !c.deletedAt)
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.updatedAt.localeCompare(a.updatedAt))[0];

    if (existing && existing.source !== 'screentime') {
      if (want?.minutes !== undefined && existing.minutes === undefined) {
        ops.push({ type: 'update', before: existing, after: { ...existing, minutes: want.minutes, updatedAt: now } });
      }
      continue;
    }

    if (!want) {
      if (existing) ops.push({ type: 'delete', before: existing });
      continue;
    }
    if (!existing && same.some((c) => c.deletedAt && c.source === 'screentime')) continue;

    if (existing) {
      if (existing.status === want.status && existing.minutes === want.minutes && existing.note === note) continue;
      const after: CheckIn = { ...existing, status: want.status, note, updatedAt: now };
      if (want.minutes === undefined) delete after.minutes;
      else after.minutes = want.minutes;
      ops.push({ type: 'update', before: existing, after });
      continue;
    }

    const created: CheckIn = {
      id: args.newId(),
      goalId: task.goalId,
      taskId: task.id,
      date,
      status: want.status,
      note,
      source: 'screentime',
      createdAt: now,
      updatedAt: now,
    };
    if (want.minutes !== undefined) created.minutes = want.minutes;
    ops.push({ type: 'create', after: created });
  }
  return ops;
}
