import { describe, expect, it } from 'vitest';
import type { DayMark, Routine, RoutineLog, WorkItem } from '../types/domain';
import {
  planEditItem,
  planPatchRoutine,
  planMarkPersonSaid,
  planMove,
  planPatchItems,
  planSetDayMark,
  planSkipOccurrence,
  planToggleItem,
  planToggleOccurrence,
} from './deskPlan';
import { invertChange, type Change } from './types';

const T0 = '2026-10-01T00:00:00.000Z';
const NOW = '2026-10-16T09:00:00.000Z';

const wi = (id: string, p: Partial<WorkItem> = {}): WorkItem => ({
  id,
  kind: 'todo',
  title: id,
  urgency: 'normal',
  scope: 'work',
  status: 'open',
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  ...p,
});
const routine: Routine = { id: 'r', title: '巡检', scope: 'work', rule: { type: 'weekly', daysOfWeek: [3] }, startDate: '2026-01-01', order: 0, createdAt: T0, updatedAt: T0 };

const state = (p: { items?: WorkItem[]; logs?: RoutineLog[]; marks?: DayMark[] } = {}) => ({
  workItems: Object.fromEntries((p.items ?? []).map((e) => [e.id, e])),
  routines: { r: routine },
  routineLogs: Object.fromEntries((p.logs ?? []).map((e) => [e.id, e])),
  dayMarks: Object.fromEntries((p.marks ?? []).map((e) => [e.id, e])),
});

const after = (c: Change) => (c.type === 'put' ? c.after : null);

describe('事项', () => {
  it('勾选 open → done 记 doneAt；再勾回 open 去掉 doneAt', () => {
    const done = after(planToggleItem(state({ items: [wi('a')] }), 'a', NOW)[0]) as WorkItem;
    expect(done).toMatchObject({ status: 'done', doneAt: NOW, updatedAt: NOW });
    const back = after(planToggleItem(state({ items: [done] }), 'a', NOW)[0]) as WorkItem;
    expect(back.status).toBe('open');
    expect('doneAt' in back).toBe(false);
  });

  it('不做了也记 doneAt；未知 id 忽略', () => {
    const cs = planPatchItems(state({ items: [wi('a')] }), ['a', 'nope'], { status: 'dropped' }, NOW);
    expect(cs).toHaveLength(1);
    expect(after(cs[0])).toMatchObject({ status: 'dropped', doneAt: NOW });
  });

  it('patch 里给 undefined = 删掉字段（清除截止日）', () => {
    const cs = planPatchItems(state({ items: [wi('a', { dueDate: '2026-10-20' })] }), ['a'], { dueDate: undefined }, NOW);
    expect('dueDate' in (after(cs[0]) as WorkItem)).toBe(false);
  });

  it('某人的未完成跟进全部标为已说，别人的与已完成的不动', () => {
    const fu = (id: string, person: string, status: WorkItem['status'] = 'open') => wi(id, { kind: 'followup', person, mode: 'inform', status });
    const cs = planMarkPersonSaid(state({ items: [fu('1', '张经理'), fu('2', '张经理', 'done'), fu('3', '王芳')] }), '张经理', NOW);
    expect(cs.map((c) => (after(c) as WorkItem).id)).toEqual(['1']);
  });
});

describe('编辑事项', () => {
  const s = state({ items: [wi('a', { date: '2026-10-16', dueDate: '2026-10-20', goalId: 'g' }), wi('f', { kind: 'followup', person: '张经理', mode: 'dispatch' })] });
  it('一次改多个字段 = 一条 put；显式 undefined 删字段', () => {
    const cs = planEditItem(s, 'a', { title: ' 新标题 ', note: '备注', dueDate: undefined, goalId: undefined }, NOW);
    expect(cs).toHaveLength(1);
    const a = after(cs[0]) as WorkItem;
    expect(a).toMatchObject({ title: '新标题', note: '备注', updatedAt: NOW });
    expect('dueDate' in a || 'goalId' in a).toBe(false);
  });
  it('改排期日按挪动口径：往后 deferCount+1，往前不加', () => {
    expect((after(planEditItem(s, 'a', { date: '2026-10-19' }, NOW)[0]) as WorkItem).deferCount).toBe(1);
    expect('deferCount' in (after(planEditItem(s, 'a', { date: '2026-10-15' }, NOW)[0]) as WorkItem)).toBe(false);
  });
  it('待办 ⇄ 跟进：改成待办去掉对象；改成跟进没写对象仍是待办；写了对象缺省待告知', () => {
    const t = after(planEditItem(s, 'f', { kind: 'todo' }, NOW)[0]) as WorkItem;
    expect(t.kind).toBe('todo');
    expect('person' in t || 'mode' in t).toBe(false);
    expect(planEditItem(s, 'a', { kind: 'followup', person: '  ' }, NOW)).toEqual([]);
    expect(after(planEditItem(s, 'a', { kind: 'followup', person: '王芳' }, NOW)[0])).toMatchObject({ kind: 'followup', person: '王芳', mode: 'inform' });
  });
  it('什么都没变 ⇒ 不进撤销栈；标题清空 ⇒ 保留原标题', () => {
    expect(planEditItem(s, 'a', { title: 'a', urgency: 'normal' }, NOW)).toEqual([]);
    expect(planEditItem(s, 'a', { title: '   ' }, NOW)).toEqual([]);
  });
});

describe('改例行', () => {
  it('显式 undefined 删字段（清除时间、恢复暂停）', () => {
    const r = { ...state(), routines: { r: { ...routine, time: '09:00', paused: true } } };
    const a = after(planPatchRoutine(r, 'r', { time: undefined, paused: undefined, title: '周巡检' }, NOW)[0]) as Routine;
    expect(a).toMatchObject({ title: '周巡检', updatedAt: NOW });
    expect('time' in a || 'paused' in a).toBe(false);
  });
});

