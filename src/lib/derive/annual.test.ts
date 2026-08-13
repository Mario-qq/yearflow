import { describe, expect, it } from 'vitest';
import type {
  CheckIn,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  Task,
} from '../../types/domain';
import {
  annualIndex,
  bestWorstMonth,
  driftRanking,
  equivalentWorkdays,
  focusByHourDow,
  goalOutcomes,
  goalShares,
  investedMsByGoal,
  investedTotals,
  longestRunOf,
  milestoneStats,
  monthProfiles,
  rangeOf,
} from './annual';
import { calcStreak } from './streak';
import { effectiveMsByGoalPrefix } from './focus';
import { minutesByGoalByMonth } from './review';

const MIN = 60_000;
/* 2026 日历参考：01-01 周四；08-13 周四（dow=4） */

const goal = (id: string, patch: Partial<Goal> = {}): Goal => ({
  id,
  name: `目标${id}`,
  color: 'goal-1',
  order: 0,
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const task = (id: string, goalId: string, patch: Partial<Task> = {}): Task => ({
  id,
  goalId,
  name: `任务${id}`,
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  progress: 0,
  progressMode: 'manual',
  status: 'active',
  order: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const checkIn = (
  goalId: string,
  date: string,
  status: CheckIn['status'],
  patch: Partial<CheckIn> = {},
): CheckIn => ({
  id: `c-${goalId}-${date}-${status}-${patch.taskId ?? ''}`,
  goalId,
  date,
  status,
  createdAt: `${date}T20:00:00.000Z`,
  updatedAt: `${date}T20:00:00.000Z`,
  ...patch,
});

/** startAt 用本地时间构造，避免测试随 TZ 漂移 */
const session = (patch: Partial<FocusSession> = {}): FocusSession => {
  const startAt = patch.startAt ?? new Date(2026, 7, 13, 9, 0, 0).toISOString();
  return {
    id: `fs-${startAt}-${patch.goalId ?? ''}-${patch.taskId ?? ''}`,
    goalId: 'g1',
    taskId: 't1',
    date: '2026-08-13',
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 25 * MIN).toISOString(),
    focusMs: 25 * MIN,
    plannedMs: 25 * MIN,
    outcome: 'completed',
    source: 'timer',
    createdAt: startAt,
    updatedAt: startAt,
    ...patch,
  };
};

const exemption = (
  startDate: string,
  endDate: string,
  goalIds?: string[],
): ExemptionPeriod => ({
  id: `e-${startDate}`,
  startDate,
  endDate,
  ...(goalIds ? { goalIds } : {}),
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// ────────────────────────────── rangeOf ──────────────────────────────

describe('rangeOf 区间引擎', () => {
  it('7 种 kind 的自然边界与月份前缀（整月对齐）', () => {
    expect(rangeOf(2026, 'full', '2026-12-31')).toMatchObject({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(rangeOf(2026, 'h1', '2026-12-31').end).toBe('2026-06-30');
    expect(rangeOf(2026, 'h2', '2026-12-31').start).toBe('2026-07-01');
    expect(rangeOf(2026, 'q1', '2026-12-31')).toMatchObject({
      start: '2026-01-01',
      end: '2026-03-31',
    });
    expect(rangeOf(2026, 'q2', '2026-12-31').end).toBe('2026-06-30');
    expect(rangeOf(2026, 'q3', '2026-12-31')).toMatchObject({
      start: '2026-07-01',
      end: '2026-09-30',
    });
    expect(rangeOf(2026, 'q4', '2026-12-31').start).toBe('2026-10-01');
    expect(rangeOf(2026, 'q1', '2026-12-31').monthPrefixes).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(rangeOf(2026, 'full', '2026-12-31').monthPrefixes).toHaveLength(12);
  });

  it('clippedEnd 裁到今天并置 clipped（界面据此标注「统计截至」）', () => {
    const r = rangeOf(2026, 'full', '2026-08-14');
    expect(r.clippedEnd).toBe('2026-08-14');
    expect(r.clipped).toBe(true);
    const done = rangeOf(2026, 'q1', '2026-08-14');
    expect(done.clippedEnd).toBe('2026-03-31');
    expect(done.clipped).toBe(false);
  });

  it('看未来区间 ⇒ clippedEnd 落在 start 之前，[start, clippedEnd] 自然为空集', () => {
    const r = rangeOf(2027, 'full', '2026-08-14');
    expect(r.clippedEnd).toBe('2026-12-31');
    expect(r.clippedEnd < r.start).toBe(true);
    expect(r.clipped).toBe(true);
  });
});

// ─────────────────── 投入时长：口径交叉断言（防漂移护栏） ───────────────────

describe('investedMsByGoal 投入时长', () => {
  const checkIns = [
    checkIn('g1', '2026-01-05', 'done', { taskId: 't1', minutes: 30 }),
    checkIn('g1', '2026-02-20', 'done', { taskId: 't1', minutes: 60 }),
    // 同 (task, date) 手填 20 与番茄 25 竞争 ⇒ 取 max = 25
    checkIn('g1', '2026-08-13', 'done', { taskId: 't1', minutes: 20 }),
    checkIn('g2', '2026-03-01', 'partial', { taskId: 't3', minutes: 45 }),
  ];
  const sessions = [
    session(),
    session({ goalId: 'g2', taskId: 't3', date: '2026-03-01', startAt: new Date(2026, 2, 1, 10).toISOString() }),
  ];

  it('全年前缀结果 === 逐月前缀求和（ms 级严格相等）', () => {
    const range = rangeOf(2026, 'full', '2026-12-31');
    const byYear = investedMsByGoal(checkIns, sessions, ['g1', 'g2'], range);

    for (const goalId of ['g1', 'g2']) {
      const yearMs = effectiveMsByGoalPrefix(checkIns, sessions, goalId, '2026-');
      let monthSum = 0;
      for (const p of range.monthPrefixes) {
        monthSum += effectiveMsByGoalPrefix(checkIns, sessions, goalId, p);
      }
      expect(byYear.get(goalId)).toBe(yearMs);
      expect(monthSum).toBe(yearMs);
    }
  });

  it('逐月取整后与 minutesByGoalByMonth 一致（与复盘页零漂移）', () => {
    const byMonth = minutesByGoalByMonth(checkIns, 2026, sessions);
    for (let m = 1; m <= 12; m += 1) {
      const prefix = `2026-${String(m).padStart(2, '0')}`;
      for (const goalId of ['g1', 'g2']) {
        const ms = effectiveMsByGoalPrefix(checkIns, sessions, goalId, prefix);
        const expected = byMonth.get(m)?.get(goalId);
        if (expected === undefined) {
          expect(ms).toBe(0);
        } else {
          expect(Math.round(ms / 60000)).toBe(expected);
        }
      }
    }
  });

  it('半年区间只累加该半年的月份', () => {
    const h1 = investedMsByGoal(checkIns, sessions, ['g1'], rangeOf(2026, 'h1', '2026-12-31'));
    const h2 = investedMsByGoal(checkIns, sessions, ['g1'], rangeOf(2026, 'h2', '2026-12-31'));
    expect(h1.get('g1')).toBe(90 * MIN); // 01-05 的 30 + 02-20 的 60
    expect(h2.get('g1')).toBe(25 * MIN); // 08-13 取 max(20, 25)
  });

  it('未归类会话进 unassignedMs，且不进任何目标', () => {
    const withUnassigned = [
      ...sessions,
      session({ goalId: undefined, taskId: undefined, date: '2026-05-05', startAt: new Date(2026, 4, 5, 14).toISOString(), focusMs: 30 * MIN }),
    ];
    const t = investedTotals(checkIns, withUnassigned, ['g1', 'g2'], rangeOf(2026, 'full', '2026-12-31'));
    expect(t.unassignedMs).toBe(30 * MIN);
    expect(t.unassignedCount).toBe(1);
    expect(t.goalTotalMs).toBe((t.byGoal.get('g1') ?? 0) + (t.byGoal.get('g2') ?? 0));
    // 未归类那 30 分钟不能悄悄混进目标合计（hero 数字要能分别报出来）
    const withoutUnassigned = investedTotals(checkIns, sessions, ['g1', 'g2'], rangeOf(2026, 'full', '2026-12-31'));
    expect(t.goalTotalMs).toBe(withoutUnassigned.goalTotalMs);
  });
});

describe('equivalentWorkdays', () => {
  it('按 8 小时工作日换算，不取整', () => {
    expect(equivalentWorkdays(8 * 3_600_000)).toBe(1);
    expect(equivalentWorkdays(4 * 3_600_000)).toBe(0.5);
    expect(equivalentWorkdays(4 * 3_600_000, 4)).toBe(1);
    expect(equivalentWorkdays(100, 0)).toBe(0);
  });
});

// ────────────────────────── goalShares 错配镜 ──────────────────────────

describe('goalShares 错配镜', () => {
  const goals = [goal('g1'), goal('g2'), goal('g3')];

  it('plannedTaskDays 按任务求和，不被按日并集压扁', () => {
    // g1 两个任务完全重叠：并集是 10 天，按任务求和是 20 —— 后者才是「两份力气」
    const tasks = [task('t1', 'g1'), task('t2', 'g1'), task('t3', 'g2')];
    const shares = goalShares({
      goals,
      tasks,
      exemptions: [],
      checkIns: [],
      sessions: [],
      range: rangeOf(2026, 'full', '2026-12-31'),
    });
    const g1 = shares.find((s) => s.goalId === 'g1');
    const g2 = shares.find((s) => s.goalId === 'g2');
    expect(g1?.plannedTaskDays).toBe(20);
    expect(g2?.plannedTaskDays).toBe(10);
    expect(g1?.plannedShare).toBeCloseTo(20 / 30, 6);
  });

  it('免打卡区间照常扣除', () => {
    const tasks = [task('t1', 'g1'), task('t2', 'g1')];
    const shares = goalShares({
      goals,
      tasks,
      exemptions: [exemption('2026-01-05', '2026-01-06', ['g1'])],
      checkIns: [],
      sessions: [],
      range: rangeOf(2026, 'full', '2026-12-31'),
    });
    expect(shares.find((s) => s.goalId === 'g1')?.plannedTaskDays).toBe(16); // (10-2)*2
  });

  it('左端裁到 range.start：区间外的应打卡日不计', () => {
    const tasks = [task('t1', 'g1', { startDate: '2026-03-25', endDate: '2026-04-05' })];
    const shares = goalShares({
      goals,
      tasks,
      exemptions: [],
      checkIns: [],
      sessions: [],
      range: rangeOf(2026, 'q2', '2026-12-31'),
    });
    expect(shares.find((s) => s.goalId === 'g1')?.plannedTaskDays).toBe(5); // 04-01..04-05
  });

  it('全随缘目标：plannedTaskDays=0 且标 adhocOnly / noPlan，不可判为错配', () => {
    const tasks = [
      task('t1', 'g1'),
      task('a1', 'g3', { recurrence: { type: 'adhoc' }, startDate: '2026-01-01', endDate: '2026-12-31' }),
    ];
    const shares = goalShares({
      goals,
      tasks,
      exemptions: [],
      checkIns: [checkIn('g3', '2026-05-05', 'done', { taskId: 'a1', minutes: 60 })],
      sessions: [],
      range: rangeOf(2026, 'full', '2026-12-31'),
    });
    const g3 = shares.find((s) => s.goalId === 'g3');
    expect(g3?.plannedTaskDays).toBe(0);
    expect(g3?.adhocOnly).toBe(true);
    expect(g3?.noPlan).toBe(true);
    expect(g3?.investedShare).toBeGreaterThan(0); // 有真实投入，却没有计划权重
    // 分母只由有排期的目标贡献 ⇒ g1 独占 100%
    expect(shares.find((s) => s.goalId === 'g1')?.plannedShare).toBe(1);
  });

  it('区间内无任务的目标标 noPlan 但不标 adhocOnly（原因不同，界面措辞不同）', () => {
    const shares = goalShares({
      goals: [goal('g1'), goal('g2')],
      tasks: [task('t1', 'g1')],
      exemptions: [],
      checkIns: [],
      sessions: [],
      range: rangeOf(2026, 'full', '2026-12-31'),
    });
    const g2 = shares.find((s) => s.goalId === 'g2');
    expect(g2?.noPlan).toBe(true);
    expect(g2?.adhocOnly).toBe(false);
  });
});

// ─────────────────── monthProfiles / bestWorstMonth ───────────────────

describe('monthProfiles 与最强/最弱月', () => {
  const goals = [goal('g1'), goal('g2')];
  // g1 全 1 月应打卡 31 天；g2 只有 1 月 1 天应打卡
  const tasks = [
    task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-02-28' }),
    task('t2', 'g2', { startDate: '2026-01-01', endDate: '2026-01-01' }),
  ];

  it('rate 是合计率（Σscore/Σscheduled），不是各目标率的平均', () => {
    // 1 月：g1 31 天打了 0 天；g2 1 天打满 ⇒ 合计 1/32 = 3%（各目标率平均会是 50%）
    const profiles = monthProfiles({
      goals,
      tasks,
      checkIns: [checkIn('g2', '2026-01-01', 'done', { taskId: 't2' })],
      exemptions: [],
      sessions: [],
      range: rangeOf(2026, 'q1', '2026-12-31'),
      today: '2026-12-31',
    });
    const jan = profiles.find((p) => p.month === '2026-01');
    expect(jan?.scheduled).toBe(32);
    expect(jan?.score).toBe(1);
    expect(jan?.rate).toBe(3);
  });

  it('无应打卡月 rate=null 且 eligible=false', () => {
    const profiles = monthProfiles({
      goals,
      tasks,
      checkIns: [],
      exemptions: [],
      range: rangeOf(2026, 'q1', '2026-12-31'),
      sessions: [],
      today: '2026-12-31',
    });
    const mar = profiles.find((p) => p.month === '2026-03');
    expect(mar?.rate).toBeNull();
    expect(mar?.eligible).toBe(false);
  });

  it('进行中的当月不可参与评选（3 天 100% 不该夺冠）', () => {
    const profiles = monthProfiles({
      goals,
      tasks,
      checkIns: [],
      exemptions: [],
      sessions: [],
      range: rangeOf(2026, 'full', '2026-02-03'),
      today: '2026-02-03',
    });
    expect(profiles.find((p) => p.month === '2026-01')?.eligible).toBe(true);
    expect(profiles.find((p) => p.month === '2026-02')?.eligible).toBe(false);
  });

  it('可评选月份少于 2 个 ⇒ bestWorstMonth 返回 null（对比的价值全在两者之差）', () => {
    const profiles = monthProfiles({
      goals,
      tasks,
      checkIns: [],
      exemptions: [],
      sessions: [],
      range: rangeOf(2026, 'q1', '2026-02-03'),
      today: '2026-02-03',
    });
    expect(bestWorstMonth(profiles)).toBeNull();
  });

  it('两个以上可评选月份 ⇒ 选出最高与最低', () => {
    const profiles = monthProfiles({
      goals: [goal('g1')],
      tasks: [task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-02-28' })],
      checkIns: [
        // 1 月打 31 天满，2 月一天不打
        ...Array.from({ length: 31 }, (_, i) =>
          checkIn('g1', `2026-01-${String(i + 1).padStart(2, '0')}`, 'done', { taskId: 't1' }),
        ),
      ],
      exemptions: [],
      sessions: [],
      range: rangeOf(2026, 'q1', '2026-03-31'),
      today: '2026-03-31',
    });
    const bw = bestWorstMonth(profiles);
    expect(bw?.best.month).toBe('2026-01');
    expect(bw?.best.rate).toBe(100);
    expect(bw?.worst.month).toBe('2026-02');
    expect(bw?.worst.rate).toBe(0);
  });
});

// ──────────────── longestRunOf：与 calcStreak 口径锁定 ────────────────

describe('longestRunOf 最长连续与打断日', () => {
  const tasks = [task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-01-20' })];
  const today = '2026-01-21';
  const done = (d: string) => checkIn('g1', d, 'done', { taskId: 't1' });

  // 01-01..05 done / 01-06 缺 / 01-07..14 done / 01-15 skipped / 01-16..18 done / 01-19,20 缺
  const checkIns = [
    ...['01', '02', '03', '04', '05'].map((d) => done(`2026-01-${d}`)),
    ...['07', '08', '09', '10', '11', '12', '13', '14'].map((d) => done(`2026-01-${d}`)),
    checkIn('g1', '2026-01-15', 'skipped', { taskId: 't1' }),
    ...['16', '17', '18'].map((d) => done(`2026-01-${d}`)),
  ];

  it('days 与 calcStreak().longest 严格相等（防漂移护栏）', () => {
    const run = longestRunOf({
      goalId: 'g1',
      tasks,
      checkIns,
      exemptions: [],
      today,
      range: rangeOf(2026, 'full', today),
    });
    const streak = calcStreak({ goalId: 'g1', tasks, checkIns, exemptions: [], today });
    expect(run?.days).toBe(streak.longest);
    expect(run?.days).toBe(11);
  });

  it('skipped 不打断不计数；记录起止与打断日', () => {
    const run = longestRunOf({
      goalId: 'g1',
      tasks,
      checkIns,
      exemptions: [],
      today,
      range: rangeOf(2026, 'full', today),
    });
    expect(run).toMatchObject({
      from: '2026-01-07',
      to: '2026-01-18',
      days: 11,
      breakDate: '2026-01-19',
      breakKind: 'missed',
    });
  });

  it('跑到区间末未被打断 ⇒ 无 breakDate', () => {
    const all = Array.from({ length: 20 }, (_, i) =>
      done(`2026-01-${String(i + 1).padStart(2, '0')}`),
    );
    const run = longestRunOf({
      goalId: 'g1',
      tasks,
      checkIns: all,
      exemptions: [],
      today,
      range: rangeOf(2026, 'full', today),
    });
    expect(run?.days).toBe(20);
    expect(run?.breakDate).toBeUndefined();
    expect(run?.breakKind).toBeUndefined();
  });

  it('无应打卡日 ⇒ null', () => {
    expect(
      longestRunOf({
        goalId: 'g9',
        tasks,
        checkIns,
        exemptions: [],
        today,
        range: rangeOf(2026, 'full', today),
      }),
    ).toBeNull();
  });
});

// ──────────────── goalOutcomes 完成与放弃 ────────────────

describe('goalOutcomes 完成与放弃', () => {
  const today = '2026-08-14';
  const range = rangeOf(2026, 'full', today);
  const base = { exemptions: [], sessions: [], range, today };

  it('completedAt 存在 ⇒ completed（判定链第 1 条）', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1', { completedAt: '2026-06-01T00:00:00.000Z' })],
      tasks: [task('t1', 'g1')],
      checkIns: [],
    });
    expect(cards[0].outcome).toBe('completed');
  });

  it('全部任务 done ⇒ completed（虽未手动标记）', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1')],
      tasks: [task('t1', 'g1', { status: 'done' }), task('t2', 'g1', { status: 'done' })],
      checkIns: [],
    });
    expect(cards[0].outcome).toBe('completed');
  });

  it('剩余未完成任务全是随缘 ⇒ adhocOnly（不催、不指责），即使长期无活动', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1')],
      tasks: [
        task('t1', 'g1', { status: 'done' }),
        task('a1', 'g1', { recurrence: { type: 'adhoc' }, endDate: '2026-12-31' }),
      ],
      checkIns: [checkIn('g1', '2026-01-05', 'done', { taskId: 'a1' })],
    });
    expect(cards[0].outcome).toBe('adhocOnly');
    expect(cards[0].idleDays).toBeGreaterThan(30);
  });

  it('超过阈值无活动 ⇒ stalled，并保留 lastActivityDate 供人眼申辩', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1')],
      tasks: [task('t1', 'g1', { endDate: '2026-12-31' })],
      checkIns: [checkIn('g1', '2026-05-12', 'done', { taskId: 't1' })],
    });
    expect(cards[0].outcome).toBe('stalled');
    expect(cards[0].lastActivityDate).toBe('2026-05-12');
    expect(cards[0].idleDays).toBe(94); // 05-13..08-14
  });

  it('免打卡区间从间隔里扣除 ⇒ 出差不算放弃', () => {
    const goals = [goal('g1')];
    const tasks = [task('t1', 'g1', { endDate: '2026-12-31' })];
    const checkIns = [checkIn('g1', '2026-06-01', 'done', { taskId: 't1' })];
    const bare = goalOutcomes({ ...base, goals, tasks, checkIns });
    expect(bare[0].outcome).toBe('stalled');

    const withExempt = goalOutcomes({
      ...base,
      exemptions: [exemption('2026-06-02', '2026-08-01', ['g1'])],
      goals,
      tasks,
      checkIns,
    });
    expect(withExempt[0].idleDays).toBe(13); // 08-02..08-14
    expect(withExempt[0].outcome).toBe('active');
  });

  it('番茄会话也算活动', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1')],
      tasks: [task('t1', 'g1', { endDate: '2026-12-31' })],
      checkIns: [],
      sessions: [session({ date: '2026-08-13', startAt: new Date(2026, 7, 13, 9).toISOString() })],
    });
    expect(cards[0].lastActivityDate).toBe('2026-08-13');
    expect(cards[0].outcome).toBe('active');
  });

  it('archived / 软删目标整个不进列表', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [
        goal('g1', { archived: true }),
        goal('g2', { deletedAt: '2026-02-01T00:00:00.000Z' }),
        goal('g3'),
      ],
      tasks: [task('t3', 'g3', { endDate: '2026-12-31' })],
      checkIns: [checkIn('g3', '2026-08-13', 'done', { taskId: 't3' })],
    });
    expect(cards.map((c) => c.goalId)).toEqual(['g3']);
  });

  it('progressPct 按跨度天数加权', () => {
    const cards = goalOutcomes({
      ...base,
      goals: [goal('g1')],
      tasks: [
        // 10 天 100% + 30 天 0% ⇒ 1000/40 = 25
        task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-01-10', progress: 100 }),
        task('t2', 'g1', { startDate: '2026-02-01', endDate: '2026-03-02', progress: 0 }),
      ],
      checkIns: [checkIn('g1', '2026-08-13', 'done', { taskId: 't1' })],
    });
    expect(cards[0].progressPct).toBe(25);
  });
});

