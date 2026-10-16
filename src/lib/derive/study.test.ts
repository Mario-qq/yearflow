import { describe, expect, it } from 'vitest';
import type { CheckIn, FocusSession, Goal, Task } from '../../types/domain';
import {
  anchorFor,
  brokeYesterday,
  buildStudyLedger,
  studiedOn,
  studyAutoCheckIn,
  studyDueOn,
  studyGoalSet,
  studyNudgeDue,
  studyPicks,
  studyStreak,
  weekStudyDays,
  type StudyData,
} from './study';

/* 2026-10-12 周一 … 10-16 周五（今天）10-17 周六 10-18 周日 */
const TODAY = '2026-10-16';
const T0 = '2026-09-01T00:00:00.000Z';

const goal = (id: string, p: Partial<Goal> = {}): Goal => ({ id, name: id, color: 'goal-1', order: 0, archived: false, createdAt: T0, updatedAt: T0, ...p });
const task = (id: string, goalId: string, p: Partial<Task> = {}): Task => ({
  id,
  goalId,
  name: id,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  progress: 0,
  progressMode: 'auto',
  status: 'active',
  order: 0,
  updatedAt: T0,
  ...p,
});
const ci = (goalId: string, date: string, status: CheckIn['status'], p: Partial<CheckIn> = {}): CheckIn => ({
  id: `${goalId}-${date}-${status}-${p.taskId ?? ''}`,
  goalId,
  date,
  status,
  createdAt: T0,
  updatedAt: T0,
  ...p,
});
const fs = (id: string, goalId: string | undefined, date: string, min: number, p: Partial<FocusSession> = {}): FocusSession => ({
  id,
  goalId,
  date,
  startAt: `${date}T04:00:00.000Z`,
  endAt: `${date}T05:00:00.000Z`,
  focusMs: min * 60_000,
  plannedMs: min * 60_000,
  outcome: 'completed',
  source: 'timer',
  createdAt: T0,
  updatedAt: T0,
  ...p,
});

const data = (p: Partial<StudyData> = {}): StudyData => ({ goals: [], tasks: [], checkIns: [], exemptions: [], sessions: [], ...p });

describe('studyGoalSet', () => {
  it('剔除已删除 / 归档 / 不存在的目标', () => {
    const goals = [goal('sap'), goal('ai', { archived: true }), goal('en', { deletedAt: T0 })];
    expect([...studyGoalSet(goals, ['sap', 'ai', 'en', 'gone'])]).toEqual(['sap']);
  });
});

describe('学过没有', () => {
  const study = new Set(['sap']);
  it('完成 / 做了一点 算学过；跳过、别的目标、删除的不算', () => {
    const l = buildStudyLedger(study, [ci('sap', '2026-10-14', 'done'), ci('sap', '2026-10-13', 'partial'), ci('sap', '2026-10-12', 'skipped'), ci('run', '2026-10-15', 'done'), ci('sap', '2026-10-15', 'done', { deletedAt: T0 })], []);
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d) => studiedOn(l, d, 15))).toEqual([false, true, true, false]);
  });
  it('专注合计 ≥ 短版分钟数也算；丢弃的会话不计', () => {
    const l = buildStudyLedger(study, [], [fs('a', 'sap', TODAY, 10), fs('b', 'sap', TODAY, 6), fs('c', 'sap', '2026-10-15', 30, { outcome: 'discarded' }), fs('d', undefined, '2026-10-14', 60)]);
    expect(studiedOn(l, TODAY, 15)).toBe(true);
    expect(studiedOn(l, '2026-10-15', 15)).toBe(false);
    expect(studiedOn(l, '2026-10-14', 15)).toBe(false);
  });
  it('本周点阵从周一数 7 天', () => {
    const l = buildStudyLedger(study, [ci('sap', '2026-10-12', 'done'), ci('sap', '2026-10-14', 'done')], []);
    expect(weekStudyDays('2026-10-12', l, 15)).toEqual([true, false, true, false, false, false, false]);
  });
});