describe('挪动', () => {
  it('事项与例行一起挪，一条命令；例行记成「这一次改期」', () => {
    const s = state({ items: [wi('a', { date: '2026-10-16', dueDate: '2026-10-17' })] });
    const { changes, pastDue, moved } = planMove(
      s,
      [
        { type: 'item', id: 'a' },
        { type: 'routine', routineId: 'r', origDate: '2026-10-21' },
      ],
      () => '2026-10-22',
      NOW,
    );
    expect(moved).toBe(2);
    expect(pastDue).toBe(1);
    expect(after(changes[0])).toMatchObject({ date: '2026-10-22', deferCount: 1 });
    expect(after(changes[1])).toEqual({
      id: 'r:2026-10-21',
      routineId: 'r',
      date: '2026-10-21',
      status: 'moved',
      movedTo: '2026-10-22',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('挪回原日 = 删掉改期记录；例行不能进待处理；做完的这一次不挪', () => {
    const moved: RoutineLog = { id: 'r:2026-10-21', routineId: 'r', date: '2026-10-21', status: 'moved', movedTo: '2026-10-22', createdAt: T0, updatedAt: T0 };
    const key = { type: 'routine' as const, routineId: 'r', origDate: '2026-10-21' };
    expect(planMove(state({ logs: [moved] }), [key], () => '2026-10-21', NOW).changes).toEqual([{ table: 'routineLogs', type: 'delete', before: moved }]);
    expect(planMove(state(), [key], () => null, NOW).moved).toBe(0);
    const done: RoutineLog = { ...moved, status: 'done', movedTo: undefined };
    expect(planMove(state({ logs: [done] }), [key], () => '2026-10-23', NOW).moved).toBe(0);
  });

  it('没变化的不产生变更（已在目标日、待处理放回待处理）', () => {
    const s = state({ items: [wi('a', { date: '2026-10-19' }), wi('b')] });
    const r = planMove(s, [{ type: 'item', id: 'a' }, { type: 'item', id: 'b' }], (k) => (k.type === 'item' && k.id === 'a' ? '2026-10-19' : null), NOW);
    expect(r.moved).toBe(0);
  });

  it('撤销挪动 = 原样回到挪动前', () => {
    const before = wi('a', { date: '2026-10-16' });
    const { changes } = planMove(state({ items: [before] }), [{ type: 'item', id: 'a' }], () => '2026-10-19', NOW);
    const undo = invertChange(changes[0]);
    expect(undo.type === 'put' && undo.after).toEqual(before);
  });
});

describe('例行的一次', () => {
  it('无记录 → 完成（记实际在哪天做的）；再点 → 删掉记录', () => {
    const [c] = planToggleOccurrence(state(), 'r', '2026-10-14', '2026-10-16', NOW);
    const log = after(c) as RoutineLog;
    expect(log).toMatchObject({ id: 'r:2026-10-14', status: 'done', doneOn: '2026-10-16', doneAt: NOW });
    expect(planToggleOccurrence(state({ logs: [log] }), 'r', '2026-10-14', '2026-10-16', NOW)).toEqual([
      { table: 'routineLogs', type: 'delete', before: log },
    ]);
  });

  it('改期记录上勾选只切换 doneAt，仍保留改期', () => {
    const moved: RoutineLog = { id: 'r:2026-10-21', routineId: 'r', date: '2026-10-21', status: 'moved', movedTo: '2026-10-22', createdAt: T0, updatedAt: T0 };
    const done = after(planToggleOccurrence(state({ logs: [moved] }), 'r', '2026-10-21', '2026-10-22', NOW)[0]) as RoutineLog;
    expect(done).toMatchObject({ status: 'moved', movedTo: '2026-10-22', doneAt: NOW, doneOn: '2026-10-22' });
    const undone = after(planToggleOccurrence(state({ logs: [done] }), 'r', '2026-10-21', '2026-10-22', NOW)[0]) as RoutineLog;
    expect('doneAt' in undone).toBe(false);
  });

  it('跳过与取消跳过；跳过过的再勾选算完成', () => {
    const skipped = after(planSkipOccurrence(state(), 'r', '2026-10-14', NOW)[0]) as RoutineLog;
    expect(skipped.status).toBe('skipped');
    expect(planSkipOccurrence(state({ logs: [skipped] }), 'r', '2026-10-14', NOW)[0].type).toBe('delete');
    expect(after(planToggleOccurrence(state({ logs: [skipped] }), 'r', '2026-10-14', '2026-10-16', NOW)[0])).toMatchObject({ status: 'done' });
  });
});

describe('休/班标记', () => {
  it('设、改、清；同类型重复设置不产生变更', () => {
    const [c] = planSetDayMark(state(), '2026-10-10', 'work', NOW);
    const mark = after(c) as DayMark;
    expect(mark).toEqual({ id: '2026-10-10', date: '2026-10-10', type: 'work', updatedAt: NOW });
    expect(planSetDayMark(state({ marks: [mark] }), '2026-10-10', 'work', NOW)).toEqual([]);
    expect(after(planSetDayMark(state({ marks: [mark] }), '2026-10-10', 'off', NOW)[0])).toMatchObject({ type: 'off' });
    expect(planSetDayMark(state({ marks: [mark] }), '2026-10-10', null, NOW)[0].type).toBe('delete');
    expect(planSetDayMark(state(), '2026-10-10', null, NOW)).toEqual([]);
  });
});