// ──────────────── driftRanking / milestoneStats ────────────────

describe('driftRanking 计划 vs 现实', () => {
  it('只收正漂移、降序、不与提前抵消，并暴露无基线任务数', () => {
    const tasks = [
      task('t1', 'g1', {
        endDate: '2026-02-11',
        baseline: { startDate: '2026-01-01', endDate: '2026-01-10' },
      }), // +32
      task('t2', 'g1', {
        endDate: '2026-01-15',
        baseline: { startDate: '2026-01-01', endDate: '2026-01-10' },
      }), // +5
      task('t3', 'g1', {
        endDate: '2026-01-05',
        baseline: { startDate: '2026-01-01', endDate: '2026-01-10' },
      }), // -5 提前，不计
      task('t4', 'g1'), // 无基线
    ];
    const { rows, totalDelayDays, noBaselineCount } = driftRanking(
      tasks,
      rangeOf(2026, 'full', '2026-12-31'),
    );
    expect(rows.map((r) => r.taskId)).toEqual(['t1', 't2']);
    expect(rows[0].driftDays).toBe(32);
    expect(totalDelayDays).toBe(37); // 32 + 5，提前的 -5 不抵消
    expect(noBaselineCount).toBe(1);
  });

  it('区间过滤用自然 end（计划漂移与「今天」无关）', () => {
    const tasks = [
      task('t1', 'g1', {
        startDate: '2026-11-01',
        endDate: '2026-12-20',
        baseline: { startDate: '2026-11-01', endDate: '2026-12-01' },
      }),
    ];
    // 今天在 8 月，但 Q4 区间照样统计到 12 月的漂移
    expect(driftRanking(tasks, rangeOf(2026, 'q4', '2026-08-14')).rows).toHaveLength(1);
    expect(driftRanking(tasks, rangeOf(2026, 'q1', '2026-08-14')).rows).toHaveLength(0);
  });
});

