import { describe, expect, it } from 'vitest';
import { buildRowLayout, visibleRowRange } from './rowLayout';
import { ROW_H_GOAL, ROW_H_TASK } from './constants';
import type { Goal, Task } from '../types/domain';

const goal = (id: string, order: number, extra?: Partial<Goal>): Goal => ({
  id,
  name: id,
  color: 'goal-1',
  order,
  archived: false,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const task = (id: string, goalId: string, order: number, extra?: Partial<Task>): Task => ({
  id,
  goalId,
  name: id,
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  progress: 0,
  progressMode: 'manual',
  status: 'active',
  order,
  updatedAt: '',
  ...extra,
});

const goals = { g1: goal('g1', 0), g2: goal('g2', 1) };
const tasks = {
  t1: task('t1', 'g1', 1),
  t0: task('t0', 'g1', 0),
  t2: task('t2', 'g2', 0),
};

describe('buildRowLayout', () => {
  it('目标按 order、任务按 order 排列，top 逐行累计', () => {
    const layout = buildRowLayout(goals, tasks, []);
    expect(layout.rows.map((r) => r.id)).toEqual(['g1', 't0', 't1', 'g2', 't2']);
    expect(layout.rows.map((r) => r.top)).toEqual([
      0,
      ROW_H_GOAL,
      ROW_H_GOAL + ROW_H_TASK,
      ROW_H_GOAL + ROW_H_TASK * 2,
      ROW_H_GOAL * 2 + ROW_H_TASK * 2,
    ]);
    expect(layout.totalHeight).toBe(ROW_H_GOAL * 2 + ROW_H_TASK * 3);
    expect(layout.rowById.t1.goalId).toBe('g1');
    expect(layout.taskRowsByGoal.g1.map((r) => r.id)).toEqual(['t0', 't1']);
  });

  it('折叠目标只留目标行，后续行 top 前移', () => {
    const layout = buildRowLayout(goals, tasks, ['g1']);
    expect(layout.rows.map((r) => r.id)).toEqual(['g1', 'g2', 't2']);
    expect(layout.rowById.g2.top).toBe(ROW_H_GOAL);
    expect(layout.taskRowsByGoal.g1).toEqual([]);
  });

  it('archived 目标与软删除任务不进布局', () => {
    const layout = buildRowLayout(
      { ...goals, g3: goal('g3', 2, { archived: true }) },
      { ...tasks, t3: task('t3', 'g2', 1, { deletedAt: 'x' }) },
      [],
    );
    expect(layout.rows.some((r) => r.id === 'g3' || r.id === 't3')).toBe(false);
  });
});

describe('visibleRowRange', () => {
  const layout = buildRowLayout(goals, tasks, []); // 高度 40+48+48+40+48
  it('返回与 [yStart, yEnd) 相交的行下标闭区间', () => {
    expect(visibleRowRange(layout, 0, 40)).toEqual([0, 0]);
    expect(visibleRowRange(layout, 40, 90)).toEqual([1, 2]);
    expect(visibleRowRange(layout, 0, 1e6)).toEqual([0, 4]);
    expect(visibleRowRange(layout, 1e6, 2e6)).toEqual([4, 4]); // 越界 clamp 到最后一行
  });
  it('空布局返回空区间', () => {
    expect(visibleRowRange(buildRowLayout({}, {}, []), 0, 100)).toEqual([0, -1]);
  });
});
