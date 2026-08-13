import { describe, expect, it } from 'vitest';
import type { CheckIn, FocusSession, RunningState } from '../../types/domain';
import {
  effectiveMsByGoalByYear,
  effectiveMsByGoalDate,
  focusIndexForGantt,
  focusMsByTaskDate,
  focusStats,
  isPaused,
  netFocusMs,
  planRecovery,
  settleSession,
  shouldLongBreak,
  todayFocusMs,
  unassignedSessions,
} from './focus';
import { minutesByGoalByMonth, monthlyGoalStats } from './review';

const MIN = 60_000;
/** 2026-08-13 09:00:00 本地时间 */
const T0 = new Date(2026, 7, 13, 9, 0, 0).getTime();

function running(patch: Partial<RunningState> = {}): RunningState {
  return {
    sessionId: 'sess-1',
    phase: 'focus',
    goalId: 'g1',
    taskId: 't1',
    startAt: T0,
    plannedMs: 25 * MIN,
    pauses: [],
    lastHeartbeatAt: T0,
    ...patch,
  };
}

function session(patch: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'fs-1',
    goalId: 'g1',
    taskId: 't1',
    date: '2026-08-13',
    startAt: new Date(T0).toISOString(),
    endAt: new Date(T0 + 25 * MIN).toISOString(),
    focusMs: 25 * MIN,
    plannedMs: 25 * MIN,
    outcome: 'completed',
    source: 'timer',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...patch,
  };
}

function checkIn(patch: Partial<CheckIn> = {}): CheckIn {
  return {
    id: 'c-1',
    goalId: 'g1',
    taskId: 't1',
    date: '2026-08-13',
    status: 'done',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...patch,
  };
}

describe('netFocusMs', () => {
  it('无暂停 = 纯墙钟差值', () => {
    expect(netFocusMs(T0, T0 + 25 * MIN, [])).toBe(25 * MIN);
  });

  it('扣除单次暂停', () => {
    expect(netFocusMs(T0, T0 + 25 * MIN, [{ at: T0 + 5 * MIN, until: T0 + 8 * MIN }])).toBe(22 * MIN);
  });

  it('扣除多次暂停', () => {
    const pauses = [
      { at: T0 + 2 * MIN, until: T0 + 3 * MIN },
      { at: T0 + 10 * MIN, until: T0 + 14 * MIN },
    ];
    expect(netFocusMs(T0, T0 + 25 * MIN, pauses)).toBe(20 * MIN);
  });

  it('末条未闭合的暂停按 endAt 闭合', () => {
    expect(netFocusMs(T0, T0 + 25 * MIN, [{ at: T0 + 20 * MIN }])).toBe(20 * MIN);
  });

  it('暂停区间被裁到 [startAt, endAt] 内，不会重复扣', () => {
    // 结算截止在第 10 分钟，之后的暂停与结算无关
    expect(netFocusMs(T0, T0 + 10 * MIN, [{ at: T0 + 12 * MIN, until: T0 + 15 * MIN }])).toBe(10 * MIN);
  });
});