describe('studyPicks 今天学什么', () => {
  const goals = [goal('sap'), goal('ai'), goal('run')];
  it('只挑学习目标；今天应打卡的在前，再按落后最多', () => {
    const tasks = [
      task('sd', 'sap', { recurrence: { type: 'custom', daysOfWeek: [1, 3, 5] } }), // 今天周五：该学
      task('py', 'ai', { recurrence: { type: 'custom', daysOfWeek: [2, 4] } }), // 今天不在排程
      task('jog', 'run'),
    ];
    const picks = studyPicks(TODAY, data({ goals, tasks }), new Set(['sap', 'ai']));
    expect(picks.map((p) => [p.taskId, p.due])).toEqual([
      ['sd', true],
      ['py', false],
    ]);
  });
  it('都该学时：落后多的在前；落后一样时最久没碰（从没碰过最久）在前', () => {
    const tasks = [task('a', 'sap'), task('b', 'sap'), task('c', 'ai', { progressMode: 'manual', progress: 100 })];
    // a 天天打卡 ⇒ 不落后；b 从没打 ⇒ 落后；c 手动进度 100 ⇒ 不落后
    const checkIns = Array.from({ length: 15 }, (_, n) => ci('sap', `2026-10-${String(n + 1).padStart(2, '0')}`, 'done', { taskId: 'a', id: `a${n}` }));
    const picks = studyPicks(TODAY, data({ goals, tasks, checkIns }), new Set(['sap', 'ai']));
    expect(picks[0].taskId).toBe('b');
    expect(picks[0].behind).toBeGreaterThan(40);
    // a、c 都不落后：c 从没碰过 ⇒ 排在 a 前
    expect(picks.slice(1).map((p) => p.taskId)).toEqual(['c', 'a']);
    expect(picks.find((p) => p.taskId === 'a')?.lastTouched).toBe('2026-10-15');
  });
  it('已完成的任务、不在日期范围的、免打卡区间内的目标不出现', () => {
    const tasks = [task('done', 'sap', { status: 'done' }), task('later', 'sap', { startDate: '2026-11-01', endDate: '2026-11-30' }), task('rest', 'ai')];
    const exemptions = [{ id: 'e', startDate: '2026-10-10', endDate: '2026-10-20', goalIds: ['ai'], updatedAt: T0 }];
    expect(studyPicks(TODAY, data({ goals, tasks, exemptions }), new Set(['sap', 'ai']))).toEqual([]);
  });
  it('studyDueOn 与年度计划同口径（周几规则）', () => {
    const tasks = [task('sd', 'sap', { recurrence: { type: 'custom', daysOfWeek: [1, 3, 5] } })];
    const d = data({ goals, tasks });
    expect(studyDueOn(TODAY, d, new Set(['sap']))).toBe(true);
    expect(studyDueOn('2026-10-15', d, new Set(['sap']))).toBe(false);
  });
});

describe('不连断', () => {
  // 一三五排学习
  const dueOn = (date: string) => [1, 3, 5].includes(new Date(`${date}T00:00:00`).getDay());
  it('昨天没排学习 ⇒ 不算断', () => {
    const l = buildStudyLedger(new Set(['sap']), [], []);
    expect(brokeYesterday(TODAY, l, 15, dueOn)).toBe(false); // 昨天周四没排
    expect(brokeYesterday('2026-10-15', l, 15, dueOn)).toBe(true); // 周三排了没学
  });
  it('连续天数：没排的日子跳过不断，排了没学就断；今天学了 +1', () => {
    const l = buildStudyLedger(new Set(['sap']), [ci('sap', '2026-10-14', 'done'), ci('sap', '2026-10-12', 'done'), ci('sap', '2026-10-07', 'done')], []);
    // 往回：10-15 周四没排跳过 → 10-14 学 → 10-13 没排 → 10-12 学 → 10-11 周日没排 → 10-10、10-09（周五排了没学）断
    expect(studyStreak(TODAY, l, 15, dueOn)).toBe(2);
    const l2 = buildStudyLedger(new Set(['sap']), [ci('sap', TODAY, 'done'), ci('sap', '2026-10-14', 'done')], []);
    expect(studyStreak(TODAY, l2, 15, dueOn)).toBe(2);
  });
});

