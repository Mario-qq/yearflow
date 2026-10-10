import { describe, expect, it } from 'vitest';
import type {
  CheckIn,
  ExemptionPeriod,
  FocusSession,
  Goal,
  Milestone,
  MonthlyReview,
  Task,
} from '../../types/domain';
import {
  annualIndex,
  bestMonth,
  dailyCells,
  focusByHourDow,
  goalOutcomes,
  investedOf,
  longestActiveSpan,
  longestRunOf,
  milestoneStats,
  monthProfiles,
  rangeOf,
} from './annual';
import { calcStreak } from './streak';
import { effectiveMsByGoalPrefix } from './focus';
import { dailyActivityScores, minutesByGoalByMonth } from './review';

const MIN = 60_000;
const HOUR = 60 * MIN;
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

const exemption = (startDate: string, endDate: string, goalIds?: string[]): ExemptionPeriod => ({
  id: `e-${startDate}`,
  startDate,
  endDate,
  ...(goalIds ? { goalIds } : {}),
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const review = (month: string, rating?: number, patch: Partial<MonthlyReview> = {}): MonthlyReview => ({
  id: `r-${month}`,
  month,
  content: '',
  ...(rating ? { rating } : {}),
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

// ────────────────────────────── rangeOf ──────────────────────────────

describe('rangeOf 区间引擎', () => {
  it('7 种 kind 的自然边界与月份前缀（整月对齐）', () => {
    expect(rangeOf(2026, 'full', '2026-12-31')).toMatchObject({ start: '2026-01-01', end: '2026-12-31' });
    expect(rangeOf(2026, 'h1', '2026-12-31').end).toBe('2026-06-30');
    expect(rangeOf(2026, 'h2', '2026-12-31').start).toBe('2026-07-01');
    expect(rangeOf(2026, 'q1', '2026-12-31')).toMatchObject({ start: '2026-01-01', end: '2026-03-31' });
    expect(rangeOf(2026, 'q3', '2026-12-31')).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
    expect(rangeOf(2026, 'q4', '2026-12-31').start).toBe('2026-10-01');
    expect(rangeOf(2026, 'q1', '2026-12-31').monthPrefixes).toEqual(['2026-01', '2026-02', '2026-03']);
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
    expect(r.clippedEnd < r.start).toBe(true);
    expect(r.clipped).toBe(true);
  });
});

// ─────────────────── 投入时长：口径交叉断言（防漂移护栏） ───────────────────

describe('investedOf 投入时长', () => {
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
  const full = rangeOf(2026, 'full', '2026-12-31');

  it('逐月之和 === 年前缀（ms 级严格相等）', () => {
    const inv = investedOf(checkIns, sessions, ['g1', 'g2'], full);
    for (const goalId of ['g1', 'g2']) {
      const row = inv.goals.find((g) => g.goalId === goalId)!;
      expect(row.ms).toBe(effectiveMsByGoalPrefix(checkIns, sessions, goalId, '2026-'));
    }
  });

  it('逐月取整后与 minutesByGoalByMonth 一致（与复盘页零漂移）', () => {
    const inv = investedOf(checkIns, sessions, ['g1', 'g2'], full);
    const byMonth = minutesByGoalByMonth(checkIns, 2026, sessions);
    for (const row of inv.goals) {
      row.byMonth.forEach((ms, i) => {
        const expected = byMonth.get(i + 1)?.get(row.goalId);
        expect(Math.round(ms / MIN)).toBe(expected ?? 0);
      });
    }
  });

  it('半年区间只累加该半年的月份；按 ms 降序；零投入的目标不出现', () => {
    const h1 = investedOf(checkIns, sessions, ['g1', 'g2', 'g3'], rangeOf(2026, 'h1', '2026-12-31'));
    expect(h1.goals.map((g) => g.goalId)).toEqual(['g1', 'g2']); // g1 90 分钟 > g2 45
    expect(h1.goals[0].ms).toBe(90 * MIN);
    expect(h1.goals[0].byMonth).toHaveLength(6);
    const h2 = investedOf(checkIns, sessions, ['g1'], rangeOf(2026, 'h2', '2026-12-31'));
    expect(h2.goals[0].ms).toBe(25 * MIN); // 08-13 取 max(20, 25)
  });

  it('未归类会话单列，share 的分母含未归类（加起来 = 1）', () => {
    const withUn = [
      ...sessions,
      session({ goalId: undefined, taskId: undefined, date: '2026-05-05', startAt: new Date(2026, 4, 5, 14).toISOString(), focusMs: 30 * MIN }),
    ];
    const inv = investedOf(checkIns, withUn, ['g1', 'g2'], full);
    expect(inv.unassignedMs).toBe(30 * MIN);
    expect(inv.unassignedByMonth[4]).toBe(30 * MIN);
    expect(inv.totalMs).toBe(inv.goalTotalMs + 30 * MIN);
    const shareSum = inv.goals.reduce((a, g) => a + g.share, 0) + inv.unassignedMs / inv.totalMs;
    expect(shareSum).toBeCloseTo(1, 10);
  });
});

// ─────────────────── 逐日活动 ───────────────────

describe('dailyCells 逐日活动', () => {
  const range = rangeOf(2026, 'q1', '2026-02-10');

  it('打卡分与复盘页热力图 dailyActivityScores 同口径（同日多条取最强，skipped 不计）', () => {
    const checkIns = [
      checkIn('g1', '2026-01-05', 'partial'),
      checkIn('g1', '2026-01-05', 'done', { id: 'dup' }),
      checkIn('g2', '2026-01-05', 'partial'),
      checkIn('g2', '2026-01-06', 'skipped'),
    ];
    const cells = dailyCells(checkIns, [], ['g1', 'g2'], range);
    const ref = dailyActivityScores(checkIns, 2026);
    expect(cells).toHaveLength(90);
    for (const c of cells) expect(c.score).toBe(ref.get(c.date) ?? 0);
    expect(cells.find((c) => c.date === '2026-01-05')?.score).toBe(1.5);
  });

  it('主角目标 = 打卡分 + 专注小时 最大者；专注含未归类但未归类不当主角', () => {
    const cells = dailyCells(
      [checkIn('g1', '2026-01-07', 'done')],
      [
        session({ goalId: 'g2', taskId: 't2', date: '2026-01-07', startAt: new Date(2026, 0, 7, 9).toISOString(), focusMs: 2 * HOUR }),
        session({ goalId: undefined, taskId: undefined, date: '2026-01-08', startAt: new Date(2026, 0, 8, 9).toISOString(), focusMs: HOUR }),
      ],
      ['g1', 'g2'],
      range,
    );
    const d7 = cells.find((c) => c.date === '2026-01-07')!;
    expect(d7.topGoalId).toBe('g2'); // 2 小时 > 1 分
    expect(d7.focusMs).toBe(2 * HOUR);
    const d8 = cells.find((c) => c.date === '2026-01-08')!;
    expect(d8.focusMs).toBe(HOUR);
    expect(d8.topGoalId).toBeUndefined();
  });

  it('clippedEnd 之后标 future；软删与区间外的记录不计', () => {
    const cells = dailyCells(
      [
        checkIn('g1', '2026-01-09', 'done', { deletedAt: '2026-01-10T00:00:00.000Z' }),
        checkIn('g1', '2025-12-31', 'done'),
      ],
      [],
      ['g1'],
      range,
    );
    expect(cells.every((c) => c.score === 0)).toBe(true);
    expect(cells.find((c) => c.date === '2026-02-10')?.future).toBe(false);
    expect(cells.find((c) => c.date === '2026-02-11')?.future).toBe(true);
  });

  it('longestActiveSpan：最长「连续有打卡」自然日段', () => {
    const days = ['03', '04', '05', '07', '08', '09', '10', '12'];
    const cells = dailyCells(days.map((d) => checkIn('g1', `2026-01-${d}`, 'done')), [], ['g1'], range);
    expect(longestActiveSpan(cells)).toEqual({ from: '2026-01-07', to: '2026-01-10', days: 4 });
    expect(longestActiveSpan(dailyCells([], [], ['g1'], range))).toBeNull();
  });
});

// ──────────────── longestRunOf：与 calcStreak 口径锁定 ────────────────

describe('longestRunOf 各目标最长连续', () => {
  const tasks = [task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-01-20' })];
  const today = '2026-01-21';
  const done = (d: string) => checkIn('g1', d, 'done', { taskId: 't1' });
  const range = rangeOf(2026, 'full', today);

  // 01-01..05 done / 01-06 缺 / 01-07..14 done / 01-15 skipped / 01-16..18 done / 01-19,20 缺
  const checkIns = [
    ...['01', '02', '03', '04', '05'].map((d) => done(`2026-01-${d}`)),
    ...['07', '08', '09', '10', '11', '12', '13', '14'].map((d) => done(`2026-01-${d}`)),
    checkIn('g1', '2026-01-15', 'skipped', { taskId: 't1' }),
    ...['16', '17', '18'].map((d) => done(`2026-01-${d}`)),
  ];

  it('days 与 calcStreak().longest 严格相等（防漂移护栏）', () => {
    const run = longestRunOf({ goalId: 'g1', tasks, checkIns, exemptions: [], today, range });
    const streak = calcStreak({ goalId: 'g1', tasks, checkIns, exemptions: [], today });
    expect(run?.days).toBe(streak.longest);
    expect(run?.days).toBe(11);
  });

  it('skipped 不打断不计数；记录起止与打断日', () => {
    const run = longestRunOf({ goalId: 'g1', tasks, checkIns, exemptions: [], today, range });
    expect(run).toMatchObject({ from: '2026-01-07', to: '2026-01-18', days: 11, breakDate: '2026-01-19' });
  });

  it('跑到区间末未被打断 ⇒ 无 breakDate', () => {
    const all = Array.from({ length: 20 }, (_, i) => done(`2026-01-${String(i + 1).padStart(2, '0')}`));
    const run = longestRunOf({ goalId: 'g1', tasks, checkIns: all, exemptions: [], today, range });
    expect(run?.days).toBe(20);
    expect(run?.breakDate).toBeUndefined();
  });

  it('无应打卡日 ⇒ null', () => {
    expect(longestRunOf({ goalId: 'g9', tasks, checkIns, exemptions: [], today, range })).toBeNull();
  });
});

// ──────────────── goalOutcomes 目标结局 ────────────────

describe('goalOutcomes 目标结局', () => {
  const today = '2026-08-14';
  const range = rangeOf(2026, 'full', today);
  const base = { exemptions: [], sessions: [], range, today };

  it('completedAt 存在 ⇒ completed', () => {
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

  it('剩余未完成任务全是随缘 ⇒ adhocOnly，即使长期无活动', () => {
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

  it('超过阈值无活动 ⇒ stalled，并保留 lastActivityDate', () => {
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
    expect(goalOutcomes({ ...base, goals, tasks, checkIns })[0].outcome).toBe('stalled');
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
      goals: [goal('g1', { archived: true }), goal('g2', { deletedAt: '2026-02-01T00:00:00.000Z' }), goal('g3')],
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

// ──────────────── 里程碑 ────────────────

describe('milestoneStats 里程碑', () => {
  const ms = (id: string, date: string, achieved: boolean): Milestone => ({
    id,
    goalId: 'g1',
    name: `碑${id}`,
    date,
    achieved,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('按日期升序；区间外与软删不计；兑现率分母只算已到期的', () => {
    const s = milestoneStats(
      [
        ms('m2', '2026-06-01', true),
        ms('m1', '2026-03-01', false),
        ms('m5', '2026-11-01', false), // 还没到日子：不算失败
        ms('m6', '2026-12-01', true), // 提前达成：照样算进分母
        ms('m3', '2025-12-31', true),
        { ...ms('m4', '2026-04-01', true), deletedAt: '2026-05-01T00:00:00.000Z' },
      ],
      rangeOf(2026, 'full', '2026-08-14'),
    );
    expect(s.rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm5', 'm6']);
    expect(s.achieved).toBe(2);
    expect(s.due).toBe(3); // m1 m2 m6
    expect(s.rows.find((r) => r.id === 'm1')?.overdue).toBe(true);
    expect(s.rows.find((r) => r.id === 'm5')?.overdue).toBe(false);
  });
});

// ─────────────────── 月度起伏 ───────────────────

describe('monthProfiles 与 bestMonth', () => {
  const goals = [goal('g1'), goal('g2')];
  // g1 1-2 月每日应打卡；g2 只有 1 月 1 天应打卡
  const tasks = [
    task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-02-28' }),
    task('t2', 'g2', { startDate: '2026-01-01', endDate: '2026-01-01' }),
  ];
  const base = { goals, tasks, exemptions: [], sessions: [], reviews: [] };

  it('rate 是合计率（Σscore/Σscheduled），不是各目标率的平均', () => {
    const profiles = monthProfiles({
      ...base,
      checkIns: [checkIn('g2', '2026-01-01', 'done', { taskId: 't2' })],
      range: rangeOf(2026, 'q1', '2026-12-31'),
      today: '2026-12-31',
    });
    const jan = profiles[0];
    expect(jan.scheduled).toBe(32);
    expect(jan.score).toBe(1);
    expect(jan.rate).toBe(3); // 1/32；各目标率平均会是 50%
    expect(profiles[2].rate).toBeNull(); // 3 月无应打卡
  });

  it('带上月度复盘自评；软删的复盘不算', () => {
    const profiles = monthProfiles({
      ...base,
      reviews: [review('2026-01', 4), review('2026-02', 2, { deletedAt: '2026-03-01T00:00:00.000Z' }), review('2026-03')],
      checkIns: [],
      range: rangeOf(2026, 'q1', '2026-12-31'),
      today: '2026-12-31',
    });
    expect(profiles.map((p) => p.rating)).toEqual([4, undefined, undefined]);
  });

  it('进行中的当月不参与最佳评选（3 天 100% 不该夺冠）', () => {
    const checkIns = [
      checkIn('g1', '2026-01-02', 'done', { taskId: 't1' }),
      checkIn('g1', '2026-02-01', 'done', { taskId: 't1' }),
      checkIn('g1', '2026-02-02', 'done', { taskId: 't1' }),
      checkIn('g1', '2026-02-03', 'done', { taskId: 't1' }),
    ];
    const profiles = monthProfiles({ ...base, checkIns, range: rangeOf(2026, 'full', '2026-02-03'), today: '2026-02-03' });
    expect(profiles[0].complete).toBe(true);
    expect(profiles[1].complete).toBe(false);
    expect(profiles[1].rate).toBe(100);
    expect(bestMonth(profiles)?.month).toBe('2026-01');
  });

  it('没有过完的月份 ⇒ bestMonth 为 null', () => {
    const profiles = monthProfiles({ ...base, checkIns: [], range: rangeOf(2026, 'q1', '2026-01-20'), today: '2026-01-20' });
    expect(bestMonth(profiles)).toBeNull();
  });
});

// ──────────────── 专注节律 ────────────────

describe('focusByHourDow 专注节律', () => {
  const range = rangeOf(2026, 'full', '2026-12-31');
  const at = (h: number, m = 0) => new Date(2026, 7, 13, h, m).toISOString();

  it('区间归属看 date，钟点与星期取 startAt（2026-08-13 是周四 dow=4）', () => {
    const cells = focusByHourDow([session({ startAt: at(9), date: '2026-08-13' })], range);
    expect(cells).toEqual([{ dow: 4, hour: 9, count: 1, ms: 25 * MIN }]);
  });

  it('date 被显式改归相邻日时，钟点仍按真实 startAt 算', () => {
    const cells = focusByHourDow([session({ startAt: at(23, 30), date: '2026-08-14' })], range);
    expect(cells[0]).toMatchObject({ dow: 4, hour: 23 });
  });

  it('同格累加；discarded、软删与区间外不计', () => {
    const cells = focusByHourDow(
      [
        session({ id: 'a', startAt: at(9, 0) }),
        session({ id: 'b', startAt: at(9, 30), outcome: 'stopped', focusMs: 10 * MIN }),
        session({ id: 'c', startAt: at(9, 45), outcome: 'discarded' }),
        { ...session({ id: 'd', startAt: at(9, 50) }), deletedAt: '2026-08-14T00:00:00.000Z' },
      ],
      range,
    );
    expect(cells[0]).toMatchObject({ count: 2, ms: 35 * MIN });
    expect(focusByHourDow([session()], rangeOf(2026, 'q1', '2026-12-31'))).toHaveLength(0);
  });
});

// ──────────────── annualIndex 汇总 ────────────────

describe('annualIndex 汇总', () => {
  const args = {
    goals: [goal('g1'), goal('g2')],
    tasks: [task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-12-31' })],
    milestones: [],
    checkIns: [checkIn('g1', '2026-08-13', 'done', { taskId: 't1', minutes: 30 })],
    exemptions: [],
    sessions: [session()],
    reviews: [],
    year: 2026,
    kind: 'full' as const,
    today: '2026-08-14',
  };

  it('一次算完封面与四节数据', () => {
    const idx = annualIndex(args);
    expect(idx.empty).toBe(false);
    expect(idx.totalDays).toBe(365);
    expect(idx.elapsedDays).toBe(226); // 01-01..08-14
    expect(idx.activeDays).toBe(1);
    expect(idx.goalCount).toBe(1); // g2 无排期无投入
    expect(idx.invested.goals[0]).toMatchObject({ goalId: 'g1', ms: 30 * MIN }); // max(手填 30, 番茄 25)
    expect(idx.days).toHaveLength(365);
    expect(idx.months).toHaveLength(12);
    expect(idx.rhythm).toHaveLength(1);
    expect(idx.sessionCount).toBe(1);
  });

  it('区间零数据 ⇒ empty=true（界面走整页空态）', () => {
    const idx = annualIndex({ ...args, year: 2024 });
    expect(idx.empty).toBe(true);
    expect(idx.invested.totalMs).toBe(0);
  });

  it('只有里程碑也不算空', () => {
    const idx = annualIndex({
      ...args,
      tasks: [],
      checkIns: [],
      sessions: [],
      milestones: [{ id: 'm', goalId: 'g1', name: '碑', date: '2026-03-01', achieved: true, updatedAt: '' }],
    });
    expect(idx.empty).toBe(false);
  });

  it('runs 按天数降序', () => {
    const idx = annualIndex({
      ...args,
      tasks: [
        task('t1', 'g1', { startDate: '2026-01-01', endDate: '2026-01-10' }),
        task('t2', 'g2', { startDate: '2026-01-01', endDate: '2026-01-10' }),
      ],
      checkIns: [
        ...['01', '02', '03'].map((d) => checkIn('g1', `2026-01-${d}`, 'done', { taskId: 't1' })),
        ...['01', '02', '03', '04', '05'].map((d) => checkIn('g2', `2026-01-${d}`, 'done', { taskId: 't2' })),
      ],
    });
    expect(idx.runs.map((r) => r.goalId)).toEqual(['g2', 'g1']);
    expect(idx.runs[0].days).toBe(5);
  });
});
