/**
 * 复盘统计派生（SPEC 第七节）：月度目标统计、年度热力图日分值、按月投入时长。
 * 口径与其余派生一致：目标级一天一条最强记录，done=1、partial=0.5 计权。
 */
import type { CheckIn, ExemptionPeriod, Task } from '../../types/domain';
import { expandScheduledDays } from './scheduled';
import { bestStatusByDate } from './streak';

export interface MonthGoalStats {
  /** 本月应打卡天数（目标级并集，截至今天） */
  scheduled: number;
  /** 完成分：done=1、partial=0.5 */
  score: number;
  /** 完成率 0-100；无应打卡返回 null（横条不渲染） */
  rate: number | null;
  /** 本月投入分钟数（该目标全部记录） */
  minutes: number;
  /** 缺卡天数（应打卡、< 今天、无记录） */
  missedDays: number;
}

/** 某目标某月的复盘统计。month = YYYY-MM */
export function monthlyGoalStats(args: {
  goalId: string;
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  month: string;
  today: string;
}): MonthGoalStats {
  const { goalId, tasks, checkIns, exemptions, month, today } = args;
  const dayset = new Set<string>();
  for (const t of tasks) {
    if (t.deletedAt || t.goalId !== goalId) continue;
    for (const d of expandScheduledDays(t, exemptions, today)) {
      if (d.startsWith(month)) dayset.add(d);
    }
  }
  const statusByDate = bestStatusByDate(checkIns, goalId);

  let score = 0;
  let missedDays = 0;
  for (const d of dayset) {
    const s = statusByDate.get(d);
    if (s === 'done') score += 1;
    else if (s === 'partial') score += 0.5;
    else if (!s && d < today) missedDays += 1;
  }

  let minutes = 0;
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== goalId || !c.date.startsWith(month)) continue;
    minutes += c.minutes ?? 0;
  }

  const scheduled = dayset.size;
  return {
    scheduled,
    score,
    rate: scheduled === 0 ? null : Math.round((score / scheduled) * 100),
    minutes,
    missedDays,
  };
}

/**
 * 年度热力图日分值：date → 当日活动分（各目标最强记录 done=1、partial=0.5 求和）。
 * goalId 传入时只统计该目标。skipped 不算活动。
 */
export function dailyActivityScores(
  checkIns: CheckIn[],
  year: number,
  goalId?: string,
): Map<string, number> {
  const prefix = `${year}-`;
  // 每目标每日最强状态（与派生口径一致，避免同日多条重复计分）
  const bestByGoalDate = new Map<string, 'done' | 'partial' | 'skipped'>();
  const rank = { done: 3, partial: 2, skipped: 1 } as const;
  for (const c of checkIns) {
    if (c.deletedAt || !c.date.startsWith(prefix)) continue;
    if (goalId && c.goalId !== goalId) continue;
    const key = `${c.goalId}|${c.date}`;
    const prev = bestByGoalDate.get(key);
    if (!prev || rank[c.status] > rank[prev]) bestByGoalDate.set(key, c.status);
  }
  const scores = new Map<string, number>();
  for (const [key, status] of bestByGoalDate) {
    const w = status === 'done' ? 1 : status === 'partial' ? 0.5 : 0;
    if (w === 0) continue;
    const date = key.slice(key.indexOf('|') + 1);
    scores.set(date, (scores.get(date) ?? 0) + w);
  }
  return scores;
}

/** 按月×目标投入分钟数（年度堆叠面积图数据源）。返回 month(1-12) → goalId → minutes */
export function minutesByGoalByMonth(
  checkIns: CheckIn[],
  year: number,
): Map<number, Map<string, number>> {
  const prefix = `${year}-`;
  const out = new Map<number, Map<string, number>>();
  for (const c of checkIns) {
    if (c.deletedAt || !c.minutes || !c.date.startsWith(prefix)) continue;
    const m = Number(c.date.slice(5, 7));
    const byGoal = out.get(m) ?? new Map<string, number>();
    byGoal.set(c.goalId, (byGoal.get(c.goalId) ?? 0) + c.minutes);
    out.set(m, byGoal);
  }
  return out;
}
