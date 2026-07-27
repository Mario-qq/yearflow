import type { CheckIn, CheckInStatus, ExemptionPeriod, Task } from '../../types/domain';
import { diffDays } from '../date';
import { calcAutoProgress, expandScheduledDays, getMissedDays } from './scheduled';
import { bestStatusByDate, calcStreak, statusByDateFor, type StreakResult } from './streak';
import { weeklyHeat, type WeekHeat } from './heat';
import { aggregateTrackProgress, buildTracks, type TrackSegment } from './tracks';

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

/** 一条执行轨道折叠成一行时所需的派生数据 */
export interface TrackGantt {
  /** 包络：成员 min(start)..max(end) */
  span: { startDate: string; endDate: string };
  /** 成员区间并集，实心分段；段间即浅色间隙 */
  segments: TrackSegment[];
  memberIds: string[];
  /** 聚合热度：成员应打卡日并集（截至今天）× 目标口径最强状态 */
  heat: WeekHeat[];
  /** 按跨度天数加权的聚合进度 0-100 */
  progress: number;
}

/** 单目标甘特渲染所需的派生数据（目标行 + 各任务行） */
export interface GoalGantt {
  perTask: Map<string, TaskGantt>;
  /** 该目标下每条轨道（key = trackId）折叠行所需数据；无轨道时为空 Map */
  perTrack: Map<string, TrackGantt>;
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

/**
 * 目标某月完成率（0-100）：分子 done=1 / partial=0.5，
 * 分母 = 各任务该月截至今天的应打卡日之和；无应打卡日返回 null（环形不渲染）。
 */
export function goalMonthlyRate(gg: GoalGantt, month: string, today: string): number | null {
  let total = 0;
  let score = 0;
  for (const tg of gg.perTask.values()) {
    for (const d of tg.scheduledDays) {
      if (d > today || !d.startsWith(month)) continue;
      total += 1;
      const s = tg.statusByDate.get(d);
      if (s === 'done') score += 1;
      else if (s === 'partial') score += 0.5;
    }
  }
  return total === 0 ? null : Math.round((score / total) * 100);
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

  // 轨道聚合：并集范围从整目标缩到轨道成员，复用同一套 unionDays × 目标口径状态
  const goalStatusByDate = bestStatusByDate(checkIns, goalId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const perTrack = new Map<string, TrackGantt>();
  for (const tr of buildTracks(tasks).tracks) {
    const members = tr.memberIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
    const trackDays = new Set<string>();
    for (const m of members) {
      for (const d of perTask.get(m.id)?.scheduledDays ?? []) {
        if (d <= today) trackDays.add(d);
      }
    }
    perTrack.set(tr.id, {
      span: { startDate: tr.startDate, endDate: tr.endDate },
      segments: tr.segments,
      memberIds: tr.memberIds,
      heat: weeklyHeat([...trackDays].sort(), goalStatusByDate, weekStartsOn),
      progress: aggregateTrackProgress(
        members,
        (id) => perTask.get(id)?.effectiveProgress ?? 0,
      ),
    });
  }

  return {
    perTask,
    perTrack,
    streak: calcStreak({ goalId, tasks, checkIns, exemptions, today }),
    summarySpan:
      minStart && maxEnd ? { startDate: minStart, endDate: maxEnd } : null,
    aggregatedHeat: weeklyHeat([...unionDays].sort(), goalStatusByDate, weekStartsOn),
  };
}
