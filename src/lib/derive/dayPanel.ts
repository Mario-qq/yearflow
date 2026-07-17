/**
 * 今日打卡面板派生（SPEC 第五节）：某一天各目标的应打卡条目与当日完成率。
 * 口径：目标级——一天对一个目标最多一条有效记录（同日多条取最强，与 streak 一致）。
 */
import type {
  CheckIn,
  CheckInStatus,
  ExemptionPeriod,
  Goal,
  Task,
} from '../../types/domain';
import { toDay } from '../date';
import { isScheduledDow } from './scheduled';

const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

export interface DayGoalEntry {
  goalId: string;
  /** 该日应打卡的任务 id（免打卡区间内为空数组） */
  dueTaskIds: string[];
  /** 该日处于命中该目标的免打卡区间 → 面板显示"休息中"而非按钮 */
  exempt: boolean;
  exemptReason?: string;
  /** 当日最强打卡状态（无记录 = undefined） */
  status?: CheckInStatus;
}

/**
 * 某一天的打卡面板条目：仅包含"当天本应打卡"的目标
 * （任务日期范围 ∩ recurrence 命中；免打卡区间内的目标保留并标记 exempt）。
 */
export function dayEntries(args: {
  date: string;
  goals: Goal[];
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
}): DayGoalEntry[] {
  const { date, goals, tasks, checkIns, exemptions } = args;
  const dow = toDay(date).day();

  const statusByGoal = new Map<string, CheckInStatus>();
  for (const c of checkIns) {
    if (c.deletedAt || c.date !== date) continue;
    const prev = statusByGoal.get(c.goalId);
    if (!prev || STATUS_RANK[c.status] > STATUS_RANK[prev]) statusByGoal.set(c.goalId, c.status);
  }

  const entries: DayGoalEntry[] = [];
  for (const goal of [...goals].filter((g) => !g.deletedAt && !g.archived).sort((a, b) => a.order - b.order)) {
    const due = tasks.filter(
      (t) =>
        !t.deletedAt &&
        t.goalId === goal.id &&
        t.status !== 'done' &&
        date >= t.startDate &&
        date <= t.endDate &&
        isScheduledDow(t.recurrence, dow),
    );
    if (due.length === 0) continue;
    const hit = exemptions.find(
      (e) =>
        !e.deletedAt &&
        date >= e.startDate &&
        date <= e.endDate &&
        (!e.goalIds || e.goalIds.length === 0 || e.goalIds.includes(goal.id)),
    );
    entries.push({
      goalId: goal.id,
      dueTaskIds: hit ? [] : due.map((t) => t.id),
      exempt: !!hit,
      exemptReason: hit?.reason,
      status: statusByGoal.get(goal.id),
    });
  }
  return entries;
}

/**
 * 当日完成率（微型日历小环，0-1）：done=1、partial=0.5；
 * skipped 与休息中不入分母；分母为 0 返回 null（环不渲染）。
 */
export function dayCompletionRate(entries: DayGoalEntry[]): number | null {
  let total = 0;
  let score = 0;
  for (const e of entries) {
    if (e.exempt || e.status === 'skipped') continue;
    total += 1;
    if (e.status === 'done') score += 1;
    else if (e.status === 'partial') score += 0.5;
  }
  return total === 0 ? null : score / total;
}