describe('settleSession', () => {
  it('到点结算：completed，净时长等于计划时长', () => {
    const s = settleSession(running(), T0 + 25 * MIN, { outcome: 'completed' });
    expect(s).not.toBeNull();
    expect(s?.focusMs).toBe(25 * MIN);
    expect(s?.outcome).toBe('completed');
    expect(s?.source).toBe('timer');
    expect(s?.needsReview).toBeUndefined();
  });

  it('提前停止：stopped，按实际净时长记账', () => {
    const s = settleSession(running(), T0 + 10 * MIN, { outcome: 'stopped' });
    expect(s?.focusMs).toBe(10 * MIN);
    expect(s?.outcome).toBe('stopped');
  });

  it('丢弃：落库但 outcome = discarded', () => {
    const s = settleSession(running(), T0 + 10 * MIN, { outcome: 'discarded' });
    expect(s?.outcome).toBe('discarded');
  });

  it('clamp 到 plannedMs：合盖 3 小时结构上不可能记成 3 小时', () => {
    const s = settleSession(running(), T0 + 3 * 60 * MIN, { outcome: 'completed' });
    expect(s?.focusMs).toBe(25 * MIN);
    expect(s?.needsReview).toBe(true);
  });

  it('净时长为负（时钟回拨）→ 不落库，且不会写出负数', () => {
    // clamp 到 0 后不足 1 分钟 ⇒ 返回 null
    expect(settleSession(running(), T0 - 10 * MIN, { outcome: 'stopped' })).toBeNull();
  });

  it('不足 1 分钟返回 null（误触不落库、不进 undo）', () => {
    expect(settleSession(running(), T0 + 30_000, { outcome: 'stopped' })).toBeNull();
  });

  it('休息段永不落库', () => {
    const s = settleSession(running({ phase: 'shortBreak', plannedMs: 5 * MIN }), T0 + 5 * MIN, {
      outcome: 'completed',
    });
    expect(s).toBeNull();
  });

  it('暂停被闭合并写进 pauses；无暂停时不写空数组', () => {
    const withPause = settleSession(
      running({ pauses: [{ at: T0 + 5 * MIN }] }),
      T0 + 30 * MIN,
      { outcome: 'stopped' },
    );
    expect(withPause?.pauses).toHaveLength(1);
    expect(withPause?.pauses?.[0].until).toBe(new Date(T0 + 30 * MIN).toISOString());
    expect(settleSession(running(), T0 + 25 * MIN, { outcome: 'completed' })?.pauses).toBeUndefined();
  });

  it('落库 id 用预生成的 sessionId ⇒ 重复结算幂等', () => {
    const a = settleSession(running(), T0 + 25 * MIN, { outcome: 'completed' });
    const b = settleSession(running(), T0 + 25 * MIN, { outcome: 'completed' });
    expect(a?.id).toBe('sess-1');
    expect(b?.id).toBe(a?.id);
  });

  it('跨天会话按开始日整段归属，且 date 冻结在字段里', () => {
    const late = new Date(2026, 7, 13, 23, 50, 0).getTime();
    const s = settleSession(running({ startAt: late, lastHeartbeatAt: late }), late + 25 * MIN, {
      outcome: 'completed',
    });
    expect(s?.date).toBe('2026-08-13'); // 不是 08-14
    expect(s?.endAt).toBe(new Date(late + 25 * MIN).toISOString());
  });
});

describe('planRecovery', () => {
  it('gap ≤ 90s 且未到点 → 无缝续跑', () => {
    const r = running({ lastHeartbeatAt: T0 + 5 * MIN });
    expect(planRecovery(r, T0 + 5 * MIN + 3_000).kind).toBe('resume');
  });

  it('刷新页面本身绝不产生 needsReview', () => {
    const r = running({ lastHeartbeatAt: T0 + 2_000 });
    const plan = planRecovery(r, T0 + 4_000);
    expect(plan.kind).toBe('resume');
    expect(plan.needsReview).toBe(false);
  });

  it('已过计划终点 → 按计划终点结算', () => {
    const r = running({ lastHeartbeatAt: T0 + 25 * MIN });
    const plan = planRecovery(r, T0 + 26 * MIN);
    expect(plan.kind).toBe('settleAtPlannedEnd');
    expect(plan.focusMs).toBe(25 * MIN);
    expect(plan.needsReview).toBe(false);
  });

  it('已过计划终点且 gap > 90s → 附 needsReview', () => {
    const r = running({ lastHeartbeatAt: T0 + 10 * MIN });
    const plan = planRecovery(r, T0 + 30 * MIN);
    expect(plan.kind).toBe('settleAtPlannedEnd');
    expect(plan.needsReview).toBe(true);
  });

  it('gap > 90s 且未到点 → 结算对话，X 已扣暂停（不是裸截断）', () => {
    const r = running({
      pauses: [{ at: T0 + 2 * MIN, until: T0 + 5 * MIN }],
      lastHeartbeatAt: T0 + 10 * MIN,
    });
    const plan = planRecovery(r, T0 + 12 * MIN);
    expect(plan.kind).toBe('ask');
    expect(plan.focusMs).toBe(7 * MIN); // 10 分钟里有 3 分钟在暂停
    expect(plan.endAt).toBe(T0 + 10 * MIN);
  });

  it('超过 4 小时 → 硬截断，focusMs = min(净时长, plannedMs) 且待确认', () => {
    const r = running({ lastHeartbeatAt: T0 + 5 * MIN });
    const plan = planRecovery(r, T0 + 5 * 60 * MIN);
    expect(plan.kind).toBe('hardCut');
    expect(plan.focusMs).toBe(25 * MIN);
    expect(plan.needsReview).toBe(true);
  });

  it('优先级：>4h 与已到点同时成立 → hardCut 胜出', () => {
    const r = running({ lastHeartbeatAt: T0 + 25 * MIN });
    expect(planRecovery(r, T0 + 6 * 60 * MIN).kind).toBe('hardCut');
  });

  it('暂停优先于到点：暂停中的会话永不自动结算', () => {
    // 按了暂停后关页面，2 小时后重开：绝不能按 completed 全额结算
    const r = running({ pauses: [{ at: T0 + 3 * MIN }], lastHeartbeatAt: T0 + 3 * MIN });
    const plan = planRecovery(r, T0 + 120 * MIN);
    expect(plan.kind).toBe('resume');
    expect(plan.focusMs).toBeUndefined();
  });

  it('休息总闸：休息态在任何 gap / 任何时刻都不产生专注会话', () => {
    const base = running({ phase: 'shortBreak', plannedMs: 5 * MIN });
    for (const [now, hb] of [
      [T0 + 6 * MIN, T0 + 5 * MIN], // 刚过点
      [T0 + 60 * MIN, T0 + 1 * MIN], // 过点很久且失联
      [T0 + 2 * MIN, T0 + 2 * MIN - 1_000], // 还在休息中
    ]) {
      const plan = planRecovery({ ...base, lastHeartbeatAt: hb }, now);
      expect(['resume', 'dropSilently']).toContain(plan.kind);
      expect(settleSession({ ...base, lastHeartbeatAt: hb }, now, { outcome: 'completed' })).toBeNull();
    }
  });

  it('休息刚过点补响铃，过点很久不补', () => {
    const base = running({ phase: 'shortBreak', plannedMs: 5 * MIN, lastHeartbeatAt: T0 + 5 * MIN });
    expect(planRecovery(base, T0 + 5 * MIN + 10_000).chime).toBe(true);
    expect(planRecovery(base, T0 + 30 * MIN).chime).toBe(false);
  });

  it('时钟回拨 → needsReview', () => {
    const r = running({ lastHeartbeatAt: T0 + 10 * MIN });
    const plan = planRecovery(r, T0 + 9 * MIN);
    expect(plan.needsReview).toBe(true);
  });

  it('净时长超过总流逝时间（自相矛盾）→ needsReview', () => {
    // 心跳记到第 10 分钟，但现在只到第 5 分钟：时钟被往前又往后动过
    const r = running({ startAt: T0, lastHeartbeatAt: T0 + 10 * MIN });
    expect(planRecovery(r, T0 + 5 * MIN).needsReview).toBe(true);
  });

  it('isPaused 只看末条暂停是否闭合', () => {
    expect(isPaused(running({ pauses: [{ at: T0, until: T0 + MIN }] }))).toBe(false);
    expect(isPaused(running({ pauses: [{ at: T0 }] }))).toBe(true);
  });
});

