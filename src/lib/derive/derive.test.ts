import { describe, expect, it } from 'vitest';
import type { CheckIn, ExemptionPeriod, Task } from '../../types/domain';
import {
  baselineDrift,
  bestStatusByDate,
  calcAutoProgress,
  calcStreak,
  expandScheduledDays,
  getMissedDays,
  weeklyHeat,
} from './index';

/* 2026-01 日历参考：01-01 周四，01-03 周六，01-04 周日，01-05 周一 */

const task = (partial: Partial<Task> = {}): Task => ({
  id: 't1',
  goalId: 'g1',
  name: '测试任务',
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  progress: 0,
  progressMode: 'auto',
  status: 'active',
  order: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

const checkIn = (date: string, status: CheckIn['status'], partial: Partial<CheckIn> = {}): CheckIn => ({
  id: `c-${date}-${status}`,
  goalId: 'g1',
  date,
  status,
  createdAt: `${date}T20:00:00.000Z`,
  updatedAt: `${date}T20:00:00.000Z`,
  ...partial,
});

const exemption = (startDate: string, endDate: string, partial: Partial<ExemptionPeriod> = {}): ExemptionPeriod => ({
  id: `e-${startDate}`,
  startDate,
  endDate,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...partial,
});

describe('expandScheduledDays 应打卡日展开', () => {
  it('无 recurrence 默认 daily，闭区间含首尾', () => {
    const days = expandScheduledDays(task({ endDate: '2026-01-03' }));
    expect(days).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('weekdays 只含周一到周五', () => {
    const days = expandScheduledDays(task({ startDate: '2026-01-02', endDate: '2026-01-06' }, ) );
    // 上面是 daily；weekdays 单测：
    const wd = expandScheduledDays(
      task({ startDate: '2026-01-02', endDate: '2026-01-06', recurrence: { type: 'weekdays' } }),
    );
    expect(days).toHaveLength(5);
    expect(wd).toEqual(['2026-01-02', '2026-01-05', '2026-01-06']); // 周五、周一、周二
  });

  it('custom daysOfWeek 如 [1,3,6]（一/三/六）', () => {
    const days = expandScheduledDays(
      task({ recurrence: { type: 'custom', daysOfWeek: [1, 3, 6] } }),
    );
    expect(days).toEqual(['2026-01-03', '2026-01-05', '2026-01-07', '2026-01-10']);
  });

  it('减去免打卡区间（边界日含首尾）', () => {
    const days = expandScheduledDays(task({ endDate: '2026-01-05' }), [
      exemption('2026-01-02', '2026-01-03'),
    ]);
    expect(days).toEqual(['2026-01-01', '2026-01-04', '2026-01-05']);
  });

  it('免打卡区间限定 goalIds 时不影响其他目标', () => {
    const days = expandScheduledDays(task({ endDate: '2026-01-03' }), [
      exemption('2026-01-01', '2026-01-31', { goalIds: ['g-other'] }),
    ]);
    expect(days).toHaveLength(3);
  });

  it('until 裁剪右端（截至今天口径）', () => {
    const days = expandScheduledDays(task(), [], '2026-01-04');
    expect(days).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });

  it('范围为空返回 []', () => {
    expect(expandScheduledDays(task({ startDate: '2026-02-01' }), [], '2026-01-15')).toEqual([]);
  });
});

describe('getMissedDays 缺卡判定', () => {
  it('过去的应打卡日无记录 → missed；今天不算', () => {
    const missed = getMissedDays(
      task({ endDate: '2026-01-05' }),
      [checkIn('2026-01-01', 'done'), checkIn('2026-01-03', 'skipped')],
      [],
      '2026-01-04',
    );
    expect(missed).toEqual(['2026-01-02']); // 01-03 有 skipped 记录不算缺；01-04 是今天不算
  });

  it('免打卡区间内不判缺卡', () => {
    const missed = getMissedDays(task(), [], [exemption('2026-01-01', '2026-01-03')], '2026-01-05');
    expect(missed).toEqual(['2026-01-04']);
  });

  it('其他任务的定向打卡不算本任务', () => {
    const missed = getMissedDays(
      task({ endDate: '2026-01-01' }),
      [checkIn('2026-01-01', 'done', { taskId: 't-other' })],
      [],
      '2026-01-02',
    );
    expect(missed).toEqual(['2026-01-01']);
  });
});

describe('calcStreak 连续天数', () => {
  const base = { goalId: 'g1', exemptions: [] as ExemptionPeriod[] };

  it('连续 done 计数，missed 打断，current 取尾段', () => {
    const r = calcStreak({
      ...base,
      tasks: [task({ endDate: '2026-01-06' })],
      checkIns: [
        checkIn('2026-01-01', 'done'),
        checkIn('2026-01-02', 'done'),
        checkIn('2026-01-03', 'done'),
        // 01-04 missed
        checkIn('2026-01-05', 'done'),
      ],
      today: '2026-01-06',
    });
    expect(r.longest).toBe(3);
    expect(r.current).toBe(1); // 01-05 起新段；今天(01-06)未打不打断
  });

  it('skipped 不打断也不计数', () => {
    const r = calcStreak({
      ...base,
      tasks: [task({ endDate: '2026-01-04' })],
      checkIns: [
        checkIn('2026-01-01', 'done'),
        checkIn('2026-01-02', 'skipped'),
        checkIn('2026-01-03', 'done'),
      ],
      today: '2026-01-04',
    });
    expect(r.current).toBe(2);
    expect(r.longest).toBe(2);
  });

  it('免打卡区间不打断（区间两侧连续拼接）', () => {
    const r = calcStreak({
      goalId: 'g1',
      tasks: [task({ endDate: '2026-01-06' })],
      checkIns: [checkIn('2026-01-01', 'done'), checkIn('2026-01-05', 'done')],
      exemptions: [exemption('2026-01-02', '2026-01-04')],
      today: '2026-01-06',
    });
    expect(r.current).toBe(2);
  });

  it('partial 也延续 streak；今天已打卡计入 current', () => {
    const r = calcStreak({
      ...base,
      tasks: [task({ endDate: '2026-01-03' })],
      checkIns: [checkIn('2026-01-01', 'partial'), checkIn('2026-01-02', 'done')],
      today: '2026-01-02',
    });
    expect(r.current).toBe(2);
  });

  it('昨天缺卡 → current 归零', () => {
    const r = calcStreak({
      ...base,
      tasks: [task({ endDate: '2026-01-06' })],
      checkIns: [checkIn('2026-01-01', 'done'), checkIn('2026-01-02', 'done')],
      today: '2026-01-04', // 01-03 缺
    });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(2);
  });
});

describe('weeklyHeat 周聚合热度', () => {
  it('按 ISO 周聚合，done=1 partial=0.5', () => {
    /* 2026-01-05(一)~01-11(日) 为一个 ISO 周 */
    const scheduled = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
    const status = bestStatusByDate(
      [checkIn('2026-01-05', 'done'), checkIn('2026-01-06', 'partial')],
      'g1',
    );
    const heat = weeklyHeat(scheduled, status, 1);
    expect(heat).toHaveLength(1);
    expect(heat[0]).toMatchObject({ weekStart: '2026-01-05', scheduled: 4, score: 1.5 });
    expect(heat[0].rate).toBeCloseTo(0.375);
    expect(heat[0].allMissed).toBe(false);
  });

  it('整周零记录 → allMissed（年视图淡红）', () => {
    const heat = weeklyHeat(['2026-01-05', '2026-01-06'], new Map(), 1);
    expect(heat[0].allMissed).toBe(true);
    expect(heat[0].rate).toBe(0);
  });

  it('weekStartsOn=0 时周日归入下一组', () => {
    /* 01-04 是周日：周一制归上一周(2025-12-29)，周日制自成周首 */
    const iso = weeklyHeat(['2026-01-04'], new Map(), 1);
    const sun = weeklyHeat(['2026-01-04'], new Map(), 0);
    expect(iso[0].weekStart).toBe('2025-12-29');
    expect(sun[0].weekStart).toBe('2026-01-04');
  });

  it('跨周排序稳定', () => {
    const heat = weeklyHeat(['2026-01-12', '2026-01-05'], new Map(), 1);
    expect(heat.map((h) => h.weekStart)).toEqual(['2026-01-05', '2026-01-12']);
  });
});

describe('baselineDrift 基线偏移', () => {
  it('无 baseline 返回 null', () => {
    expect(baselineDrift(task())).toBeNull();
  });

  it('延后为正、提前为负', () => {
    const d = baselineDrift(
      task({ baseline: { startDate: '2026-01-01', endDate: '2026-01-08' } , startDate: '2026-01-04', endDate: '2026-01-06' }),
    );
    expect(d).toEqual({ startDriftDays: 3, endDriftDays: -2 });
  });
});

describe('calcAutoProgress 自动进度', () => {
  it('done=1 partial=0.5，分母为截至今天的应打卡数', () => {
    const p = calcAutoProgress(
      task({ endDate: '2026-01-10' }),
      [checkIn('2026-01-01', 'done'), checkIn('2026-01-02', 'partial')],
      [],
      '2026-01-04',
    );
    expect(p).toBe(38); // 1.5 / 4 = 37.5 → 38
  });

  it('未开始的任务进度为 0', () => {
    expect(calcAutoProgress(task({ startDate: '2026-06-01', endDate: '2026-06-30' }), [], [], '2026-01-04')).toBe(0);
  });

  it('同一天重复记录只计一次', () => {
    const p = calcAutoProgress(
      task({ endDate: '2026-01-02' }),
      [checkIn('2026-01-01', 'done'), checkIn('2026-01-01', 'done', { id: 'dup' })],
      [],
      '2026-01-03',
    );
    expect(p).toBe(50); // 1 / 2
  });
});

describe('adhoc 随缘任务：不排期、不缺卡、不断 streak', () => {
  const adhoc = (partial: Partial<Task> = {}) => task({ recurrence: { type: 'adhoc' }, ...partial });

  it('expandScheduledDays 恒为空（无应打卡日）', () => {
    expect(expandScheduledDays(adhoc({ endDate: '2026-01-10' }))).toEqual([]);
  });

  it('getMissedDays 恒为空（永不缺卡）', () => {
    expect(getMissedDays(adhoc({ endDate: '2026-01-10' }), [], [], '2026-01-20')).toEqual([]);
  });

  it('calcAutoProgress 恒为 0（无分母，故只能手动进度）', () => {
    expect(
      calcAutoProgress(adhoc({ endDate: '2026-01-10' }), [checkIn('2026-01-05', 'done')], [], '2026-01-20'),
    ).toBe(0);
  });

  it('随缘打卡不进 streak（既不 +1 也不打断）', () => {
    const r = calcStreak({
      goalId: 'g1',
      tasks: [adhoc({ endDate: '2026-01-10' })],
      checkIns: [checkIn('2026-01-05', 'done', { taskId: 't1' })],
      exemptions: [],
      today: '2026-01-20',
    });
    expect(r).toEqual({ current: 0, longest: 0 });
  });
});
