import type { CheckIn, ExemptionPeriod, Recurrence, Task } from '../../types/domain';
import { eachDay, toDay } from '../date';

/** recurrence 是否命中某个星期几（0=周日...6=周六）；无 recurrence 默认 daily */
export function isScheduledDow(recurrence: Recurrence | undefined, dow: number): boolean {
  if (!recurrence || recurrence.type === 'daily') return true;
  // 随缘：不排期——不产生应打卡日，从而永不缺卡、不断 streak、自动进度分母为 0
  if (recurrence.type === 'adhoc') return false;
  if (recurrence.type === 'weekdays') return dow >= 1 && dow <= 5;
  return recurrence.daysOfWeek?.includes(dow) ?? false;
}

/** 某天对某目标是否处于免打卡区间（goalIds 缺省 = 覆盖全部目标） */
export function isExempt(date: string, goalId: string, exemptions: ExemptionPeriod[]): boolean {
  return exemptions.some(
    (e) =>
      !e.deletedAt &&
      date >= e.startDate &&
      date <= e.endDate &&
      (!e.goalIds || e.goalIds.length === 0 || e.goalIds.includes(goalId)),
  );
}

/**
 * 应打卡日：任务日期范围 ∩ recurrence 规则，再减去命中的免打卡区间。
 * until 传入时把范围右端裁到 min(endDate, until)（如"截至今天"）。
 */
export function expandScheduledDays(
  task: Pick<Task, 'goalId' | 'startDate' | 'endDate' | 'recurrence'>,
  exemptions: ExemptionPeriod[] = [],
  until?: string,
): string[] {
  let end = task.endDate;
  if (until && until < end) end = until;
  if (end < task.startDate) return [];
  const days: string[] = [];
  for (const date of eachDay(task.startDate, end)) {
    if (!isScheduledDow(task.recurrence, toDay(date).day())) continue;
    if (isExempt(date, task.goalId, exemptions)) continue;
    days.push(date);
  }
  return days;
}

/**
 * 提取"算作对该任务的打卡"的日期集合：
 * goalId 匹配，且 CheckIn 未指定 taskId 或 taskId 与本任务一致。
 */
export function checkedDatesFor(
  checkIns: CheckIn[],
  goalId: string,
  taskId?: string,
): Set<string> {
  const dates = new Set<string>();
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== goalId) continue;
    if (c.taskId && taskId && c.taskId !== taskId) continue;
    dates.add(c.date);
  }
  return dates;
}

/** 缺卡：应打卡日 < 今天 且无任何 CheckIn 记录（done/partial/skipped 都算有记录） */
export function getMissedDays(
  task: Pick<Task, 'id' | 'goalId' | 'startDate' | 'endDate' | 'recurrence'>,
  checkIns: CheckIn[],
  exemptions: ExemptionPeriod[],
  today: string,
): string[] {
  const checked = checkedDatesFor(checkIns, task.goalId, task.id);
  return expandScheduledDays(task, exemptions).filter((d) => d < today && !checked.has(d));
}

/**
 * 自动进度（progressMode='auto'）：已打卡 / 截至今天的应打卡天数，0-100。
 * 打卡计权与完成率口径一致：done=1、partial=0.5、skipped=0。
 * 任务还没开始或截至今天无应打卡日时返回 0。
 */
export function calcAutoProgress(
  task: Pick<Task, 'id' | 'goalId' | 'startDate' | 'endDate' | 'recurrence'>,
  checkIns: CheckIn[],
  exemptions: ExemptionPeriod[],
  today: string,
): number {
  const scheduled = expandScheduledDays(task, exemptions, today);
  if (scheduled.length === 0) return 0;
  const scheduledSet = new Set(scheduled);
  let score = 0;
  const counted = new Set<string>();
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== task.goalId) continue;
    if (c.taskId && c.taskId !== task.id) continue;
    if (!scheduledSet.has(c.date) || counted.has(c.date)) continue;
    counted.add(c.date);
    if (c.status === 'done') score += 1;
    else if (c.status === 'partial') score += 0.5;
  }
  return Math.round((score / scheduled.length) * 100);
}