describe('节律计数', () => {
  it('completed > 0 且整除才进长休息', () => {
    expect(shouldLongBreak(4, 4)).toBe(true);
    expect(shouldLongBreak(8, 4)).toBe(true);
    expect(shouldLongBreak(3, 4)).toBe(false);
  });

  it('completed === 0 是负例（第一段还没跑完不能进长休息）', () => {
    expect(shouldLongBreak(0, 4)).toBe(false);
  });

  it('longBreakEvery = 0 不炸（NaN 会让长休息永不触发且不报错）', () => {
    expect(shouldLongBreak(4, 0)).toBe(false);
  });
});

describe('focusMsByTaskDate / todayFocusMs / unassignedSessions', () => {
  const sessions = [
    session({ id: 'a', focusMs: 25 * MIN }),
    session({ id: 'b', taskId: 't2', focusMs: 10 * MIN }),
    session({ id: 'c', focusMs: 30 * MIN, outcome: 'discarded' }),
    session({ id: 'd', focusMs: 40 * MIN, deletedAt: new Date(T0).toISOString() }),
    session({ id: 'e', focusMs: 5 * MIN, date: '2026-08-12' }),
    session({ id: 'f', goalId: undefined, taskId: undefined, focusMs: 15 * MIN }),
  ];

  it('排除 discarded 与软删', () => {
    const map = focusMsByTaskDate(sessions, '2026-08-13');
    expect(map.get('t1')).toBe(25 * MIN);
    expect(map.get('t2')).toBe(10 * MIN);
    expect(map.get('')).toBe(15 * MIN); // taskId 缺省归入 '' 桶
  });

  it('今日已专注只算当日、只算计入统计的', () => {
    expect(todayFocusMs(sessions, '2026-08-13')).toBe(50 * MIN);
  });

  it('未归类 = goalId 缺省者', () => {
    expect(unassignedSessions(sessions).map((s) => s.id)).toEqual(['f']);
  });
});

