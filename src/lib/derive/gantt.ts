import type { CheckIn, CheckInStatus, ExemptionPeriod, Task } from '../../types/domain';
import { diffDays } from '../date';
import { calcAutoProgress, expandScheduledDays, getMissedDays } from './scheduled';
import { bestStatusByDate, calcStreak, statusByDateFor, type StreakResult } from './streak';
import { weeklyHeat, type WeekHeat } from './heat';

/** 时间进度：已过天数 / 总天数（endDate 含当天），0-100 clamp */
export function timeProgressPct(
  task: Pick<Task, 'startDate' | 'endDate'>,
  today: string,
): number {
  const total = diffDays(task.endDate, task.startDate) + 1;
  if (total <= 0) return 0;
  const elapsed = diffDays(today, task.startDate) + 1;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/** 单任务甘特渲染所需的全部派生数据（bar/点阵/热度/tooltip 共用） */
export interface TaskGantt {
  /** 全范围应打卡日（点阵含未来占位点） */
  scheduledDays: string[];
  /** 每日最强打卡状态（任务归属口径） */
  statusByDate: Map<string, CheckInStatus>;
  /** 缺卡日集合（< 今天且无记录） */
  missedSet: Set<string>;
  /** 自动进度 0-100 */
  autoProgress: number;
  /** bar 实色段用的进度：auto 用 autoProgress，manual 用 task.progress */
  effectiveProgress: number;
  /** active 且 auto 进度 < 时间进度 → bar 右上角警示角标 */
  isBehind: boolean;
  /** 周热度（应打卡日已裁至今天，未来周不产生假 allMissed） */
  weekHeat: WeekHeat[];
  /** tooltip 计数（应打卡截至今天） */
  counts: { scheduled: number; checked: number; missed: number };
}

/** 单目标甘特渲染所需的派生数据（目标行 + 各任务行） */
export interface GoalGantt {
  perTask: Map<string, TaskGantt>;
  streak: StreakResult;
  /** 汇总条范围：子任务 min(start)..max(end)；无任务 = null */
  summarySpan: { startDate: string; endDate: string } | null;
  /** 折叠时的聚合热度：子任务应打卡日并集（截至今天）× 目标口径最强状态 */
  aggregatedHeat: WeekHeat[];
}

export function deriveTaskGantt(
  task: Task,
  checkIns: CheckIn[],
  exemptions: ExemptionPeriod[],
  today: string,
  weekStartsOn: 0 | 1,
): TaskGantt {
  const scheduledDays = expandScheduledDays(task, exemptions);
  const statusByDate = statusByDateFor(checkIns, task.goalId, task.id);
  const missedSet = new Set(getMissedDays(task, checkIns, exemptions, today));
  const autoProgress = calcAutoProgress(task, checkIns, exemptions, today);
  const effectiveProgress = task.progressMode === 'auto' ? autoProgress : task.progress;

  const scheduledUntilToday = scheduledDays.filter((d) => d <= today);
  const weekHeat = weeklyHeat(scheduledUntilToday, statusByDate, weekStartsOn);
  let checked = 0;
  for (const d of scheduledUntilToday) if (statusByDate.has(d)) checked += 1;

  const isBehind =
    task.status === 'active' &&
    scheduledUntilToday.length > 0 &&
    autoProgress < timeProgressPct(task, today);

  return {
    scheduledDays,
    statusByDate,
    missedSet,
    autoProgress,
    effectiveProgress,
    isBehind,
    weekHeat,
    counts: { scheduled: scheduledUntilToday.length, checked, missed: missedSet.size },
  };
}

export function deriveGoalGantt(args: {
  goalId: string;
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  today: string;
  weekStartsOn: 0 | 1;
}): GoalGantt {
  const { goalId, checkIns, exemptions, today, weekStartsOn } = args;
  const tasks = args.tasks.filter((t) => !t.deletedAt && t.goalId === goalId);

  const perTask = new Map<string, TaskGantt>();
  const unionDays = new Set<string>();
  let minStart: string | null = null;
  let maxEnd: string | null = null;
  for (const t of tasks) {
    const tg = deriveTaskGantt(t, checkIns, exemptions, today, weekStartsOn);
    perTask.set(t.id, tg);
    for (const d of tg.scheduledDays) {
      if (d <= today) unionDays.add(d);
    }
    if (!minStart || t.startDate < minStart) minStart = t.startDate;
    if (!maxEnd || t.endDate > maxEnd) maxEnd = t.endDate;
  }

  return {
    perTask,
    streak: calcStreak({ goalId, tasks, checkIns, exemptions, today }),
    summarySpan:
      minStart && maxEnd ? { startDate: minStart, endDate: maxEnd } : null,
    aggregatedHeat: weeklyHeat(
      [...unionDays].sort(),
      bestStatusByDate(checkIns, goalId),
      weekStartsOn,
    ),
  };
}
