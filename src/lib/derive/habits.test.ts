import { describe, expect, it } from 'vitest';
import type { Habit, HabitLog } from '../../types/domain';
import { habitBadge, habitDayState, habitDueOn, habitHint, habitLogId, habitNudgesDue, habitView, habitViews } from './habits';

/* 2026-10 日历参考：10-12 周一 … 10-16 周五 10-17 周六 10-18 周日 10-19 周一（今天） */
const TODAY = '2026-10-19';
const T0 = '2026-10-01T00:00:00.000Z';

function habit(id: string, over: Partial<Habit> = {}): Habit {
  return { id, title: id, kind: 'do', startDate: '2026-10-01', order: 0, createdAt: T0, updatedAt: T0, ...over };
}

function logs(habitId: string, entries: Record<string, HabitLog['status']>): Record<string, HabitLog> {
  const out: Record<string, HabitLog> = {};
  for (const [date, status] of Object.entries(entries)) {
    const id = habitLogId(habitId, date);
    out[id] = { id, habitId, date, status, createdAt: T0, updatedAt: T0 };
  }
  return out;
}

describe('habitDueOn', () => {
  it('每天 / 选定星期 / 暂停 / 开始之前', () => {
    expect(habitDueOn(habit('a'), TODAY)).toBe(true);
    expect(habitDueOn(habit('a', { daysOfWeek: [1, 3] }), '2026-10-19')).toBe(true); // 周一
    expect(habitDueOn(habit('a', { daysOfWeek: [1, 3] }), '2026-10-20')).toBe(false); // 周二
    expect(habitDueOn(habit('a', { paused: true }), TODAY)).toBe(false);
    expect(habitDueOn(habit('a', { startDate: '2026-10-20' }), TODAY)).toBe(false);
    expect(habitDueOn(habit('a', { daysOfWeek: [] }), TODAY)).toBe(true); // 空数组 = 每天
  });
});

describe('habitDayState', () => {
  const h = habit('a');
  const avoid = habit('b', { kind: 'avoid' });
  it('要做的：做了 / 今天还没做 / 过去漏了', () => {
    const l = logs('a', { '2026-10-18': 'done' });
    expect(habitDayState(h, l, '2026-10-18', TODAY)).toBe('done');
    expect(habitDayState(h, l, TODAY, TODAY)).toBe('open');
    expect(habitDayState(h, l, '2026-10-17', TODAY)).toBe('missed');
  });
  it('忍住的：默认守住，记了才算破', () => {
    const l = logs('b', { '2026-10-18': 'slip' });
    expect(habitDayState(avoid, l, '2026-10-18', TODAY)).toBe('slip');
    expect(habitDayState(avoid, l, '2026-10-17', TODAY)).toBe('kept');
    expect(habitDayState(avoid, l, TODAY, TODAY)).toBe('kept');
  });
  it('不用做的日子是 off；软删的记录不算', () => {
    const wk = habit('a', { daysOfWeek: [1] });
    expect(habitDayState(wk, {}, '2026-10-18', TODAY)).toBe('off');
    const l = logs('a', { '2026-10-18': 'done' });
    l[habitLogId('a', '2026-10-18')].deletedAt = T0;
    expect(habitDayState(h, l, '2026-10-18', TODAY)).toBe('missed');
  });
});

describe('habitView：连续与「别连着断两天」', () => {
  it('今天做了算进连续；今天没做从昨天数', () => {
    const l = logs('a', { '2026-10-16': 'done', '2026-10-17': 'done', '2026-10-18': 'done' });
    expect(habitView(habit('a'), l, TODAY).streak).toBe(3);
    const l2 = { ...l, ...logs('a', { [TODAY]: 'done' }) };
    expect(habitView(habit('a'), l2, TODAY).streak).toBe(4);
  });
  it('不用做的日子跳过、不打断连续', () => {
    // 只在周一三五做：10-12 一、10-14 三、10-16 五、今天 10-19 一
    const wk = habit('a', { daysOfWeek: [1, 3, 5] });
    const l = logs('a', { '2026-10-12': 'done', '2026-10-14': 'done', '2026-10-16': 'done' });
    const v = habitView(wk, l, TODAY);
    expect(v.streak).toBe(3);
    expect(v.broke).toBe(0);
  });
  it('断一天 = 1（今天接上），连断两天 = 2，今天做了就清零', () => {
    const l = logs('a', { '2026-10-16': 'done', '2026-10-17': 'done' }); // 10-18 漏
    expect(habitView(habit('a'), l, TODAY).broke).toBe(1);
    const l2 = logs('a', { '2026-10-16': 'done' }); // 10-17、10-18 都漏
    expect(habitView(habit('a'), l2, TODAY).broke).toBe(2);
    const l3 = { ...l2, ...logs('a', { [TODAY]: 'done' }) };
    expect(habitView(habit('a'), l3, TODAY).broke).toBe(0);
  });
  it('忍住的：从昨天往回数守住的天数，破了就从头', () => {
    const avoid = habit('b', { kind: 'avoid', startDate: '2026-10-10' });
    const l = logs('b', { '2026-10-14': 'slip' });
    const v = habitView(avoid, l, TODAY);
    expect(v.state).toBe('kept');
    expect(v.streak).toBe(4); // 15、16、17、18
    expect(v.broke).toBe(0);
    const today = habitView(avoid, logs('b', { [TODAY]: 'slip' }), TODAY);
    expect(today.state).toBe('slip');
    expect(today.streak).toBe(0);
    expect(today.broke).toBe(1);
    expect(habitView(avoid, logs('b', { [TODAY]: 'slip', '2026-10-18': 'slip' }), TODAY).broke).toBe(2);
    expect(habitView(avoid, logs('b', { '2026-10-18': 'slip' }), TODAY).broke).toBe(1);
  });
  it('第一天开始：没有历史，不算断', () => {
    const v = habitView(habit('a', { startDate: TODAY }), {}, TODAY);
    expect(v).toMatchObject({ state: 'open', streak: 0, broke: 0 });
    expect(v.last14).toHaveLength(14);
    expect(v.last14[0]).toBe('off');
  });
});

