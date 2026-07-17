import { describe, expect, it } from 'vitest';
import type { CheckIn, Task } from '../../types/domain';
import { dailyActivityScores, minutesByGoalByMonth, monthlyGoalStats } from './review';

/* 2026-01 日历参考：01-01 周四；01-03 周六，01-04 周日 */

const task = (id: string, goalId: string, partial: Partial<Task> = {}): Task => ({
  id,
  goalId,
  name: `任务${id}`,
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  progress: 0,
  progressMode: 'auto',
  status: 'active',
  order: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

const checkIn = (
  goalId: string,
  date: string,
  status: CheckIn['status'],
  minutes?: number,
): CheckIn => ({
  id: `c-${goalId}-${date}-${status}`,
  goalId,
  date,
  status,
  minutes,
  createdAt: `${date}T20:00:00.000Z`,
  updatedAt: `${date}T20:00:00.000Z`,
});

describe('monthlyGoalStats 月度目标统计', () => {
  it('应打卡取目标级并集且裁到今天；done=1 partial=0.5；缺卡=无记录且<今天', () => {
    // t1 daily 01-01..01-10，t2 与其重叠（并集不重复计）
    const tasks = [task('t1', 'g1'), task('t2', 'g1', { startDate: '2026-01-03', endDate: '2026-01-05' })];
    const checkIns = [
      checkIn('g1', '2026-01-01', 'done', 30),
      checkIn('g1', '2026-01-02', 'partial', 15),
      checkIn('g1', '2026-01-03', 'skipped'),
      // 01-04 缺卡；01-05 = 今天，未打不算缺卡
    ];
    const s = monthlyGoalStats({
      goalId: 'g1',
      tasks,
      checkIns,
      exemptions: [],
      month: '2026-01',
      today: '2026-01-05',
    });
    expect(s.scheduled).toBe(5); // 01-01..01-05
    expect(s.score).toBe(1.5);
    expect(s.rate).toBe(30);
    expect(s.minutes).toBe(45);
    expect(s.missedDays).toBe(1); // 01-04
  });

  it('非本月记录的分钟不计；无应打卡日 rate=null', () => {
    const s = monthlyGoalStats({
      goalId: 'g1',
      tasks: [task('t1', 'g1', { startDate: '2026-02-01', endDate: '2026-02-10' })],
      checkIns: [checkIn('g1', '2026-02-02', 'done', 60)],
      exemptions: [],
      month: '2026-01',
      today: '2026-03-01',
    });
    expect(s.scheduled).toBe(0);
    expect(s.rate).toBeNull();
    expect(s.minutes).toBe(0);
  });
});

describe('dailyActivityScores 热力图日分值', () => {
  it('跨目标求和；同目标同日取最强；skipped 不计活动', () => {
    const scores = dailyActivityScores(
      [
        checkIn('g1', '2026-03-01', 'partial'),
        checkIn('g1', '2026-03-01', 'done'), // 同目标同日取最强 = 1
        checkIn('g2', '2026-03-01', 'partial'), // +0.5
        checkIn('g2', '2026-03-02', 'skipped'), // 不计
        checkIn('g1', '2025-12-31', 'done'), // 非本年
      ],
      2026,
    );
    expect(scores.get('2026-03-01')).toBe(1.5);
    expect(scores.has('2026-03-02')).toBe(false);
    expect(scores.has('2025-12-31')).toBe(false);
  });

  it('goalId 过滤单目标', () => {
    const scores = dailyActivityScores(
      [checkIn('g1', '2026-03-01', 'done'), checkIn('g2', '2026-03-01', 'done')],
      2026,
      'g2',
    );
    expect(scores.get('2026-03-01')).toBe(1);
  });
});

describe('minutesByGoalByMonth 按月投入', () => {
  it('按月×目标聚合分钟，无 minutes 的记录不计', () => {
    const m = minutesByGoalByMonth(
      [
        checkIn('g1', '2026-01-05', 'done', 30),
        checkIn('g1', '2026-01-20', 'done', 60),
        checkIn('g2', '2026-01-05', 'partial', 15),
        checkIn('g1', '2026-02-01', 'done', 45),
        checkIn('g1', '2026-02-02', 'done'), // 无分钟
      ],
      2026,
    );
    expect(m.get(1)?.get('g1')).toBe(90);
    expect(m.get(1)?.get('g2')).toBe(15);
    expect(m.get(2)?.get('g1')).toBe(45);
  });
});