describe('effectiveMsByGoalDate', () => {
  it('仅手填', () => {
    const ms = effectiveMsByGoalDate([checkIn({ minutes: 60 })], [], 'g1', '2026-08-13');
    expect(ms).toBe(60 * MIN);
  });

  it('仅自动', () => {
    const ms = effectiveMsByGoalDate([], [session({ focusMs: 25 * MIN })], 'g1', '2026-08-13');
    expect(ms).toBe(25 * MIN);
  });

  it('两者取 max（手填往往是含番茄那部分的估算，相加必然重复计）', () => {
    const ms = effectiveMsByGoalDate(
      [checkIn({ minutes: 60 })],
      [session({ focusMs: 25 * MIN })],
      'g1',
      '2026-08-13',
    );
    expect(ms).toBe(60 * MIN);
  });

  it('多任务分桶后求和：A 手填 60 + B 自动 25 = 85（不是 60）', () => {
    const ms = effectiveMsByGoalDate(
      [checkIn({ id: 'c1', taskId: 'tA', minutes: 60 })],
      [session({ id: 's1', taskId: 'tB', focusMs: 25 * MIN })],
      'g1',
      '2026-08-13',
    );
    expect(ms).toBe(85 * MIN);
  });

  it('taskId 缺省的记录归入 \'\' 桶，不与具体任务串味', () => {
    const ms = effectiveMsByGoalDate(
      [checkIn({ id: 'c1', taskId: undefined, minutes: 60 })],
      [session({ id: 's1', taskId: 'tB', focusMs: 25 * MIN })],
      'g1',
      '2026-08-13',
    );
    expect(ms).toBe(85 * MIN);
  });

  it('丢弃与软删不计入自动值', () => {
    const ms = effectiveMsByGoalDate(
      [],
      [
        session({ id: 's1', focusMs: 25 * MIN, outcome: 'discarded' }),
        session({ id: 's2', focusMs: 25 * MIN, deletedAt: new Date(T0).toISOString() }),
      ],
      'g1',
      '2026-08-13',
    );
    expect(ms).toBe(0);
  });

  it('ms 精度：4 段各 25 分 29 秒按 ms 求和后取整是 102 分，不是逐段 round 的 100 分', () => {
    const each = 25 * MIN + 29_000;
    const sessions = [1, 2, 3, 4].map((i) =>
      session({ id: `s${i}`, taskId: `t${i}`, focusMs: each, plannedMs: each }),
    );
    const ms = effectiveMsByGoalDate([], sessions, 'g1', '2026-08-13');
    expect(Math.round(ms / MIN)).toBe(102);
    expect(sessions.reduce((sum, s) => sum + Math.round(s.focusMs / MIN), 0)).toBe(100);
  });
});

describe('effectiveMsByGoalByYear', () => {
  it('键集合 = checkIns ∪ sessions（只跑番茄没打卡的目标不能缺键）', () => {
    const byMonth = effectiveMsByGoalByYear(
      [checkIn({ goalId: 'g1', minutes: 30 })],
      [session({ id: 's1', goalId: 'g2', taskId: 'tx', focusMs: 25 * MIN })],
      2026,
    );
    const aug = byMonth.get(8);
    expect(aug?.get('g1')).toBe(30 * MIN);
    expect(aug?.get('g2')).toBe(25 * MIN);
  });

  it('未归类会话不进任何 goal 级统计', () => {
    const byMonth = effectiveMsByGoalByYear(
      [],
      [session({ id: 's1', goalId: undefined, focusMs: 25 * MIN })],
      2026,
    );
    expect(byMonth.size).toBe(0);
  });

  it('只认 date 字段，不按 startAt 算月份', () => {
    // 会话被用户一键改归到 7 月 31 日，startAt 仍在 8 月
    const byMonth = effectiveMsByGoalByYear(
      [],
      [session({ id: 's1', date: '2026-07-31', focusMs: 25 * MIN })],
      2026,
    );
    expect(byMonth.get(7)?.get('g1')).toBe(25 * MIN);
    expect(byMonth.get(8)).toBeUndefined();
  });
});

