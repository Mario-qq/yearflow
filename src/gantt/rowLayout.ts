/**
 * 行布局（纯函数，vitest 覆盖）——左侧网格与时间轴行对齐的唯一来源。
 * 两侧同时消费同一份 rows 数组；行虚拟化、y→行命中（跨泳道拖拽）都以此为准。
 * ghost 行 = 每个展开目标分组末尾的「+ 添加任务」矮行（空间常驻，内容 hover 才显示）。
 */
import type { Goal, Task } from '../types/domain';
import { ROW_H_GHOST, ROW_H_GOAL, ROW_H_TASK } from './constants';

export interface GanttRow {
  kind: 'goal' | 'task' | 'ghost';
  id: string;
  goalId: string; // goal 行 = 自身 id；ghost 行 = 所属目标 id
  top: number;
  height: number;
}

export interface RowLayout {
  rows: GanttRow[];
  totalHeight: number;
  rowById: Record<string, GanttRow>;
  /** goalId → 该目标的任务行（折叠时为空数组），汇总条/聚合热度条用 */
  taskRowsByGoal: Record<string, GanttRow[]>;
}

export function buildRowLayout(
  goals: Record<string, Goal>,
  tasks: Record<string, Task>,
  collapsedGoalIds: string[],
): RowLayout {
  const collapsed = new Set(collapsedGoalIds);
  const goalList = Object.values(goals)
    .filter((g) => !g.archived && !g.deletedAt)
    .sort((a, b) => a.order - b.order);
  const tasksByGoal = new Map<string, Task[]>();
  for (const t of Object.values(tasks)) {
    if (t.deletedAt) continue;
    const list = tasksByGoal.get(t.goalId);
    if (list) list.push(t);
    else tasksByGoal.set(t.goalId, [t]);
  }

  const rows: GanttRow[] = [];
  const rowById: Record<string, GanttRow> = {};
  const taskRowsByGoal: Record<string, GanttRow[]> = {};
  let top = 0;
  for (const goal of goalList) {
    const goalRow: GanttRow = { kind: 'goal', id: goal.id, goalId: goal.id, top, height: ROW_H_GOAL };
    rows.push(goalRow);
    rowById[goal.id] = goalRow;
    taskRowsByGoal[goal.id] = [];
    top += ROW_H_GOAL;
    if (collapsed.has(goal.id)) continue;
    const goalTasks = (tasksByGoal.get(goal.id) ?? []).sort((a, b) => a.order - b.order);
    for (const task of goalTasks) {
      const row: GanttRow = { kind: 'task', id: task.id, goalId: goal.id, top, height: ROW_H_TASK };
      rows.push(row);
      rowById[task.id] = row;
      taskRowsByGoal[goal.id].push(row);
      top += ROW_H_TASK;
    }
    const ghost: GanttRow = { kind: 'ghost', id: `ghost-${goal.id}`, goalId: goal.id, top, height: ROW_H_GHOST };
    rows.push(ghost);
    rowById[ghost.id] = ghost;
    top += ROW_H_GHOST;
  }
  return { rows, totalHeight: top, rowById, taskRowsByGoal };
}

/** body y 坐标 → 命中行（二分；越界返回 null） */
export function rowAtY(layout: RowLayout, y: number): GanttRow | null {
  const { rows } = layout;
  if (y < 0 || rows.length === 0 || y >= layout.totalHeight) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].height <= y) lo = mid + 1;
    else hi = mid;
  }
  return rows[lo];
}

/** 可视 y 范围 → 可视行下标闭区间（虚拟化用） */
export function visibleRowRange(layout: RowLayout, yStart: number, yEnd: number): [number, number] {
  const { rows } = layout;
  if (rows.length === 0) return [0, -1];
  let lo = 0;
  while (lo < rows.length - 1 && rows[lo].top + rows[lo].height <= yStart) lo++;
  let hi = lo;
  while (hi < rows.length - 1 && rows[hi + 1].top < yEnd) hi++;
  return [lo, hi];
}
