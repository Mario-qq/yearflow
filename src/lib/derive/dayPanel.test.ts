import { describe, expect, it } from 'vitest';
import type { CheckIn, ExemptionPeriod, Goal, Task } from '../../types/domain';
import { dayCompletionRate, dayEntries, type DayGoalEntry } from './dayPanel';

/* 2026-01 日历参考：01-03 周六，01-04 周日，01-05 周一 */

const goal = (id: string, order = 0, partial: Partial<Goal> = {}): Goal => ({
  id,
  name: `目标${id}`,
  color: 'goal-1',
  order,
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

const task = (id: string, goalId: string, partial: Partial<Task> = {}): Task => ({
  id,
  goalId,
  name: `任务${id}`,
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  progress: 0,
  progressMode: 'auto',
  status: 'active',
  order: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

const checkIn = (goalId: string, date: string, status: CheckIn['status']): CheckIn => ({
  id: `c-${goalId}-${date}-${status}`,
  goalId,
  date,
  status,
  createdAt: `${date}T20:00:00.000Z`,
  updatedAt: `${date}T20:00:00.000Z`,
});

const exemption = (
  startDate: string,
  endDate: string,
  partial: Partial<ExemptionPeriod> = {},
): ExemptionPeriod => ({
  id: `e-${startDate}`,
  startDate,
  endDate,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

describe('dayEntries 面板条目', () => {
  it('只含当日应打卡的目标：范围外 / recurrence 未命中 / status=done 的任务不算', () => {
    const goals = [goal('g1'), goal('g2', 1), goal('g3', 2), goal('g4', 3)];
    const tasks = [
      task('t1', 'g1'), // daily，命中
      task('t2', 'g2', { recurrence: { type: 'weekdays' } }), // 01-03 周六，不命中
      task('t3', 'g3', { startDate: '2026-02-01', endDate: '2026-02-10' }), // 范围外
      task('t4', 'g4', { status: 'done' }), // 已完结任务不再提示
    ];
    const entries = dayEntries({ date: '2026-01-03', goals, tasks, checkIns: [], exemptions: [] });
    expect(entries.map((e) => e.goalId)).toEqual(['g1']);
    expect(entries[0].dueTaskIds).toEqual(['t1']);
  });

  it('免打卡区间内的目标保留并标 exempt（含 reason），dueTaskIds 置空', () => {
    const entries = dayEntries({
      date: '2026-01-05',
      goals: [goal('g1')],
      tasks: [task('t1', 'g1')],
      checkIns: [],
      exemptions: [exemption('2026-01-04', '2026-01-06', { reason: '出差' })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].exempt).toBe(true);
    expect(entries[0].exemptReason).toBe('出差');
    expect(entries[0].dueTaskIds).toEqual([]);
  });

  it('goalIds 限定的免打卡区间不影响其他目标；同日多条记录取最强状态', () => {
    const entries = dayEntries({
      date: '2026-01-05',
      goals: [goal('g1'), goal('g2', 1)],
      tasks: [task('t1', 'g1'), task('t2', 'g2')],
      checkIns: [checkIn('g2', '2026-01-05', 'skipped'), checkIn('g2', '2026-01-05', 'done')],
      exemptions: [exemption('2026-01-01', '2026-01-31', { goalIds: ['g1'] })],
    });
    expect(entries.find((e) => e.goalId === 'g1')?.exempt).toBe(true);
    const g2 = entries.find((e) => e.goalId === 'g2');
    expect(g2?.exempt).toBe(false);
    expect(g2?.status).toBe('done');
  });

  it('归档目标与软删任务不产生条目', () => {
    const entries = dayEntries({
      date: '2026-01-05',
      goals: [goal('g1', 0, { archived: true }), goal('g2', 1)],
      tasks: [task('t1', 'g1'), task('t2', 'g2', { deletedAt: '2026-01-02T00:00:00.000Z' })],
      checkIns: [],
      exemptions: [],
    });
    expect(entries).toEqual([]);
  });
});

describe('dayCompletionRate 当日完成率', () => {
  const entry = (partial: Partial<DayGoalEntry>): DayGoalEntry => ({
    goalId: 'g',
    dueTaskIds: ['t'],
    exempt: false,
    ...partial,
  });

  it('done=1、partial=0.5、未打=0', () => {
    const rate = dayCompletionRate([
      entry({ status: 'done' }),
      entry({ status: 'partial' }),
      entry({}),
      entry({ status: 'done' }),
    ]);
    expect(rate).toBeCloseTo(2.5 / 4);
  });

  it('skipped 与休息中不入分母；全为二者时返回 null', () => {
    expect(dayCompletionRate([entry({ status: 'skipped' }), entry({ exempt: true })])).toBeNull();
    expect(
      dayCompletionRate([entry({ status: 'done' }), entry({ status: 'skipped' })]),
    ).toBe(1);
  });

  it('空条目返回 null', () => {
    expect(dayCompletionRate([])).toBeNull();
  });
});
