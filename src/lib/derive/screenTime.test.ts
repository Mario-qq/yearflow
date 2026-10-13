import { describe, expect, it } from 'vitest';
import type { CheckIn, Goal, Task } from '../../types/domain';
import {
  computeAppMinutes,
  evaluateRule,
  planScreenTimeCheckIns,
  type AbilityEvent,
} from './screenTime';

const MIN = 60_000;
const D0 = new Date(2026, 9, 12).getTime(); // 2026-10-12 00:00 本地
const D1 = D0 + 1440 * MIN;
const fg = (min: number, bundle: string, ability = 'Main'): AbilityEvent => ({ time: D0 + min * MIN, fg: true, bundle, ability });
const bg = (min: number, bundle: string, ability = 'Main'): AbilityEvent => ({ time: D0 + min * MIN, fg: false, bundle, ability });

describe('computeAppMinutes', () => {
  it('前台→后台配对累计', () => {
    const r = computeAppMinutes([fg(60, 'a'), bg(90, 'a'), fg(100, 'a'), bg(110, 'a'), fg(95, 'b'), bg(99, 'b')], D0, D1);
    expect(r).toEqual({ a: 40, b: 4 });
  });

  it('跨零点的会话按日界裁剪', () => {
    expect(computeAppMinutes([fg(-20, 'a'), bg(15, 'a')], D0, D1)).toEqual({ a: 15 });
    expect(computeAppMinutes([fg(1430, 'a'), bg(1460, 'a')], D0, D1)).toEqual({ a: 10 });
  });

  it('同一应用多个 ability 重叠只算一次', () => {
    const r = computeAppMinutes([fg(0, 'a', 'X'), fg(10, 'a', 'Y'), bg(20, 'a', 'Y'), bg(30, 'a', 'X')], D0, D1);
    expect(r).toEqual({ a: 30 });
  });

  it('缺后台事件的会话止于下一个其它应用前台；之后无事件则丢弃', () => {
    expect(computeAppMinutes([fg(0, 'sys'), fg(5, 'a'), bg(8, 'a')], D0, D1)).toEqual({ sys: 5, a: 3 });
    expect(computeAppMinutes([fg(0, 'sys')], D0, D1)).toEqual({});
  });

  it('前台事件重复上报不重置开始时间', () => {
    expect(computeAppMinutes([fg(0, 'a'), fg(5, 'a'), bg(10, 'a')], D0, D1)).toEqual({ a: 10 });
  });
});

describe('evaluateRule', () => {
  const reach = { apps: ['x'], mode: 'reach' as const, minutes: 30 };
  const cap = { apps: ['g', 'v'], mode: 'cap' as const, minutes: 60 };
  it('累计型：达标完成、不足做了一点、0 不记', () => {
    expect(evaluateRule(reach, { x: 30.4 }, true)).toEqual({ status: 'done', minutes: 30 });
    expect(evaluateRule(reach, { x: 12 }, false)).toEqual({ status: 'partial', minutes: 12 });
    expect(evaluateRule(reach, { x: 0.3 }, true)).toBeNull();
  });
  it('上限型：守住记完成且不写分钟；超出不记；非排期日不判', () => {
    expect(evaluateRule(cap, { g: 28.8, v: 30 }, true)).toEqual({ status: 'done' });
    expect(evaluateRule(cap, { g: 146.8 }, true)).toBeNull();
    expect(evaluateRule(cap, {}, false)).toBeNull();
  });
});

describe('planScreenTimeCheckIns', () => {
  const goal: Goal = { id: 'g1', name: '自律', color: '', order: 0, archived: false, createdAt: '', updatedAt: '' };
  const base: Task = {
    id: 't1', goalId: 'g1', name: '少玩游戏', startDate: '2026-10-01', endDate: '2026-12-31',
    progress: 0, progressMode: 'auto', status: 'active', order: 0, updatedAt: '',
    screenTime: { apps: ['game'], mode: 'cap', minutes: 60 },
  };
  const run = (tasks: Task[], checkIns: CheckIn[], apps: Record<string, number>, date = '2026-10-12') =>
    planScreenTimeCheckIns({
      date, apps, goals: [goal], tasks, checkIns, exemptions: [],
      label: (b) => b, now: 'NOW', newId: () => 'new',
    });

  it('无记录时新建自动打卡，带来源与备注', () => {
    const ops = run([base], [], { game: 20 });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'create',
      after: { id: 'new', status: 'done', source: 'screentime', note: '屏幕时间：game 20 分（上限 60 分）' },
    });
    expect((ops[0] as { after: CheckIn }).after.minutes).toBeUndefined();
  });

  it('手动打卡不改状态；累计型只补缺失的分钟', () => {
    const manual: CheckIn = { id: 'm', goalId: 'g1', taskId: 't1', date: '2026-10-12', status: 'skipped', createdAt: '', updatedAt: '' };
    expect(run([base], [manual], { game: 200 })).toEqual([]);
    const reachTask: Task = { ...base, screenTime: { apps: ['book'], mode: 'reach', minutes: 30 } };
    const ops = run([reachTask], [manual], { book: 45 });
    expect(ops).toEqual([{ type: 'update', before: manual, after: { ...manual, minutes: 45, updatedAt: 'NOW' } }]);
  });

  it('重采幂等：结果没变不产生变更；变成超限则撤掉自动打卡', () => {
    const first = run([base], [], { game: 20 });
    const auto = (first[0] as { after: CheckIn }).after;
    expect(run([base], [auto], { game: 20 })).toEqual([]);
    expect(run([base], [auto], { game: 90 })).toEqual([{ type: 'delete', before: auto }]);
  });

  it('用户删掉的自动打卡不再写回', () => {
    const auto = (run([base], [], { game: 20 })[0] as { after: CheckIn }).after;
    expect(run([base], [{ ...auto, deletedAt: 'X' }], { game: 20 })).toEqual([]);
  });

  it('不在任务日期范围、目标已归档、非排期日的上限型都跳过', () => {
    expect(run([base], [], { game: 1 }, '2026-09-30')).toEqual([]);
    const weekdays: Task = { ...base, recurrence: { type: 'weekdays' } };
    expect(run([weekdays], [], { game: 1 }, '2026-10-11')).toEqual([]); // 周日
    expect(
      planScreenTimeCheckIns({
        date: '2026-10-12', apps: { game: 1 }, goals: [{ ...goal, archived: true }], tasks: [base],
        checkIns: [], exemptions: [], label: (b) => b, now: 'NOW', newId: () => 'new',
      }),
    ).toEqual([]);
  });
});