describe('锚点与提醒', () => {
  const desk = { anchor: { time: '12:30', text: '午饭后' }, anchorByDow: [{ off: true }, null, null, null, null, { time: '18:30' }, null] };
  it('按星期覆盖：没写的字段沿用默认；off 表示这天不提醒', () => {
    expect(anchorFor(desk, TODAY)).toEqual({ time: '18:30', text: '午饭后' }); // 周五
    expect(anchorFor(desk, '2026-10-15')).toEqual({ time: '12:30', text: '午饭后' });
    expect(anchorFor(desk, '2026-10-18').off).toBe(true); // 周日
  });
  const base = { anchor: { time: '12:30' }, lastCall: '21:00', remind: true, due: true, studied: false, running: false, sent: {} };
  it('到锚点提醒一次，到最晚时间再提醒一次', () => {
    expect(studyNudgeDue({ ...base, nowHm: '12:29' })).toBe(null);
    expect(studyNudgeDue({ ...base, nowHm: '12:30' })).toBe('anchor');
    expect(studyNudgeDue({ ...base, nowHm: '15:00', sent: { anchor: true } })).toBe(null);
    expect(studyNudgeDue({ ...base, nowHm: '21:05', sent: { anchor: true } })).toBe('lastCall');
    expect(studyNudgeDue({ ...base, nowHm: '21:30', sent: { anchor: true, lastCall: true } })).toBe(null);
  });
  it('过了最晚时间才打开：只补最晚那次，不再补锚点', () => {
    expect(studyNudgeDue({ ...base, nowHm: '22:00' })).toBe('lastCall');
  });
  it('学过了 / 正在学 / 今天没排 / 关了提醒 / 这天不提醒 ⇒ 不提醒；没定时间只有最晚提醒', () => {
    for (const p of [{ studied: true }, { running: true }, { due: false }, { remind: false }, { anchor: { time: '12:30', off: true } }]) {
      expect(studyNudgeDue({ ...base, nowHm: '21:30', ...p })).toBe(null);
    }
    expect(studyNudgeDue({ ...base, anchor: {}, nowHm: '13:00' })).toBe(null);
    expect(studyNudgeDue({ ...base, anchor: {}, nowHm: '21:00' })).toBe('lastCall');
  });
});

describe('studyAutoCheckIn 专注结束自动打卡', () => {
  const study = new Set(['sap']);
  const ctx = (p: { sessions?: FocusSession[]; checkIns?: CheckIn[] } = {}) => ({ study, studyMinutes: 30, sessions: [], checkIns: [], ...p });
  it('学够 30 分钟 ⇒ 完成；不够 ⇒ 做了一点（当天学习专注合计，落库的这段不重复算）', () => {
    const s = fs('s1', 'sap', TODAY, 15, { taskId: 'sd' });
    expect(studyAutoCheckIn(s, ctx({ sessions: [s] }))?.status).toBe('partial');
    expect(studyAutoCheckIn(s, ctx({ sessions: [s, fs('s0', 'sap', TODAY, 15, { taskId: 'other' })] }))?.status).toBe('done');
  });
  it('只认跑完的学习任务专注', () => {
    expect(studyAutoCheckIn(fs('s', 'sap', TODAY, 30, { taskId: 'sd', outcome: 'stopped' }), ctx())).toBe(null);
    expect(studyAutoCheckIn(fs('s', 'run', TODAY, 30, { taskId: 'jog' }), ctx())).toBe(null);
    expect(studyAutoCheckIn(fs('s', 'sap', TODAY, 30), ctx())).toBe(null); // 没挂任务
  });
  it('已有完成不动；做了一点只升不降；跳过会被覆盖', () => {
    const s = fs('s', 'sap', TODAY, 15, { taskId: 'sd' });
    expect(studyAutoCheckIn(s, ctx({ checkIns: [ci('sap', TODAY, 'done', { taskId: 'sd' })] }))).toBe(null);
    expect(studyAutoCheckIn(s, ctx({ checkIns: [ci('sap', TODAY, 'partial', { taskId: 'sd' })] }))).toBe(null);
    const long = fs('l', 'sap', TODAY, 30, { taskId: 'sd' });
    expect(studyAutoCheckIn(long, ctx({ checkIns: [ci('sap', TODAY, 'partial', { taskId: 'sd' })] }))?.status).toBe('done');
    expect(studyAutoCheckIn(s, ctx({ checkIns: [ci('sap', TODAY, 'skipped', { taskId: 'sd' })] }))?.status).toBe('partial');
  });
});