describe('milestoneStats 里程碑', () => {
  const ms = (id: string, date: string, achieved: boolean): Milestone => ({
    id,
    goalId: 'g1',
    name: `碑${id}`,
    date,
    achieved,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('按日期升序、统计达成数、区间外与软删不计', () => {
    const s = milestoneStats(
      [
        ms('m2', '2026-06-01', true),
        ms('m1', '2026-03-01', false),
        ms('m3', '2025-12-31', true),
        { ...ms('m4', '2026-04-01', true), deletedAt: '2026-05-01T00:00:00.000Z' },
      ],
      rangeOf(2026, 'full', '2026-12-31'),
    );
    expect(s.rows.map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(s.total).toBe(2);
    expect(s.achieved).toBe(1);
  });
});

// ──────────────── focusByHourDow 节律画像 ────────────────

describe('focusByHourDow 节律画像', () => {
  const range = rangeOf(2026, 'full', '2026-12-31');

  it('区间归属看 date，钟点与星期取 startAt（2026-08-13 是周四 dow=4）', () => {
    const cells = focusByHourDow(
      [session({ startAt: new Date(2026, 7, 13, 9, 0).toISOString(), date: '2026-08-13' })],
      range,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ dow: 4, hour: 9, count: 1, ms: 25 * MIN });
  });

  it('date 被显式改归相邻日时，钟点仍按真实 startAt 算', () => {
    // 23:30 开始、date 被改到次日 ⇒ 区间用 date（8 月，在内），钟点仍是 23、星期仍是周四
    const cells = focusByHourDow(
      [session({ startAt: new Date(2026, 7, 13, 23, 30).toISOString(), date: '2026-08-14' })],
      range,
    );
    expect(cells[0]).toMatchObject({ dow: 4, hour: 23 });
  });

  it('被打断率 = 提前停止段数 / 段数；discarded 与软删不计', () => {
    const at = (h: number, m = 0) => new Date(2026, 7, 13, h, m).toISOString();
    const cells = focusByHourDow(
      [
        session({ id: 'a', startAt: at(9, 0), outcome: 'completed' }),
        session({ id: 'b', startAt: at(9, 30), outcome: 'stopped', focusMs: 10 * MIN }),
        session({ id: 'c', startAt: at(9, 45), outcome: 'discarded' }),
        { ...session({ id: 'd', startAt: at(9, 50) }), deletedAt: '2026-08-14T00:00:00.000Z' },
      ],
      range,
    );
    expect(cells[0].count).toBe(2);
    expect(cells[0].interruptedRate).toBe(0.5);
    expect(cells[0].ms).toBe(35 * MIN);
  });

  it('区间外的会话不计', () => {
    const cells = focusByHourDow(
      [session({ date: '2026-08-13' })],
      rangeOf(2026, 'q1', '2026-12-31'),
    );
    expect(cells).toHaveLength(0);
  });
});

// ──────────────── annualIndex 汇总 ────────────────

describe('annualIndex 汇总', () => {
  const args = {
    goals: [goal('g1')],
    tasks: [task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-12-31' })],
    milestones: [],
    checkIns: [checkIn('g1', '2026-08-13', 'done', { taskId: 't1', minutes: 30 })],
    exemptions: [],
    sessions: [session()],
    year: 2026,
    kind: 'full' as const,
    today: '2026-08-14',
  };

  it('一次算完全部 beat 数据，并给出封面进度', () => {
    const idx = annualIndex(args);
    expect(idx.empty).toBe(false);
    expect(idx.totalDays).toBe(365);
    expect(idx.elapsedDays).toBe(226); // 01-01..08-14
    expect(idx.checkInCount).toBe(1);
    expect(idx.invested.byGoal.get('g1')).toBe(30 * MIN); // max(手填 30, 番茄 25)
    expect(idx.range.clipped).toBe(true);
    expect(idx.shares).toHaveLength(1);
    expect(idx.months).toHaveLength(12);
    expect(idx.rhythm).toHaveLength(1);
  });

  it('区间零数据 ⇒ empty=true（界面走整页空态）', () => {
    const idx = annualIndex({ ...args, year: 2024 });
    expect(idx.empty).toBe(true);
    expect(idx.invested.goalTotalMs).toBe(0);
  });

  it('runs 按天数降序', () => {
    const idx = annualIndex({
      ...args,
      goals: [goal('g1'), goal('g2')],
      tasks: [
        task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-01-10' }),
        task('t2', 'g2', { startDate: '2026-01-01', endDate: '2026-01-10' }),
      ],
      checkIns: [
        ...['01', '02', '03'].map((d) =>
          checkIn('g1', `2026-01-${d}`, 'done', { taskId: 't1' }),
        ),
        ...['01', '02', '03', '04', '05'].map((d) =>
          checkIn('g2', `2026-01-${d}`, 'done', { taskId: 't2' }),
        ),
      ],
    });
    expect(idx.runs.map((r) => r.goalId)).toEqual(['g2', 'g1']);
    expect(idx.runs[0].days).toBe(5);
  });
});
