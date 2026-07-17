import { describe, expect, it } from 'vitest';
import type { CheckIn, ExemptionPeriod, Task } from '../../types/domain';
import { deriveGoalGantt, deriveTaskGantt, goalMonthlyRate, statusByDateFor, timeProgressPct } from './index';

/* 2026-01 日历参考：01-01 周四，01-03 周六，01-04 周日，01-05 周一，01-10 周六 */

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

describe('statusByDateFor 任务口径每日最强状态', () => {
  it('未指定 taskId 的记录算给该目标下任何任务', () => {
    const map = statusByDateFor([checkIn('2026-01-02', 'done')], 'g1', 't1');
    expect(map.get('2026-01-02')).toBe('done');
  });

  it('taskId 一致才算，不一致不算', () => {
    const ins = [
      checkIn('2026-01-02', 'done', { taskId: 't1' }),
      checkIn('2026-01-03', 'done', { taskId: 't2' }),
    ];
    const map = statusByDateFor(ins, 'g1', 't1');
    expect(map.get('2026-01-02')).toBe('done');
    expect(map.has('2026-01-03')).toBe(false);
  });

  it('同日多条取最强：done > partial > skipped', () => {
    const ins = [
      checkIn('2026-01-02', 'skipped'),
      checkIn('2026-01-02', 'done'),
      checkIn('2026-01-02', 'partial'),
    ];
    expect(statusByDateFor(ins, 'g1').get('2026-01-02')).toBe('done');
  });

  it('跳过软删除与其他目标', () => {
    const ins = [
      checkIn('2026-01-02', 'done', { deletedAt: '2026-01-03T00:00:00.000Z' }),
      checkIn('2026-01-03', 'done', { goalId: 'g-other' }),
    ];
    expect(statusByDateFor(ins, 'g1').size).toBe(0);
  });
});

describe('timeProgressPct 时间进度', () => {
  it('未开始 = 0', () => {
    expect(timeProgressPct(task(), '2025-12-20')).toBe(0);
  });

  it('已结束 = 100', () => {
    expect(timeProgressPct(task(), '2026-02-01')).toBe(100);
  });

  it('进行中按已过天数比例（含当天）', () => {
    // 01-01..01-10 共 10 天，今天 01-05 → 已过 5 天 = 50%
    expect(timeProgressPct(task(), '2026-01-05')).toBeCloseTo(50);
  });

  it('单日任务当天 = 100', () => {
    expect(
      timeProgressPct(task({ startDate: '2026-01-05', endDate: '2026-01-05' }), '2026-01-05'),
    ).toBe(100);
  });
});

describe('deriveTaskGantt 单任务派生', () => {
  it('weekHeat 裁剪至今天：未来周不出现', () => {
    const tg = deriveTaskGantt(task({ endDate: '2026-01-31' }), [], [], '2026-01-10', 1);
    // 01-01(周四)..01-10(周六) → 仅两周：2025-12-29 起、2026-01-05 起
    expect(tg.weekHeat.map((w) => w.weekStart)).toEqual(['2025-12-29', '2026-01-05']);
    expect(tg.weekHeat[1].scheduled).toBe(6); // 01-05..01-10
  });

  it('counts：应打卡截至今天 / 已打卡 / 缺卡', () => {
    const ins = [checkIn('2026-01-02', 'done'), checkIn('2026-01-04', 'skipped')];
    const tg = deriveTaskGantt(task(), ins, [], '2026-01-10', 1);
    expect(tg.counts).toEqual({ scheduled: 10, checked: 2, missed: 7 }); // 01-10 是今天不算缺
  });

  it('isBehind：active 且 auto 进度落后时间进度', () => {
    expect(deriveTaskGantt(task(), [], [], '2026-01-05', 1).isBehind).toBe(true);
    expect(deriveTaskGantt(task({ status: 'done' }), [], [], '2026-01-05', 1).isBehind).toBe(false);
    expect(deriveTaskGantt(task({ status: 'paused' }), [], [], '2026-01-05', 1).isBehind).toBe(false);
    // 全部打满则不落后
    const full = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'].map((d) =>
      checkIn(d, 'done'),
    );
    expect(deriveTaskGantt(task(), full, [], '2026-01-05', 1).isBehind).toBe(false);
  });

  it('effectiveProgress：manual 用 task.progress，auto 用 autoProgress', () => {
    const ins = [checkIn('2026-01-01', 'done'), checkIn('2026-01-02', 'partial')];
    const auto = deriveTaskGantt(task(), ins, [], '2026-01-05', 1);
    expect(auto.autoProgress).toBe(30); // (1+0.5)/5
    expect(auto.effectiveProgress).toBe(30);
    const manual = deriveTaskGantt(
      task({ progressMode: 'manual', progress: 66 }),
      ins,
      [],
      '2026-01-05',
      1,
    );
    expect(manual.effectiveProgress).toBe(66);
  });

  it('免打卡区间不产生点也不计缺卡', () => {
    const tg = deriveTaskGantt(task(), [], [exemption('2026-01-01', '2026-01-08')], '2026-01-10', 1);
    expect(tg.scheduledDays).toEqual(['2026-01-09', '2026-01-10']);
    expect(tg.missedSet).toEqual(new Set(['2026-01-09']));
  });
});

