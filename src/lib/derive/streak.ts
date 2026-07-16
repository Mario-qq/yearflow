import type { CheckIn, CheckInStatus, ExemptionPeriod, Task } from '../../types/domain';
import { expandScheduledDays } from './scheduled';

export interface StreakResult {
  /** 当前连续完成天数（截至今天） */
  current: number;
  /** 历史最长连续 */
  longest: number;
}

const STATUS_RANK: Record<CheckInStatus, number> = { done: 3, partial: 2, skipped: 1 };

/** 同一天多条记录时取"最强"状态：done > partial > skipped */
export function bestStatusByDate(checkIns: CheckIn[], goalId: string): Map<string, CheckInStatus> {
  const map = new Map<string, CheckInStatus>();
  for (const c of checkIns) {
    if (c.deletedAt || c.goalId !== goalId) continue;
    const prev = map.get(c.date);
    if (!prev || STATUS_RANK[c.status] > STATUS_RANK[prev]) map.set(c.date, c.status);
  }
  return map;
}

/**
 * 按 Goal 计算 streak（SPEC 派生概念）：
 * - 应打卡日 = 该目标所有任务应打卡日的并集（已减免打卡区间）
 * - done / partial 延续并 +1
 * - skipped 与免打卡日/非应打卡日不打断、不计数
 * - missed（应打卡、无记录、日期 < 今天）打断
 * - 今天应打卡但还没打：不打断（尚在进行中）
 */
export function calcStreak(args: {
  goalId: string;
  tasks: Task[];
  checkIns: CheckIn[];
  exemptions: ExemptionPeriod[];
  today: string;
}): StreakResult {
  const { goalId, tasks, checkIns, exemptions, today } = args;
  const dayset = new Set<string>();
  for (const t of tasks) {
    if (t.deletedAt || t.goalId !== goalId) continue;
    for (const d of expandScheduledDays(t, exemptions, today)) dayset.add(d);
  }
  const days = [...dayset].sort();
  const statusByDate = bestStatusByDate(checkIns, goalId);

  let run = 0;
  let longest = 0;
  for (const day of days) {
    const status = statusByDate.get(day);
    if (status === 'done' || status === 'partial') {
      run += 1;
      if (run > longest) longest = run;
    } else if (status === 'skipped') {
      continue; // 有意跳过：不打断不计数
    } else if (day < today) {
      run = 0; // missed：打断
    }
    // day === today 且未打卡：不打断，等今天的卡
  }
  return { current: run, longest };
}
