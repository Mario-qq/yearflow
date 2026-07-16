import type { CheckInStatus } from '../../types/domain';
import { weekStartOf } from '../date';

export interface WeekHeat {
  /** 周首日期 YYYY-MM-DD */
  weekStart: string;
  /** 本周应打卡天数 */
  scheduled: number;
  /** 完成分：done=1、partial=0.5 */
  score: number;
  /** 完成率 score/scheduled；无应打卡 = null（不渲染热度） */
  rate: number | null;
  /** 整周全缺（应打卡>0 且一次记录都没有）→ 年视图淡红信号 */
  allMissed: boolean;
}

/**
 * 按周聚合完成率（年/季视图热度条数据源）。
 * scheduledDays 应已裁剪到"今天"（未来周不产生 allMissed 假信号）。
 */
export function weeklyHeat(
  scheduledDays: string[],
  statusByDate: Map<string, CheckInStatus>,
  weekStartsOn: 0 | 1,
): WeekHeat[] {
  const weeks = new Map<string, { scheduled: number; score: number; recorded: number }>();
  for (const day of scheduledDays) {
    const ws = weekStartOf(day, weekStartsOn);
    const w = weeks.get(ws) ?? { scheduled: 0, score: 0, recorded: 0 };
    w.scheduled += 1;
    const status = statusByDate.get(day);
    if (status) {
      w.recorded += 1;
      if (status === 'done') w.score += 1;
      else if (status === 'partial') w.score += 0.5;
    }
    weeks.set(ws, w);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, w]) => ({
      weekStart,
      scheduled: w.scheduled,
      score: w.score,
      rate: w.scheduled > 0 ? w.score / w.scheduled : null,
      allMissed: w.scheduled > 0 && w.recorded === 0,
    }));
}