describe('habitViews / 提醒 / 文案', () => {
  it('暂停的、还没开始的、软删的不显示；按 order 排', () => {
    const list = [
      habit('c', { order: 3 }),
      habit('a', { order: 1 }),
      habit('p', { paused: true }),
      habit('f', { startDate: '2026-10-20' }),
      habit('d', { deletedAt: T0 }),
    ];
    expect(habitViews(list, {}, TODAY).map((v) => v.habit.id)).toEqual(['a', 'c']);
  });
  it('到点、没做、没提醒过才提醒；忍住的没破就提醒，破了不提', () => {
    const vs = habitViews(
      [habit('a', { time: '21:30' }), habit('b', { time: '12:00', kind: 'avoid' }), habit('c'), habit('d', { time: '08:00' })],
      logs('d', { [TODAY]: 'done' }),
      TODAY,
    );
    expect(habitNudgesDue(vs, '21:00', []).map((v) => v.habit.id)).toEqual(['b']);
    expect(habitNudgesDue(vs, '21:30', []).map((v) => v.habit.id)).toEqual(['a', 'b']);
    expect(habitNudgesDue(vs, '22:00', ['a']).map((v) => v.habit.id)).toEqual(['b']);
    const slipped = habitViews([habit('b', { time: '12:00', kind: 'avoid' })], logs('b', { [TODAY]: 'slip' }), TODAY);
    expect(habitNudgesDue(slipped, '13:00', [])).toEqual([]);
  });
  it('文案', () => {
    expect(habitHint(habitView(habit('a', { cue: '刷完牙后', startDate: '2026-10-18' }), {}, TODAY))).toBe('昨天断了，今天接上');
    expect(habitHint(habitView(habit('a', { cue: '刷完牙后' }), {}, TODAY))).toBe('连断两次了，今天接上');
    expect(habitHint(habitView(habit('a', { cue: '刷完牙后', startDate: TODAY }), {}, TODAY))).toBe('刷完牙后');
    expect(habitHint(habitView(habit('a'), logs('a', { [TODAY]: 'done', '2026-10-18': 'done' }), TODAY))).toBe('连续 2 天');
    expect(habitHint(habitView(habit('b', { kind: 'avoid', startDate: '2026-10-16' }), {}, TODAY))).toBe('守住 3 天');
  });
  it('胶囊短标记：只在有信息量时出现', () => {
    expect(habitBadge(habitView(habit('a', { startDate: '2026-10-18' }), {}, TODAY))).toBe('昨天断了');
    expect(habitBadge(habitView(habit('a'), {}, TODAY))).toBe('连断2次');
    expect(habitBadge(habitView(habit('a', { startDate: TODAY }), {}, TODAY))).toBe('');
    expect(habitBadge(habitView(habit('a', { startDate: TODAY }), logs('a', { [TODAY]: 'done' }), TODAY))).toBe('');
    expect(habitBadge(habitView(habit('a'), logs('a', { [TODAY]: 'done', '2026-10-18': 'done' }), TODAY))).toBe('2天');
    expect(habitBadge(habitView(habit('b', { kind: 'avoid', startDate: '2026-10-16' }), {}, TODAY))).toBe('3天');
    expect(habitBadge(habitView(habit('b', { kind: 'avoid' }), logs('b', { [TODAY]: 'slip' }), TODAY))).toBe('今天破了');
    expect(habitBadge(habitView(habit('a', { daysOfWeek: [2] }), {}, TODAY))).toBe('');
  });
});