describe('focusIndexForGantt', () => {
  const sessions = [
    session({ id: 's1', date: '2026-03-02', taskId: 't1', focusMs: 25 * MIN }),
    session({ id: 's2', date: '2026-03-02', taskId: 't1', focusMs: 20 * MIN }),
    session({ id: 's3', date: '2026-03-05', taskId: 't2', focusMs: 50 * MIN }),
    session({ id: 's4', date: '2025-12-31', taskId: 't1', focusMs: 30 * MIN }), // 去年
    session({ id: 's5', date: '2026-03-06', taskId: undefined, focusMs: 40 * MIN }), // 未归类
    session({ id: 's6', date: '2026-03-07', taskId: 't1', focusMs: 15 * MIN, outcome: 'discarded' }),
    session({ id: 's7', date: '2026-03-08', taskId: 't1', focusMs: 15 * MIN, deletedAt: new Date(T0).toISOString() }),
  ];
  const idx = focusIndexForGantt(sessions, 2026);

  it('同日多段合并成一个日期，且毫秒累加', () => {
    expect([...(idx.focusDaysByTask.get('t1') ?? [])]).toEqual(['2026-03-02']);
    expect(idx.msByTask.get('t1')).toBe(45 * MIN);
  });

  it('按 task 分桶，不与同目标的其它任务串味', () => {
    expect(idx.focusDaysByTask.get('t2')?.has('2026-03-05')).toBe(true);
    expect(idx.focusDaysByTask.get('t2')?.has('2026-03-02')).toBe(false);
  });

  it('只吃当年；丢弃 / 软删 / 未归类都不进甘特', () => {
    expect(idx.focusDaysByTask.get('t1')?.has('2025-12-31')).toBe(false);
    expect(idx.focusDaysByTask.get('t1')?.has('2026-03-07')).toBe(false);
    expect(idx.focusDaysByTask.get('t1')?.has('2026-03-08')).toBe(false);
    expect(idx.focusDaysByTask.has('')).toBe(false);
    expect(idx.msByTask.get('t1')).toBe(45 * MIN); // 去年那 30 分没混进来
  });

  it('空输入返回空索引（无会话的用户不该看到任何中间态）', () => {
    const empty = focusIndexForGantt([], 2026);
    expect(empty.focusDaysByTask.size).toBe(0);
    expect(empty.msByTask.size).toBe(0);
  });
});

describe('focusStats', () => {
  const sessions = [
    session({ id: 's1', date: '2026-08-01', focusMs: 25 * MIN, outcome: 'completed' }),
    session({ id: 's2', date: '2026-08-02', focusMs: 15 * MIN, outcome: 'stopped' }),
    session({ id: 's3', date: '2026-08-03', focusMs: 20 * MIN, outcome: 'completed' }),
    session({ id: 's4', date: '2026-08-04', focusMs: 10 * MIN, outcome: 'discarded' }),
    session({ id: 's5', date: '2026-07-31', focusMs: 60 * MIN, outcome: 'completed' }),
  ];

  it('按月前缀统计段数 / 总时长 / 平均段长 / 被打断率（丢弃不计）', () => {
    const s = focusStats(sessions, '2026-08');
    expect(s.count).toBe(3);
    expect(s.totalMs).toBe(60 * MIN);
    expect(s.avgMs).toBe(20 * MIN);
    expect(s.interruptedRate).toBeCloseTo(1 / 3, 6);
  });

  it('年前缀把 7 月那段也算进来', () => {
    expect(focusStats(sessions, '2026-').count).toBe(4);
  });

  it('无会话时全零且不除零', () => {
    expect(focusStats([], '2026-08')).toEqual({ count: 0, totalMs: 0, avgMs: 0, interruptedRate: 0 });
  });
});

describe('回归护栏：sessions 缺省时与改造前完全一致', () => {
  const checkIns = [
    checkIn({ id: 'c1', date: '2026-08-01', minutes: 30 }),
    checkIn({ id: 'c2', date: '2026-08-02', minutes: 45, taskId: 't2' }),
    checkIn({ id: 'c3', date: '2026-08-03', status: 'partial' }), // 无 minutes
    checkIn({ id: 'c4', date: '2026-07-30', minutes: 60 }),
  ];

  it('monthlyGoalStats.minutes 等于当月手填分钟直接累加', () => {
    const stats = monthlyGoalStats({
      goalId: 'g1',
      tasks: [],
      checkIns,
      exemptions: [],
      month: '2026-08',
      today: '2026-08-13',
    });
    expect(stats.minutes).toBe(75);
  });

  it('minutesByGoalByMonth 与逐条累加一致', () => {
    const byMonth = minutesByGoalByMonth(checkIns, 2026);
    expect(byMonth.get(8)?.get('g1')).toBe(75);
    expect(byMonth.get(7)?.get('g1')).toBe(60);
  });

  it('传入 sessions 后番茄时长才进复盘（不传就是功能等于没做）', () => {
    const sessions = [session({ id: 's1', date: '2026-08-05', taskId: 't9', focusMs: 50 * MIN })];
    const stats = monthlyGoalStats({
      goalId: 'g1',
      tasks: [],
      checkIns,
      exemptions: [],
      month: '2026-08',
      today: '2026-08-13',
      sessions,
    });
    expect(stats.minutes).toBe(125);
    expect(minutesByGoalByMonth(checkIns, 2026, sessions).get(8)?.get('g1')).toBe(125);
  });
});