describe('deriveGoalGantt 单目标派生', () => {
  it('summarySpan = 子任务 min(start)..max(end)；无任务 = null', () => {
    const g = deriveGoalGantt({
      goalId: 'g1',
      tasks: [
        task({ id: 't1' }),
        task({ id: 't2', startDate: '2026-02-01', endDate: '2026-03-15' }),
      ],
      checkIns: [],
      exemptions: [],
      today: '2026-01-10',
      weekStartsOn: 1,
    });
    expect(g.summarySpan).toEqual({ startDate: '2026-01-01', endDate: '2026-03-15' });
    expect(g.perTask.size).toBe(2);

    const empty = deriveGoalGantt({
      goalId: 'g1',
      tasks: [],
      checkIns: [],
      exemptions: [],
      today: '2026-01-10',
      weekStartsOn: 1,
    });
    expect(empty.summarySpan).toBeNull();
    expect(empty.aggregatedHeat).toEqual([]);
  });

  it('aggregatedHeat 应打卡日并集去重（同日两任务只算一天）', () => {
    const g = deriveGoalGantt({
      goalId: 'g1',
      tasks: [
        task({ id: 't1', endDate: '2026-01-03' }),
        task({ id: 't2', endDate: '2026-01-03' }),
      ],
      checkIns: [],
      exemptions: [],
      today: '2026-01-10',
      weekStartsOn: 1,
    });
    expect(g.aggregatedHeat).toHaveLength(1);
    expect(g.aggregatedHeat[0].scheduled).toBe(3); // 并集 3 天而非 6
  });

  it('排除软删除任务与其他目标任务', () => {
    const g = deriveGoalGantt({
      goalId: 'g1',
      tasks: [
        task({ id: 't1' }),
        task({ id: 't2', deletedAt: '2026-01-02T00:00:00.000Z' }),
        task({ id: 't3', goalId: 'g-other' }),
      ],
      checkIns: [],
      exemptions: [],
      today: '2026-01-10',
      weekStartsOn: 1,
    });
    expect([...g.perTask.keys()]).toEqual(['t1']);
  });
});

describe('goalMonthlyRate 目标月完成率', () => {
  it('done=1、partial=0.5 计权，分母为该月截至今天的应打卡日之和', () => {
    // t1 每日 1/1-1/4：done 1 天 + partial 1 天 → (1+0.5)/4 截至 today=1/4
    const g = deriveGoalGantt({
      goalId: 'g1',
      tasks: [task({ id: 't1', endDate: '2026-01-04' })],
      checkIns: [checkIn('2026-01-01', 'done'), checkIn('2026-01-02', 'partial')],
      exemptions: [],
      today: '2026-01-04',
      weekStartsOn: 1,
    });
    expect(goalMonthlyRate(g, '2026-01', '2026-01-04')).toBe(38); // 1.5/4 = 37.5 → 38
  });

  it('未来日与非本月日不计入；无应打卡日返回 null', () => {
    const g = deriveGoalGantt({
      goalId: 'g1',
      tasks: [task({ id: 't1', startDate: '2026-01-01', endDate: '2026-02-10' })],
      checkIns: [checkIn('2026-01-01', 'done')],
      exemptions: [],
      today: '2026-01-02',
      weekStartsOn: 1,
    });
    expect(goalMonthlyRate(g, '2026-01', '2026-01-02')).toBe(50); // 分母只有 1/1、1/2
    expect(goalMonthlyRate(g, '2026-02', '2026-01-02')).toBeNull(); // 2 月还没到
  });
});
